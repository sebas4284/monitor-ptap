# Auditoría técnica preproducción — Gateway OPC UA Monitor PTAP

**Fecha:** 2026-07-14 · **Rama:** yosh · **Modalidad:** solo lectura, sin cambios de comportamiento.
**Alcance:** los 13 puntos solicitados, sobre `apps/api`, `apps/mobile`, `packages/shared`.

Metodología: 5 investigaciones independientes en paralelo (reconexión/lifecycle OPC UA, memoria y
concurrencia del pipeline, seguridad JWT/audit log, datos inválidos/configuración, duplicación de
contratos/logging), cada una leyendo el código fuente completo de los archivos relevantes (no
fragmentos), con grep exhaustivo sobre todo `apps/api/src` para los puntos transversales
(timers/listeners, logging, hardcoding). Los hallazgos de mayor severidad (Faulted terminal,
`Number(null)===0`, drift de DTOs) fueron re-verificados directamente leyendo el código fuente
antes de incluirlos aquí.

---

## 1. Reconexión OPC UA

### Hallazgo 1

**Severidad:** Crítico

**Estado:** Confirmado

**Archivos:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:413-443`, `apps/api/src/infrastructure/connectivity/bridge/bridge-state-machine.ts:18`, `apps/api/src/infrastructure/connectivity/bridge-orchestrator.service.ts:36-48`

**Evidencia:** La máquina de estados declara `Faulted: ['Connecting'], // solo se sale de Faulted reintentando el arranque` (bridge-state-machine.ts:18). Si `recycleSession()` falla, transiciona a `Faulted` con el comentario propio del código: *"Faulted es terminal hasta stop()/start(): watchdog y heartbeat quedan parados"* (adapter.ts:438). Pero `BridgeOrchestratorService.startWithRetry()` (líneas 36-48) es la ÚNICA pieza que llama `adapter.start()`, y solo se reprograma a sí misma vía `setTimeout` dentro del `catch` de esa misma llamada (línea 40-46). Una vez que `adapter.start()` resuelve con éxito una sola vez, esa función nunca vuelve a invocarse — no existe ningún listener de `onStatusChange` que, al ver `Faulted`, llame `adapter.stop()` + `adapter.start()`. Los otros dos suscriptores de `onStatusChange` (`ConnectionEventsSubscriber`, `StructuredEventsSubscriber`) solo auditan/loguean.

**Impacto:** cualquier fallo transitorio dentro de `recycleSession()` (el PLC rechaza momentáneamente `createSession`, `resolveTargets()` lanza por un `NamespaceNotFoundError` intermitente, etc.) DESPUÉS de haber estado `Connected` mata el puente **permanentemente** hasta que alguien reinicie el proceso Node a mano. En una planta de tratamiento de agua operando 24/7 sin supervisión constante, esto significa que un evento transitorio de red puede dejar el monitoreo completamente ciego indefinidamente, sin ninguna alerta automática de que necesita intervención humana más allá del log de la transición.

**Recomendación:** cuando el bridge transiciona a `Faulted` después de haber estado operativo (no en el arranque inicial, donde `BridgeOrchestratorService` ya reintenta), un listener debería disparar `adapter.stop()` seguido de un nuevo ciclo de `startWithRetry()` con backoff, en vez de dejarlo varado.

---

### Hallazgo 2

**Severidad:** Alto

**Estado:** Confirmado

**Archivos:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:236-257` vs `:382,413-417,454`

**Evidencia:** `client.on('connection_reestablished', () => { this.reconnectCount++; ...; void this.onReconnected(); })` (línea ~240) **no** verifica `this.recycling` antes de proceder. En cambio, `onWatchdogTimeout()` (línea 382: `if (this.recycling) return;`), `recycleSession()` (línea 414) y `onHeartbeatThreshold()` (línea 454) sí se protegen mutuamente entre ellos.

**Impacto:** si el heartbeat dispara `recycleSession('heartbeat')` justo cuando node-opcua también dispara `connection_reestablished` (plausible: el mismo corte de red que activó el heartbeat-timeout es el que se restaura), ambas rutas pueden llamar `setupSubscription()` concurrentemente sobre `this.session`. Como la asignación `this.subscription = await session.createSubscription2(...)` no tiene lock, la ejecución que resuelve última "gana" la referencia y la subscription creada por la otra queda huérfana en el servidor OPC UA (nunca se le llama `.terminate()`, porque `this.subscription` ya apunta a otra cosa) — es la subscripción huérfana que pedían auditar en el punto 1, pero solo se materializa en este camino de carrera específico.

---

### Hallazgo 3

**Severidad:** Alto

**Estado:** Confirmado

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:232-235`

**Evidencia:** `client.on('connection_lost', () => { this.watchdog.stop(); this.bridge.transition('Recovering', ...); })` detiene solo el **watchdog**, no `this.heartbeat`. `onHeartbeatThreshold()` excluye los estados `'Faulted', 'Disconnected', 'Connecting'` de su guard pero **no** `'Recovering'` ni `'Stale'`.

**Impacto (con defaults reales de `connectivity.config.ts`: `heartbeatIntervalMs=10000`, `heartbeatMaxFailures=2` ⇒ ~20s):** un corte de red de ~20s hace que el heartbeat siga sondeando contra una sesión con el canal caído, falle 2 veces seguidas, y dispare `recycleSession('heartbeat')` — cerrando y recreando la sesión — **mientras** node-opcua todavía está en su propio backoff interno intentando restaurar el mismo canal (`reconnectMaxRetry=1_000_000`, prácticamente indefinido). Ambos procesos compitiendo por `this.session`/`this.client` es la causa raíz más probable de llegar al Hallazgo 1 o al Hallazgo 2 en producción real, porque es exactamente el escenario más común en este dominio (cortes de red intermitentes de PLC industrial).

---

### Hallazgo 4

**Severidad:** Crítico

**Estado:** Confirmado

**Archivos:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:116-156`

**Evidencia:**
```ts
async start(): Promise<void> {
  ...
  try {
    this.client = this.createClient();
    this.wireClientEvents(this.client);
    await this.client.connect(this.config.endpoint);
    this.session = await this.client.createSession(this.buildIdentity());
    await this.resolveTargets();          // puede lanzar
    await this.setupSubscription();
    ...
  } catch (err) {
    ...
    await this.teardownSession().catch(() => undefined);  // NO toca this.client
    throw err;
  } finally { this.starting = false; }
}
```
`teardownSession()` solo cierra `subscription`/`session`, nunca llama `this.client.disconnect()`. En el siguiente reintento de `BridgeOrchestratorService.startWithRetry()`, `this.client = this.createClient()` **sobrescribe** la referencia sin desconectar ni remover listeners del cliente anterior.

**Impacto:** cualquier fallo *después* de `client.connect()` (fallo de sesión, `resolveTargets()`, `setupSubscription()`) filtra un `OPCUAClient` completo — socket TCP con canal seguro abierto, `OPCUACertificateManager`, y 3 listeners todavía activos (`connection_lost`/`connection_reestablished`/`backoff`) — por cada reintento. El caso más grave: si el mapping tiene un error de configuración que dispara `NamespaceNotFoundError` de forma consistente (el propio comentario del código dice *"Config/servidor equivocado: no se arregla reintentando"*, línea 136), `BridgeOrchestratorService` reintenta igual, indefinidamente, cada `reconnectMaxDelayMs` (30s default) — fuga **sin cota** de sockets/objetos hasta agotar file descriptors o memoria del proceso. El cliente huérfano, además, puede seguir vivo internamente y disparar eventos que mutan el mismo `this.bridge`/`this.session` que usa el cliente "activo", corrompiendo transiciones de estado de forma cruzada.

**Recomendación:** el `catch` de `start()` debería llamar también `this.client?.disconnect()` (y limpiar la referencia) antes de relanzar, no solo `teardownSession()`.

---

### Hallazgo 5

**Severidad:** Medio

**Estado:** Confirmado

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:389-401` vs `:432`

**Evidencia:** el bloque de éxito del reciclaje de Nivel 1 (solo subscription) no resetea `recycleCount`; únicamente `recycleSession()` (reciclaje de sesión completa) lo hace, en su rama de éxito.

**Impacto:** `recycleCount` es un contador de por vida del proceso, no de fallos consecutivos. Tras `subscriptionRecycleMaxAttempts` (3 por defecto) eventos de Stale **totalmente autocurados** por reciclaje de Nivel 1 — aunque estén separados por días sin relación entre sí — el sistema deja de intentar el reciclaje barato para siempre y escala directo a reciclaje de sesión completa en cada Stale subsecuente. Degradación de eficiencia, no de correctitud.

---

### Hallazgo 6

**Severidad:** Bajo

**Estado:** Riesgo potencial

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:306-320, 246-257, 396-400`

**Evidencia:** si `subscription.monitor()` lanza a mitad del loop de creación de MonitoredItems, `this.monitoredItems` queda parcialmente poblado; ni el catch de `onReconnected()` ni el de Nivel 1 llaman explícitamente `teardownSubscription()` (aunque el siguiente `setupSubscription()` sí lo hace siempre al inicio, autocurándose). No verificable sin un servidor real que falle a mitad de un batch de `monitor()`.

---

### Puntos correctamente implementados (con evidencia)

- **Sin subscripciones huérfanas en el camino serializado normal:** `setupSubscription()` siempre llama `teardownSubscription()` antes de crear una nueva (`opcua-connectivity.adapter.ts:290-294`), y esta última llama `.terminate()` sobre la subscription vieja. Solo falla bajo la carrera del Hallazgo 2.
- **MonitoredItems se limpian antes de repoblarse:** `teardownSubscription()` hace `item.removeAllListeners()` y vacía el array antes de que `setupSubscription()` lo repueble (`adapter.ts:459-461, 306`).
- **Guard `recycling` funciona correctamente entre watchdog y heartbeat** (no así con `onReconnected`, ver Hallazgo 2): todos los chequeos son síncronos, sin ventana de carrera entre ellos.
- **Aislamiento por buffer:** un NodeId inválido marca solo ese `ResolvedTarget` como `faulted`, sin afectar al resto (`resolveTargets()`, líneas 267-281); si `session.read()` completo lanza, la excepción sale **antes** de la asignación atómica `this.targets = resolved`, dejando el estado previo intacto.
- **`FrameCoalescer` acotado ante alta frecuencia:** el Map interno por `browseName` sobrescribe (no acumula) muestras repetidas del mismo buffer, sumando a `droppedCount` — el tamaño está acotado por la cantidad de buffers configurados, no por la tasa de notificaciones (`frame-coalescer.ts:41`).
- **Watchdog/HeartbeatMonitor no acumulan timers:** ambos limpian su timer previo antes de rearmar/reiniciar (`watchdog.ts:25-27`, `heartbeat-monitor.ts:41-43`).

---

## 2. Memory leaks

### Hallazgo 7 (mismo defecto que Hallazgo 4, ángulo de memoria)

Ver Hallazgo 4 — la fuga de `OPCUAClient` en reintentos post-`connect()` fallidos es simultáneamente el hallazgo de reconexión más grave y el memory leak más grave del sistema.

### Hallazgo 8

**Severidad:** Media

**Estado:** Confirmado (riesgo bajo en operación normal de un solo proceso)

**Archivos:** `apps/api/src/infrastructure/audit/connection-events.subscriber.ts`, `apps/api/src/infrastructure/metrics/opc-metrics.subscriber.ts`, `apps/api/src/infrastructure/logging/structured-events.subscriber.ts`, `apps/api/src/infrastructure/connectivity/ports/connectivity-adapter.port.ts:116-117`

**Evidencia:** los 3 subscribers de Fase 4 implementan `OnModuleInit` pero no `OnModuleDestroy`. `StructuredEventsSubscriber` llama `pipeline.snapshot$.subscribe(...)` sin guardar la `Subscription` devuelta — ni sería posible desuscribirse aunque se quisiera. El puerto `ConnectivityAdapter` (`onFrame`/`onStatusChange`) y `BridgeStateMachine.onChange()` no exponen ningún método `off*`/`removeListener` — no hay API pública para desuscribirse de estos hooks en absoluto.

**Impacto:** irrelevante mientras el proceso Node arranque una sola vez (caso normal de este despliegue — confirmado no hay evidencia de reinstanciación del mismo adapter en producción). Se vuelve un problema real (acumulación de listeners → audit logs/métricas/logs duplicados, no solo memoria) si en el futuro se introduce cualquier patrón de reinicialización de módulos sin reiniciar el proceso completo.

### Puntos correctamente implementados

- `BridgeOrchestratorService.startWithRetry()` registra `onFrame`/`onStatusChange` una sola vez en `onModuleInit`, nunca en el bucle de reintento — confirmado sin acumulación por reintentos en este servicio específico.
- `FrameCoalescer.stop()` limpia con `clearTimeout` **todos** los timers pendientes vía `flushAll()`/`flushPlant()`, y como todo el flujo es síncrono (sin `await`), no existe ventana de carrera donde `add()` pueda crear un timer huérfano después de `stopped=true`.
- `Watchdog`, `HeartbeatMonitor` y el timer del `SimulatorBridgeAdapter` limpian correctamente sus timers en `stop()`.
- `PlantPipelineService.sweepTimer`: creado en `onModuleInit`, limpiado en `onModuleDestroy`, con `.unref()` — completo y correcto.
- `ConnectivityGateway` es el patrón de referencia correcto: guarda las `Subscription` en un array y las desuscribe todas en `onModuleDestroy()` — exactamente lo que le falta al Hallazgo 8.

---

## 3 y 4. Race conditions y consistencia del snapshot

### Hallazgo 9

**Severidad:** N/A

**Estado:** Correctamente implementado

**Archivos:** `plant-pipeline.service.ts:79-140`, `mapping.engine.ts:48-97`, `snapshot.builder.ts:24-67`, `quality.evaluator.ts`

**Evidencia:** toda la cadena `onFrame callback → processFrame → rebuildAndMaybeEmit → engine.extract → buildSnapshot → evaluateQuality → cache.write → snapshot$.next` es 100% síncrona (cero `await` en cualquiera de estos métodos). Node.js ejecuta un callback hasta completarse antes de procesar el siguiente; sin puntos de `await`, no hay yield al event loop y dos frames de la misma planta **no pueden intercalarse**, sin importar qué tan "simultáneos" parezcan sus disparadores externos.

**Conclusión:** un snapshot representa siempre un único estado lógico consistente. No hay condición de carrera real en el pipeline de dominio hoy.

### Hallazgo 10

**Severidad:** Bajo

**Estado:** Riesgo potencial latente (no explotable con el código actual)

**Archivo:** `apps/api/src/infrastructure/connectivity/pipeline/plant-cache.ts:15-23`

**Evidencia:** `write(snapshot)` sobrescribe incondicionalmente `this.snapshots.set(snapshot.plantId, snapshot)`, sin comparar `snapshot.sequence` contra el valor ya almacenado.

**Impacto:** hoy no es explotable — es una invariante *implícita* sostenida únicamente porque `nextSequence()` y `write()` se llaman en el mismo tick síncrono confirmado en el Hallazgo 9, y `PlantCache` es el único escritor. Si en el futuro se introduce cualquier operación `await` entre la generación de `sequence` y la escritura (p. ej. una validación remota), un snapshot viejo podría sobrescribir uno nuevo sin que nada lo detecte. Defensa barata y recomendable: `if (snapshot.sequence < existing?.sequence) return;` en `write()`.

---

## 5. Backpressure

### Hallazgo 11

**Severidad:** N/A

**Estado:** Correctamente implementado

**Archivo:** `apps/api/src/infrastructure/connectivity/bridge/frame-coalescer.ts:33-62`

**Evidencia:** el Map externo `pending` está indexado por `plantId` (cantidad fija, ~12); el Map interno `entry.buffers` por `browseName` (cantidad fija por planta) — **sobrescribe**, no acumula, ante alta frecuencia de cambios del mismo buffer, sumando a un contador `droppedCount` en vez de crecer sin límite. El tamaño está acotado estructuralmente por la cantidad de buffers configurados, nunca por la tasa de notificaciones del PLC. No existen colas infinitas en ningún punto del pipeline (confirmado también por la naturaleza síncrona descrita en el Hallazgo 9 — no hay acumulación de trabajo pendiente entre pasos).

No se encontró evidencia de bloqueo del event loop: las operaciones por frame son transformaciones ligeras sobre arrays pequeños (decenas de elementos por buffer, no miles), sin loops anidados costosos.

---

## 6. Datos inválidos

### Hallazgo 12

**Severidad:** Crítico

**Estado:** Confirmado (verificado directamente)

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:373`

**Evidencia:**
```ts
if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'boolean' ? v : Number(v)));
```
`Number(null) === 0` en JavaScript (confirmado). Un elemento `null` dentro del array crudo recibido del PLC (p. ej. un Variant array mixto, o un canal con calidad individual mala representada como `null`) se convierte **silenciosamente en el número `0`**, indistinguible de una lectura real de cero. No hay `NaN`, no hay dead-letter, no hay `usable:false`.

**Impacto:** un sensor con lectura no disponible se muestra en el móvil como "caudal = 0 l/s" (un valor operacionalmente significativo y potencialmente alarmante o, peor, tranquilizador de forma falsa) sin ninguna traza de que el dato es en realidad inválido. Para un sistema cuyo principio de diseño explícito es "el tablero nunca miente", este es el tipo de bug más dañino posible: produce un dato con apariencia perfectamente confiable que no lo es.

**Recomendación:** `v === null || v === undefined ? NaN : Number(v)` antes del `Number(v)`, para que caiga en el camino ya validado de `INVALID_NUMBER`.

### Hallazgo 13

**Severidad:** Crítico

**Estado:** Confirmado

**Archivos:** `apps/api/src/infrastructure/connectivity/pipeline/quality.evaluator.ts`, `apps/api/src/infrastructure/connectivity/pipeline/mapping.engine.ts:69-77`, `apps/api/src/infrastructure/connectivity/pipeline/snapshot.builder.ts:41-46`

**Evidencia:** `evaluateQuality()` no tiene ninguna rama que rechace explícitamente `value === null`. Cuando `mapping.engine.ts` detecta un índice mapeado fuera del array real recibido (`sig.index >= buffer.values.length`, línea 69), registra `INDEX_OUT_OF_RANGE` en el dead-letter pero devuelve `{ ...base, value: null, quality: buffer.quality, structurallyBroken: true }` (línea 76) — **sin forzar `quality: 'Bad'`** (a diferencia de la rama `BUFFER_MISSING`, que sí lo hace). Si el buffer llegó con `StatusCode` bueno pero un array más corto de lo mapeado, `value: null` y `quality: 'Good'` llegan juntos a `evaluateQuality()`, que no tiene rama para atraparlos, y cae en `return { usable: true, outOfRange }`. El campo `structurallyBroken` que puso `mapping.engine.ts` **nunca se consulta** para forzar `usable:false` en `snapshot.builder.ts` (solo evita doble-registro en el dead-letter).

**Impacto:** el `SignalDto` final puede quedar como `{ value: null, usable: true, quality: 'Good' }`, sin `reason` — una señal estructuralmente rota (índice fuera de rango, o array vacío por NodeId no resuelto) reportada como si fuera una lectura válida y utilizable. Cualquier consumidor que confíe en `usable` sin verificar además `value !== null` la tratará como dato bueno.

**Recomendación:** añadir `if (input.value === null) return { usable: false, reason: 'INVALID_NUMBER' };` al inicio de `evaluateQuality()`, y/o forzar `quality: 'Bad'` también en la rama `INDEX_OUT_OF_RANGE` de `mapping.engine.ts`.

### Hallazgo 14

**Severidad:** Alto (gap de diseño, no crash pero validación muerta)

**Estado:** Confirmado

**Archivos:** `apps/api/src/infrastructure/connectivity/mapping/opc-mapping.loader.ts:23,137`, `apps/api/src/infrastructure/connectivity/pipeline/dead-letter.buffer.ts:1,23`, `apps/api/src/infrastructure/metrics/metrics.service.ts:106`

**Evidencia:** `arrayLength` se parsea y almacena en el mapping, pero **nunca se vuelve a leer para validar** el array real recibido del PLC contra la longitud declarada — su único consumidor real es `simulator-bridge.adapter.ts:166`, para *generar* datos sintéticos, no para validar datos reales. `DeadLetterType` declara `'UNEXPECTED_LENGTH'` y `metrics.service.ts` lo cuenta en `opc_parser_errors_total`, pero `deadLetter.record('UNEXPECTED_LENGTH', ...)` **no se invoca en ningún lugar del código real** — la métrica está muerta, siempre en 0.

**Impacto:** un drift de configuración entre `opc_mapping.json` y el array real del PLC (p. ej. tras un cambio de firmware que acorta un buffer) no genera ninguna alerta agregada; solo se manifiesta indirectamente, señal por señal, si algún índice mapeado cae fuera del nuevo rango real (y en ese caso, cae en el Hallazgo 13, que además puede reportarlo como usable).

### Hallazgo 15

**Severidad:** Medio

**Estado:** Confirmado

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:373`

**Evidencia:** una string numérica (`"42.5"`) que llegue en un elemento del array donde se esperaba un number pasa `Number("42.5") === 42.5` y se acepta como si fuera una lectura legítima del PLC, sin ningún registro de que el tipo OPC UA recibido no era el esperado.

**Impacto:** enmascaramiento silencioso de una anomalía de tipo del PLC (no un crash — confirmado que no hay ningún `.toFixed()` u operación similar sobre datos de ingesta real que pudiera romperse; el único `.toFixed()` en el módulo de conectividad es del simulador, generando datos sintéticos).

### Puntos correctamente implementados

- `NaN`/`Infinity`/`-Infinity`: capturados correctamente por `!Number.isFinite(input.value)` en `quality.evaluator.ts`, con registro en dead-letter (`INVALID_NUMBER`) y serialización JSON-safe a `null` en `snapshot.builder.ts`.

---

## 7. Desconexión parcial

### Hallazgo 16

**Severidad:** N/A

**Estado:** Correctamente implementado

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:267-281, 308`

**Evidencia:** cada `ResolvedTarget` recibe su propio `.resolved`/`.faultReason` independientemente del resto; `setupSubscription()` filtra con `if (!target.resolved) continue;` — un buffer con NodeId inválido no afecta a los demás buffers ni a la planta completa. La asignación `this.targets = resolved` es atómica (ocurre después de que todas las lecturas de verificación terminaron), así que un fallo total de `session.read()` deja el estado previo intacto en vez de una escritura parcial corrupta.

**Conclusión:** solo se degradan las señales/buffers afectados; la planta y el snapshot completo no se invalidan por un fallo puntual de NodeId.

---

## 8. Seguridad del audit log

### Hallazgo 17

**Severidad:** N/A

**Estado:** Correctamente implementado (múltiples controles verificados)

**Archivos:** `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/infrastructure/audit/audit.interceptor.ts:24-33`, `apps/api/src/modules/auth/auth.service.ts:54-80`, `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:205-229`, `apps/api/src/infrastructure/database/database.module.ts:32-34`

**Evidencia:**
- `AuditInterceptor` **no** se aplica a `POST /api/auth/login` (grep confirma su uso solo en `snapshots.controller.ts`, `plants.controller.ts`, `opc.controller.ts`) — el password en texto plano del body de login nunca pasa por el interceptor.
- `AuditInterceptor.intercept()` no referencia `request.body` ni `request.headers` en ningún punto (grep de `.body\b` en todo `apps/api/src`: 0 resultados) — diseño defensivo por construcción, robusto incluso si el interceptor se aplicara al login por error futuro.
- `AuthService.logLoginFailed()` solo persiste literales fijos (`'usuario no encontrado o inactivo'`, `'contraseña incorrecta'`) en `detail.reason` — nunca el password ni el JWT emitido.
- El JWT/header `Authorization` nunca se pasa a `Logger` ni a `AuditLogService` (grep confirma que los 2 únicos usos de `authorization` en el código son en guards, leyéndolo solo para validar).
- Los certificados/llaves privadas de cliente OPC UA se leen en memoria y se usan solo para construir `UserIdentityInfo` consumido por `node-opcua` — nunca logueados; el único texto en un error relacionado es la *ruta* del archivo, no su contenido.
- El connection string de MySQL solo expone host/puerto/nombre de BD en el log de arranque, nunca usuario/password.

### Hallazgo 18

**Severidad:** Bajo/Medio

**Estado:** Riesgo potencial (sin evidencia de explotación concreta hoy)

**Archivo:** `apps/api/src/infrastructure/audit/connection-events.subscriber.ts:20-30`

**Evidencia:** `detail: { status, reason }` persiste `reason`, que en varios puntos del adapter proviene de `err.message` de excepciones de `node-opcua`/red (texto libre generado por una librería de terceros fuera de control del proyecto). No se encontró una ruta de código concreta hoy que filtre una credencial OPC hacia `reason`, pero tampoco hay ningún saneo/whitelist si esa librería alguna vez incluyera un dato sensible en un mensaje de excepción (p. ej. de fallos de autenticación).

**Recomendación (defensa en profundidad, no urgente):** sanear `reason` antes de persistirlo.

---

## 9. Validación JWT

### Hallazgo 19

**Severidad:** Bajo

**Estado:** Riesgo potencial, mitigado por el diseño (no explotable en este contexto)

**Archivo:** `apps/api/src/modules/auth/jwt.service.ts:20,25`

**Evidencia:** ni `jwt.sign()` ni `jwt.verify()` fijan `algorithm`/`algorithms` explícitamente. Verificado en el código fuente instalado de `jsonwebtoken`: `sign()` sin opción usa HS256 por defecto; `verify()` solo habilita algoritmos RS/ES/PS si el secreto tiene forma de clave pública/certificado — como `JWT_SECRET` es siempre un string plano de `.env`, queda limitado a `HS256/384/512`. El ataque clásico de "algorithm confusion" RS256↔HS256 requiere que el sistema posea una clave pública asimétrica utilizable como secreto HMAC — **este sistema nunca usa claves asimétricas para JWT**, así que el vector no aplica.

**Recomendación (endurecimiento opcional, no urgente):** fijar `{ algorithm: 'HS256' }` / `{ algorithms: ['HS256'] }` como defensa en profundidad ante cambios futuros.

### Hallazgo 20

**Severidad:** N/A

**Estado:** Correctamente implementado

**Archivo:** `apps/api/src/modules/auth/jwt.service.ts:25`, `apps/api/src/modules/auth/jwt.config.ts:6-10`

**Evidencia:** ninguna ocurrencia de `ignoreExpiration` en el código (expiración validada por defecto de la librería); `JWT_SECRET` sin ningún fallback inseguro — falla duro en el arranque si falta la variable de entorno.

### Hallazgo 21

**Severidad:** Bajo / no aplicable en este deployment

**Estado:** Confirmado, sin acción requerida

**Archivo:** `apps/api/src/modules/auth/jwt.service.ts`

**Evidencia:** no se firma/valida `iss`/`aud`, y no se configura `clockTolerance` (default 0). Ambos son relevantes solo en despliegues distribuidos/multi-servicio; no se encontró evidencia de clustering o federación (sin `docker-compose`, sin manifiestos K8s, un único backend consumido por un único móvil con el mismo `JWT_SECRET`).

### Hallazgo 22

**Severidad:** Bajo, informativo

**Estado:** Confirmado

**Archivo:** `apps/api/src/modules/auth/jwt.config.ts:13`

**Evidencia:** `expiresIn: process.env.JWT_EXPIRES_IN ?? '8h'` sin validación de cota máxima. Vector de explotación requiere ya tener acceso al `.env` del servidor (no es una superficie de ataque externa), pero es una brecha de defensa-en-profundidad ausente.

---

## 10. Variables globales mutables

### Hallazgo 23

**Severidad:** N/A

**Estado:** Correctamente implementado

**Archivo:** `apps/api/src/infrastructure/connectivity/mapping/opc-mapping.loader.ts:61`

**Evidencia:** grep exhaustivo de declaraciones `Map`/`Set`/array/objeto a nivel de módulo (fuera de clases) en todo `apps/api/src` encontró un único resultado: `const DATA_CHANNELS = new Set([...])`, usado exclusivamente en modo lectura (`.has()`), nunca mutado. Todo el estado real de dominio (`PlantCache`, `DeadLetterBuffer`, `RawFrameCache`, `LivenessTracker`, `MappingEngine`) vive dentro de clases `@Injectable()` gestionadas por DI de Nest — singletons administrados, no "globales salvajes".

---

## 11. DTOs duplicados

### Hallazgo 24

**Severidad:** Alto

**Estado:** Confirmado (verificado directamente; drift real y vigente, no hipotético)

**Archivos:** `apps/api/src/infrastructure/connectivity/pipeline/plant-snapshot.dto.ts:40-42` vs `apps/mobile/services/api.ts:50-52`

**Evidencia (verificado línea por línea):**
```
backend: protocolVersion: string;   mobile: protocolVersion?: string;
backend: dtoVersion: string;        mobile: dtoVersion?: string;
backend: bridgeStatus: BridgeStatus (unión de 6 literales)   mobile: bridgeStatus: string;
```
El mobile pierde toda verificación de tipos sobre los 6 estados válidos del bridge; un mapa de colores/switch en mobile puede no cubrir un estado nuevo sin que TypeScript lo detecte. La opcionalidad de `protocolVersion`/`dtoVersion` en mobile en realidad corrige un hueco real del propio backend: `plants.controller.ts` (rama "pending", snapshot aún no en cache) construye un objeto que omite esos dos campos y añade `pending: true` no declarado en el DTO — sin anotación de tipo de retorno que hubiera detectado la violación de su propio contrato.

Historial de git confirma que el drift es real y no solo teórico: `plant-snapshot.dto.ts` tiene 1 solo commit en su historia; `api.ts` tiene 7, de los cuales 3 modificaron el archivo mobile sin tocar el DTO del backend. El campo `outOfRange` (cambio reciente de esta sesión) está sincronizado hoy solo porque se tocaron ambos archivos deliberadamente en el mismo cambio — no hay ningún mecanismo (compilador, test de contrato) que lo hubiera forzado si se hubiera olvidado uno de los dos lados.

**Por qué no hay barrera técnica para unificar en `packages/shared`:** `apps/mobile/metro.config.js` ya declara `watchFolders` sobre `packages/shared`; `apps/mobile/package.json` ya depende de `@ptap/shared` y lo usa con éxito hoy para `AuthUser`/`Role`; los tipos en disputa (`plant-snapshot.dto.ts` y su dependencia `connectivity-adapter.port.ts`) son 100% libres de imports de runtime (solo `type`/`interface`). No hay ninguna dependencia transitiva de NestJS/node-opcua/Express que pudiera colarse en el bundle de Expo.

**Recomendación:** mover `LivenessState`, `UnusableReason`, `SignalDto`, `LivenessDto`, `PlantSnapshotDto`, `BridgeStatus`, `OpcQuality` a `packages/shared`, con ambos lados haciendo `import type` desde ahí. Refactor solo-de-tipos, sin cambio de comportamiento runtime, con precedente ya funcionando.

### Hallazgo 25

**Severidad:** Bajo

**Estado:** Confirmado

**Archivo:** `apps/mobile/services/mock-data.ts:10-15`

**Evidencia:** el tipo `Valve` se redefine a mano ahí, siendo idéntico al ya exportado por `packages/shared/src/index.ts:36-41` (que el propio backend ya importa con éxito). Confirma que el patrón de "copiar en vez de importar de shared" no es exclusivo del caso `PlantSnapshotDto`.

---

## 12. Logging

### Hallazgo 26

**Severidad:** Alto

**Estado:** Confirmado

**Archivo:** `apps/api/src/infrastructure/logging/structured-events.subscriber.ts:21-28`

**Evidencia:** `pipeline.snapshot$.subscribe((snapshot) => this.logger.log({ msg: 'snapshot emitted', ... }))` se dispara en cada cambio de snapshot detectado (tras coalescing). Con los defaults reales (`OPCUA_PUBLISHING_INTERVAL_MS=2000`, `OPCUA_COALESCE_WINDOW_MS`=lo mismo) y 12 plantas con señales analógicas (que casi siempre varían entre ciclos de muestreo), esto genera del orden de **~6 líneas/seg ≈ 360/min ≈ ~21.600/hora** como piso de ruido normal 24/7 — no como escenario de falla.

**Impacto:** satura I/O de logging; si se reenvía a un servicio externo con costo por línea/GB, es un costo recurrente significativo; ahoga cualquier warning/error real entre cientos de miles de líneas informativas casi idénticas por día.

**Recomendación:** bajar a nivel `debug` (silenciable vía `LOG_LEVEL` en producción), o muestrear — el transporte real (Socket.IO) y las métricas (`opc-metrics.subscriber.ts`, que no loguea nada) ya cubren la necesidad de observabilidad sin necesidad de una línea de log por evento.

### Hallazgo 27

**Severidad:** Medio

**Estado:** Confirmado

**Archivo:** `apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts:241-243`

**Evidencia:** `client.on('backoff', (retry, delay) => this.logger.warn(...))` — durante un outage largo del PLC, node-opcua reintenta internamente vía su `connectionStrategy` (delay escalando hasta 30s, `maxRetry` efectivamente indefinido), emitiendo `backoff` en cada intento. Para un outage de 8h: **~960 líneas WARN casi idénticas**; sin agregación.

### Puntos correctamente implementados

- `onBufferChanged()` (el hot path más caliente del sistema, disparado por cada notificación OPC UA individual) está completamente limpio de logging.
- `OpcMetricsSubscriber.handleFrame()` (mismo hot path a nivel de frame coalescido) tampoco loguea nada — solo actualiza contadores en memoria.
- `HeartbeatMonitor` no loguea en cada probe fallido individual, solo al cruzar el umbral de fallos consecutivos, con reset explícito del contador ("evita tormentas de reciclaje", comentario propio del código).
- `BridgeStateMachine.transition()` es idempotente (`if (from === to) return`) — solo loguea en cambios reales de estado, nunca repetido.

### Hallazgo 28

**Severidad:** Bajo

**Estado:** Riesgo potencial (duplicación evitable, no una tormenta)

**Archivo:** `apps/api/src/infrastructure/connectivity/bridge-orchestrator.service.ts:29-31`, `apps/api/src/infrastructure/logging/structured-events.subscriber.ts:30-32`, `apps/api/src/infrastructure/audit/connection-events.subscriber.ts`

**Evidencia:** cada transición de `BridgeStatus` dispara 2 líneas de log independientes (una en texto plano desde `BridgeOrchestratorService`, otra estructurada desde `StructuredEventsSubscriber`) más una escritura a `audit_log` — 3 registros de la misma información en formatos distintos. Bajo impacto porque las transiciones son infrecuentes (no por notificación, ver Hallazgo 26/BridgeStateMachine idempotente), pero es ruido evitable.

---

## 13. Configuración

### Hallazgo 29

**Severidad:** Moderado

**Estado:** Confirmado

**Archivo:** `apps/api/src/infrastructure/connectivity/pipeline/dead-letter.buffer.ts:26`

**Evidencia:** `constructor(private readonly capacity = 500) {}`, instanciado sin argumento en `plant-pipeline.service.ts:30` — sin ninguna variable de entorno (`DEAD_LETTER_CAPACITY` no existe). Solo afecta la ventana de detalle histórico (`recent`, para el endpoint admin); los contadores agregados por tipo son correctos e ilimitados.

**Impacto:** en una ráfaga sostenida de anomalías (p. ej. tras el drift del Hallazgo 14), un operador no puede ampliar la ventana de detalle sin recompilar.

### Hallazgo 30

**Severidad:** Moderado

**Estado:** Confirmado

**Archivos:** `apps/api/src/infrastructure/connectivity/opc-config.service.ts:35-52`, `apps/api/src/infrastructure/connectivity/connectivity.service.ts:33`, `apps/api/src/infrastructure/connectivity/connectivity.module.ts:33-40`

**Evidencia:** `getPollingIntervalMs()` lee de un archivo JSON estático (`opc-config.json`, versionado en el repo), no de `.env`. Este servicio ("Dominio legado (Fase 1)" según el comentario del propio módulo) sigue **activo y registrado** en `ConnectivityModule`, y su método `getSnapshot()` sigue leyendo `RawFrameCache` incluso cuando `provider === 'opcua'` — es decir, este poller legado corre en paralelo al pipeline real (push-based, Fase 2/3) también en el modo de producción real, con un intervalo que vive fuera de `.env`.

**Impacto:** inconsistente con la regla de diseño 8 del proyecto ("cero valores quemados... toda config OPC sale de .env"); además representa código legado activo cuyo propósito actual no está claro (el pipeline real que llega al frontend es push-based, no depende de este poller) — vale la pena una decisión explícita de retirarlo o de aclarar por qué sigue vivo.

### Hallazgos menores (Bajo, agrupados)

- `BridgeStateMachine.maxHistory = 50` hardcodeado, sin variable de entorno — solo acota el historial de transiciones expuesto en diagnósticos (`bridge-state-machine.ts:29`).
- `metrics.service.ts:49` — buckets del histograma Prometheus (`[50,100,250,500,1000,2000,5000,10000]`) hardcodeados. Defendible: los dashboards/alertas de Prometheus típicamente dependen de límites de bucket fijos y coordinados, no es una violación real de la regla 8.
- `opcua-connectivity.adapter.ts:179` — `applicationName: 'monitor-ptap-gateway'` hardcodeado en `createClient()`. Parte de la identidad anunciada al servidor OPC UA; impacto bajo.
- `jwt.config.ts:13` — default `'8h'` para `JWT_EXPIRES_IN` (ver también Hallazgo 22): es un default sobreescribible por `.env`, no una violación de la regla — 8h es razonable para un turno de planta.

### Puntos correctamente implementados

- `connectivity.config.ts` cumple la regla 8 de forma completa y verificable — cotejado campo por campo contra `.env.example`: endpoint, seguridad, identidad, publishing/sampling interval, lifetime/keepalive (con validación fail-fast de la relación 3× exigida por OPC UA Part 4), coalescing, watchdog, heartbeat, reconexión, stale threshold, writes-enabled, auto-accept-certificate, liveness. Nada falta.
- `FrameCoalescer`, `Watchdog`, `HeartbeatMonitor` reciben **todos** sus parámetros de timing por constructor desde `OpcUaConfig`, sin ningún valor de respaldo interno adicional.
- `http-hardening.config.ts` (CORS, rate-limit general y de login) completo, todo desde `.env`.
- `audit-log.service.ts` (`AUDIT_LOG_DETAIL_MAX_BYTES`) completo.

---

# Resumen ejecutivo

## Riesgos críticos (4)

1. **Bridge queda permanentemente Faulted tras un fallo transitorio de reciclaje de sesión** — sin ningún mecanismo automático de recuperación más allá del arranque inicial del proceso (Hallazgo 1).
2. **Fuga sin cota de `OPCUAClient`/sockets en cada reintento fallido tras `connect()` exitoso** — especialmente grave con un mapping mal configurado, que reintenta indefinidamente sin liberar recursos (Hallazgo 4/7).
3. **`Number(null) === 0` convierte silenciosamente lecturas inválidas del PLC en ceros reales**, sin ninguna traza — el tipo de bug más dañino posible para un sistema cuyo principio de diseño es "el tablero nunca miente" (Hallazgo 12).
4. **Señales estructuralmente rotas (índice fuera de rango, array vacío) pueden llegar al frontend como `usable:true, value:null`**, indistinguibles de una lectura válida (Hallazgo 13).

## Riesgos altos (5)

5. Condición de carrera entre `onReconnected()` y `recycleSession()`/`onWatchdogTimeout()` — puede dejar subscripciones huérfanas en el servidor (Hallazgo 2).
6. El heartbeat sigue sondeando durante `Recovering`, compitiendo con la reconexión interna de node-opcua durante cortes de red reales — el escenario más común del dominio (Hallazgo 3).
7. `arrayLength`/`UNEXPECTED_LENGTH` son código muerto: un drift de configuración PLC↔mapping no genera ninguna alerta agregada (Hallazgo 14).
8. Drift real y vigente entre los DTOs duplicados de backend y móvil (`bridgeStatus`, `protocolVersion`/`dtoVersion`) — confirmado con evidencia de historial de git, no hipotético (Hallazgo 24).
9. `structured-events.subscriber.ts` genera del orden de cientos de miles de líneas de log por día en operación normal (Hallazgo 26).

## Riesgos medios (7)

`recycleCount` nunca resetea tras reciclaje parcial exitoso (5); subscribers de Fase 4 sin `OnModuleDestroy` (8); strings numéricas aceptadas silenciosamente sin registro de anomalía (15); `err.message` de node-opcua sin sanear hacia el audit log (18); logs de `backoff` sin agregación durante outages largos (27); capacidad fija del ring buffer de dead-letter (29); poller legado con intervalo fuera de `.env`, activo en paralelo al pipeline real (30).

## Riesgos bajos (9)

Teardown parcial no explícito en ciertos catches de subscription (6); `PlantCache.write()` sin guard de `sequence` (10); duplicación menor del tipo `Valve` (25); triple logging redundante de transiciones de bridge (28); algoritmo JWT no fijado explícitamente pero no explotable (19); ausencia de `iss`/`aud`/`clockTolerance`, aceptable en este deployment (21); `JWT_EXPIRES_IN` sin cota máxima (22); comparación no constante en `MetricsAuthGuard` (mencionado en auditoría de seguridad); varios hardcodeos menores defendibles (`maxHistory`, buckets Prometheus, `applicationName`).

## Fortalezas de la arquitectura

- **Diseño de resiliencia en capas deliberado y mayormente bien ejecutado**: máquina de estados explícita, watchdog, heartbeat, reciclaje escalonado (subscription → sesión) — la intención arquitectónica es sólida; los hallazgos críticos están en los bordes de ese diseño (qué pasa cuando el último nivel falla), no en su núcleo.
- **Pipeline de dominio 100% síncrono**: garantiza consistencia de snapshot sin necesidad de locks — verificado, no solo documentado.
- **Aislamiento de fallos por buffer/planta**: un NodeId roto nunca tumba una planta completa ni el snapshot global.
- **Seguridad fundamentalmente sólida**: ningún secreto (password, JWT, certificados, connection strings) llega jamás a logs o audit log — verificado exhaustivamente, con el login explícitamente excluido del interceptor de auditoría. Argon2id conforme a OWASP. `JWT_SECRET` sin fallback inseguro.
- **Los hot paths más calientes del sistema están limpios de logging** (`onBufferChanged`, `opc-metrics.subscriber`) — quien diseñó esto entendió bien dónde no se puede loguear.
- **Regla de "cero configuración quemada" cumplida en el núcleo OPC UA** (`connectivity.config.ts` y todo el módulo `bridge/`) de forma ejemplar.

## Nivel de preparación para producción: 55%

## Recomendación final: NO listo para operación 24/7 sin supervisión en planta. SÍ apto para un piloto supervisado, condicionado a corregir antes los 4 hallazgos críticos.

**Justificación:** la arquitectura de este sistema demuestra un entendimiento genuino de los problemas de un gateway industrial 24/7 (máquina de estados, watchdog, heartbeat, reciclaje escalonado, dead-letter, liveness, aislamiento por buffer) — no es un sistema ingenuo. La seguridad (Fase 4) está implementada con un rigor por encima del promedio: cero fugas de secretos hacia logs, JWT sin fallbacks inseguros, hashing conforme a OWASP.

Pero dos de los cuatro hallazgos críticos son exactamente el tipo de bug que "pasa desapercibido aunque todos los tests estén en verde" que se pidió buscar: **(1)** el bridge puede quedar ciego permanentemente tras un solo evento transitorio de red, sin alerta automática — inaceptable para un sistema no supervisado; **(2)** un `null` del PLC se convierte en un `0` real sin rastro, violando el principio de diseño explícito y más importante del propio proyecto ("el tablero nunca miente"). Ninguno de los dos requeriría un fallo exótico para manifestarse — ambos son alcanzables con la configuración por defecto real del sistema ante eventos comunes en un entorno industrial (cortes de red intermitentes, un PLC que devuelve un array parcial).

Antes de un piloto en planta real, se recomienda como mínimo indispensable: corregir los Hallazgos 1, 4, 12 y 13 (los 4 críticos), y el Hallazgo 26 (volumen de logging, que dificultaría diagnosticar cualquier incidente real durante el piloto al enterrar la señal en ruido). El resto de hallazgos altos/medios pueden abordarse en paralelo o inmediatamente después, sin bloquear un piloto supervisado donde un operador humano pueda reiniciar el proceso manualmente si el bridge se queda en `Faulted`.
