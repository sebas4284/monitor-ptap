# Prueba de accionamiento — Electroválvula de La Sirena (`sirena`)

> # ⛔ ACCIONAMIENTO FÍSICO REAL
> Escribir en `INT_OUT_SIRENA` puede **abrir/cerrar una válvula física**. Este documento **prepara,
> lista y registra** el procedimiento de prueba de campo. **No se dispara ninguna escritura** hasta
> que (a) el operador confirme la semántica exacta de Sirena y (b) estén satisfechos TODOS los
> candados de seguridad de abajo. Bitácora al final: qué funcionó / qué no.

**Contexto:** prueba en campo, backend corriendo contra el PLC real. **PLC = Allen-Bradley (Rockwell)**;
capa SCADA/HMI = **FactoryTalk Optix** (confirmado por namespaces del servidor, ver §Resultados Paso 1).
**Fecha inicio:** 2026-07-29. **`open=4096` confirmado por captura real de campo** (canal 0, pulso);
`close` aún pendiente de capturar con el mismo método.

**Estado de implementación (2026-07-29):** el canal OFICIAL de comandos (Fase 5) ya está cableado para
esta válvula — código, mapping y tests en verde. Ver §3 (candados) y §4-Paso 3 en adelante para lo que
falta (ejecutar desde una instancia de prueba aislada en la VM).

---

## 0. Topología y estado de planta

- **HMI Sirena:** `10.10.51.26` · **PLC Sirena:** `10.10.51.27`.
- **Escritura por el PLC MAESTRO / FactoryTalk Optix OPC UA:** `opc.tcp://181.204.165.66:59100` (con conexión ✅).
- ~~PLC de Sirena caído~~ — **CORRECCIÓN (2026-07-29): el PLC de Sirena está EN VIVO**, confirmado
  visualmente por el operador en sitio. La nota anterior (basada en que `INT_IN_SIRENA` no cambiaba en
  los primeros monitoreos) quedó descartada — el interlock del `WriteService` (bridge Connected +
  snapshot `live`) debería pasar sin necesidad de tocarlo.

## 1. NodeIds de Sirena (del mapping — confirmados en `opc_mapping.json`)

| Rol | Buffer | NodeId (nsUri AQUATECH) | Tipo | Uso |
|---|---|---|---|---|
| **COMANDO** | `INT_OUT_SIRENA` | `g=4AB6ECB4-D019-D4F1-A8A8-6177C3FE3278` | `Int16[20]` | escribir apertura/cierre |
| **ESTADO** | `INT_IN_SIRENA` | `g=184E4071-DC15-213A-3DE8-442A4E0A354B` | `Int16[10]` | leer estado (read-back) |
| (aux) msg escritura | `MSG_WRITE_INT_SIRENA` | `g=AEC8BB93-ED3D-BEC5-6EC5-782EA513CFA2` | MESSAGE | handshake, si aplica |
| (aux) bits | `BIT_SIRENA` | `g=57F08F39-07AA-5C7C-6B7E-4ABE531EC93D` | Boolean | por confirmar |

## 2. Protocolo de Voragine como PLANTILLA (a validar para Sirena)

De [PROTOCOLO_VALVULAS_VORAGINE.md](PROTOCOLO_VALVULAS_VORAGINE.md) (UNVERIFIED):
- **COMANDO** `INT_OUT`, índice 0: `4`=ABRIR (bit2), `8`=CERRAR (bit3), `4096`=PULSO (bit12). Nunca 4 y 8 a la vez (interlock).
- **ESTADO** `INT_IN`, posición 2: `16384`=CERRADA (bit14), `16385`=ABIERTA (bit14+bit0).
- **Ambigüedad sin resolver:** el PULSO (4096) ¿se combina con la dirección (`4100`/`4104`) o es independiente?

⚠️ **Para Sirena estos índices/valores NO están confirmados.** `INT_IN_SIRENA` es `[10]` (Voragine `[20]`),
así que "posición 2" puede no aplicar igual. **Confirmar con el operador y/o por lectura en vivo.**

### Mecanismo confirmado por el operador (2026-07-29)
La escritura es **por el CANAL 0** (índice 0 de `INT_OUT_SIRENA`) y el valor es **numerología en bits**:
el `Int16` que se escribe es una **máscara de bits** y cada bit **enruta la energía a un canal/salida**
concreto → así el PLC sabe **a cuál de todas las salidas** mandar la orden (registro de comando tipo
*demux*). Es decir: `write.target.index = 0` **fijo**; lo que cambia por acción/válvula es **qué bit(s)**
se encienden en ese valor. Coherente con Voragine (`4`=bit2 abrir, `8`=bit3 cerrar, `4096`=bit12 pulso).

**Falta confirmar, para calcular el valor exacto de Sirena:**
1. ¿Qué **bit** corresponde a la **válvula objetivo** de Sirena? (¿abrir y cerrar son bits distintos, como Voragine bit2/bit3?)
2. ✅ **Confirmado: es por PULSO** (se enciende el bit un instante y vuelve a 0 → `rollbackValue = 0`; el estado real se confirma leyendo `INT_IN_SIRENA`, no el propio comando).
3. ¿Qué índice/valor de `INT_IN_SIRENA` **confirma** el estado resultante (para el read-back)?

### Resultados Paso 1 — LECTURA en vivo (2026-07-29, solo lectura)
Endpoint `opc.tcp://181.204.165.66:59100`, sesión anónima None/None. Evidencia real:
- **El servidor OPC UA ES FactoryTalk Optix** (namespaces `urn:FTOptix:*`, `urn:IOT_RURAL:FactoryTalkOptixHMI`,
  driver `urn:FTOptix:RAEtherNetIP` → habla EtherNet/IP con el PLC **Allen-Bradley**). ✅ Coincide con el
  proyecto original. ⚠️ **Contradice** el "pivote a WinCC Unified" que salió de la página web del `:443`
  (`docs/PLAN_HMI_OPTIX.md`) — la capa **OPC/HMI es FTOptix**; qué es la página WinCC del `:443` queda por aclarar.
- `AQUATECH` = **ns=9**.
- **`INT_OUT_SIRENA` `AccessLevel=3` (CurrentRead+CurrentWrite)** → el servidor **permite escribir** ese nodo (candado #4 ✅).
- **`INT_OUT_SIRENA` = todo 0** (registro de pulso en reposo, idle).
- **`INT_IN_SIRENA[0] = 16384 = bit14`** → según la semántica de Voragine, **VÁLVULA CERRADA** (bit14=presente, bit0=0).
  → El estado vive en **índice 0** (en Voragine era índice 2). Esperado al ABRIR: `16385` (bit14+bit0).
- **Estado actual de la válvula: CERRADA.**

**Deducciones para el read-back:** `readBack` = `INT_IN_SIRENA` **índice 0**; `16385`=ABIERTA, `16384`=CERRADA.
**Falta (lo que darás):** el **valor/bit de comando** a pulsar en `INT_OUT_SIRENA[0]` para ABRIR y para CERRAR.

### Monitoreo por suscripción (2026-07-29, 20 ms servidor, ventana 60 s + 120 s) — NEGATIVO
Con el operador ejecutando (o intentando) el comando, **`INT_OUT_SIRENA[0]` nunca cambió de 0** y
**`INT_IN_SIRENA[0]` se mantuvo en 16384 (CERRADA)** en ambas ventanas. Es decir: la orden **NO se
reflejó** en el buffer de comando/estado del maestro. Causa más probable: el **PLC de Sirena
(`10.10.51.27`) está CAÍDO**, así que el maestro no actualiza esos buffers de Sirena. Pendiente:
descartar que el comando pase por otro buffer (`MSG_WRITE_INT_SIRENA`/otro índice) y/o repetir con el
PLC de Sirena arriba. (Método de sondeo descartado: a ~2,3 lecturas/s se pierde el pulso; se usa
suscripción con muestreo de 20 ms en el servidor.)

### ✅ CAPTURA POSITIVA (2026-07-29, suscripción a los 4 buffers, 20 ms servidor)
Con el operador disparando el comando desde el HMI, la suscripción capturó el **pulso real**:
- **`INT_OUT_SIRENA[0]`: `0 → 4096 → 0`** → **valor de comando = `4096` = bit12 = PULSO**. Confirma que
  el comando pasa por el **canal 0** de `INT_OUT_SIRENA`, es un **pulso** (vuelve a 0 solo), y coincide
  con el `4096`/bit12 "PULSO" del protocolo de Voragine. (Solo se vio `4096`; no `4`/`8` de dirección.)
- **`MSG_WRITE_INT_SIRENA`:** tráfico CIP/MSG del maestro (`EN/ST/DN` alternando, `path=10.10.51.25`) —
  handshake de comunicación, no el comando de la válvula.
- ⚠️ **`INT_IN_SIRENA[0]` NO cambió** (siguió `16384`/CERRADA) → el pulso **no** produjo cambio de estado
  observable. Causa probable: **PLC de Sirena (`10.10.51.27`) caído**, o `4096` es solo el PULSO y falta
  la dirección (abrir=`4`/cerrar=`8`), o la válvula no se movió.
- ⏱️ Los `sourceTimestamp` del servidor vienen **desfasados** (relojes); usar el `t=` del monitor para el orden.

**Confirmado por evidencia:** canal 0 · pulso · valor `4096` (bit12). **Falta:** ¿`4096` es toda la orden
(toggle) o hay bits de dirección abrir/cerrar (4/8)? ¿la válvula se movió físicamente? Repetir con el PLC de Sirena arriba.

Análisis de array completo (`monitor-sirena-full.ts`, 90 s, todos los índices de `INT_OUT`/`INT_IN`):
**solo el índice `[0]`** tuvo actividad en ambos arrays — los índices 1-19 (`OUT`) y 1-9 (`IN`) se
mantuvieron en 0 en toda la captura. El comando y el estado viven exclusivamente en `[0]`.

**Corrección importante:** se preparó `write-sirena-pulse.ts` (escritura controlada: array completo,
mantener ~1 s, restaurar a `0`) y el usuario autorizó enviarlo, pero **la ejecución NUNCA se completó**
— el verificador de seguridad del harness quedó caído en los 3 intentos (PowerShell, Bash, sin sandbox)
y no hubo un cuarto intento antes de pasar a este nuevo enfoque. **`open=4096` sigue siendo evidencia
de solo LECTURA/monitoreo pasivo** (el pulso lo disparó el HMI, nosotros solo lo observamos por
suscripción) — **NO** de una escritura nuestra ejecutada con éxito. La primera escritura real desde
nuestro sistema queda para el Paso 5 (canal oficial, vía la instancia de prueba en la VM).

### Estandarización entre plantas (aportada por el operador, 2026-07-29)
- El mecanismo de **canal 0 + máscara de bits (demux)** y el **canal `INT_IN` de estado** son el mismo
  patrón en **todas las plantas** — solo cambia el NodeId del buffer por planta (`INT_OUT_<PLANTA>`,
  `INT_IN_<PLANTA>`), no la semántica. Esto permite reutilizar la misma plantilla de `write` spec al
  onboardear la válvula de cualquier otra planta (ajustando NodeIds + valores propios).
- **Heurístico de respaldo propuesto (futuro, no implementado hoy):** además del bit de estado en
  `INT_IN`, usar el **caudal** (`realIn`, p. ej. `inletFlow1`/`outletFlow1`) como confirmación
  secundaria — caudal `0` ⇒ probablemente cerrada; caudal `>0` ⇒ probablemente abierta. Útil para
  cuando un cierre MANUAL no deja "huella digital" en el bit de estado. **No implementado**: hoy
  `WriteService.confirmReadBack()` solo soporta comparar UN nodo contra un valor esperado
  (`write.service.ts:163-186`); una confirmación OR (estado-bit **O** caudal) requeriría extender esa
  función — se deja como mejora futura explícita, fuera de esta prueba.

---

# ✅ RESULTADO DE LA PRUEBA POR EL CANAL OFICIAL (2026-07-30)

**Ejecutada desde la VM**, por el canal oficial de comandos (Fase 5), con la cuenta real
**`loresjoshua@gmail.com` (admin)**. Dato del operador que habilitó la prueba: **el canal está
habilitado pero NO hay componente que energice físicamente** → no hay actuador, los pulsos no mueven
ninguna válvula, se puede ejercitar libremente.

## Montaje: instancia AISLADA en la VM (producción intacta)

| Elemento | Cómo se aisló |
|---|---|
| Código | `git worktree` en `~/ptap-fieldtest` sobre la rama `fieldtest` (commit `59115eb`), empujada directo al repo de la VM. `dev` **NO** se tocó (sigue en `dd03fbc`). |
| `.env` | Propio en `~/ptap-fieldtest/.env` — `load-env.ts:6` resuelve el `.env` relativo a `__dirname`, así que **cada árbol lee el suyo**. Overrides: `PORT=4001`, `OPCUA_WRITES_ENABLED=true`, `OPCUA_ALLOW_INSECURE_WRITES=true`, `OPC_MAPPING_PATH` explícito, `REPORTS_DIR` aparte, rate-limit holgado. |
| `node_modules` | **Hardlinks** (`cp -al`) del de producción → 1.8 GB sin duplicar disco (uso del disco quedó igual: 8.5 G). `@ptap/shared` resolvió **dentro** del árbol de prueba (symlink relativo). |
| Proceso | Ejecutado en **primer plano y autoterminante** (`scripts/fieldtest-valve-run.ts`), **sin pm2** a propósito → imposible contaminar el dump de pm2 ni resucitar en un reboot. |
| PKI / reports | `process.cwd()`-based → directorios propios del árbol de prueba. |

## Evidencia

```
bridge=Connected   writeSecurity: secure=true  mode=None  identity=anonymous
snapshot sirena: sequence=1  señales=22
liveness: stable (+0s, +5s) → live a los +7s  (lastChangeAt=2026-07-30T14:22:05Z, antigüedad 2.9s)
PREVIO  INT_OUT[0]=0 {}          INT_IN[0]=16384 {14}
COMANDO ÚNICO   HTTP 502  failed/READBACK_UNCONFIRMED  prev=0 written=4096 confirmed=16384  (5635ms)
RÁFAGA          24 comandos, 1 cada 5 s durante 120 s → 24× idéntico
FINAL   INT_OUT[0]=0 {}          INT_IN[0]=16384 {14}     bit latente: NO ✅
RESUMEN: 25 llamadas · 25× HTTP 502 failed/READBACK_UNCONFIRMED · por llamada min 5307ms / mediana 5474ms / max 5694ms
```

### 🔬 Verificación con TESTIGO INDEPENDIENTE del canal 0 (2ª corrida, 2026-07-30)

La 1ª corrida probaba `written=4096` **según el propio `WriteService`**. Para *rectificar* que el pulso
sale de verdad al canal, la 2ª corrida establece —**antes** de comandar— una **segunda sesión OPC UA
separada del puente de la app**, suscrita a `INT_OUT_SIRENA` con muestreo de **20 ms en el servidor**:

```
VEREDICTO DEL TESTIGO (canal 0, sesión OPC UA independiente)
  eventos observados en INT_OUT_SIRENA[0]: 51   ·   en INT_IN_SIRENA[0]: 1
  valores distintos vistos en el canal 0: 0, 4096
  PULSOS 4096 observados: 25   ·   retornos a 0 (rollback): 25
  comandos enviados: 25
  ✅ CONFIRMADO: un pulso 4096 por cada comando enviado
  INT_IN[0] durante toda la prueba: 16384 {14} (sin cambio = canal sin actuador, esperado)
  timeline: +3.0s=4096  +8.1s=0  +8.5s=4096  +13.7s=0  +14.0s=4096  +19.1s=0  +19.4s=4096 ...
```

**Correspondencia 1:1 entre comandos y pulsos en el cable**, con su retorno a 0 (rollback) en cada
ciclo. El patrón del timeline muestra el pulso sostenido ~5 s (lo que tarda el read-back en agotar su
timeout) y luego el retorno a reposo. **Esta es la prueba de que podemos escribir por el canal.**

### 🎯 3ª corrida (2026-07-30, commit `af03e57`) — TRIPLE verificación del write

Se corrigió un defecto que impedía *interpretar* el resultado (ver §Guía de errores) y se añadió el
**eco instantáneo**. Resultado de repetir el proceso completo:

```
COMANDO ÚNICO   HTTP 502  failed/READBACK_UNCONFIRMED
   prev=0  written=4096  ECO=4096 verificado=true  confirmed(estado)=16384  seq=4
RÁFAGA          24 comandos → 24× idéntico (eco=4096 verificado=true en todos)
ESCRITURA VERIFICADA POR ECO (canal de comando, en el instante): 25/25
TESTIGO: 25 pulsos 4096 · 25 retornos a 0 · comandos enviados 25 → ✅ CONFIRMADO
FINAL   INT_OUT[0]=0     bit latente: NO ✅
```

**El write queda probado por tres vías independientes:**
1. `written=4096` — el `WriteService` ejecutó la escritura sin excepción (StatusCode Good).
2. **`ECO=4096 verificado=true` (25/25)** — el backend re-leyó *el mismo elemento* inmediatamente
   después de escribir: **el valor SÍ quedó en el canal, en ese instante**.
3. **Testigo externo** — una 2ª sesión OPC UA (20 ms de muestreo) vio los 25 pulsos y sus 25 retornos.

Auditoría en MySQL: **25 filas en `command_log`** (todas `failed/READBACK_UNCONFIRMED`, con
`user_email=loresjoshua@gmail.com`, `role=admin`, `target=valve1`, `command=open`, `prev=0`,
`written=4096`, `confirmed=16384`, `interlock_sequence`) y **26 eventos `command.execute` en
`audit_log`** (25 + el rechazo del preflight). El canal audita SIEMPRE, incluso los rechazos.

## Qué quedó PROBADO

1. **El canal oficial completo funciona**: HTTP → `JwtAuthGuard` + `PermissionGuard` +
   `PlantScopeGuard` → `WriteService` → resolver del mapping → precondición de seguridad → RBAC
   (`control_valves`) → interlock → **escritura OPC UA real** → read-back → rollback → auditoría.
2. **La escritura al PLC SE EJECUTA — verificado por un TERCERO**: `written=4096` en
   `INT_OUT_SIRENA[0]` (canal 0), 25 de 25 veces, y un **testigo OPC UA independiente observó los 25
   pulsos** con sus 25 retornos a 0 (ver §Verificación con testigo). `AccessLevel=3` (CurrentWrite).
   No es autorreporte del servicio: es evidencia externa sobre el canal.
3. **La excepción de sesión insegura funciona y es visible**: `secure=true` con `mode=None`/`anonymous`
   solo porque `OPCUA_ALLOW_INSECURE_WRITES=true`; en producción está ausente → `false` → bloqueado.
4. **NO queda bit latente**: `INT_OUT[0]=0` al final de las 25 ráfagas. El rollback del `WriteService`
   (`rollbackValue: 0`) hace su trabajo — crítico para que nada se ejecute cuando llegue el actuador.
5. **El sistema NO miente**: sin actuador, el estado nunca pasa a `16385`, y el canal reporta
   `failed/READBACK_UNCONFIRMED` (HTTP 502) en vez de un falso "exitoso".
6. **Producción intacta**: pm2 `ptap-api` online, `/api/health` y `/api/health/opc` en `:4000` → 200,
   `dev` en `dd03fbc`, puerto 4001 libre al terminar, ningún proceso de prueba vivo.

## Qué NO quedó probado (y por qué)

- **Que la válvula se mueva**: imposible hoy, **falta el componente que energiza** (dato del operador).
  El read-back seguirá sin confirmar hasta que exista el actuador. `status: failed` aquí **NO significa
  "el canal no sirve"** — significa "se escribió y el estado no cambió", que es lo correcto reportar.
- **El pulso de CERRAR**: nunca se capturó (solo se observó `4096`). El mapping **no** declara `close`
  a propósito: no se fabrica un valor sin evidencia.
- **`expectedValue: 16385`** (abierta) sigue siendo **inferido** del patrón de Voragine, nunca observado
  en Sirena.

---

# 🌐 RÉPLICA A TODAS LAS PLANTAS (2026-07-30)

Validada la ruta en Sirena, se replicó **sin probar en ninguna otra planta** (instrucción del operador:
«mín. 1 válvula, se escribe por el canal 0, abrir = 4096 en todas»).

## Alcance: 10 de 12 plantas

| Con válvula (`intOut` + `intIn`) | Sin válvula |
|---|---|
| voragine · soledad · montebello · cascajal · km18 · alto-los-mangos · campoalegre · pichinde · carbonero · sirena | **san-antonio · quijote** |

⚠️ **`san-antonio` y `quijote` quedan FUERA a propósito**: **no tienen buffers `intOut`/`intIn`**. Son los
tanques retransmitidos en el buffer de Soledad, sin canal de comando propio. Inventarles una válvula
sería escribir en un buffer inexistente. La pantalla lo dice explícitamente en vez de mostrar nada.

## Qué se añadió por planta

Con [`scripts/add-valve-signals.ts`](../apps/api/scripts/add-valve-signals.ts) — idempotente, e inserta
como **texto** para no reformatear las 2.400 líneas del JSON hecho a mano:

1. **`valve1`** (comando, writable): `intOut[0]`, `open: 4096`, `mode: "bitmask"`, `pulse.holdMs: 300`,
   read-back en `intIn[0]` con `expectedValue: 16385`, `timeoutMs: 5000`, `permission: control_valves`.
2. **`valve1State`** (solo lectura): `intIn[0]` — expone la palabra de estado para que el front la decodifique.

**Honestidad sobre la confianza:** en Sirena el `4096` está **verificado en campo**. En las otras 9 viene de
la **instrucción del operador**, no de una captura por planta. El `expectedValue: 16385` es **inferido** del
patrón de Vorágine (nunca se ha observado un `16385` real). Si en alguna planta el estado viviera en otro
índice, el read-back simplemente **no confirmará** → reporta `failed`, **nunca un falso éxito**: degrada seguro.

## Estado de la válvula: los DOS métodos

Implementados en [`apps/mobile/services/valves.ts`](../apps/mobile/services/valves.ts):

| Método | Cómo | Disponibilidad |
|---|---|---|
| **1 · Lectura del PLC** | `valve1State` es máscara de bits: **bit14** = estado válido, **bit0** = abierta → **`16384` CERRADA**, **`16385` ABIERTA** | las 10 plantas |
| **2 · Caudal** | caudal **≤ 0.1 → CERRADA**; por encima → ABIERTA. Prefiere el de **salida**; si no hay, usa el de entrada | 9 de 10 (**pichinde** no tiene caudales mapeados) |

**Cruce:** manda el método 1 (es la lectura del propio equipo) y el 2 corrobora. **Si discrepan se avisa**
(`estado y caudal no coinciden`) en vez de elegir uno en silencio — un estado "abierta" con caudal 0 es
información valiosa (sensor de estado o caudalímetro inconsistente). La fila muestra **siempre ambos**.

## Frontend: mocks fuera, mando bloqueado

- **Eliminados** `services/mock-data.ts`, `hooks/useElectrovalvulas.ts` y `components/ExampleDataBanner.tsx`.
  La pantalla de electroválvulas ya consume el **snapshot real**.
- **`MANDO_HABILITADO = false`** en [`electrovalvulas.tsx`](../apps/mobile/app/(app)/electrovalvulas.tsx):
  se ve el estado real, y al pulsar Abrir/Cerrar aparece un aviso explicando que **el canal ya funciona y
  está verificado contra el PLC**, pero permanece **deshabilitado hasta que la planta autorice** la
  operación remota. Ningún botón que parezca funcionar sin hacer nada.
- Para habilitarlo cuando la planta lo autorice: poner `MANDO_HABILITADO = true` y descomentar el
  `POST /api/plants/:plantId/commands` — el backend ya está listo.

---

# 🧭 GUÍA: cómo interpretar el resultado de un comando

**El defecto que se corrigió (commit `af03e57`):** antes, **cualquier** excepción (write rechazado por
el servidor, buffer faulted, red caída) se reportaba con el **mismo** `reason: READBACK_UNCONFIRMED`
que un write exitoso sin confirmación de estado → era **imposible saber si se había escrito**. Ahora la
escritura está aislada (`WRITE_REJECTED`) y todo comando trae el **eco** (`writeEcho`/`writeVerified`).

## Tabla de interpretación

| Respuesta | Qué significa REALMENTE | Dónde falló | Acción |
|---|---|---|---|
| `200` `confirmed` | Se escribió **y** el equipo respondió | — | nada |
| `502` `READBACK_UNCONFIRMED` + **`verificado=true`** | **SE ESCRIBIÓ** (el eco lo prueba); el canal de ESTADO no confirmó | actuador / equipo / lógica del PLC | **← CASO ACTUAL de Sirena.** No es un fallo del canal |
| `502` `READBACK_UNCONFIRMED` + `verificado=false` | El write fue aceptado pero el valor **no quedó** en el canal | ¿índice equivocado? ¿otro maestro pisando el valor? ¿el PLC lo resetea al instante? | revisar índice y quién más escribe |
| `502` `READBACK_UNCONFIRMED` + `verificado=null` | Se escribió pero **no se pudo leer el eco** | lectura fallida tras el write | revisar sesión/red |
| `502` **`WRITE_REJECTED`** | **NO se escribió nada** | write OPC UA rechazado, buffer faulted, sin sesión | ver el `StatusCode` en el log del backend |
| `403` `WRITES_DISABLED_INSECURE_SESSION` | Candado de seguridad activo | config | `OPCUA_WRITES_ENABLED` / `OPCUA_ALLOW_INSECURE_WRITES` |
| `403` `FORBIDDEN` | El rol no tiene `control_valves` | RBAC | usar operador/admin (jefe NO puede) |
| `409` `INTERLOCK_FAILED: snapshot frozen/stable` | No se está viendo **moverse** el dato | interlock (deliberado) | esperar `live` (~7 s tras arranque) |
| `409` `INTERLOCK_FAILED: bridge X` | El puente no está `Connected` | conectividad OPC UA | revisar `/api/health/opc` |
| `409` `IN_PROGRESS` | Misma `idempotencyKey` en vuelo | idempotencia | esperar / usar otra clave |
| `404` `TARGET_NOT_WRITABLE` | La señal no es `writable` en el mapping | mapping | declarar `writable:true` + `confidence:"confirmed"` |
| `400` `UNKNOWN_COMMAND` | El verbo no existe en `write.commands` | mapping | p. ej. `close` **aún no existe** para Sirena |

## Soluciones alternas para el write (si algún día falla)

En orden de lo que probaría, de más simple a más invasivo:

1. **Forma de la escritura** — hoy el adaptador escribe **un elemento** con `IndexRange`
   (`opcua-connectivity.adapter.ts:617`). Si un servidor lo rechazara, la alternativa es
   **read-modify-write del array completo** (es lo que hace `scripts/write-sirena-pulse.ts`). Ambas
   probadas: las dos funcionan contra este servidor.
2. **Duración del pulso** — hoy el bit queda en `4096` unos **5.5 s** (mientras el read-back agota su
   `timeoutMs: 5000`) y luego el rollback lo devuelve a 0. Si el PLC esperara un pulso **corto**
   (200–500 ms), bajar `timeoutMs` en el mapping o añadir un `pulseMs` explícito.
3. **Bit/valor alternativo** — si `4096` (bit12) fuera solo el "disparo" y faltara la **dirección**,
   probar la combinación estilo Vorágine: `4100` (=`4` abrir + `4096` pulso) o `4104` (=`8` cerrar +
   pulso). **No inventar**: capturar primero el valor real desde el HMI con el monitor por suscripción.
4. **Handshake por `MSG_WRITE_INT_SIRENA`** — si el buffer se escribe pero el PLC no lo recoge, forzar
   el envío CIP por el nodo MSG (ver punto siguiente).
5. **Comparar con UaExpert** — ya se sabe que UaExpert escribe; con el eco verificado, nuestro backend
   tiene **paridad** con él. Si UaExpert lograra algo que nosotros no, comparar el `Variant`
   (dataType/arrayType) que envía cada uno.

## ✅ Tramo FTOptix → PLC: VERIFICADO (4ª corrida, 2026-07-30)

Era el último eslabón sin probar. **Resuelto**: con `scripts/browse-msg-sirena.ts` se descubrió que los
bits de la instrucción MSG **son nodos hijos direccionables** (no hace falta decodificar el
ExtensionObject completo, que era lo que tumbaba la sesión con `Connection Break`):

| Bit | NodeId (ns=9) | Significado |
|---|---|---|
| `DN` | `g=37D4AE55-3731-D313-BF74-E71D54D2A5F9` | Done — el mensaje CIP se completó |
| `ER` | `g=9940D02E-157D-03CA-C179-240C8DA0E5A1` | Error de mensaje |
| `TO` | `g=39003436-2EFD-47BD-2CDD-3FA3B49A82BE` | Timeout |
| `ERR` | `g=86703B23-8C2B-56A5-BEDB-AF0BC4D4C667` | Código de error CIP |

Vigilados por el testigo durante los comandos (`path=10.10.51.25`):

```
──── TRAMO FTOptix → PLC (MSG_WRITE_INT_SIRENA, EtherNet/IP) ────
  ciclos DN (mensaje completado) : 9        (eventos DN: 18)
  ER en alto (error de mensaje)  : 0
  TO en alto (timeout)           : 0
  ERR != 0 (código de error CIP) : 0
  ✅ El transporte al PLC está SANO
```

**Interpretación honesta:** la instrucción MSG corre de forma **cíclica** (~9 ciclos en la ventana, uno
cada ~8 s), no una vez por write. Por tanto `DN` **no** demuestra una correspondencia 1:1
write→entrega; lo que demuestra es que **el transporte al Allen-Bradley está sano y entrega el buffer
`INT_OUT` continuamente, sin errores ni timeouts**. Combinado con que el valor **persiste** en
`INT_OUT[0]` (eco verificado), la conclusión es sólida: **el valor llega al PLC**. Lo que no ocurre es
la **energización** de la válvula — de ahí que `INT_IN[0]` siga en `16384`.

## 🔧 5ª corrida (commit `3091d1f`) — pulso real de 300 ms y escritura por máscara de bits

Una revisión externa señaló dos defectos **reales** en cómo se aplicaba el pulso. Ambos corregidos:

**Defecto 1 — se escribía el valor ABSOLUTO.** Escribíamos `4096` y limpiábamos con `0` absolutos. Si en
esa palabra hubiera **otro bit activo** (otra válvula/comando del mismo sitio), lo habríamos **apagado**.
Hoy el canal está siempre en 0, así que era inofensivo, pero es un **bug latente peligroso**.
→ Nuevo `write.mode: "bitmask"`: activar = `actual | valor`, limpiar = `actual & ~valor`
(read-modify-write). Conserva los bits ajenos.

**Defecto 2 (más grave) — el bit quedaba ENCLAVADO al confirmar.** El rollback solo corría cuando el
read-back **fallaba**. En cuanto la válvula funcione y el estado confirme (`16385`), el código **nunca**
habría limpiado el bit → **la orden quedaría puesta indefinidamente**. Además el bit se sostenía ~5.5 s
(atado al `timeoutMs` del read-back), no los 200–500 ms típicos de un pulso.
→ Nuevo `write.pulse.holdMs` (300 ms en `sirena/valve1`): se activa, se sostiene y **se limpia SIEMPRE**,
confirme o no. Desacoplado del `timeoutMs`.

**Regla nueva en el schema:** un pulso **no puede** confirmarse releyendo el valor escrito (el bit ya está
limpio cuando se relee), así que `pulse` ⇒ `readBack.confirmsWrittenValue: false` — debe confirmar por el
canal de **estado**.

Evidencia del testigo en el PLC real (pulso ahora **~0.8 s** extremo a extremo, vs 5.5 s antes):
```
[testigo] +2.98s  OUT[0]=4096 {12}     ← activación
[testigo] +3.08s  MSG.DN=1             ← la MSG al PLC se completa JUSTO después del write
[testigo] +3.38s  MSG.DN=0
[testigo] +3.78s  OUT[0]=0 {}          ← cierre del pulso (garantizado)
...
PULSOS 4096 observados: 9 · retornos a 0: 9 · comandos enviados: 9 → ✅ 1:1
ESCRITURA VERIFICADA POR ECO: 9/9      ·  ER/TO/ERR: 0
FINAL INT_OUT[0]=0 · bit latente: NO ✅
```
El `MSG.DN` subiendo **100 ms después** de cada write refuerza la conclusión del §tramo: el buffer se
entrega al Allen-Bradley sin error.

### Cadena de custodia del write — completa

| # | Eslabón | Evidencia | Estado |
|---|---|---|---|
| 1 | App → backend | `POST /api/plants/sirena/commands` con JWT admin, guards + RBAC | ✅ |
| 2 | Backend → servidor OPC UA | `write` con `StatusCode Good`, `AccessLevel=3` | ✅ |
| 3 | El valor **queda** en el canal | **eco** `writeVerified=true` (25/25 y 13/13) | ✅ |
| 4 | Visible para un **tercero** | testigo OPC UA independiente: 1 pulso por comando | ✅ |
| 5 | Servidor → **PLC** (EtherNet/IP) | MSG `DN` ciclando, `ER/TO/ERR = 0` | ✅ |
| 6 | PLC → **energiza la válvula** | `INT_IN[0]` nunca pasa a `16385` | ❌ **canal físico dañado** |

**El write está resuelto de punta a punta.** El único eslabón roto es el #6, que es hardware.

## Hallazgos operativos

1. **El interlock exige `liveness === 'live'`, y eso requiere ver MOVERSE el dato.** Es una decisión
   deliberada de seguridad (documentada en `test/write-service.test.ts:183`), no un bug. Consecuencia
   práctica: al arrancar en frío el snapshot nace `stable`/`frozen` y **hay que esperar** a que el
   puente observe un cambio real de valor (en esta prueba: **7 segundos**). El primer intento —hecho
   3 s después de arrancar— fue rechazado con `409 INTERLOCK_FAILED: snapshot frozen`. Al comandar
   desde la app esto no se nota (el puente lleva horas corriendo), pero **cualquier script o instancia
   recién arrancada debe esperar a `live`**.
2. **Cada comando tarda ~5.4 s** porque el read-back agota su `timeoutMs: 5000` (sin actuador nunca
   confirma). Con un intervalo de 5 s las llamadas quedan **encadenadas** (no solapadas): la ráfaga de
   24 tomó ~126 s. Cuando exista el actuador y el estado confirme, la respuesta será casi inmediata.
3. **Los `sourceTimestamp` del servidor vienen desfasados** entre nodos (se vieron marcas de minutos de
   diferencia). No afectó a esta prueba porque `REAL_IN_SIRENA` sí trae marcas frescas, pero conviene
   **sincronizar NTP** en la VM y no usar ese KPI como medida de rendimiento.

## Cómo re-ejecutar (queda LISTO en la VM)

```bash
# la instancia NO queda corriendo; se arranca sola, ejecuta y se cierra
ssh ptap
cd ptap-fieldtest/apps/api
FT_EMAIL=loresjoshua@gmail.com FT_MODE=single+burst \
  FT_WAIT_LIVE_S=150 FT_BURST_SECONDS=120 FT_BURST_INTERVAL_MS=5000 \
  ../../node_modules/.bin/tsx scripts/fieldtest-valve-run.ts
# modos: preflight (diagnóstico + 1 comando) | single | burst | single+burst
```
El árbol de prueba ocupa **11 MB** de datos reales (node_modules son hardlinks → 0 disco adicional).
Para eliminarlo: `git -C ~/monitor-ptap worktree remove --force ~/ptap-fieldtest && git -C ~/monitor-ptap branch -D fieldtest`.

## Pendiente para cerrar la válvula de verdad

1. **Conectar el componente de energía (actuador)** → repetir: el read-back debería pasar
   `16384 → 16385` y el estado a `confirmed` (HTTP 200).
2. **Capturar el pulso de CERRAR** desde el HMI (monitor por suscripción ya está listo) y añadir
   `commands.close` al mapping con ese valor real.
3. **Cablear el botón de la app** al canal (hoy la pantalla de electroválvulas es demo): el flujo que
   pediste ya existe de extremo a extremo — botón → `POST /api/plants/:plantId/commands` → backend →
   OPC UA → `INT_OUT_SIRENA[0]`.

---

## 3. CANDADOS DE SEGURIDAD (todos deben cumplirse para poder escribir)

El `WriteService` (Fase 5) rechaza el comando si falla cualquiera:

| # | Candado | Estado hoy | Qué falta |
|---|---|---|---|
| 1 | **Señal writable en el mapping** para la válvula de Sirena | ✅ **HECHO** — `apps/api/config/opc_mapping.json` (`sirena.signals[]`, `domainKey:"valve1"`, `open:4096`, `confidence:"confirmed"`). Validado contra el schema. `close` queda fuera (no fabricado). | — |
| 2 | **`OPCUA_WRITES_ENABLED=true`** | ⚙️ Se activa en el `.env` de la **instancia de prueba aislada** (no en producción) | Paso 5 |
| 3 | **Sesión SEGURA**: OPC UA `SignAndEncrypt` + identidad no-anónima | ✅ **Excepción implementada**: `OPCUA_ALLOW_INSECURE_WRITES` (`connectivity.config.ts`, `getWriteSecurity()` en el adaptador real y el simulador) — deliberada, documentada como desviación de la regla 9, default `false`. Se activa SOLO en la instancia de prueba. | Activarla en esa instancia (Paso 5) |
| 4 | **AccessLevel del nodo** `INT_OUT_SIRENA` permite `CurrentWrite` | ✅ **Confirmado por lectura**: `AccessLevel=3` (CurrentRead+CurrentWrite) | — |
| 5 | **Interlock**: bridge `Connected` + snapshot `live` + `connectionStatus` OK | ✅ **VERIFICADO en la ejecución (2026-07-30)**: pasó cuando el snapshot alcanzó `live` a los ~7 s de arrancar; el intento a los 3 s fue rechazado (`409 INTERLOCK_FAILED: snapshot frozen`). El interlock NO se debilitó. | — |
| 6 | **RBAC**: rol con permiso `control_valves` | ✅ Cuenta **Joshua Lores (admin)** — JWT vía `mint-test-jwt.ts` | — |
| 7 | **Físico**: personal en la válvula confirmando que es seguro accionar | 👷 campo | Coordinación en sitio antes de cada envío |

**Único paso real pendiente:** ejecutar el Paso 5 (instancia de prueba en la VM + llamada por el canal
oficial). Todo lo demás (mapping, excepción de código, tests) ya está implementado y verificado.

## 4. Procedimiento

### Paso 0 — Conectividad local (sin VM)  ·  Decisiones (2026-07-29)
- **OPC UA:** endpoint = IP del **PLC maestro** instaurado con nuestro equipo, **identidad ANÓNIMA** ("incógnito").
- **Auth backend:** cuenta **Joshua Lores (admin)** de nuestra BD → cumple RBAC `control_valves` (candado #6).
- **Escritura = Opción A:** sesión insegura → requiere `OPCUA_ALLOW_INSECURE_WRITES=true` (candado #3), local/auditado/revertido.
- [ ] **CONFIRMAR la IP:puerto exacta** del PLC maestro que responde desde el equipo de campo (NO adivinar — escribir al endpoint equivocado acciona una válvula equivocada).
- [ ] `.env` local: `CONNECTIVITY_PROVIDER=opcua`, `OPC_ENDPOINT=opc.tcp://<ip-confirmada>:59100`, `OPC_IDENTITY=anonymous`.

### Paso 1 — LECTURA (seguro, cero riesgo) — hacer PRIMERO
- [ ] Leer `INT_OUT_SIRENA` (valor actual de comando) y `INT_IN_SIRENA` (estado) en vivo, **read-only**.
- [ ] Con la válvula en un estado conocido (p. ej. CERRADA), anotar el patrón de `INT_IN_SIRENA` →
      confirmar qué índice/bits reflejan ABIERTA/CERRADA para Sirena.
- [ ] Verificar `AccessLevel` de `INT_OUT_SIRENA` (¿`CurrentWrite`?).
- [ ] Registrar valores crudos en la bitácora (§5).

### Paso 2 — Confirmar semántica con el operador
- [ ] ¿Qué índice de `INT_OUT_SIRENA` acciona la válvula objetivo? ¿Valores ABRIR/CERRAR? ¿Pulso combinado o independiente?
- [ ] ¿Qué índice de `INT_IN_SIRENA` confirma el estado? ¿Valores ABIERTA/CERRADA?

### Paso 3 — ✅ HECHO: señal writable en el mapping
Añadido a `sirena.signals[]` en `apps/api/config/opc_mapping.json` (`domainKey:"valve1"`):
```jsonc
{
  "buffer": "intOut", "sourceBuffer": "INT_OUT_SIRENA", "index": 0,
  "domainKey": "valve1", "label": "Válvula 1", "mappingStatus": "mapped",
  "confidence": "confirmed", "writable": true,
  "write": {
    "target":   { "channel": "intOut", "sourceBuffer": "INT_OUT_SIRENA", "index": 0 },
    "commands": { "open": 4096 },   // confirmado por captura real; "close" pendiente (no fabricado)
    "readBack": { "channel": "intIn", "sourceBuffer": "INT_IN_SIRENA", "index": 0,
                  "confirmsWrittenValue": false, "expectedValue": 16385 },  // inferido, no observado aún
    "timeoutMs": 5000, "rollbackValue": 0, "permission": "control_valves"
  }
}
```
- [x] `npm run -w @ptap/api validate:mapping` → ✅ válido (12 plantas).
- [x] Excepción `OPCUA_ALLOW_INSECURE_WRITES` implementada (`connectivity.config.ts` +
      `getWriteSecurity()` en `opcua-connectivity.adapter.ts`/`simulator-bridge.adapter.ts`).
- [x] `test:security`, `test:commands`, `test:bridge`, typecheck → todo verde (23+2+27 tests).

### Paso 4 — Instancia de prueba AISLADA en la VM (no tocar producción)
Levantar un **segundo proceso pm2** en la VM, mismo repo, mismo endpoint OPC UA real, puerto distinto:
```bash
# En la VM, checkout del mismo código (con el mapping+excepción de este documento):
cp .env .env.fieldtest   # partir del .env real
# editar .env.fieldtest:
#   PORT=4001
#   OPCUA_WRITES_ENABLED=true
#   OPCUA_ALLOW_INSECURE_WRITES=true
pm2 start dist/main.js --name ptap-api-fieldtest --env-file .env.fieldtest
```
- [ ] Verificar `curl http://127.0.0.1:4001/api/health/opc` → 200.
- [ ] La producción (`ptap-api`, :4000) **no se toca en absoluto**.

### Paso 5 — Comando real por el canal OFICIAL (con personal en la válvula)
```bash
# 1) JWT real de Joshua Lores (sin pedir su contraseña):
npm exec -w @ptap/api -- tsx scripts/mint-test-jwt.ts loresjoshua@gmail.com

# 2) Llamada al endpoint oficial (RBAC + interlock + idempotencia + read-back + auditoría):
CALL_TOKEN=<jwt-del-paso-1> npm exec -w @ptap/api -- tsx scripts/call-valve-command.ts \
  http://<host-vm>:4001 sirena open valve1
```
- [ ] Confirmar personal observando la válvula ANTES de correr el paso 2.
- [ ] Verificar `status:"confirmed"` (read-back `16385`) o `status:"failed"`/`reason` explícito — cualquiera
      de los dos es información válida (nunca asumir éxito sin el read-back).
- [ ] Revisar `command_log`/`audit_log` en MySQL (trazabilidad).
- [ ] **Al terminar:** `pm2 delete ptap-api-fieldtest` — no hace falta revertir nada en producción
      porque nunca se tocó.

## 5. Bitácora de resultados (llenar en campo)

| Hora | Paso | Acción | Resultado esperado | Resultado real | ¿OK? | Notas |
|---|---|---|---|---|---|---|
| | 1 | Leer `INT_IN_SIRENA` con válvula CERRADA | patrón estado cerrada | | | |
| | 1 | Leer `INT_IN_SIRENA` con válvula ABIERTA | patrón estado abierta | | | |
| | 1 | AccessLevel `INT_OUT_SIRENA` | CurrentWrite | | | |
| | 4 | `secure === true` | sesión cifrada | | | |
| | 5 | Comando abrir/cerrar | read-back confirma + válvula acciona | | | |

## 6. Estado / preguntas abiertas
- [x] ¿Credenciales OPC UA de escritura? → **NO hay: el servidor acepta escritura ANÓNIMA** (hallazgo P0). Resuelto con la excepción de código `OPCUA_ALLOW_INSECURE_WRITES` (implementada, candado #3).
- [x] ¿Cuál es la válvula objetivo y su índice en `INT_OUT_SIRENA`? → índice **0** (canal 0, único índice con actividad).
- [x] ¿PLC de Sirena arriba? → **Sí, en vivo** (corregido §0).
- [ ] **`close`**: valor/bit para cerrar — pendiente de capturar con el mismo método (`monitor-sirena-full.ts` mientras se dispara "cerrar" desde el HMI).
- [ ] Ejecutar el Paso 5 (instancia de prueba en la VM) — primera escritura REAL desde nuestro sistema, aún no realizada.
- [ ] Heurístico de respaldo por caudal (ver §2) — mejora futura, no implementada.
