# Verificación de FASE 0.1 — evidencia de solo lectura contra el PLC

Este documento respalda dos correcciones del contrato `opc_mapping.json` que exigían
comprobación contra el servidor OPC UA real (no podían resolverse solo con los
artefactos capturados).

| Campo | Valor |
|---|---|
| **Fecha/hora de la lectura** | 2026-07-14T10:52:32.242Z (UTC) |
| **Servidor** | `opc.tcp://181.204.165.66:59100` (FactoryTalk Optix HMI, estado `Running`) |
| **Sesión** | `SecurityMode=None` + identidad `Anonymous` — **solo lectura** |
| **Operaciones usadas** | `Browse`, `BrowseNext`, `Read`. Nunca `Write`, nunca `Call`. |
| **Herramienta** | `tools/plc-discovery/src/verify-phase0.ts` (reutiliza el cliente del tool; la fachada `ReadOnlySession` no expone `write`/`call`/`createSubscription` — garantía estructural) |
| **Artefacto crudo** | `tools/plc-discovery/output/phase0_verification.json` (gitignored) |

---

## Hallazgo 3 — Topología de los sitios atípicos (san-antonio, quijote)

**Duda:** ambos salieron con un único buffer (`realIn:1`, `msgRead:1`) y sin
`intIn`/`intOut`/`msgWrite`. ¿Es la topología real o una captura truncada?

**Método:** browse fresco de `.../Controller Tags`, filtrando los buffers de nivel
superior de cada sitio.

**Resultado — es la topología real. Son sitios mínimos (solo nivel de tanque + estado de comunicación):**

| Sitio | Canales presentes | Buffers |
|---|---|---|
| `san-antonio` | `realIn`, `msgRead` | `REAL_TK_SAN_ANTONO`, `MSG_READ_REAL_SAN_ANTONIO` |
| `quijote` | `realIn`, `msgRead` | `REAL_TK_QUIJOTE`, `MSG_READ_REAL_QUIJOTE` |

No existen para estos sitios buffers `intIn`, `intOut`, `bitIn`, `realOut` ni
`msgWrite`. **No fue captura truncada.** El buffer de entrada es un array de tanque
(`REAL_TK_*`), coherente con estaciones que solo reportan nivel.

**Acción aplicada:** en `opc_mapping.json`, estas dos plantas llevan
`topologyVerified: true` y solo declaran los canales que realmente existen (los
canales ausentes se omiten, no se rellenan con `[]`).

---

## Hallazgo 5 — `confidence` de `connection` (DN/ER/TO)

**Duda:** los 12 sitios se marcaron `confidence: "confirmed"` habiendo leído de verdad
un solo sitio (CAMPOALEGRE). Los otros 11 se localizaron por patrón de browse. Eso es
inferencia estructural, no lectura confirmada.

**Método (vía A):** localizar el `MSG_READ` primario (el que **no** es `_INT_`) de cada
sitio, browse de sus hijos para obtener los NodeIds de `DN`/`ER`/`TO`, y **leer** los
tres valores. `confirmed` solo si los tres responden `StatusCode = Good`.

**Resultado — los 12 sitios respondieron `Good` en los tres bits → los 12 quedan `confirmed`:**

| Sitio | MSG_READ primario | DN | ER | TO | confidence |
|---|---|---|---|---|---|
| voragine | `MSG_READ_VORAGINE` | Good | Good | Good | confirmed |
| soledad | `MSG_READ_REAL_SOLEDAD` | Good | Good | Good | confirmed |
| montebello | `MSG_READ_REAL_MONTEBELLO` | Good | Good | Good | confirmed |
| cascajal | `MSG_READ_CASCAJAL` | Good | Good | Good | confirmed |
| km18 | `MSG_READ_KM18` | Good | Good | Good | confirmed |
| alto-los-mangos | `MSG_READ_REAL_ALTO_MANGOS` | Good | Good | Good | confirmed |
| campoalegre | `MSG_READ_REAL_CAMPOALEGRE` | Good | Good | Good | confirmed |
| pichinde | `MSG_READ_REAL_PICHINDE` | Good | Good | Good | confirmed |
| carbonero | `MSG_READ_REAL_CARBONERO` | Good | Good | Good | confirmed |
| sirena | `MSG_READ_REAL_SIRENA` | Good | Good | Good | confirmed |
| san-antonio | `MSG_READ_REAL_SAN_ANTONIO` | Good | Good | Good | confirmed |
| quijote | `MSG_READ_REAL_QUIJOTE` | Good | Good | Good | confirmed |

**Acción aplicada:** el generador toma el `confidence` por sitio desde este resultado
de verificación (no lo asume). Cada `connection` lleva un campo `evidence` con la fecha
de la lectura. Si en una regeneración futura algún sitio no respondiera `Good`, bajaría
automáticamente a `inferred`.

---

## Alcance de lo que sigue SIN confirmar

- **`connection` confirma que el canal de estado de comunicación existe y responde.** No
  confirma la semántica de las señales de proceso (nivel, caudal, pH…), que siguen
  `unmapped` a la espera del export L5X. `confirmed` aquí significa "el bit DN/ER/TO fue
  leído con calidad Good", no "conocemos el significado de cada índice de los arrays".
- **`displayName`** sigue provisional (`displayNameProvisional: true`) en las 12 plantas:
  la nomenclatura oficial no fue confirmada por la planta.
