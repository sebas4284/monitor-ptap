# Propuesta — recarga en caliente de `opc_mapping.json` (Fase 3, pendiente de aprobación)

> **Estado: PROPUESTA. Nada de esto está implementado.** La Fase 3 del PROMPT MAESTRO dice
> literalmente: *"Hot-reload opcional del mapping (SIGHUP o endpoint admin) → **proponlo, no lo
> implementes sin mi OK**"*. Este documento es ese entregable pendiente. Hoy el mapping es
> **inmutable en runtime**: `loadMapping()` cachea por ruta resuelta
> ([opc-mapping.loader.ts:439](../apps/api/src/infrastructure/connectivity/mapping/opc-mapping.loader.ts#L439))
> y cambiar el JSON exige reiniciar el backend.

## 1. Qué problema resolvería (y cuál no)

Cada corrección de semántica —un índice que el operador confirma por HMI, una presión que resulta
estar en otra posición, una válvula que sube a `confirmed`— hoy termina en un reinicio del backend
en producción. Ese reinicio cuesta, medido en [OPERATIONAL_VALIDATION.md §5](OPERATIONAL_VALIDATION.md):
**~3 s hasta `Connected` y ~5 s hasta el primer snapshot** con el build compilado. No es catastrófico,
y ahí está la primera conclusión honesta de esta propuesta: **el reinicio no duele lo suficiente para
justificar cualquier diseño**. Lo que sí duele es lo que el reinicio arrastra con él:

- Se pierde la **cache RAM** de las 12 plantas → todos los clientes ven `pending` unos segundos.
- Se **reinicia el `sequence`** de cada planta → todos los clientes detectan hueco y piden refresh
  por REST a la vez.
- Se cae la **sesión OPC UA y la Subscription** → se re-resuelven los NodeIds y se re-crean los ~78
  MonitoredItems contra el PLC de la planta, por un cambio que no tiene nada que ver con el PLC.
- Se pierde el **liveness acumulado** (`LivenessTracker`), así que durante la ventana siguiente el
  estado de cada planta vuelve a ser provisional.
- Se pierde el **dead letter** en RAM, que es justo la evidencia que se estaba mirando cuando se
  corrigió el mapping.

Lo que un hot-reload **no** resolvería, y conviene decirlo para que nadie lo espere: no arregla un
mapping equivocado, no valida contra el PLC, y no sustituye a `npm run validate:mapping`.

## 2. Alcance propuesto: recarga PARCIAL, no total

El mapping alimenta hoy seis consumidores, y no todos toleran cambiar bajo los pies:

| Consumidor | Qué usa | ¿Recargable en caliente? |
|---|---|---|
| `PlantPipelineService` | `plants`, `signals`, `livenessWindowSec` | **Sí** — reconstruye el DTO en el siguiente frame |
| `MappingEngine` | índices → `domainKey` | **Sí** — es una tabla de traducción pura |
| `reports.service` | `signals` para las métricas exportables | **Sí** — lo invoca por request |
| `register.dto` | conjunto de `plantId` válidos | **Sí** — solo valida altas |
| `command-mapping.resolver` | señales `writable` + `write` | **Con reservas** — ver §4 |
| `ConnectivityModule` / adaptador | `opcBuffers` → NodeIds y MonitoredItems | **NO** — exige sesión OPC |

De ahí la propuesta concreta: **recargar la capa de dominio (señales, rangos, unidades, labels,
confidence) y NO la capa de transporte (buffers, NodeIds, canales)**. Si el JSON nuevo cambia
`opcBuffers` respecto al cargado, la recarga se **rechaza** y se pide un reinicio explícito. Es la
división que ya existe en la arquitectura (adaptador ⟂ dominio, regla 3), aplicada al ciclo de vida.

Esto cubre el caso real —el 100 % de las correcciones que ha habido hasta hoy han sido de índices y
semántica, nunca de NodeIds— sin tocar lo único que obligaría a renegociar con el PLC.

## 3. Mecanismo propuesto: endpoint admin, no SIGHUP

El plan ofrecía las dos opciones. Propongo **`POST /api/opc/mapping/reload`** con
`@RequirePermission('system_config')`, y descartar SIGHUP por tres razones concretas de este
proyecto:

1. **Windows no tiene SIGHUP.** El desarrollo es en Windows y la VM en Linux: un mecanismo que solo
   existe en la mitad de los entornos se prueba en la mitad de los entornos.
2. **`pm2` ya usa señales** para su propio ciclo de vida; añadir semántica propia a una señal invita
   a una colisión difícil de depurar a las 2 de la mañana.
3. **La auditoría sale gratis con HTTP.** Un `POST` pasa por `JwtAuthGuard` + `AuditMiddleware`, así
   que queda registrado *quién* recargó el mapping, desde qué IP y con qué resultado. Una señal no
   tiene autor. Para un cambio que altera cómo se interpreta la telemetría de una planta de agua
   potable, saber quién lo hizo no es opcional.

Respuesta propuesta, para que el operador vea qué cambió antes de creerse el resultado:

```json
{
  "resultado": "aplicado",
  "versionAnterior": "0.14.0", "versionNueva": "0.15.0",
  "protocolVersion": "v2", "dtoVersion": "v1",
  "cambios": {
    "senalesAgregadas": ["montebello.tank1Level"],
    "senalesEliminadas": [],
    "senalesModificadas": [{ "domainKey": "cascajal.inletPressure1", "campos": ["index", "confidence"] }],
    "plantasAfectadas": ["montebello", "cascajal"]
  }
}
```

## 4. Precondiciones y rechazos (la parte que importa)

La recarga es **atómica**: se valida entero contra el schema y las reglas semánticas ANTES de
sustituir nada. Un JSON inválido no deja el sistema a medio camino — se rechaza con el mismo
mensaje que da `validate-mapping.ts` y el mapping viejo sigue sirviendo.

Se **rechaza** (HTTP 409, mapping anterior intacto) si:

- El JSON no valida contra `opc_mapping.schema.json` o falla una regla semántica.
- Cambian los `opcBuffers` de cualquier planta (§2): eso es transporte, exige reinicio.
- Cambia el conjunto de `plantId` (alta o baja de planta): el adaptador y el `PlantCache` tienen
  estado por planta y el liveness quedaría huérfano.
- Cambia `protocolVersion` o `dtoVersion`: un cambio de contrato debe pasar por despliegue, para
  que el móvil se entere. Recargar en caliente un DTO nuevo dejaría a los clientes viejos leyendo
  un formato que no conocen.
- **Hay un comando de válvula en vuelo** (`WriteService` tiene el cerrojo tomado): cambiar el
  mapping mientras una maniobra sostenida espera su read-back es cambiar la definición del bit que
  se está vigilando. Se responde 409 con `COMANDO_EN_CURSO` y se reintenta después.
- `OPCUA_MAPPING_RELOAD_ENABLED` no está en `true` (default `false`, como toda capacidad nueva que
  toca infraestructura crítica en este proyecto).

Además, al aplicarse: se invalida `mappingCache`, se reconstruyen `MappingEngine` y las ventanas de
liveness, **se conserva el `sequence`** de cada planta (el DTO cambia de forma, no de linaje: el
cliente ve el cambio sin un falso hueco) y el siguiente frame ya emite con la semántica nueva. Los
snapshots en cache se marcan para reconstrucción en vez de borrarse, para no dejar a nadie en
`pending`.

## 5. Coste y riesgo

- **Implementación:** ~1 día. Lo caro no es recargar, es el diff de cambios y los rechazos de §4.
- **Riesgo principal:** que se convierta en la vía normal de cambiar el mapping en producción sin
  pasar por git. Mitigación propuesta: la respuesta incluye el hash del archivo cargado y el audit
  log lo guarda, de modo que un mapping en la VM que no exista en el repo sea detectable.
- **Riesgo secundario:** un mapping recargado con un rango `min/max` nuevo cambia qué lecturas se
  marcan `outOfRange` sin que nadie haya desplegado nada. Es el efecto buscado, pero debe quedar
  auditado — de ahí el §3.

## 6. Recomendación

**Implementarlo solo si aparece la necesidad operativa.** Hoy los reinicios de mapping son poco
frecuentes y el coste medido es de segundos. Lo que sí recomiendo desde ya, y no requiere aprobación
porque no cambia el runtime, es lo que este documento deja escrito: **la división recargable /
no-recargable de §2**, porque es la que decide si el día que se necesite se puede hacer en una tarde
o exige rediseñar el ciclo de vida del adaptador.

Pendiente de tu OK para pasar de propuesta a implementación.
