# Auditoría comparativa del primer mes — Monitor PTAP

**Fecha de auditoría:** 2026-07-15 (re-baselineada el mismo día tras recibir el cronograma oficial) · **Rama auditada:** `yosh` (HEAD `02aff5a`) · **Modalidad:** auditoría comparativa plan-vs-real, con verificación directa de código y ejecución de las suites en la máquina de desarrollo.

**Línea base:** `plan_plc_desarrollo.xlsx` — “Plan de Trabajo · Sistema de Monitoreo PLC · Aplicación Web y Móvil”: 3 meses / 12 semanas, 2 ingenieros (A: backend e infraestructura; B: frontend y app móvil), 4 hitos de control. El Mes 1 (“Fundamentos & Arquitectura”, Semanas 1–4) comprende **11 tareas y 2 hitos**: Hito 1 (Semana 1, acuerdo de protocolo PLC) e Hito 2 (Semana 4, primer dato real del PLC en pantalla).

**Rol del auditor:** revisión independiente tipo CTO/PMP: cada afirmación está respaldada por un commit, un archivo del repositorio o una ejecución verificada el 2026-07-15. Donde falta evidencia, se dice explícitamente.

---

## 0. Alcance, método y limitaciones

**Verificaciones ejecutadas por el auditor (2026-07-15):** `npm test -w @ptap/api` → **94/94 OK** (tras reinstalar dependencias — ver riesgo nuevo §5.3-2); `npm run validate:mapping` → OK, 12 plantas; `npm run typecheck` → limpio en `@ptap/api` y `@ptap/shared`, **falla en `@ptap/mobile`** (regresión en HEAD, §5.3-1); lectura línea a línea de los archivos citados; historial git completo (`e2b9f5d`…`02aff5a`).

**Limitaciones que persisten:**

| Limitación | Impacto |
|---|---|
| El cronograma oficial no trae **fechas calendario** (semanas relativas S1–S12) | El mapeo semana↔calendario se reconstruyó desde git: primer commit 2026-06-26; hoy transcurren ~19 días (≈ final de la semana 3 real). La evaluación se hace **por tarea**, que es independiente del calendario |
| Export **L5X** del PLC ausente | Toda la semántica de señales sigue en `confidence: inferred`; ninguna es `confirmed` |
| Esquema SQL de dominio nunca entregado (`IA.txt` vacío, auditoría 10-jul) | La parte “usuarios” de la BD existe; “lecturas/alertas/historial” no (ver desviación D1, §2-S2) |
| Confirmación escrita de la planta (nombres, dimensiones de tanques) | `displayNameProvisional: true`; % de llenado solo donde el operador confirmó nivel de lleno |
| Acción del administrador OT sobre el hallazgo P0 | El servidor OPC UA de la planta sigue aceptando `Anonymous + None` con tags escribibles |

---

## 1. Resumen ejecutivo

Contra el cronograma oficial, el primer mes se cumple **en lo esencial y con el hito crítico adelantado**: el **Hito 2 (“primer dato real del PLC en pantalla”, previsto para la Semana 4) se logró en la semana 3 real** — y no con un dato, sino con **10 de 12 plantas y 96 señales reales** fluyendo PLC → backend → app (validado en vivo, `docs/FLOW_VALIDATION.md`, catálogo `docs/DATA_CATALOG.md`). El Hito 1 (protocolo definido y documentado) se cumplió con un rigor muy superior al pedido: OPC UA, con ingeniería inversa formal de 3.402 nodos y 10 entregables (`docs/plc/`).

De las **11 tareas planificadas para las Semanas 1–4: 4 completadas, 2 sustituidas por una solución mejor, 5 parciales, 0 no realizadas** (~75% de cumplimiento de tareas; detalle en §2 y §3).

El informe no es complaciente. Hay **tres desviaciones de alcance frente al plan que requieren decisión explícita del cliente/director** (D1: historial en BD sustituido por telemetría solo-RAM — el plan exige “lecturas e historial” en Semana 2 y “filtros al historial” en Semana 5; D2: la aplicación web React dedicada fue sustituida por Expo web; D3: login y roles existen en backend pero **no** están integrados de punta a punta en la app). Y hay **deuda crítica verificada hoy en el código**: los 4 hallazgos críticos de la auditoría de preproducción del 14-jul siguen abiertos, y el typecheck del monorepo está roto en HEAD. Nada de esto es estructural; todo es corregible en días — pero debe cerrarse **antes** de abrir la Semana 5.

**Veredicto global:** **en cronograma, con el hito crítico adelantado** y retraso localizado en la integración de auth/roles y en la capa de historial. Cumplimiento ponderado del primer mes: **~73%** (§4).

---

## 2. Comparativa por semanas (contra el cronograma oficial)

### Semana 1 — Protocolo, arquitectura y pantallas

**1. Objetivos planteados (plan oficial).**
- T1 (Ambos, **Hito 1**): reunión de inicio — definir qué datos envía el PLC, con qué frecuencia y por qué protocolo (MQTT, WebSocket, etc.). Criterio: protocolo definido y documentado.
- T2 (Ing. A): diseñar la arquitectura del sistema (flujo PLC → servidor → app/web). Entregable: documento de arquitectura.
- T3 (Ing. B): wireframes para Administrador, Operativo y Civil. Entregable: diseño de pantallas aprobado.

**2. Trabajo realizado.** El protocolo quedó definido como **OPC UA** (el servidor FactoryTalk Optix del PLC maestro lo expone) y documentado con un nivel muy superior al pedido: herramienta `tools/plc-discovery` (solo lectura), captura de 3.402 nodos, 10 entregables en `docs/plc/`, contrato de mapping con JSON Schema. La arquitectura está documentada en README §Arquitectura + `docs/architecture/` (capas obligatorias, máquina de estados del puente, 12 reglas de dominio). En lugar de wireframes, el commit inicial (`e2b9f5d`, 26-jun) entregó directamente la **app Expo funcional** con login por roles, sensores, válvulas, tanques y reportes (con mocks).

**3. Comparación.**

| Tarea | Estado | Justificación |
|---|---|---|
| T1 · Protocolo PLC (**Hito 1**) | ✅ Completado (superado) | Criterio del hito era “MQTT/OPC-UA/Serial definido y documentado”: OPC UA definido, con evidencia forense (`docs/plc/`, `docs/PHASE0_VERIFICATION.md`). Nota: la frecuencia/semántica por señal se completó incrementalmente hasta el 15-jul con el operador |
| T2 · Documento de arquitectura | ✅ Completado (superado) | README §Arquitectura + `docs/architecture/backend-structure.md`/`backend-methods.md`; la arquitectura además está implementada y testeada, no solo dibujada |
| T3 · Wireframes por rol | 🔄 Sustituido | No hay artefacto de wireframes; se construyó directamente el prototipo funcional con las pantallas por rol. Cumple el espíritu (“diseño de pantallas aprobado”) con mayor valor; el riesgo asumido fue saltarse la aprobación formal del diseño |

**4. Cambios respecto al plan.** El protocolo resultó impuesto por la infraestructura real (OPC UA, no MQTT/WebSocket) — decisión correcta y sin alternativa razonable. Prototipo funcional en lugar de wireframes.

**5. Impacto.** Reduce riesgo técnico (protocolo verificado contra el servidor real, no asumido) y adelantó el contrato visual. Costo: los mocks del prototipo aún conviven con datos reales (auth, válvulas, reportes) — ver D3.

### Semana 2 — Servidor + PLC, base de datos, estructura de proyectos

**1. Objetivos planteados (plan oficial).**
- T4 (Ing. A): configurar el servidor y lograr la **primera conexión real con el PLC maestro**. Criterio: servidor recibiendo datos del PLC.
- T5 (Ing. A): diseñar la **base de datos**: lecturas, usuarios, alertas e historial. Criterio: BD creada y funcionando.
- T6 (Ing. B): estructura base del proyecto **web (React)** y **app móvil (React Native/Expo)**. Criterio: proyectos inicializados.

**2. Trabajo realizado.** Monorepo npm workspaces (7-jul), backend NestJS con arquitectura de puertos y adaptador simulador (8-jul), adaptador OPC UA real conectado al PLC con subscriptions, watchdog, heartbeat y reconexión (Fase 1, verificada el 14-jul; el caudal real de Montebello se validó en vivo — `docs/FLOW_VALIDATION.md`). MySQL con pool, migraciones y tablas `users` + `audit_log` (14-jul). App móvil Expo operativa también como web (Expo web).

**3. Comparación.**

| Tarea | Estado | Justificación |
|---|---|---|
| T4 · Servidor recibiendo datos del PLC | ✅ Completado (con retraso de ~1 semana, superado en alcance) | El puente vivo contra el PLC llegó en la semana 3 real, no en la 2 — pero con calidad industrial (máquina de estados, reciclaje escalonado, coalescer), no una conexión de prueba |
| T5 · BD: lecturas, usuarios, alertas, historial | 🟡 Parcial — **desviación D1** | “Usuarios” ✅ (`users`, `audit_log`, migraciones, seed). “Lecturas/historial” ❌ **por decisión deliberada**: la telemetría vive solo en RAM (regla 1 del proyecto). “Alertas” ❌ (los insumos `opMin/opMax` ya viajan en el DTO, pero no hay motor de alertas — es Semana 6 del plan). **D1 debe validarse con el cliente**: el plan exige historial, y las tareas S5 (“filtros al historial”) y S6 (“gráficas de tendencia”) dependen de él |
| T6 · Proyectos web + móvil inicializados | 🔄 Sustituido — **desviación D2** | Móvil Expo ✅. **No existe app web React dedicada**: Expo web la sustituye (un solo código para Android/iOS/Web). Defendible — el propio plan pide PWA en S8 — pero es un cambio de arquitectura de entregables que el cliente debe conocer |

**4. Cambios respecto al plan.** D1 (RAM-only) y D2 (Expo web) — ambas decisiones conscientes y documentadas en el repo, ninguna validada formalmente contra el cronograma.

**5. Impacto.** D1 reduce riesgo operativo (sin crecimiento de BD sin control) y simplifica el MVP, pero **choca frontalmente con el alcance del Mes 2**; postergarla convierte un riesgo de diseño en un incumplimiento de cronograma. D2 reduce mantenimiento (un solo frontend) con el riesgo de límites de PWA/web en gráficas pesadas — a validar en S8.

### Semana 3 — API y login

**1. Objetivos planteados (plan oficial).**
- T7 (Ing. A): crear la API: endpoints de datos en **tiempo real** y de **historial**. Criterio: API documentada y probada.
- T8 (Ing. B): pantalla de login con control de usuarios y **seguridad (JWT)**. Criterio: login funcionando en web y app.

**2. Trabajo realizado.** API REST de tiempo real (`/api/plants`, `/api/plants/:id/snapshot`) + push Socket.IO (`opc:snapshot`/`opc:liveness`), documentada (OpenAPI, Postman, `docs/DATA_CATALOG.md` generado) y probada (94 tests, incluidos e2e con supertest). Backend de auth completo: `POST /api/auth/login` (JWT), guards `JwtAuthGuard`/`MinTierGuard`, RBAC por tier reutilizando el `Role` compartido, Argon2id, rate-limit de login. La pantalla de login del móvil existe desde la semana 1 **pero sigue conectada a un stub** (`apps/mobile/services/auth.ts` — verificado hoy).

**3. Comparación.**

| Tarea | Estado | Justificación |
|---|---|---|
| T7 · API tiempo real + historial | 🟡 Parcial | Tiempo real: ✅ superado (REST + push, documentada, probada). Historial: ❌ — consecuencia directa de D1: sin persistencia de lecturas no puede existir endpoint de historial |
| T8 · Login JWT funcionando en web y app | 🟡 Parcial — **desviación D3** | El backend está completo y probado; el shape de respuesta coincide exactamente con lo que `services/auth.ts` espera. Pero la app **no lo consume**: el login real de punta a punta no existe. “Funcionando en web y app”, criterio literal del plan: no cumplido |

**4. Cambios respecto al plan.** La Fase 4 (seguridad) se ejecutó backend-only por decisión de alcance; la integración móvil quedó explícitamente pendiente (`docs/audit/auditoria-2026-07-14.md`).

**5. Impacto.** El trabajo de backend de T8 está por encima del plan (RBAC completo, audit log, hardening — parte de eso es S4 y S5 del plan); el gap es una tarea de integración acotada (~1 día) pero mientras exista, roles y permisos en la app son ficticios.

### Semana 4 — Integración (Hito 2), roles y dashboard

**1. Objetivos planteados (plan oficial).**
- T9 (Ambos, **Hito 2**): integración — conectar web y app al servidor; **ver el primer dato real del PLC en pantalla**.
- T10 (Ing. A): sistema de roles Admin/Operativo/Civil funcionando.
- T11 (Ing. B): dashboard base con medidores, tablas y gráficas, visible por rol.

**2. Trabajo realizado.** El Hito 2 se alcanzó **antes de la Semana 4**: caudal de Montebello en pantalla el 14-jul y, al 15-jul, 10 plantas / 96 señales reales con liveness honesto (EN VIVO/congelado), unidades de ingeniería y rangos operativos. El modelo de roles del plan (Civil/Operador/Jefe de PTAP/Admin, con la matriz de permisos del documento) está implementado en `@ptap/shared` (fuente única) y aplicado en el backend vía tiers; en la app, las pantallas de sensores/tanques/estado consumen datos reales; válvulas y reportes siguen mock.

**3. Comparación.**

| Tarea | Estado | Justificación |
|---|---|---|
| T9 · **Hito 2**: primer dato real en pantalla | ✅ Completado **adelantado y superado** | Previsto para S4; logrado en la semana 3 real, con 96 señales en vez de “un pequeño número que valida el mes” (texto literal del plan) |
| T10 · Roles funcionando | 🟡 Parcial | Modelo y enforcement backend: ✅ (guards por tier; la matriz del plan, incluido “Jefe ve todo pero no acciona válvulas”, está codificada en `@ptap/shared`). En la app: el rol proviene del login mock, así que la experiencia por rol no está garantizada E2E (D3) |
| T11 · Dashboard base por rol | 🟡 Parcial | Medidores y tablas con datos reales: ✅ (sensores, tanques con % de llenado donde hay confirmación, estado). Gráficas: ❌ (el plan las profundiza en S6, pero “gráficas” aparece en el criterio de S4). Visibilidad por rol: limitada por D3 |

**4. Cambios respecto al plan.** El orden se invirtió deliberadamente: el equipo priorizó la tubería de datos real (hito de mayor riesgo técnico) por delante de la experiencia por rol. También se añadió alcance no planificado para el Mes 1: seguridad OPC UA cifrada probada end-to-end, audit log, métricas Prometheus, health industrial — tareas que el plan sitúa en S8–S11 (“reconexión automática”, “revisar seguridad”, “monitoreo del servidor”) y que ya están construidas y probadas.

**5. Impacto.** Positivo neto: el riesgo más alto del proyecto (¿podemos leer el PLC de verdad?) quedó retirado antes de tiempo, y trabajo de los meses 2–3 ya está adelantado. El costo es la cola de integración D3, que es exactamente lo que el plan esperaba tener cerrado al final del Mes 1.

---

## 3. Balance del Mes 1: adelantos y pendientes

**Marcador de tareas del plan (Semanas 1–4):** ✅ 4 · 🔄 2 · 🟡 5 · ❌ 0 — **~75% de cumplimiento de tareas**. Los dos hitos de control del Mes 1: **Hito 1 ✅, Hito 2 ✅ (adelantado)**.

**Trabajo del Mes 2–3 ya adelantado (no estaba en S1–S4):**
- Reconexión automática y estabilidad del puente (plan: S8) — construida, con 4 defectos críticos en los bordes (§5.2-2).
- Seguridad y control de accesos (plan: S9) — JWT+RBAC+hardening+OPC UA cifrado, probados.
- Monitoreo/observabilidad (plan: S11) — `/api/health/opc`, 9 métricas Prometheus, audit log.
- Log de eventos del sistema (plan: S5) — `audit_log` en MySQL con eventos de conexión y accesos.

**Pendiente del Mes 1, con causa y responsable:**

| Pendiente | Tarea del plan | Causa | Responsable de destrabar |
|---|---|---|---|
| Login real E2E en la app (D3) | S3-T8 | Fase 4 fue backend-only | Equipo frontend |
| Experiencia por rol E2E (D3) | S4-T10 | Depende del login real | Equipo frontend |
| Historial de lecturas (D1) | S2-T5, S3-T7 | Decisión RAM-only + esquema SQL nunca entregado (`IA.txt` vacío) | **Decisión de cliente/director** + equipo |
| App web React dedicada (D2) | S2-T6 | Sustituida por Expo web | Validación con cliente (formalizar) |
| Gráficas en dashboard | S4-T11 | Pospuesto a S6 (donde el plan las desarrolla) | Equipo frontend |
| 2 plantas sin señales propias (`san-antonio`, `quijote`) | — (extra al plan) | Sus tanques llegan retransmitidos vía Soledad; pendiente rectificar con operador | Operador/cliente |

---

## 4. Tabla de cumplimiento del primer mes

El porcentaje mide avance real contra lo que el Mes 1 del cronograma oficial debía dejar listo, ponderado por la evidencia verificada.

| Área | % | Justificación (evidencia) |
|---|---|---|
| Arquitectura | **90%** | T2 superada: capas estrictas implementadas y testeadas; máquina de estados; puerto + 2 adaptadores; 12 reglas de dominio. Resta: DTOs duplicados backend/móvil sin unificar en `@ptap/shared` (drift real confirmado por git), poller legado activo en paralelo |
| Backend (pipeline) | **85%** | Fases 0–3 completas; 94/94 tests; pipeline síncrono sin carreras (verificado). Resta: críticos H12/H13 en los bordes de validación de datos |
| Comunicación PLC | **75%** | T4 cumplida con calidad industrial; 10/12 plantas emitiendo. Resta: H1 (Faulted terminal) y H4 (fuga de clientes) — los caminos de fallo que un entorno industrial ejercita a diario; semántica 100% `inferred` sin L5X |
| API | **80%** | T7 tiempo real superada (REST+Socket.IO+OpenAPI+Postman+catálogo). Resta: historial (D1), Socket.IO sin auth, rutas legacy deprecadas montadas |
| Base de datos | **40%** | De las 4 responsabilidades que el plan da a la BD (lecturas, usuarios, alertas, historial), solo “usuarios” existe. La decisión RAM-only reduce el alcance esperado de la BD, pero es una desviación no validada (D1), y las alertas de S6 necesitarán su parte de esquema |
| Seguridad | **70%** | Muy por delante del plan (que la sitúa en S9): JWT sin fallbacks, Argon2id OWASP, cero fugas de secretos a logs (verificado), OPC UA cifrado probado. Contrapesos: P0 del servidor sin mitigar (responsabilidad externa, riesgo vivo), Socket.IO abierto, login móvil mock |
| Frontend | **65%** | Pantallas del prototipo completas; sensores/tanques/estado con datos reales de 10 plantas; patrón resync por `sequence`. Contrapesos: **typecheck roto en HEAD**, D3 (auth/roles), válvulas/reportes mock, sin gráficas, 0 tests de móvil |
| Integración | **70%** | Hito 2 superado (PLC→app E2E validado en vivo). Contrapesos: auth no integrada E2E; contrato DTO duplicado con drift |
| Preparación MVP (Hito 3, S8) | **60%** | La demo de telemetría es sólida hoy; para el MVP de 3 roles faltan D3, vistas por rol (S5–S7) y alertas (S6); piloto supervisado alcanzable tras corregir los 4 críticos |
| **Global ponderado** | **~73%** | Consistente con el marcador de tareas (~75%) menos el descuento por deuda crítica abierta y typecheck roto |

---

## 5. Riesgos

### 5.1 Riesgos resueltos (mitigados con evidencia)

| Riesgo | Cómo se mitigó |
|---|---|
| Protocolo PLC desconocido (riesgo #1 del plan — Hito 1) | OPC UA verificado contra el servidor real; ingeniería inversa documentada (`docs/plc/`) |
| Camino técnico PLC→pantalla sin probar (Hito 2) | Cerrado antes de tiempo: 10 plantas / 96 señales E2E |
| Desarrollar sin acceso al PLC | Adaptador simulador permanente conmutables por `.env` |
| Índices de namespace OPC UA cambiantes entre reinicios de Optix | Mapping por `{nsUri, identifier}` resuelto en runtime en cada conexión |
| Inventar semántica de señales | Contrato de mapping con `confidence`; regla “sin evidencia ⇒ unmapped”; dead-letter |
| Credenciales en el repo | `.env` git-ignorado (corregido el 10-jul tras detectarse) |
| DI rota en modo dev (`tsx` sin `design:paramtypes`) | `@Inject` explícito en los 5 puntos afectados (10-jul) |
| Escribir al PLC por accidente | `OPCUA_WRITES_ENABLED=false` + canal de escritura bloqueado por diseño |
| Sesión OPC UA en claro | Conmutación probada a `SignAndEncrypt/Basic256Sha256` (username y certificado) |

### 5.2 Riesgos pendientes (conocidos, sin resolver)

1. **P0 del servidor OPC UA de la planta** (`Anonymous+None`, todos los tags escribibles, IP pública): mitigación en manos del administrador OT; mientras tanto cualquier tercero con red puede escribir a los buffers de comando de 13 plantas de agua potable. El gateway no puede compensarlo.
2. **Los 4 críticos de la auditoría de preproducción** — verificados abiertos hoy: `Faulted` terminal sin auto-recuperación (`bridge-orchestrator.service.ts:36-48`), fuga de `OPCUAClient` en el catch de `start()`, `Number(null)→0` (`opcua-connectivity.adapter.ts:373`), `usable:true` con `value:null` (`mapping.engine.ts:92` + `quality.evaluator.ts` sin rama para `null`).
3. **D1 sin decisión formal**: si el cliente ratifica el historial del plan, la Semana 5 arranca bloqueada (“filtros al historial” sin historial que filtrar).
4. **Socket.IO sin autenticación** — cualquier cliente con red al backend lee la telemetría.
5. **Semántica `inferred` sin documento** — un índice mal confirmado por HMI mostraría el dato equivocado con apariencia normal; hay casos pendientes explícitos (Cascajal presión de entrada lee 384 psi; tanques de Montebello sin mapear; Pichindé posible sitio anidado).

### 5.3 Riesgos nuevos detectados en esta auditoría

1. **Typecheck del monorepo roto en HEAD**: `TankCard.tsx:41,73` usa `tank.outOfRange`, no declarado en `TankView` (`services/tanks.ts:12`); introducido por `10b7e2e` (15-jul). La definición de “hecho” del propio proyecto no se cumple en el commit más reciente.
2. **Reproducibilidad de entorno**: la suite fallaba en la máquina del equipo por dependencias de Fase 4 no instaladas tras el merge (resuelto en esta auditoría con `npm install`). Sin CI, “en verde” depende de la máquina de cada quien.
3. **Higiene de git en deterioro en la semana 3**: commits `a`, `coomii`; `origin/main` congelado en el 8-jul (`1efb29d`) mientras el producto vive en `yosh`; `main` local divergido. La rama pública no representa el estado real — relevante para tutor/cliente.

---

## 6. Deuda técnica

| # | Deuda | Severidad | Impacto |
|---|---|---|---|
| 1 | `Number(null)===0` en ingesta (`opcua-connectivity.adapter.ts:373`) | **Crítica** | Lecturas inválidas del PLC se vuelven ceros reales sin traza; viola el principio “el tablero nunca miente”. Fix de 1 línea recomendado desde el 14-jul |
| 2 | Señal estructuralmente rota puede salir `usable:true, value:null` (`mapping.engine.ts:92` + `quality.evaluator.ts`) | **Crítica** | El front puede tratar como válida una señal sin dato |
| 3 | `Faulted` terminal sin auto-recuperación post-arranque | **Crítica** | Un transitorio de red puede dejar el monitoreo ciego hasta reinicio manual del proceso |
| 4 | Fuga de `OPCUAClient` en el `catch` de `start()` (no llama `client.disconnect()`) | **Crítica** | Fuga sin cota de sockets/memoria en reintentos; agotamiento de recursos en outages largos |
| 5 | Typecheck móvil roto (`outOfRange` ausente en `TankView`) | **Alta** | Rompe el gate de calidad del monorepo; bloquea builds tipados del móvil |
| 6 | DTOs duplicados backend/móvil con drift confirmado (`plant-snapshot.dto.ts` vs `services/api.ts`) | **Alta** | Sin mecanismo que fuerce sincronía; sin barrera técnica para unificar en `@ptap/shared` |
| 7 | Socket.IO sin auth (`connectivity.gateway.ts`) | **Alta** | Telemetría de infraestructura crítica legible por cualquier cliente con red al backend |
| 8 | Logging por snapshot (~21.600 líneas/hora en operación normal) | **Alta** | Ahoga errores reales; costo de log shipping; dificultaría diagnosticar un piloto |
| 9 | `arrayLength`/`UNEXPECTED_LENGTH` muertos | **Media** | Drift PLC↔mapping sin alerta agregada; la métrica existe pero siempre en 0 |
| 10 | Heartbeat compite con la reconexión interna de node-opcua en `Recovering` | **Media** | Carreras de sesión bajo cortes intermitentes — el escenario más común del dominio |
| 11 | Poller legado (`opc-config.service.ts`) activo en paralelo, con config fuera de `.env` | **Media** | Código de propósito difuso en producción; viola la regla 8 del proyecto |
| 12 | Lint del monorepo falla (`expo/no-dynamic-env-var` sobre helpers backend) | **Media** | Deuda documentada desde el 10-jul; normaliza vivir con el lint en rojo |
| 13 | Mocks residuales en móvil (auth, válvulas, reportes) conviviendo con datos reales | **Media** | Intencional y documentado, pero superficie de confusión para demos y nuevos desarrolladores |
| 14 | Sin CI (tests/typecheck solo locales) | **Media** | Las dos regresiones de esta semana (deps faltantes, typecheck roto) habrían sido atrapadas por un pipeline mínimo |
| 15 | Subscribers de Fase 4 sin `OnModuleDestroy`; `PlantCache.write()` sin guard de `sequence`; `err.message` sin sanear hacia audit log; capacidad fija del dead-letter | **Baja** | Riesgos latentes documentados en preproducción, no explotables hoy |
| 16 | Indentación rota en `tanks.ts:21,104` (artefacto de merge) | **Baja** | Cosmético, pero delata merges sin revisión |

---

## 7. Decisiones de arquitectura del primer mes

| Decisión | Por qué fue necesaria | Qué resolvió / ventajas | ¿Modifica el plan? |
|---|---|---|---|
| **Protocolo OPC UA** (vs. MQTT/WebSocket del plan) | Es lo que expone la infraestructura real (FactoryTalk Optix) | Cierra el Hito 1 con evidencia forense | Dentro del plan (el hito admitía OPC-UA) |
| **Monorepo npm workspaces con `@ptap/shared`** | FE y BE comparten roles/tipos | Una sola fuente de verdad; typecheck cruzado | No (organiza T6) |
| **Puerto `ConnectivityAdapter` + simulador permanente** | Desarrollo sin depender de la planta | El PLC real entró por el mismo puerto sin tocar el resto | No (habilita T4) |
| **Telemetría solo en RAM; MySQL solo auth/auditoría** | Evitar una BD de series prematura | Snapshot <50 ms; sin crecimiento sin control | **Sí — D1**: contradice “lecturas e historial” (S2) y bloquea “filtros al historial” (S5). Requiere decisión del cliente |
| **Expo web en lugar de app React dedicada** | Un solo código Android/iOS/Web | Menos mantenimiento; el plan pide PWA en S8 | **Sí — D2**: cambia el entregable “Aplicación Web (React)”. Formalizar con el cliente |
| **Mapping declarativo versionado** (`opc_mapping.json` + schema + generador) | Sin L5X, la semántica no podía quemarse en código | Semántica auditable con `confidence`; catálogo generado | No (eleva la calidad de T1/T7) |
| **Direccionamiento por `(plantId, domainKey)`, nunca por índice** | Los índices no son transferibles entre plantas (verificado) | Elimina una clase entera de errores de datos cruzados | No |
| **Máquina de estados del puente + liveness de 4 estados** | Un boolean “connected” miente en un dominio con sitios congelados | El operador distingue congelado/vivo/inferido | No (adelanta “reconexión automática” de S8) |
| **Seguridad adelantada (Fase 4) tras el hallazgo P0** | El servidor de la planta está expuesto; escribir sin sesión segura era inaceptable | Precondición del canal de comandos cumplida y probada | Sí, en positivo: adelanta S9 |
| **`main.ts` vs `main.telemetry.ts` + `OpcObservabilityModule`** | La demo sin MySQL no debía exigir BD al añadir RBAC | La demo de telemetría sigue arrancando sin base de datos | No |
| **Política “si hay número, se muestra tal cual”** (acordada con el operador, 15-jul) | Valores fuera de rango son información operativa (un −57 psi delata el sensor) | `usable`/`outOfRange` son metadatos de aviso, no filtros | No (insumo del semáforo de S5) |

---

## 8. Estado general del proyecto

**Clasificación: EN CRONOGRAMA**, con el hito crítico adelantado.

- **Adelantado:** Hito 2 cumplido antes de la Semana 4 y multiplicado (96 señales vs. “un dato”); seguridad (S9), reconexión (S8), monitoreo (S11) y log de eventos (S5) ya construidos.
- **En línea:** protocolo, arquitectura, estructura de proyectos, API de tiempo real, dashboard base con datos reales.
- **Retrasado (localizado):** login/roles E2E en la app (criterios literales de S3-T8 y S4-T10) e historial (S2-T5/S3-T7, condicionado a la decisión D1).
- **No está “en riesgo”**, pero tiene una ventana de riesgo concreta: pilotar en planta sin corregir los 4 críticos expondría el sistema a quedar ciego (Faulted terminal) o a mentir (`null`→0) ante los eventos más comunes del dominio; y arrancar la Semana 5 sin decidir D1 pone dos de sus tres tareas sobre un supuesto inexistente.

---

## 9. Preparación para la Semana 5 (Mes 2)

Las tareas oficiales de la Semana 5 son: **vista Civil completa (Ing. B), filtros al historial (Ing. A), log de eventos (Ing. A)**.

**Veredicto: listo condicionalmente.**

- **Vista Civil:** desbloqueada técnicamente (datos reales + `liveness` + `opMin/opMax` para semáforos), pero su “solo lectura por rol” exige cerrar D3 primero.
- **Log de eventos:** parcialmente hecho (audit_log de Fase 4); falta acordar qué eventos de dominio adicionales exige el cliente.
- **Filtros al historial:** **bloqueada por D1** — no existe historial que filtrar. Decisión requerida antes del lunes de Semana 5.

**Bloqueantes a cerrar antes de abrir alcance nuevo (estimación conjunta: 2–4 días):**
1. Corregir los 4 críticos de preproducción (H12/H13 son cambios de pocas líneas ya especificados; H1/H4 requieren un listener de `Faulted` con backoff y `disconnect()` en el catch).
2. Reparar el typecheck del móvil (declarar y poblar `outOfRange` en `TankView`, o retirar su uso de `TankCard`).
3. **Decidir D1 con el cliente/director**: ratificar historial (y diseñar la capa de persistencia de series ya) o re-negociar el alcance de S5/S6 por escrito.
4. Integrar `/api/auth/login` en la app y JWT en el handshake de Socket.IO (cierra D3 y el gap de seguridad del gateway a la vez).
5. Bajar el logging de snapshots a `debug` y restablecer la disciplina de ramas (llevar `yosh` a `main` vía PR).

**Muy recomendado en la primera semana del Mes 2:** CI mínimo (typecheck+tests+validate:mapping por push); unificar DTOs de snapshot en `@ptap/shared`.

**Dependencias externas a gestionar (PM):** export L5X, mitigación del P0 por el administrador OT, confirmación escrita de nombres/dimensiones, y —si D1 se ratifica— el esquema de la parte de dominio de la BD que nunca llegó.

---

## 10. Recomendaciones

1. **Congelar alcance nuevo 2–4 días** y ejecutar los bloqueantes 1–5 de §9: elimina las cuatro formas conocidas en que el sistema puede mentir o quedarse ciego, y deja la Semana 5 sin supuestos rotos.
2. **Formalizar las tres desviaciones (D1, D2, D3) por escrito** con director/cliente: son decisiones razonables, pero hoy viven solo en el repositorio; el plan oficial dice otra cosa y en una revisión contractual eso cuenta como incumplimiento no gestionado.
3. **Institucionalizar los gates con CI**: la evidencia de esta semana (dependencias desincronizadas, typecheck roto en HEAD) demuestra que la disciplina manual ya no alcanza al ritmo actual.
4. **Escalar formalmente el P0** con `docs/SECURITY_FINDING_P0.md` (autosuficiente) a la dirección de la planta, con fecha compromiso. Es el mayor riesgo del proyecto y no se resuelve con código propio.
5. **Presionar por el L5X**: es la diferencia entre un tablero `inferred` y uno `confirmed`, y destraba los casos abiertos (tanques de Montebello, Cascajal 384 psi, Pichindé).
6. **Versionar el cronograma en el repo** (p. ej. `docs/CRONOGRAMA.md` con el plan de 12 semanas) y actualizar el reporte semanal de avance contra él — la plantilla de “Avance de proyecto — Semana 1” del propio plan es el formato a sostener.

---

## 11. Conclusión ejecutiva

Medido contra el cronograma oficial de 12 semanas, el primer mes de Monitor PTAP termina con sus **dos hitos de control cumplidos — el segundo, adelantado y multiplicado** (10 plantas y 96 señales reales en pantalla en lugar del “primer dato”), 4 de 11 tareas completas, 2 sustituidas por soluciones superiores, 5 parciales y ninguna sin tocar (~75% de tareas, ~73% ponderado). Además, el equipo adelantó trabajo que el plan sitúa en las semanas 8–11: reconexión automática, seguridad, observabilidad y log de eventos.

El mismo rigor documental del proyecto impide un veredicto complaciente: sus propias auditorías identificaron el 14-jul cuatro defectos críticos que siguen abiertos en el código, el typecheck está roto en el commit más reciente, y tres desviaciones de alcance frente al plan (historial, app web, login/roles E2E) no han sido formalizadas con el cliente — una de ellas (D1) bloquea directamente una tarea de la Semana 5. Nada de esto es estructural; todo es corregible en días, pero debe corregirse **antes** de abrir el Mes 2, no en paralelo.

**Cumplimiento del primer mes: ~73% (tareas: ~75%; hitos: 2/2). Estado: en cronograma, con el hito crítico adelantado. Apto para demo hoy; apto para piloto supervisado tras cerrar los 4 críticos; no apto para operación 24/7 sin supervisión. Listo para la Semana 5 bajo las condiciones de §9 — la decisión D1 (historial) es del cliente y es previa.**

---

*Informe generado por auditoría independiente el 2026-07-15 y re-baselineado el mismo día contra el cronograma oficial (`plan_plc_desarrollo.xlsx`: 12 semanas, 2 ingenieros, 4 hitos). Evidencia: historial git (`e2b9f5d`…`02aff5a`), ejecución local de `npm test -w @ptap/api` (94/94), `npm run typecheck` (falla en `@ptap/mobile`), `npm run validate:mapping` (OK, 12 plantas), y lectura directa de los archivos citados. Limitación restante: el plan no trae fechas calendario; el mapeo semana↔fecha se reconstruyó desde git.*
