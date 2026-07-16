# Métodos y contratos internos del backend

> Complemento del [documento de arquitectura](./backend-structure.md). Describe **qué hace cada
> pieza por dentro** y con qué contrato. El contrato **HTTP** no se documenta aquí, para no
> duplicarlo y que se desincronice: vive en [`docs/api/openapi.yaml`](../api/openapi.yaml).

## 1. Puerto `ConnectivityAdapter`

Contrato único que implementan `OpcUaConnectivityAdapter` (PLC real) y `SimulatorBridgeAdapter`
(testbed sin PLC), seleccionados por `CONNECTIVITY_PROVIDER`.

| Método | Devuelve | Notas |
|---|---|---|
| `start()` / `stop()` | `Promise<void>` | Idempotentes. `start()` no bloquea el boot: si el PLC no responde, se reintenta en segundo plano. |
| `getBridgeStatus()` | `BridgeStatus` | Máquina de estados, nunca un boolean. |
| `onFrame(cb)` | — | Push de `RawPlantFrame`: uno por planta por ventana de coalescing. |
| `onStatusChange(cb)` | — | Cada transición del puente, con motivo. |
| `getDiagnostics()` | `AdapterDiagnostics` | Alimenta `/api/opc/status` y `/api/health/opc`. |
| `getServerInfo()` | `Promise<ServerInfo>` | Metadata del servidor OPC UA; campos no disponibles → `null` explícito. |
| `getBufferHealth()` | `BufferHealth[]` | Estado por buffer: un NodeId inválido marca **solo** ese buffer, no la planta. |
| `getWriteSecurity()` | `WriteSecurity` | `secure` = sesión autenticada **y** cifrada. Precondición dura de escritura. |
| `writeBufferElement(target, value)` | `Promise<void>` | Escribe UN elemento (IndexRange). No valida seguridad: eso es del WriteService. |
| `readBufferElement(target)` | `Promise<BufferElementRead>` | Read-back de confirmación. |

## 2. Pipeline de dominio (`PlantPipelineService`)

Cadena **100 % síncrona** por frame — sin `await` entre pasos. Eso garantiza que un snapshot
representa siempre un estado lógico consistente **sin necesidad de locks**: Node ejecuta el
callback hasta completarlo, así que dos frames de la misma planta no pueden intercalarse.

```txt
adapter.onFrame → processFrame → liveness.ingest → rebuildAndMaybeEmit
                → engine.extract → buildSnapshot → evaluateQuality
                → cache.write (ÚNICO escritor) → snapshot$.next → Socket.IO
```

| Paso | Pieza | Responsabilidad |
|---|---|---|
| Parser/estado | `latestBuffers` | Acumula la última muestra de cada buffer, para reconstruir el DTO completo aunque el frame coalescido traiga solo los que cambiaron. |
| Liveness | `LivenessTracker` | Frescura **por planta**: `live` / `idle` / `stale` / `unknown`. Un barrido periódico pasa `idle→stale` aunque no lleguen frames — un caudal congelado no puede verse conectado. |
| Mapping | `MappingEngine` | `(buffer, índice) → domainKey` desde `opc_mapping.json`. Índice fuera de rango o buffer ausente → DeadLetter + `structurallyBroken`. |
| Calidad | `evaluateQuality()` | Decide `usable`. Orden: `StatusCode != Good` → `BAD_QUALITY`; NaN/∞ → `INVALID_NUMBER`; liveness stale/unknown → `BRIDGE_STALE`. Fuera de `[min,max]` **sigue siendo usable**: solo marca `outOfRange` (aviso), nunca oculta la lectura. |
| DTO | `buildSnapshot()` | Ensambla `PlantSnapshotDto`. Nunca asciende `inferred → confirmed`. No-finitos → `null` (JSON-safe). |
| Cache | `PlantCache` | RAM. Custodia el `sequence` monótono por planta. Único escritor: el pipeline. |

**Emisión**: `opc:snapshot` solo cuando el snapshot **cambia** (diff por firma, sin `sequence`);
`opc:liveness` en cambios de estado (broadcast).

## 3. Contrato de dato (`SignalDto`)

Cada señal lleva SIEMPRE `value`, `quality` (Good|Bad|Uncertain), `usable`, `mappingStatus`
(mapped|unmapped), `confidence` (confirmed|inferred|estimated) y `ts` (SourceTimestamp del PLC).
Opcionales: `reason`, `outOfRange`, `unit`, `label`, `opMin`/`opMax`.

- `min`/`max` = **validez física** (producen `outOfRange`).
- `opMin`/`opMax` = **rango operativo** entregado por el operador (insumo de alarmas futuras).
- `confidence: confirmed` exige documento oficial/L5X. Hoy **todo es `inferred`** (confirmado por
  el operador vía HMI, sin documento en el repo).

## 4. Canal de escritura (`WriteService`)

Único punto que escribe al PLC. Flujo por comando:

1. Resolver `(plantId, target)` → señal `writable` + su `write` spec en el mapping.
2. Verbo válido (`write.commands`), si no → `UNKNOWN_COMMAND`.
3. **Precondición dura**: `OPCUA_WRITES_ENABLED` **y** sesión segura; si no →
   `WRITES_DISABLED_INSECURE_SESSION`. Sin excepciones.
4. **RBAC dinámico**: el permiso lo declara el mapping (`control_valves`, `acknowledge_alarms`…).
5. **Interlock**: `bridgeStatus === Connected` + snapshot fresco (`liveness.live`).
6. **Idempotencia**: reserva *insert-pending-first* en `command_log` — una `idempotencyKey`
   repetida no re-ejecuta, ni siquiera tras reiniciar el proceso.
7. Leer valor previo → escribir → **read-back con timeout** → `confirmed` | `failed`
   (+ rollback best-effort). Sin read-back confirmado **nunca** se reporta éxito.
8. **Audit log siempre**, con valor previo/confirmado y el `sequence` usado en el interlock.

> Hoy el mapping de producción **no tiene señales `writable`** (falta el L5X), así que todo comando
> real responde `TARGET_NOT_WRITABLE`: el mecanismo está probado, la escritura real sigue cerrada.

## 5. Autenticación y permisos

| Pieza | Responsabilidad |
|---|---|
| `PasswordHashingService` | Argon2id (parámetros OWASP) + pepper HMAC versionado. |
| `JwtService` | Firma/valida el JWT (8 h). `JWT_SECRET` sin fallback inseguro: el backend no arranca si falta. |
| `AuthService.login()` | Verifica credenciales y audita éxito/fallo (nunca la contraseña ni el token). |
| `AuthService.register()` | Fuerza `role: 'civil'` **en el servidor**; el schema `.strict()` rechaza un `role` del cliente con 400. Email duplicado → 409. |
| `JwtAuthGuard` | Sin token válido → 401. Respeta `@Public()`. |
| `PermissionGuard` | Sin `@RequirePermission` → solo exige JWT. Con permiso declarado → `hasPermission()` de `@ptap/shared`; si el rol no lo tiene → 403. |
| `UsersService` | Gestión admin. Guard rails: un admin no puede cambiar su propio rol ni desactivarse. Audita `user.role_changed` con from→to. |

## 6. Observabilidad

- `computeOpcHealth()` — función pura (testeable sin Nest): deriva la salud industrial del
  diagnóstico del adapter. **503 en `Stale`/`Faulted`**, para servir de liveness/readiness.
- `MetricsService` — Prometheus. `opc_quality_good/bad_total` y `opc_subscription_latency_ms`
  llevan label `plantId`; el resto son de proceso (la sesión OPC es única para las 12 plantas).
- `AuditMiddleware` — engancha `res.on('finish')`: audita **200, 401 y 403** por igual, porque en
  NestJS los guards cortan **antes** que los interceptores (un interceptor nunca vería un 403).
- `DeadLetterBuffer` — ring buffer en RAM con contadores por tipo, expuesto en
  `/api/opc/dead-letter` (regla 12: nada se pierde en silencio).
