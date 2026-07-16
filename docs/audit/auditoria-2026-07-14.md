# Resumen de sesión — Fase 4: Seguridad, RBAC y observabilidad (2026-07-14)

Estado al cierre de la sesión. Rama `yosh`. Continúa de la auditoría del 10 jul
(`docs/audit/auditoria-2026-07-10.md`), donde el backend arrancaba sin auth/RBAC/observabilidad.

## Qué se hizo

| Área | Entregable |
|---|---|
| Auth | `POST /api/auth/login` real (JWT + `PasswordHashingService` existente, reutilizado); guards `JwtAuthGuard`/`MinTierGuard` aplicados a `/api/opc/*`, `/api/plants/*`, `/api/snapshots/*` |
| Roles | `RoleTier`/`tierAtLeast()` en `@ptap/shared`, mapeando el `Role` real (`civil\|operador\|jefe\|admin`) a `viewer\|operator\|admin` — sin introducir un segundo sistema de roles ni tocar el móvil |
| Base de datos | Primeras tablas del proyecto: `users` y `audit_log` (migraciones SQL numeradas + runner propio, sin ORM), `npm run db:migrate` / `npm run db:seed-admin` |
| Auditoría | `AuditLogService` (nunca lanza), interceptor HTTP en rutas admin/viewer, suscriptor de transiciones de `BridgeStatus` |
| Seguridad OPC UA | `automaticallyAcceptUnknownCertificate` dejó de estar quemado (ahora por `.env`); identidad `certificate` añadida; ambas identidades (`username`, `certificate`) + `SignAndEncrypt`/`Basic256Sha256` **probadas de punta a punta contra un `OPCUAServer` real local**, no un mock (`apps/api/test/opcua-security-switch.test.ts`) |
| Observabilidad | `GET /api/health/opc` (503 en `Stale`/`Faulted`), `GET /metrics` (Prometheus, 9 métricas, fuera del prefijo `/api`) |
| Hardening HTTP | `helmet`, rate-limiting (global + uno más estricto en login), CORS por `.env`, validación con `zod` en login y en `:plantId` |
| Logging | `JsonLogger` (pino) instalado vía `app.useLogger()` — todo el logging existente de Fase 1-3 pasa a JSON sin tocar esos archivos; eventos estructurados explícitos con `plantId`/`bridgeStatus`/`sequence` |
| Docs | `docs/OPTIX_CLIENT_CERT_TRUST.md` (nuevo), `docs/SECURITY_FINDING_P0.md` actualizado con el seguimiento de mitigaciones del lado backend, README con la Fase 4 documentada de punta a punta |

Verificado al cierre: `npm run typecheck` limpio en las 3 workspaces (`@ptap/api`, `@ptap/mobile`,
`@ptap/shared`), `npm test -w @ptap/api` → **92/92 tests** (61 previos + 31 nuevos de Fase 4),
`npm run validate:mapping -w @ptap/api` → mapping válido.

## Dos problemas reales que aparecieron al construir, y cómo se resolvieron

1. **`main.telemetry.ts` hubiera empezado a exigir MySQL.** Al colgarle guards a `OpcController`
   (que vivía dentro de `ConnectivityModule`, importado también por el arranque de demo sin BD),
   cualquier import de `ConnectivityModule` habría arrastrado `AuthModule` → `UsersModule` →
   `DatabaseModule`, rompiendo la invariante documentada de que la demo de telemetría no necesita
   base de datos. Se resolvió separando `OpcController` + RBAC/audit/métricas en un
   `OpcObservabilityModule` propio, usado solo por `main.ts` (app completa). `ConnectivityModule`
   volvió a quedar exactamente como en Fase 1-3: sin dependencia de BD.
2. **`tsx` rompía los decoradores de NestJS en archivos de `test/`.** Al escribir el primer test
   que declaraba una clase con `@Controller`/`@Get` dentro de `test/`, esbuild usaba el transform
   de decoradores "nuevo estilo" (incompatible con los decoradores clásicos de Nest) porque
   `test/**/*.ts` no está en el `include` de `tsconfig.json`. Diagnosticado con un repro mínimo
   confirmando que el problema era exactamente ese (`include`, no orden de decoradores ni Nest
   testing). Se resolvió con `apps/api/tsconfig.test.json` (incluye `test/`) + la variable
   `TSX_TSCONFIG_PATH` fijada en todos los scripts `test*` de `package.json`. Documentado en el
   README para que no se repita.

## Gaps conocidos, documentados y NO resueltos en esta sesión (a propósito)

- El gateway Socket.IO (`connectivity.gateway.ts`) sigue sin autenticación — protegerlo exige que
  el móvil mande el JWT en el handshake, cambio fuera del alcance de esta fase (backend-only).
- `opc_dead_letter_total`, `opc_parser_errors_total`, `opc_mapping_errors_total`,
  `opc_notifications_total`, `opc_reconnects_total` y `opc_bridge_status` salen **sin** label
  `plantId`: los contadores de origen (`DeadLetterBuffer`, `AdapterDiagnostics`) son de proceso
  completo, no por planta. Desglosarlos por planta es un cambio más grande que Fase 4.
- El login del móvil (`apps/mobile/services/auth.ts`) sigue mockeado. El backend ya expone
  `/api/auth/login` con el shape exacto que ese archivo espera (`{ token, user: AuthUser }`);
  integrarlo es trabajo pendiente, fuera del alcance de esta fase.
- Fase 5 (comandos de escritura) no se tocó — su precondición dura (sesión OPC UA
  autenticada + cifrada) ya está disponible desde esta fase, pero el canal de escritura en sí
  sigue sin empezar.

## Tareas pendientes (orden recomendado)

1. Conseguir credenciales/certificado reales de la planta y ejecutar el procedimiento de
   `docs/OPTIX_CLIENT_CERT_TRUST.md` contra el servidor de Optix real (esta sesión solo lo probó
   contra un servidor de pruebas local).
2. Decidir si se integra `/api/auth/login` en el móvil ahora o se pospone a la fase que toque
   frontend.
3. Fase 5: canal de comandos de escritura (interlocks, idempotencia, feature flag).

## Actualización 2026-07-15 — ajustes de cierre antes de Fase 5

Dos deudas de esta sesión se cerraron antes de abrir Fase 5 (ver plan de ajustes):

- **RBAC de tiers → permisos.** El modelo de tiers (`viewer|operator|admin`) de esta sesión no
  podía expresar la matriz oficial: el **Jefe de PTAP** hace todo lo del Operador **salvo** abrir/
  cerrar válvulas. Se migró a permisos granulares reutilizando `ROLE_PERMISSIONS`/`hasPermission()`
  de `@ptap/shared` (la misma fuente que ya consume el móvil): `@MinTier(tier)` → `@RequirePermission(permiso)`,
  `MinTierGuard` → `PermissionGuard`, y se retiró `RoleTier`/`ROLE_TIER`/`tierAtLeast` de `@ptap/shared`.
  Los diagnósticos admin (`/api/opc/info|buffers|dead-letter`) ahora exigen `system_config`; las
  lecturas solo exigen JWT válido (sin regresión). Los comandos de Fase 5 usarán `control_valves`
  (el jefe NO lo tiene) y `acknowledge_alarms`/`adjust_setpoints` (el jefe SÍ).
- **Auditoría de accesos denegados.** El `AuditInterceptor` (solo registraba éxitos; los guards
  corren antes que los interceptores en NestJS) se reemplazó por `AuditMiddleware`
  (`res.on('finish')`), que registra **200, 401 y 403** en `audit_log` — con el usuario que
  `JwtAuthGuard` haya seteado en un 403. También quedó auditado `/api/opc/status`, que antes no lo
  estaba. Cobertura nueva: `test/audit-middleware.test.ts` y el caso `jefe` en `test/rbac-e2e.test.ts`.
