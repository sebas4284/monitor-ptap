# Observación de viabilidad de `connectionStatus` (FASE 0.3)

Objetivo: antes de rediseñar `connectionStatus`, distinguir tres hipótesis sobre por
qué DN/ER/TO leyeron 0 en la FASE 0.2, y elegir con datos cómo derivar el estado de
conexión por sitio.

| Campo | Valor |
|---|---|
| **Fecha/hora** | 2026-07-14 (UTC) |
| **Servidor** | `opc.tcp://181.204.165.66:59100` (FactoryTalk Optix, `Running`) |
| **Sesión** | `None` + `Anonymous` — **solo lectura** (fachada `ReadOnlySession`) |
| **Scripts** | `tools/plc-discovery/src/observe-liveness.ts` (M1/M2/M3), `observe-ts-freshness.ts` (M4) |
| **Artefactos crudos** | `output/liveness_observation.json`, `output/ts_freshness_observation.json` (gitignored) |
| **Operaciones** | `Browse`, `Read`. Nunca `Write`, `Call` ni `Subscription`. |

---

## Medición 1 — ¿los MSG están corriendo? (60 s, bits EN/EW/ST/DN/ER/TO)

| Sitio | EN | EW | ST | DN | ER | TO |
|---|---|---|---|---|---|---|
| MONTEBELLO | **1 (latcheado)** | 0 | **1 (latcheado)** | 0 | 0 | 0 |
| VORAGINE | **1** | 0 | **1** | 0 | 0 | 0 |
| QUIJOTE | **1** | 0 | **1** | 0 | 0 | 0 |

`EN` (Enable) y `ST` (Start) están **en alto de forma sostenida** (duty cycle 1.0, 0
transiciones) en los 3 sitios. Las instrucciones MSG **están habilitadas y ejecutándose
de forma continua**.

> **→ Hipótesis H-b REFUTADA. Los MSG SÍ se están ejecutando.** (No es un hallazgo para
> la planta; no aplica la condición de parada.) DN=0 con EN/ST latcheados es el patrón
> clásico de un MSG re-disparado continuamente: `DN` pulsa un scan al completar y se
> limpia al re-ejecutar — transitorio, prácticamente inobservable.

## Medición 2 — ¿los datos se mueven? (180 s, 28 buffers realIn/intIn, 90 muestras)

| Sitio | Índices que cambiaron | Cambios totales | Contadores monótonos | Máx. sin cambio | ¿Estático? |
|---|---|---|---|---|---|
| SIRENA | 25 | 1268 | 2 | ≤2 s | no |
| SOLEDAD | 20 | 918 | 2 | ≤2 s | no |
| CAMPOALEGRE | 13 | 734 | 2 | ≤2 s | no |
| ALTO_MANGOS | 7 | 384 | 2 | ≤2 s | no |
| QUIJOTE | 2 | 140 | 0 | ≤6 s | no |
| SAN_ANTONIO | 2 | 138 | 0 | ≤4 s | no |
| MONTEBELLO | 5 | **5** | 2 | **140 s** | no (apenas) |
| **VORAGINE** | 0 | 0 | 0 | 180 s | **SÍ** |
| **CASCAJAL** | 0 | 0 | 0 | 180 s | **SÍ** |
| **KM18** | 0 | 0 | 0 | 180 s | **SÍ** |
| **PICHINDE** | 0 | 0 | 0 | 180 s | **SÍ** |
| **CARBONERO** | 0 | 0 | 0 | 180 s | **SÍ** |

- **7 sitios con datos vivos**; sus valores instantáneos refrescan cada ≤2–6 s. 0 lecturas Bad.
- Los "contadores monótonos" son **totalizadores** (acumuladores de volumen: 645594,
  169933, 544371…), que incrementan **muy lento** (Δ1–2 en 180 s ≈ un paso cada ~90–120 s).
  Útiles como respaldo de vida, **no** como heartbeat rápido.
- **MONTEBELLO está conectado** (EN/ST altos, totalizador tickeando) pero tuvo un tramo
  de **140 s sin ningún cambio**. Un sitio conectado puede quedarse quieto.
- **5 sitios completamente estáticos en 3 minutos** (VORAGINE, CASCAJAL, KM18, PICHINDE,
  CARBONERO). VORAGINE tenía datos no-nulos en la captura inicial, ahora congelados →
  **probablemente desconectados AHORA**, aunque no se puede probar "desconectado" vs
  "genuinamente quieto" solo con OPC UA. **Requiere confirmación de la planta.**

## Medición 3 — techo de resolución del servidor (30 s, máx. frecuencia)

Buffer activo `DATOS_REAL_IN_MANGOS`: 110 lecturas, 103 SourceTimestamps distintos,
**minDelta = 100 ms**, meanDelta = 294 ms (≈ nuestro intervalo de lectura de ~270 ms).

El servidor actualiza el SourceTimestamp con un piso de ~100 ms. Un scan de PLC dura
~1–50 ms. Como el piso de captura de Optix (~100 ms) es **mucho más grueso que un scan**,
un pulso `DN` de un scan **no es capturado por el propio Optix**, y por lo tanto **ningún
MonitoredItem del cliente podrá entregarlo**, por más `queueSize`/`samplingInterval` que
se pida (el servidor no puede entregar lo que él mismo no muestreó).

> **→ H-c CONFIRMADA (para DN). DN es inobservable por OPC UA.** Combinado con M1
> (H-a: el pulso es demasiado rápido), la conclusión es firme: **descartar DN como
> fuente de `connectionStatus`.** La opción (1) del prompt (DN por MonitoredItem
> encolado) queda **descartada**.

## Medición 4 — ¿el SourceTimestamp avanza con valor estático? (30 s) — decisiva

| Buffer | Lecturas | Timestamps distintos | Cambios de valor | ¿TS avanza con valor estático? |
|---|---|---|---|---|
| REAL_IN_SOLEDAD (activo) | 30 | **30** | 29 | — (el valor cambia) |
| REAL_IN_MONTEBELLO (lento) | 30 | **1** | 0 | **NO** |
| REAL_IN_VORAGINE (estático) | 30 | **1** | 0 | **NO** |

> **→ El SourceTimestamp es dirigido-por-cambio, no por sondeo.** Solo avanza cuando el
> valor cambia. Por lo tanto **`SourceTimestamp` ≡ frescura de valor**: no aporta
> información extra y **no distingue "conectado pero quieto" de "desconectado".**

---

## Veredicto

| Hipótesis | Resultado |
|---|---|
| H-b (MSG detenidos) | **REFUTADA** — EN/ST latcheados; 7 sitios con datos vivos |
| H-a (pulso más rápido que lo observable) | **Cierta** — DN nunca visto en 300+ muestras |
| H-c (Optix no captura el pulso) | **CONFIRMADA** — piso del servidor ~100 ms ≫ scan |

**`connectionStatus` NO puede derivarse de DN/ER/TO ni del SourceTimestamp.** La única
evidencia positiva de vida disponible hoy es el **movimiento de datos** (algún valor o
totalizador cambió).

## Recomendación final para `connectionStatus` (input de Fase 2)

**Opción elegida: (2) frescura de datos**, con matices obligados por los datos:

1. **Señal:** un sitio está `live` si **algún índice de sus buffers de entrada cambió**
   (o su totalizador incrementó) dentro de los últimos **N** segundos. Se evalúa en el
   backend comparando snapshots sucesivos (el parser ya hace el diff — regla 6).

2. **Modelo de 3 estados** (no un booleano), porque un sitio conectado puede estar quieto:
   - `live` (verde): algún valor cambió en los últimos **~10 s**. Indicador de actividad para UX.
   - `idle` (ámbar): sin cambios de valor rápidos, pero **hubo algún cambio/totalizador
     en los últimos N s**. Conectado pero con proceso quieto.
   - `stale` (rojo): **ningún cambio en N s**. Probable desconexión.

3. **Valor de N (justificado con lo medido):** el sitio conectado más lento
   (MONTEBELLO) estuvo **140 s sin ningún cambio**. Para no marcar "desconectado" a un
   sitio conectado-pero-quieto, **N debe superar ese hueco con margen**:
   **N recomendado = 300 s (5 min)**. Implica que detectar una desconexión real tiene una
   **latencia de hasta ~5 min** — aceptable para una PTAP (no es un servo), pero debe
   documentarse en el tablero. El umbral `live` de ~10 s da la sensación de "tiempo real".

4. **Los 5 sitios estáticos** (VORAGINE, CASCAJAL, KM18, PICHINDE, CARBONERO) hoy no
   emiten ninguna señal de vida → arrancarían en `stale`. Puede ser real (desconectados)
   o falso (proceso quieto). **Marcar como "sin señal de vida — requiere validación en
   planta", nunca como "conectado".**

### Limitación estructural y solicitud a la planta

No existe hoy un **heartbeat/scan counter libre** (un valor que incremente cada scan
del PLC, independiente del proceso). Los totalizadores dependen de que haya caudal.
Sin ese contador, `connectionStatus` es un "los datos se movieron en los últimos N min"
con latencia inherente y 5 sitios inevaluables.

> **Solicitud formal a la planta / integrador (paralela al L5X):** exponer en el payload
> de cada sitio un **contador de heartbeat de 16/32 bits que incremente cada scan** del
> PLC local. Eso convertiría `connectionStatus` en una señal rápida (N = pocos segundos)
> y fiable para los 12 sitios, y eliminaría la ambigüedad "quieto vs desconectado".

## Impacto sobre el plan de Fase 1/2

- **Descartar** la Subscription de DN para conectividad. La Subscription de datos
  (1 MonitoredItem por buffer de entrada, regla 6) **ya provee** la señal: el diff de
  elementos del parser alimenta directamente el evaluador de frescura.
- `publishingInterval` de 2000 ms es adecuado para la frescura (los sitios activos
  refrescan cada ≤2–6 s); no hay que perseguir milisegundos.
- El agregador de `connectionStatus` (ventana de N=300 s + umbral live 10 s) se
  implementa en el Snapshot Builder / Quality Service de Fase 2, no en el adaptador.
