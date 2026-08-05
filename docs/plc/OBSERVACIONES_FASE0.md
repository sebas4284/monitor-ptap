# Fase 0 — Observaciones de solo lectura contra el PLC real

> **Documento fusionado.** Reúne los cuatro informes de observación de la Fase 0 que antes vivían
> sueltos (`PHASE0_VERIFICATION.md`, `MSG_BITS_OBSERVATION.md`, `LIVENESS_OBSERVATION.md`,
> `FLOW_VALIDATION.md`). Se leen como una sola investigación porque lo son: cada medición nació de
> lo que refutó la anterior.
>
> **Todas las observaciones fueron de SOLO LECTURA** (`Browse`, `BrowseNext`, `Read`). Nunca `Write`,
> nunca `Call`, nunca `Subscription`. La fachada `ReadOnlySession` de `tools/plc-discovery` no expone
> esos métodos — es una garantía estructural, no una promesa.

| Campo | Valor |
|---|---|
| **Servidor** | `opc.tcp://181.204.165.66:59100` (FactoryTalk Optix HMI, estado `Running`) |
| **Sesión** | `SecurityMode=None` + identidad `Anonymous` (hallazgo P0, ver [`../SECURITY_FINDING_P0.md`](../SECURITY_FINDING_P0.md)) |
| **Fechas** | 2026-07-14 |
| **Artefactos crudos** | `tools/plc-discovery/output/*.json` (gitignored) |

**El desenlace, por si solo necesitas la conclusión:** `connectionStatus` **no puede** derivarse de
los bits DN/ER/TO ni del `SourceTimestamp`. La única evidencia positiva de vida que el PLC expone hoy
es el **movimiento de los datos**. De ahí salió el modelo de 3 estados (`live`/`idle`/`stale`) que
implementa la Fase 2 en `liveness.tracker.ts`.

---

## 1. Verificación del contrato de mapeo (Fase 0.1)

Dos correcciones de `opc_mapping.json` que no podían resolverse con los artefactos capturados y
exigían leer el servidor real. Herramienta: `tools/plc-discovery/src/verify-phase0.ts`.
Lectura: 2026-07-14T10:52:32.242Z.

### Hallazgo 3 — Topología de los sitios atípicos (san-antonio, quijote)

**Duda:** ambos salieron con un único buffer (`realIn:1`, `msgRead:1`) y sin `intIn`/`intOut`/
`msgWrite`. ¿Topología real o captura truncada?

**Resultado — es la topología real.** Son sitios mínimos (solo nivel de tanque + estado de
comunicación):

| Sitio | Canales presentes | Buffers |
|---|---|---|
| `san-antonio` | `realIn`, `msgRead` | `REAL_TK_SAN_ANTONO`, `MSG_READ_REAL_SAN_ANTONIO` |
| `quijote` | `realIn`, `msgRead` | `REAL_TK_QUIJOTE`, `MSG_READ_REAL_QUIJOTE` |

No existen para estos sitios buffers `intIn`, `intOut`, `bitIn`, `realOut` ni `msgWrite`. **No fue
captura truncada.** El buffer de entrada es un array de tanque (`REAL_TK_*`), coherente con
estaciones que solo reportan nivel.

**Acción aplicada:** ambas plantas llevan `topologyVerified: true` y solo declaran los canales que
existen (los ausentes se omiten, no se rellenan con `[]`).

### Hallazgo 5 — `confidence` de `connection` (DN/ER/TO)

**Duda:** los 12 sitios se marcaron `confirmed` habiendo leído de verdad un solo sitio
(CAMPOALEGRE). Los otros 11 se localizaron por patrón de browse — inferencia estructural, no
lectura confirmada.

**Método:** localizar el `MSG_READ` primario (el que **no** es `_INT_`) de cada sitio, browse de sus
hijos para obtener los NodeIds de `DN`/`ER`/`TO`, y **leer** los tres valores. `confirmed` solo si
los tres responden `StatusCode = Good`.

**Resultado — los 12 sitios respondieron `Good` en los tres bits.** MSG_READ primario por sitio:
`MSG_READ_VORAGINE`, `MSG_READ_REAL_SOLEDAD`, `MSG_READ_REAL_MONTEBELLO`, `MSG_READ_CASCAJAL`,
`MSG_READ_KM18`, `MSG_READ_REAL_ALTO_MANGOS`, `MSG_READ_REAL_CAMPOALEGRE`, `MSG_READ_REAL_PICHINDE`,
`MSG_READ_REAL_CARBONERO`, `MSG_READ_REAL_SIRENA`, `MSG_READ_REAL_SAN_ANTONIO`,
`MSG_READ_REAL_QUIJOTE`.

**Acción aplicada:** el generador toma el `confidence` por sitio desde este resultado (no lo asume) y
cada `connection` lleva un campo `evidence` con la fecha. Si en una regeneración futura algún sitio
no respondiera `Good`, bajaría automáticamente a `inferred`.

> ⚠️ **Qué significa aquí `confirmed`:** "el bit DN/ER/TO fue leído con calidad Good", es decir
> confirmamos **la identidad del mapeo**. **No** significa "el sitio está conectado" ni que
> conozcamos el significado de cada índice de los arrays. Las señales de proceso siguen `unmapped`
> a la espera del export L5X, y los `displayName` siguen provisionales en las 12 plantas.

---

## 2. Los bits DN/ER/TO no sirven como estado de conexión (Fase 0.2)

Script: `observe-msg-bits.ts`. 2026-07-14T11:19:16Z. 60 s, 144 muestras, 3 sitios (MONTEBELLO rico,
VORAGINE estándar, QUIJOTE mínimo), 0 lecturas Bad.

| Sitio | DN duty cycle | DN transiciones | DN máx. en bajo | ER activó | TO activó |
|---|---|---|---|---|---|
| MONTEBELLO | **0.000** | 0 | 60 192 ms (todo el tramo) | no | no |
| VORAGINE | **0.000** | 0 | 60 192 ms | no | no |
| QUIJOTE | **0.000** | 0 | 60 192 ms | no | no |

**Las 9 series (3 sitios × 3 bits) fueron `false` en las 144 muestras**, todas con `StatusCode = Good`.

### Interpretación

1. **La fórmula directa queda refutada.** `connectionStatus = DN && !ER && !TO` reportaría
   **"desconectado" el 100 % del tiempo, para todos los sitios** — incluido VORAGINE, que en la
   captura de descubrimiento entregó datos vivos y no-nulos
   (`REAL_IN_VORAGINE = [7.599, 395811.125, …]`). Un tablero construido sobre la lectura instantánea
   de DN estaría **siempre en rojo**, lo cual es falso.

2. **DN es un pulso transitorio de la instrucción MSG de Rockwell.** Se pone en alto al completar el
   mensaje y se limpia al re-disparar; si el maestro re-dispara continuamente, DN está en alto solo
   uno o pocos scans (~10–50 ms).

3. **Advertencia de método, importante:** el muestreo real fue de **418 ms**, no de los 200 ms
   solicitados — el round-trip contra la IP pública es ~218 ms. Es **demasiado grueso para
   caracterizar un pulso de un scan.** Por lo tanto **no** se puede afirmar "DN nunca pulsa"; solo
   que **DN estuvo en bajo en los 144 instantes muestreados**. Esa honestidad es la que motivó la
   Fase 0.3.

---

## 3. Viabilidad de `connectionStatus`: qué sí indica vida (Fase 0.3)

Scripts: `observe-liveness.ts` (M1–M3), `observe-ts-freshness.ts` (M4). Objetivo: distinguir tres
hipótesis sobre por qué DN/ER/TO leyeron 0.

### Medición 1 — ¿los MSG están corriendo? (60 s, bits EN/EW/ST/DN/ER/TO)

| Sitio | EN | EW | ST | DN | ER | TO |
|---|---|---|---|---|---|---|
| MONTEBELLO | **1 (latcheado)** | 0 | **1 (latcheado)** | 0 | 0 | 0 |
| VORAGINE | **1** | 0 | **1** | 0 | 0 | 0 |
| QUIJOTE | **1** | 0 | **1** | 0 | 0 | 0 |

`EN` (Enable) y `ST` (Start) están **en alto de forma sostenida** (duty cycle 1.0, 0 transiciones).
Las instrucciones MSG **están habilitadas y ejecutándose de forma continua**.

> **→ Hipótesis H-b (MSG detenidos) REFUTADA.** DN=0 con EN/ST latcheados es el patrón clásico de un
> MSG re-disparado continuamente.

### Medición 2 — ¿los datos se mueven? (180 s, 28 buffers realIn/intIn, 90 muestras)

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

- **7 sitios con datos vivos**; sus valores refrescan cada ≤2–6 s. 0 lecturas Bad.
- Los "contadores monótonos" son **totalizadores** de volumen (645594, 169933, 544371…), que
  incrementan **muy lento** (Δ1–2 en 180 s ≈ un paso cada ~90–120 s). Útiles como respaldo de vida,
  **no** como heartbeat rápido.
- **MONTEBELLO está conectado** (EN/ST altos, totalizador tickeando) pero tuvo un tramo de **140 s
  sin ningún cambio**. Un sitio conectado puede quedarse quieto — este dato es el que fija el
  umbral N más abajo.
- **5 sitios completamente estáticos en 3 minutos.** VORAGINE tenía datos no-nulos en la captura
  inicial, ahora congelados → **probablemente desconectados**, aunque no se puede probar
  "desconectado" vs "genuinamente quieto" solo con OPC UA. **Requiere confirmación de la planta.**

### Medición 3 — techo de resolución del servidor (30 s)

Buffer activo `DATOS_REAL_IN_MANGOS`: 110 lecturas, 103 SourceTimestamps distintos,
**minDelta = 100 ms**, meanDelta = 294 ms.

El servidor actualiza el SourceTimestamp con un piso de ~100 ms. Un scan de PLC dura ~1–50 ms. Como
el piso de captura de Optix es **mucho más grueso que un scan**, un pulso `DN` de un scan **no lo
captura el propio Optix**, y por tanto **ningún MonitoredItem del cliente podrá entregarlo**, por más
`queueSize`/`samplingInterval` que se pida — el servidor no puede entregar lo que él mismo no
muestreó.

> **→ H-c CONFIRMADA. DN es inobservable por OPC UA.** Esto cierra la puerta también a la opción de
> "DN por MonitoredItem encolado" que la Fase 0.2 había sugerido como camino.

### Medición 4 — ¿el SourceTimestamp avanza con valor estático? (30 s) — decisiva

| Buffer | Lecturas | Timestamps distintos | Cambios de valor | ¿TS avanza con valor estático? |
|---|---|---|---|---|
| REAL_IN_SOLEDAD (activo) | 30 | **30** | 29 | — (el valor cambia) |
| REAL_IN_MONTEBELLO (lento) | 30 | **1** | 0 | **NO** |
| REAL_IN_VORAGINE (estático) | 30 | **1** | 0 | **NO** |

> **→ El SourceTimestamp es dirigido-por-cambio, no por sondeo.** Solo avanza cuando el valor cambia.
> Por lo tanto `SourceTimestamp` ≡ frescura de valor: no aporta información extra y **no distingue
> "conectado pero quieto" de "desconectado".**

### Veredicto de hipótesis

| Hipótesis | Resultado |
|---|---|
| H-b (MSG detenidos) | **REFUTADA** — EN/ST latcheados; 7 sitios con datos vivos |
| H-a (pulso más rápido que lo observable) | **Cierta** — DN nunca visto en 300+ muestras |
| H-c (Optix no captura el pulso) | **CONFIRMADA** — piso del servidor ~100 ms ≫ scan |

### Diseño resultante de `connectionStatus`

**Señal:** un sitio está vivo si **algún índice de sus buffers de entrada cambió** (o su totalizador
incrementó) dentro de los últimos **N** segundos. Se evalúa en el backend comparando snapshots
sucesivos (el parser ya hace el diff).

**Modelo de 3 estados**, no un booleano, porque un sitio conectado puede estar quieto:

- `live` (verde): algún valor cambió en los últimos **~10 s**.
- `idle` (ámbar): sin cambios rápidos, pero hubo algún cambio/totalizador en los últimos N s.
- `stale` (rojo): **ningún cambio en N s**. Probable desconexión.

**Valor de N, justificado con lo medido:** el sitio conectado más lento (MONTEBELLO) estuvo **140 s
sin ningún cambio**. Para no marcar "desconectado" a un sitio conectado-pero-quieto, N debe superar
ese hueco con margen: **N = 300 s (5 min)**. Implica que detectar una desconexión real tiene una
**latencia de hasta ~5 min** — aceptable para una PTAP (no es un servo), pero **debe documentarse en
el tablero**. El umbral `live` de ~10 s da la sensación de tiempo real.

**Los 5 sitios estáticos** arrancarían en `stale`. Puede ser real o falso. **Marcar como "sin señal
de vida — requiere validación en planta", nunca como "conectado".**

### Limitación estructural y solicitud abierta a la planta

No existe hoy un **heartbeat/scan counter libre** (un valor que incremente cada scan del PLC,
independiente del proceso). Los totalizadores dependen de que haya caudal. Sin ese contador,
`connectionStatus` es un "los datos se movieron en los últimos N min" con latencia inherente y 5
sitios inevaluables.

> **📋 Solicitud formal a la planta / integrador (paralela al export L5X), aún ABIERTA:** exponer en
> el payload de cada sitio un **contador de heartbeat de 16/32 bits que incremente cada scan** del
> PLC local. Eso convertiría `connectionStatus` en una señal rápida (N = pocos segundos) y fiable
> para los 12 sitios, y eliminaría la ambigüedad "quieto vs desconectado".

**Consecuencia sobre el diseño del puente:** el `publishingInterval` de 2000 ms es adecuado para la
frescura (los sitios activos refrescan cada ≤2–6 s); no hay que perseguir milisegundos. El agregador
vive en el Snapshot Builder / Quality Service, no en el adaptador.

---

## 4. Validación del caudal de Montebello

2026-07-14. Buffer `REAL_IN_MONTEBELLO` → NodeId resuelto en vivo
`ns=9;g=EBA8E3EB-53A2-0CCD-3912-501C0F7E4C8F`.

**Hipótesis de la documentación de planta:** `[0]` = caudal de entrada 1 (l/s), `[5]` = caudal de
entrada 2 (l/s). NodeId del HMI `g=eba8e3eb-…`, valor observado en HMI: 14.22.

### Coherencia del NodeId ✅

El identifier del HMI coincide con el del mapping (mismo GUID; OPC UA es case-insensitive en GUIDs).
**El HMI lee el mismo buffer que el backend suscribe.**

### Array crudo (50 elementos)

| idx | valor | idx | valor |
|----:|------|----:|------|
| 0 | **14.168** | 10 | 36.331 |
| 1 | **170466.516** | 11 | 262144 |
| 2 | 0 | 15 | 2.509 |
| 3 | 1913.594 | 16 | 3.133 |
| 5 | **23.206** | 17 | −11.603 |
| 6 | 262144 | 18–49 | 0 (mayoría) |

- **idx[0] = 14.168** → decimal de 2 cifras. Coincide con el HMI (14.22) dentro de la variación
  normal del proceso (Δ ≈ 0.05, muestreado en otro instante).
- **idx[1] = 170466.5** → 6 cifras. **Es el TOTALIZADOR**, ya identificado en la Fase 0.3 (≈169933).
  **idx[0] no se confunde con él** — la prueba de disambiguación que el método exigía se cumple.
- **idx[5] = 23.206** → plausible como segundo caudal en l/s.
- Los demás índices quedan **unmapped**. No se mapean por conveniencia.

### Muestreo temporal (180 s @ 1 s, 134 muestras)

| índice | valores distintos | cambios | min | max | veredicto |
|---|---:|---:|---|---|---|
| 0 (inletFlow1) | 3 | 3 | 14.1687 | 14.1875 | **vivo**, estable ~14.18 l/s |
| 1 (totalizador) | 4 | 3 | 170466.5 | 170468.5 | **monótono creciente** |
| 5 (inletFlow2) | 4 | 3 | 23.1375 | 23.2063 | **vivo**, ~23.2 l/s |

**Corroboración cruzada:** el totalizador creció ~1.98 unidades en 180 s = ~0.011 u/s. Si la unidad
es m³, eso es **~11 l/s**, del mismo orden que idx0 (~14 l/s). El caudal instantáneo y la tasa de
cambio del acumulador son coherentes → refuerza que idx0 es un caudal y idx1 su totalizador.

### Veredicto: RESPALDADA

La documentación coincide con lo cargado en el PLC. Pero **no alcanza para `confidence: confirmed`**,
y por dos razones que el contrato exige y que esta validación no puede resolver sola:

1. **El documento de la planta debe vivir en el repo** (`docs/plant-documentation/`, campo
   `evidenceRef`). "confirmed" significa "evidencia verificable por un tercero dentro de un año sin
   preguntarnos"; esta validación empírica lo *respalda*, pero la fuente es el documento oficial.
2. **El `max` físico** de cada caudal debe salir de la capacidad de diseño de la planta, no
   inventarse. Los valores observados (~14 y ~23 l/s) no fijan el máximo físico.

---

## Índices `PENDIENTE DE RECTIFICAR` que siguen abiertos

Anotados en `apps/api/config/opc_mapping.json` y en `scripts/generate-mapping.ts`:

- **montebello** — semántica de los índices de tanque desconocida.
- **soledad** — los tanques de san-antonio/quijote se retransmiten en el buffer de soledad.
- **cascajal** — la presión de entrada lee 384 psi; verificar contra el HMI.
