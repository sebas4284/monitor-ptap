# Auditoría técnica — Monitor PTAP (2026-07-10)

Estado tras la validación de infraestructura backend ↔ MySQL. Rama `josh`.

## Estado general

| Área | Estado |
|---|---|
| Backend (`apps/api`) | ✅ Arranca sin errores (dev con tsx y compilado con tsc), typecheck limpio, 4 endpoints REST + Socket.IO funcionando |
| Base de datos | ✅ Conexión validada a MySQL 9.7 (`127.0.0.1:3300`), BD `monitor_ptap` creada (utf8mb4), CRUD round-trip verificado directamente. **0 tablas de dominio** (pendiente el esquema SQL — el archivo `IA.txt` llegó vacío) |
| Repositorio | ⚠️ Working tree con los cambios de esta sesión sin commitear; rama `josh` es la más avanzada. **Push bloqueado por credenciales** (ver P1) |
| Frontend (`apps/mobile`) | ✅ Funciona; datos de sensores/tanques ya consumen API real; auth y reportes siguen mockeados (intencional) |
| Compatibilidad FE↔BE | ⚠️ Compatible en lo existente; faltantes documentados en `docs/integration/frontend-integration.md` (anexo Fase 5) |

## Problemas encontrados y prioridad

### P1 — Bloqueantes para colaboración
1. **Permisos GitHub rotos en esta máquina.** La credencial activa del Credential Manager es la cuenta **`Yoshll`**, y GitHub devuelve 403 al push tanto a `origin` (`YoshLores/monitor-ptap`) como a `upstream` (`sebas4284/monitor-ptap`). Hasta re-autenticar (Credential Manager → eliminar la credencial `git:https://Yoshll@github.com` y volver a iniciar sesión, o `git credential-manager github login`), **no se puede subir nada**: ni ramas, ni PRs.
2. **Esquema de BD ausente.** Las ~17 tablas del dominio no existen ni como SQL ni como migraciones. El archivo `IA.txt` que debía traer las sentencias llegó vacío (0 bytes, verificado en `C:\Users\Joshua\Desktop\IA.txt`).

### P2 — Corregidos en esta sesión (verificados)
3. **Inyección de dependencias rota en modo dev.** `tsx` (esbuild) no emite `design:paramtypes`; toda inyección por tipo sin `@Inject` explícito llegaba `undefined`, silenciada por `@Optional()`. Efecto real: `GET /api/plants` y `GET /api/snapshots/:plantId` devolvían **500** y el gateway Socket.IO arrancaba en "modo pasivo" (sin difusión). Corregido con `@Inject(...)` explícito en 5 puntos (controllers de plants/snapshots, gateway, service, adapter). El modo compilado nunca tuvo el bug — por eso pasó inadvertido.
4. **`.gitignore` no cubría `.env`** — la contraseña de MySQL y el pepper habrían terminado en el repositorio. Añadida la línea `.env`.
5. **Nada cargaba `.env`** — añadido `dotenv` con `apps/api/src/config/load-env.ts` (path por `__dirname`, funciona igual en dev y dist).

### P3 — Reportados, sin cambiar (decisión del equipo)
6. **Patrón `@Optional()` defensivo** en `connectivity.service.ts`, `connectivity.gateway.ts` y el adapter: enmascara fallos de DI convirtiéndolos en degradación silenciosa (este patrón es exactamente lo que ocultó el bug P2-3). Recomendación: eliminarlos y dejar que Nest falle en el arranque.
7. **`PlcModule` huérfano** (`apps/api/src/modules/plc/plc.module.ts`) — no se importa en `AppModule`; código muerto documentado como reubicado.
8. **`PasswordHashingService` sin consumidores** — listo pero nadie lo inyecta (auth sin implementar).
9. **Sin `ValidationPipe` global ni CORS HTTP en `main.ts`**; el gateway Socket.IO usa `cors.origin: '*'` — restringir origins antes de cualquier despliegue fuera de localhost.
10. **Lint con 1 error preexistente** (`expo/no-dynamic-env-var` en `password-hashing.service.ts:48`, acceso dinámico a `process.env`) y 1 warning (`Array<T>` en el adapter). `npm run lint -w @ptap/api` falla por ello desde antes de esta sesión.
11. **TypeScript `~6.0.3` + `ignoreDeprecations: "6.0"`** — versión atípica; verificar reproducibilidad de instalación en otras máquinas.
12. **Scripts `test` son stubs** (`echo`) — no hay ni un test en el monorepo.
13. **Dos instancias MySQL simultáneas en esta máquina** (8.4 en 3306, 9.7 en 3300, más procesos mysqld adicionales). La credencial del proyecto solo vale en la 9.7/3300. Documentado en `.env` y en la guía; considerar apagar la instancia que no se use para evitar confusiones del equipo.
14. **El proxy combinado no soporta upgrade WebSocket** (`scripts/combined-proxy.js`) — Socket.IO vía 8080 caería a long-polling.
15. **Fail-fast ante MySQL caído** (decisión deliberada de esta sesión): la API no arranca sin BD. Si en el futuro se prefiere modo degradado, cambiarlo en `database.module.ts`.

## Tareas pendientes (orden recomendado)
1. Re-autenticar GitHub y hacer push de esta rama (P1-1).
2. Conseguir el SQL de las 17 tablas (reenviar `IA.txt`) y decidir estrategia de migraciones antes de ejecutarlo (P1-2).
3. Commitear los cambios de esta sesión en `josh` y abrir PR hacia `main`.
4. Implementar auth real (login/register + JWT + guards) — el frontend ya tiene el flujo esperado definido.
5. Endpoint de comandos de válvula + contrato `Report` en `@ptap/shared`.
6. Resolver P3-6 (quitar `@Optional()`) y P3-9 (CORS/ValidationPipe) antes de exponer el backend fuera de localhost.
