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
