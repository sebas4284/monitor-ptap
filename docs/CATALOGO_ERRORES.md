# Catálogo de errores — Monitor PTAP

**Propósito:** identificar rápido cualquier fallo del sistema por un **código** estable, saber en
**qué archivo** vive, qué lo causa normalmente, qué ve el usuario y quién lo resuelve. Cuando alguien
reporte "sale NET-02" o "el comando dio CMD-05", con este catálogo se ubica el problema en segundos.

**Nomenclatura:** `PREFIJO-NN`. El prefijo agrupa por dominio; `NN` es el número dentro del dominio.

| Prefijo | Dominio |
|---|---|
| `NET` | Conexión del **dispositivo** a internet/servidor (lado del usuario) |
| `PLC` | Enlace y datos del **PLC** (lado del servidor) |
| `DAT` | Calidad/integridad de una **señal** en el pipeline |
| `AUT` | **Autenticación** y control de acceso (RBAC) |
| `CMD` | Canal de **comandos** / escritura al PLC (Fase 5) |
| `SRV` | **Servidor** e infraestructura (API, BD) |
| `CFG` | **Configuración** / arranque (`.env`, red al PLC) |
| `DEF` | **Defectos conocidos** (bugs/riesgos internos con severidad y ruta a corregir) |

> Muchos códigos son la traducción "amable" de constantes que YA existen en el código (`REJECT.*`,
> `UnusableReason`, `DeadLetterType`, `BridgeStatus`). La columna **Ruta** apunta a su origen.

---

## NET — Conexión del dispositivo (lo ve el usuario en el banner)

El dispositivo no está viendo el servidor. La app distingue tres causas porque la acción es distinta.

| Código | Título | Causa común | Qué ve / hace el usuario | Ruta |
|---|---|---|---|---|
| **NET-01** | No estás conectado a una red | WiFi/datos apagados, modo avión | "Conéctate a WiFi o datos" | [useClientNetworkStatus.ts](../apps/mobile/hooks/useClientNetworkStatus.ts) · [ConnectionBanner.tsx](../apps/mobile/components/ConnectionBanner.tsx) |
| **NET-02** | Tu red no tiene salida a internet | Red conectada pero sin navegación (caída del proveedor, portal cautivo, IP sin ruta) | "Contacta a tu proveedor de internet" | ídem (ping a host público falla) |
| **NET-03** | El servidor no responde | Hay internet, pero la API del sistema está caída o inalcanzable | "Avisa al administrador del sistema" | ídem (ping OK + API falla) · ver **SRV-01** |

---

## PLC — Enlace y datos del PLC (lado del servidor)

La app SÍ alcanza el servidor, pero no llegan datos del PLC. Deriva del `bridgeStatus` del puente.

| Código | Título | `bridgeStatus` | Quién lo ve | Ruta |
|---|---|---|---|---|
| **PLC-01** | Sin conexión con el PLC (problema de ruta) | `Connecting`/`Disconnected`/`Recovering`/`Faulted` | **Solo admin** (a operador no le aporta) | [classifyBridge](../packages/shared/src/index.ts) · [ConnectionBanner.tsx](../apps/mobile/components/ConnectionBanner.tsx) |
| **PLC-02** | El PLC no está enviando datos | `Stale` (hubo sesión y el dato paró) | Todos | ídem |
| **PLC-03** | Namespace OPC UA no resuelto | `Faulted` por `NamespaceNotFoundError` (el índice del servidor cambió y el mapping no resuelve) | Admin/técnico | [namespace-resolver.ts](../apps/api/src/infrastructure/connectivity/opcua/namespace-resolver.ts) |
| **PLC-11** | Puerto del PLC rechaza la conexión | La sonda TCP recibe RST: el host está **vivo** pero nada escucha en el puerto → el servicio OPC del maestro está caído o cambió de puerto | Admin (prueba de ruta) | [route-check.service.ts](../apps/api/src/infrastructure/connectivity/route-check.service.ts) |
| **PLC-12** | Puerto del PLC **filtrado** (host vivo) | El host responde **ping** pero el TCP al puerto muere en timeout: un cortafuegos descarta el TCP. NO es "planta sin internet" ni IP incorrecta — es un bloqueo (evidencia real del 2026-07-22: ping 21 ms OK, TCP 59100 muerto) | Admin (prueba de ruta) | ídem |

> Estados del puente (máquina de estados): [connectivity-adapter.port.ts](../apps/api/src/infrastructure/connectivity/ports/connectivity-adapter.port.ts) · [bridge-state-machine.ts](../apps/api/src/infrastructure/connectivity/bridge/bridge-state-machine.ts).
> El historial de transiciones queda en `audit_log` (`opc.bridge_status_change`) y se exporta desde
> Ajustes → Estado de conexión. Escalar un **PLC-01** persistente: `docs/INCIDENTE_CONEXION_PLC.md`.
>
> **PLC-01 NO dice dónde está la falla** — solo que el servidor no sostiene sesión con el PLC. El
> **dónde** lo da la prueba de ruta en vivo (`GET /api/diagnostics/route-check`, botón "Probar ruta
> ahora" en Ajustes): sondas servidor→internet (TCP), ping ICMP al host y TCP al puerto OPC, con
> veredicto por evidencia: sin internet en el servidor = **SRV-07** (proveedor del servidor);
> ping OK + TCP muerto = **PLC-12** (host vivo, puerto filtrado); todo muerto = **PLC-01** (ruta o
> planta); rechazo = **PLC-11** (host vivo, servicio caído).
>
> Además hay **registro interno**: una prueba automática OCULTA cada hora **en punto** (alineada
> al reloj; una manual a las 5:30 no corre la de las 6:00), con catch-up al arrancar
> (`ROUTE_PROBE_ENABLED`, sampler → `audit_log` `opc.route_probe`, `source` auto|manual). Ventana
> de **20 h** en `GET /api/diagnostics/route-history` (resumen: % alcanzable, corte vigente desde);
> cada hora nueva expulsa de la vista a la más vieja. Las pruebas manuales del botón también se
> graban. En la app el registro solo se muestra tras ejecutar la prueba; siempre viaja en el
> informe .txt exportable.

### Modos internos del puente (diagnóstico — no llegan al usuario final)

Transiciones y resiliencia del adaptador OPC UA. Un admin/técnico los ve en `/api/opc/status` y en el
historial de conexión; el operador solo ve el resultado (PLC-01/02).

| Código | Título | Qué pasa | Ruta |
|---|---|---|---|
| **PLC-04** | Watchdog vencido | No llegó ningún dato en la ventana → el puente recicla la suscripción (y si insiste, la sesión) | [watchdog.ts](../apps/api/src/infrastructure/connectivity/bridge/watchdog.ts) · adapter `onWatchdogTimeout` |
| **PLC-05** | Heartbeat sin respuesta | N sondeos consecutivos fallan (default 2 ≈ 20 s) → reciclaje de sesión | [heartbeat-monitor.ts](../apps/api/src/infrastructure/connectivity/bridge/heartbeat-monitor.ts) · adapter `onHeartbeatThreshold` |
| **PLC-06** | Canal perdido (Recovering) | node-opcua avisa `connection_lost`; entra en su backoff interno de reconexión | adapter `wireClientEvents` |
| **PLC-07** | Reciclaje de sesión falló | Al recrear la sesión algo falla → el puente pasa a `Faulted` | adapter `recycleSession` (ver **DEF-01**) |
| **PLC-08** | Certificado de cliente ausente | `OPC_IDENTITY=certificate` pero no hay cert/llave en `pki/own/certs` → no arranca | adapter `buildIdentity` |
| **PLC-09** | Timing OPC inválido | `lifetime < 3×keepalive` → el backend NO arranca (regla dura OPC UA Part 4) | [connectivity.config.ts](../apps/api/src/infrastructure/connectivity/connectivity.config.ts) (ver **CFG-07**) |
| **PLC-10** | Seguridad no soportada | El servidor no ofrece el `securityMode`/`policy` pedido, o el endpoint no existe (`endpointMustExist`) | connectivity.config.ts · `.env` |

---

## DAT — Calidad/integridad de una señal (pipeline)

Una señal concreta no es usable o se descartó. El valor **sigue mostrándose si es numérico** (política
"si hay número, se muestra"): estos códigos son metadatos de aviso, no ocultan el dato.

| Código | Título | Origen (`reason`/`type`) | Significado | Ruta |
|---|---|---|---|---|
| **DAT-01** | Calidad OPC no buena | `BAD_QUALITY` | El PLC marcó la lectura como no buena (StatusCode ≠ Good) | [quality.evaluator.ts](../apps/api/src/infrastructure/connectivity/pipeline/quality.evaluator.ts) |
| **DAT-02** | Valor inválido | `INVALID_NUMBER` | Llegó NaN/Infinity; se serializa como `null` | ídem · [snapshot.builder.ts](../apps/api/src/infrastructure/connectivity/pipeline/snapshot.builder.ts) |
| **DAT-03** | Sin conexión con el PLC (dato viejo) | `BRIDGE_STALE` | El puente perdió la sesión: el último valor no es fiable | ídem (ligado a **PLC-01/02**) |
| **DAT-04** | Buffer ausente | `BUFFER_MISSING` | El buffer fuente de la señal no llegó del PLC | [mapping.engine.ts](../apps/api/src/infrastructure/connectivity/pipeline/mapping.engine.ts) · [dead-letter.buffer.ts](../apps/api/src/infrastructure/connectivity/pipeline/dead-letter.buffer.ts) |
| **DAT-05** | Índice fuera de rango | `INDEX_OUT_OF_RANGE` | El índice mapeado excede el tamaño del buffer recibido | ídem |
| **DAT-06** | Tamaño de array inesperado | `UNEXPECTED_LENGTH` | El array del PLC no tiene la longitud esperada (drift PLC↔mapping) | ídem |
| **DAT-07** | Fuera de rango físico | `outOfRange` | La lectura cae fuera de `[min,max]` de validez física (p. ej. presión −57 psi) | [quality.evaluator.ts](../apps/api/src/infrastructure/connectivity/pipeline/quality.evaluator.ts) |

> Las señales descartadas (`DAT-04/05/06`) quedan en el **dead-letter** (`GET /api/opc/dead-letter`,
> solo admin). `DAT-07` NO descarta el dato: lo marca "fuera de rango" y se sigue mostrando.

---

## AUT — Autenticación y acceso (RBAC)

| Código | Título | HTTP | Causa | Ruta |
|---|---|---|---|---|
| **AUT-01** | Credenciales inválidas | 401 | Correo o contraseña incorrectos (mensaje genérico anti-enumeración) | [auth.service.ts](../apps/api/src/modules/auth/auth.service.ts) |
| **AUT-02** | Cuenta pendiente o desactivada | 403 | Registro sin aprobar, o cuenta desactivada por un admin | [auth.service.ts](../apps/api/src/modules/auth/auth.service.ts) |
| **AUT-03** | Sesión ya no válida | 401 | La cuenta fue desactivada/eliminada; el guard relee la BD y corta la sesión | [jwt-auth.guard.ts](../apps/api/src/modules/auth/guards/jwt-auth.guard.ts) |
| **AUT-04** | Permiso insuficiente | 403 | El rol no tiene el permiso requerido (matriz oficial) | [permission.guard.ts](../apps/api/src/modules/auth/guards/permission.guard.ts) |
| **AUT-05** | Planta no autorizada | 403 | Se pidió una planta distinta a la de la cuenta (sin `view_all_plants`) | [plant-scope.guard.ts](../apps/api/src/modules/auth/guards/plant-scope.guard.ts) |
| **AUT-06** | Token inválido o expirado | 401 | JWT ausente, malformado o caducado (8 h) | [jwt.service.ts](../apps/api/src/modules/auth/jwt.service.ts) · [jwt-auth.guard.ts](../apps/api/src/modules/auth/guards/jwt-auth.guard.ts) |
| **AUT-07** | Correo ya registrado | 409 | Alta con un correo que ya existe | [auth.service.ts](../apps/api/src/modules/auth/auth.service.ts) |
| **AUT-08** | Demasiados intentos | 429 | Rate-limit de login/registro (fuerza bruta / alta masiva) | [main.ts](../apps/api/src/main.ts) |
| **AUT-09** | Acción bloqueada sobre uno mismo | 400 | Un admin intenta cambiar su propio rol o auto-desactivarse | [users.service.ts](../apps/api/src/modules/users/users.service.ts) |
| **AUT-14** | Acción bloqueada sobre otro administrador | 403 | Un admin intenta DESACTIVAR o DEGRADAR a otro admin. Los administradores son mutuamente intocables (se gestionan por script/BD, `db:seed-admin`). SÍ se permite PROMOVER a admin a un no-admin | [users.service.ts](../apps/api/src/modules/users/users.service.ts) |
| **AUT-10** | Datos de la petición inválidos | 400 | Body/query no pasa el schema `zod` (`.strict()`) | [zod-validation.pipe.ts](../apps/api/src/infrastructure/validation/zod-validation.pipe.ts) |
| **AUT-11** | Registro rechazado (validación) | 400 | El body del registro no cumple: contraseña débil (falta mayúscula/minúscula/dígito), correo desechable, planta inexistente, nombre con URL, teléfono con formato inválido, o **honeypot** con contenido (bot) | [register.dto.ts](../apps/api/src/modules/auth/dto/register.dto.ts) |
| **AUT-12** | Correo no verificado (no se puede activar) | 400 | Un admin intenta activar una cuenta cuyo correo aún no fue verificado por el usuario | [users.service.ts](../apps/api/src/modules/users/users.service.ts) |
| **AUT-13** | Enlace de verificación inválido/vencido | — (HTML) | El token de `verify-email` no existe, ya venció o ya se usó → página de "enlace no válido" (genérico, anti-enumeración) | [email-verification.repository.ts](../apps/api/src/modules/auth/email-verification.repository.ts) · [auth.controller.ts](../apps/api/src/modules/auth/auth.controller.ts) |

> **Flujo de alta (3 barreras anti-bot):** (1) validación estricta del registro (AUT-11) →
> (2) **verificación de correo** por enlace (token de un solo uso con expiración; el transporte es
> `console`/dev por ahora, `EMAIL_TRANSPORT`) → (3) **aprobación del admin**, que NO puede activar
> una cuenta sin correo verificado (AUT-12). El reenvío (`/api/auth/resend-verification`) responde
> siempre genérico para no revelar qué correos existen.

---

## CMD — Canal de comandos / escritura al PLC (Fase 5)

Rechazos (`REJECT`) y fallos (`FAIL`) del `WriteService`. Todos quedan auditados.

> **Protocolo de válvulas de La Vorágine** (mando/estado real del PLC, sin cablear): registrado en
> [PROTOCOLO_VALVULAS_VORAGINE.md](PROTOCOLO_VALVULAS_VORAGINE.md) — ⛔ material de referencia, **no
> ejecutar** (enviar un pulso puede dañar la planta). La escritura sigue cerrada
> (`OPCUA_WRITES_ENABLED=false`, sin señales `writable`).

| Código | Título | Constante | HTTP | Ruta |
|---|---|---|---|---|
| **CMD-01** | Destino no escribible | `TARGET_NOT_WRITABLE` | 404 | [command.dto.ts](../apps/api/src/modules/commands/command.dto.ts) · [write.service.ts](../apps/api/src/modules/commands/write.service.ts) |
| **CMD-02** | Comando desconocido | `UNKNOWN_COMMAND` | 400 | ídem |
| **CMD-03** | Escritura bloqueada (sesión insegura) | `WRITES_DISABLED_INSECURE_SESSION` | 403 | ídem (precondición dura: sesión cifrada + autenticada) |
| **CMD-04** | Sin permiso para el comando | `FORBIDDEN` | 403 | ídem (p. ej. un jefe NO abre válvulas) |
| **CMD-05** | Interlock no satisfecho | `INTERLOCK_FAILED` | 409 | ídem (puente no `Connected` o snapshot no `live`) |
| **CMD-06** | Comando ya en curso | `IN_PROGRESS` | 409 | ídem (idempotencia por `idempotencyKey`) |
| **CMD-07** | Escritura no confirmada | `READBACK_UNCONFIRMED` | — | ídem (el read-back no confirmó el valor → rollback) |

---

## SRV — Servidor e infraestructura

| Código | Título | Causa | Detección | Ruta |
|---|---|---|---|---|
| **SRV-01** | API no responde | El backend está caído o no arrancó | El cliente lo ve como **NET-03** | [health.controller.ts](../apps/api/src/modules/health/health.controller.ts) |
| **SRV-02** | Base de datos no disponible | MySQL caído o credencial mala | `GET /api/health/db` → 503 | [health.controller.ts](../apps/api/src/modules/health/health.controller.ts) |
| **SRV-03** | Puerto en uso | Quedó otro proceso en `:4000`/`:8081` (`EADDRINUSE`) | Log de arranque | [main.ts](../apps/api/src/main.ts) |
| **SRV-04** | ✅ **RESUELTO (2026-07-21)**: el gateway autentica el handshake con el JWT del login; sin token válido corta la conexión. Desactivable con `SOCKET_AUTH_REQUIRED=false` (solo el demo de telemetría) | — | [connectivity.gateway.ts](../apps/api/src/infrastructure/connectivity/connectivity.gateway.ts) · test `gateway-auth.test.ts` |
| **SRV-05** | Token de métricas inválido | `/metrics` protegido por Bearer y el token no coincide (o falta) | 401 en el scrape | [metrics-auth.guard.ts](../apps/api/src/infrastructure/metrics/metrics-auth.guard.ts) |
| **SRV-06** | Fallo de BD durante un comando | La BD no responde al reservar/finalizar en `command_log` (Fase 5) | Error del comando | [command-log.repository.ts](../apps/api/src/modules/commands/command-log.repository.ts) |
| **SRV-07** | El servidor sin salida a internet | La sonda servidor→internet (8.8.8.8:53) falla: el problema es la red/proveedor del **servidor de monitoreo**, no la planta | Prueba de ruta (admin) | [route-check.service.ts](../apps/api/src/infrastructure/connectivity/route-check.service.ts) |

---

## FRT — Seguridad del cliente (app móvil/web)

Hallazgos de la auditoría del front (2026-07-22). El backend ya está cubierto (JWT por request,
RBAC, PlantScopeGuard, SRV-04, revocación por relectura en BD); estos son del lado del cliente.

| Código | Título | Estado | Ruta |
|---|---|---|---|
| **FRT-01** | Socket.IO sobrevivía al logout con el token viejo (stream de datos activo sin sesión; reutilizaba el JWT de otro usuario al re-entrar) | ✅ **RESUELTO (2026-07-22)**: `resetSocket()` cierra el socket; AuthContext lo llama en login y logout | [socket.ts](../apps/mobile/services/socket.ts) · [AuthContext.tsx](../apps/mobile/context/AuthContext.tsx) |
| **FRT-02** | Comentario obsoleto afirmaba que el gateway NO valida el handshake (falso desde SRV-04) | ✅ **RESUELTO (2026-07-22)**: comentario corregido | [socket.ts](../apps/mobile/services/socket.ts) |
| **FRT-03** | CORS del gateway WebSocket fijo en `origin:'*'` en vez de la allowlist `CORS_ORIGINS` | ✅ **RESUELTO (2026-07-22)**: usa `CORS_ORIGINS` (fallback `*` solo para el demo sin esa variable) | [connectivity.gateway.ts](../apps/api/src/infrastructure/connectivity/connectivity.gateway.ts) |
| **FRT-04** | JWT y respaldo de telemetría en `localStorage` (solo web) → legibles por un XSS. Nativo usa SecureStore (correcto) | ⚠️ **RIESGO ACEPTADO**: el fix real es cookie httpOnly (cambio de backend) y choca con la persistencia de sesión de 8 h; se mantiene deliberadamente | [AuthContext.tsx](../apps/mobile/context/AuthContext.tsx) · [last-snapshot-store.ts](../apps/mobile/services/last-snapshot-store.ts) |

> **FRT-04 — mitigación futura:** emitir el JWT en una cookie `httpOnly; Secure; SameSite` desde el
> backend y que el front deje de tocar el token en JS. Elimina el robo por XSS a costa de rehacer el
> flujo de login/CORS. Mientras tanto, la exposición se acota por: expiración de 8 h, revocación por
> relectura en BD, y que en móvil nativo el token va en SecureStore, no en localStorage.

---

## CFG — Configuración / arranque

Errores de puesta en marcha; no pasan por la UI, se ven en el arranque. Detalle en `docs/SETUP.md` y
`docs/SETUP_AGENT.md`.

| Código | Título | Síntoma | Solución | Ruta |
|---|---|---|---|---|
| **CFG-01** | Falta `.env` / `DB_PASSWORD` | "Falta la variable de entorno DB_PASSWORD" | Crear `.env` (§SETUP) | [config/load-env](../apps/api/src/config) · [database.config.ts](../apps/api/src/infrastructure/database/database.config.ts) |
| **CFG-02** | CORS vacío | Login falla **solo en el navegador** (curl funciona) | `CORS_ORIGINS=http://localhost:8081` | [main.ts](../apps/api/src/main.ts) |
| **CFG-03** | Pepper inválido | El login truena tras sembrar usuarios | `PASSWORD_PEPPER_V1_BASE64` = 64 bytes | [password-hashing.service.ts](../apps/api/src/modules/auth/password-hashing.service.ts) |
| **CFG-04** | PLC inalcanzable | Puente en `Connecting` indefinido (**PLC-01**) | Revisar red/VPN/IP al PLC | [.env.example](../.env.example) · [docs/INCIDENTE_CONEXION_PLC.md](INCIDENTE_CONEXION_PLC.md) |
| **CFG-05** | Certificado del servidor no confiado | El puente no conecta seguro; el cert del PLC queda en `pki/rejected` | Moverlo a `pki/trusted` tras verificarlo | [docs/OPTIX_CLIENT_CERT_TRUST.md](OPTIX_CLIENT_CERT_TRUST.md) |
| **CFG-06** | Auto-aceptar certificados en producción | `OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=true` fuera de desarrollo | Ponerlo en `false` y confiar el cert a mano (riesgo MITM) | `.env` · adapter `createClient` |
| **CFG-07** | Timing OPC mal configurado | `lifetime`/`keepalive` no cumplen la relación 3× → el backend NO arranca (**PLC-09**) | Ajustar `OPCUA_REQUESTED_*` en `.env` | [connectivity.config.ts](../apps/api/src/infrastructure/connectivity/connectivity.config.ts) |

---

## DEF — Defectos conocidos (bugs y riesgos internos)

No son mensajes que vea el usuario: son **fallos específicos del código** detectados en la auditoría
técnica de preproducción ([auditoria-tecnica-preproduccion-2026-07-14.md](audit/auditoria-tecnica-preproduccion-2026-07-14.md),
detalle y recomendación de cada uno ahí). Se listan con su ubicación exacta para corregirlos rápido.

> **Estado re-verificado el 2026-07-21:** los 4 críticos estaban abiertos y se **CORRIGIERON** el
> mismo día (con test cada uno). El resto conserva el estado de la auditoría salvo donde se indica.

### Críticos — ✅ RESUELTOS (2026-07-21, con test)

| Código | Descripción | Ruta | Cómo se resolvió |
|---|---|---|---|
| **DEF-01** | El puente quedaba `Faulted` **permanente** tras un fallo transitorio de reciclaje: nada lo recuperaba salvo reiniciar el proceso | [bridge-orchestrator.service.ts](../apps/api/src/infrastructure/connectivity/bridge-orchestrator.service.ts) · [bridge-state-machine.ts:18](../apps/api/src/infrastructure/connectivity/bridge/bridge-state-machine.ts#L18) | ✅ El listener de `onStatusChange` recupera de `Faulted` post-arranque con `stop()`+`startWithRetry()` (backoff); test `bridge-recovery.test.ts` |
| **DEF-02** | Fuga de `OPCUAClient` (socket + canal seguro + 3 listeners) en **cada** reintento fallido tras `connect()` | [opcua-connectivity.adapter.ts:156](../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts#L156) | ✅ El `catch` de `start()` ahora hace `client.disconnect()` + limpia la referencia |
| **DEF-03** | `Number(null) === 0`: un `null` por elemento del PLC se volvía **0 real**, sin traza | [opcua-connectivity.adapter.ts:388](../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts#L388) | ✅ `v == null ? NaN : Number(v)` → cae en `INVALID_NUMBER` (DAT-02); test en `pipeline.test.ts` |
| **DEF-04** | Señal estructuralmente rota salía `usable:true` con `value:null` | [quality.evaluator.ts](../apps/api/src/infrastructure/connectivity/pipeline/quality.evaluator.ts) · [mapping.engine.ts:85-92](../apps/api/src/infrastructure/connectivity/pipeline/mapping.engine.ts#L85-L92) | ✅ Guard `value===null → INVALID_NUMBER` + `INDEX_OUT_OF_RANGE` fuerza `quality:'Bad'`; tests en `pipeline.test.ts` |

### Altos

| Código | Descripción | Ruta |
|---|---|---|
| **DEF-05** | Carrera `onReconnected` vs `recycleSession`/`onWatchdogTimeout` (no comprueba `recycling`) → subscripción huérfana en el servidor OPC UA | opcua-connectivity.adapter.ts (`connection_reestablished` vs guards) |
| **DEF-06** | El heartbeat sigue sondeando en `Recovering` y compite con la reconexión interna de node-opcua — el escenario más común (cortes intermitentes) | [opcua-connectivity.adapter.ts:232-235](../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts#L232-L235) |
| **DEF-07** | `UNEXPECTED_LENGTH`/`arrayLength` es código muerto: un drift PLC↔mapping (firmware que acorta un buffer) no genera ninguna alerta agregada | [mapping.engine.ts](../apps/api/src/infrastructure/connectivity/pipeline/mapping.engine.ts) · [dead-letter.buffer.ts](../apps/api/src/infrastructure/connectivity/pipeline/dead-letter.buffer.ts) |
| **DEF-08** | ✅ **RESUELTO (2026-07-22)**: el contrato del snapshot (`BridgeStatus`, `SignalDto`, `PlantSnapshotDto`, `PlantBasicStatusDto`, …) vive en `@ptap/shared` como fuente ÚNICA; backend y móvil lo importan de ahí (el móvil recupera la unión de 6 estados y el typecheck fuerza la sincronía) | [shared/src/index.ts](../packages/shared/src/index.ts) ← [plant-snapshot.dto.ts](../apps/api/src/infrastructure/connectivity/pipeline/plant-snapshot.dto.ts) · [api.ts](../apps/mobile/services/api.ts) |
| **DEF-09** | ✅ **RESUELTO (2026-07-22)**: el log por snapshot bajó a `debug` — invisible con `LOG_LEVEL=info` (default), recuperable con `LOG_LEVEL=debug` al investigar. Las transiciones del puente (raras) siguen en `info` | [structured-events.subscriber.ts](../apps/api/src/infrastructure/logging/structured-events.subscriber.ts) |

### Medios

| Código | Descripción | Ruta |
|---|---|---|
| **DEF-10** | `recycleCount` no resetea tras un reciclaje parcial exitoso → tras 3 Stale autocurados (aunque sin relación), escala a reciclaje completo para siempre | opcua-connectivity.adapter.ts (bloque de éxito Nivel 1) |
| **DEF-11** | Los 3 subscribers de Fase 4 no implementan `OnModuleDestroy` y no hay API para desuscribirse → listeners duplicados si algún día se re-inicializan módulos | connection-events / opc-metrics / structured-events subscribers |
| **DEF-12** | Una string numérica (`"42.5"`) se acepta como lectura legítima sin registrar la anomalía de tipo | [opcua-connectivity.adapter.ts:388](../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts#L388) |
| **DEF-13** | `reason` del audit incluye `err.message` de node-opcua sin sanear (texto de terceros) → riesgo teórico de filtrar algo sensible | [connection-events.subscriber.ts](../apps/api/src/infrastructure/audit/connection-events.subscriber.ts) |
| **DEF-14** | Logs de `backoff` sin agregación durante outages largos (~960 líneas WARN en 8 h) | opcua-connectivity.adapter.ts (`client.on('backoff')`) |
| **DEF-15** | Capacidad del ring buffer del dead-letter fija (500) sin variable de entorno | [dead-letter.buffer.ts:26](../apps/api/src/infrastructure/connectivity/pipeline/dead-letter.buffer.ts#L26) |

### Bajos (agrupados)
Teardown parcial no explícito en ciertos `catch` de subscription; `PlantCache.write()` sin guard de
`sequence`; tipo `Valve` duplicado en el móvil; triple logging de cada transición de bridge; JWT sin
`algorithm` fijado / sin `iss`/`aud` / sin cota de `expiresIn` (no explotable en este despliegue);
comparación no constante en el guard de métricas. Detalle en la auditoría (Hallazgos 6, 10, 19, 21,
22, 25, 28).

### Resueltos desde la auditoría
- **H30 — poller legado con config fuera de `.env`:** RESUELTO. `connectivity.service.ts` y
  `opc-config.service.ts` fueron eliminados; ya no hay poller en paralelo al pipeline real.

---

## Cómo se usa esto

- **Un operador reporta un problema:** que dicte el código del banner (p. ej. **NET-02**). Con la
  tabla NET se sabe al instante que es su proveedor de internet, no el sistema.
- **Un admin escala un corte del PLC:** exporta el `.txt` desde Ajustes → Estado de conexión; el
  informe trae el código (**PLC-01/02**) y el detalle técnico para el programador.
- **Un desarrollador depura:** busca el código aquí → salta a la **Ruta** del archivo donde se origina.
- **Se prioriza deuda técnica:** la sección **DEF** es la lista de bugs/riesgos con severidad y ruta;
  los **DEF-01…04 (críticos, abiertos)** son lo que hay que cerrar antes de un piloto sin supervisión.

> Mantener este catálogo: al añadir un `REJECT`, una `UnusableReason` o un estado nuevo, se agrega su
> fila aquí con su código y ruta; al corregir un **DEF**, se marca resuelto (como H30). Es la única
> lista maestra de fallos del proyecto.
