# Auditoría de Eficiencia del Backend — Monitor PTAP

**Fecha:** 2026-07-28 · **Alcance:** `apps/api` (NestJS) + VM de producción `192.168.30.50`
(2 vCPU / 2 GB RAM, 1 proceso `fork` pm2). **Método:** medición **pasiva** en la VM (solo lectura) +
carga con el **simulador** (harness de Fase 6). No se modificó código ni BD en esta auditoría.

> Adaptación del algoritmo genérico (zonas → KPIs → Efficiency Score → desperdicios → prioridad →
> ROI) a un backend de **tiempo real**: monitoreo de 12 plantas por OPC UA, **telemetría NO
> persistida**, lecturas desde **cache RAM** (`PlantCache`), transporte **push por Socket.IO**. Por eso
> el SQL pesa poco y pesan el **event-loop lag**, la **RAM** (VM de 2 GB), el **fan-out** y los errores.

---

## Resumen ejecutivo

**Efficiency Score global: 91 / 100 — 🟢 Óptimo.** El backend está sano y con amplio margen: **RSS
194 MB (68 % de headroom** sobre el límite pm2 de 600 MB), **event-loop lag p99 = 11 ms**, **CPU
1.3 %**, **REST ~3 ms**, **calidad OPC 100 % Good**, **0 reconexiones**. Bajo carga (harness Fase 6):
**0 pérdida de sequence** con 60–80 clientes y **p95 de entrega 16–21 ms**. Los **3 críticos** de la
auditoría de preproducción (H1, H4, H26) están **resueltos**. No hay cuellos de botella en operación
actual; las mejoras son de **higiene y de headroom futuro**, no urgencias.

| Zona | Score | Estado |
|---|---:|---|
| D/E/G/H · OPC-obs / Comandos / Salud / Métricas | 94 | 🟢 Óptimo |
| A · Auth / Login | 89 | 🟡 Mejorable |
| C′ · Tiempo real (Socket.IO + pipeline) | 89 | 🟡 Mejorable |
| F · Reportes | 88 | 🟡 Mejorable |
| C · Plantas / Snapshot (REST) | 87 | 🟡 Mejorable |
| B · Usuarios | 85 | 🟡 Mejorable |
| **GLOBAL** | **91** | **🟢 Óptimo** |

Sub-scores: latencia 84 · CPU/lag 92 · RAM 100 · tiempo real 90 · BD 85 · errores 90 · costo 100.

---

## 1. Metodología

**Efficiency Score (pesos adaptados a tiempo real):**
`25 % latencia (REST p95 + OPC source→emit) · 20 % CPU/event-loop lag · 20 % RAM (RSS/headroom) ·
15 % tiempo real (throughput, 0 pérdida de sequence, dead-letter acotado) · 10 % BD · 5 % errores ·
5 % costo (headroom de la VM — no hay $/request: VM interna de costo fijo)`. Bandas 🟢 90-100 · 🟡
70-89 · 🟠 50-69 · 🔴 0-49.

**Fuentes (pasivas):** `GET /metrics` (Prometheus: RSS, event-loop lag, heap, GC, CPU, FDs + 9
métricas OPC) · `GET /api/health/opc` · `pm2 jlist` · MySQL `information_schema`/`COUNT`/`EXPLAIN` ·
`curl -w time_total` en endpoints públicos. Carga/latencia real: harness Fase 6
(`scripts/operational-validation.ts`). Herramienta reutilizable:
[`apps/api/scripts/efficiency-collector.ts`](../../apps/api/scripts/efficiency-collector.ts)
(`npm run -w @ptap/api audit:efficiency` — base para auditoría continua).

---

## 2. KPIs medidos (reales, VM en producción)

### Proceso
| KPI | Valor | Lectura |
|---|---|---|
| RSS | **194 MB** (headroom **68 %** de 600 MB) | 🟢 lejos del `max_memory_restart` |
| Heap usado | 61 MB | 🟢 |
| Event-loop lag p99 | **11 ms** | 🟢 el hilo JS no está saturado |
| CPU | 1.3 % | 🟢 1 vCPU prácticamente ocioso |
| FDs abiertos | 31 | 🟢 sin fuga (H4 resuelto) |
| Reinicios pm2 / uptime | 5 / ~6 h | 🟡 revisar por qué 5 reinicios (deploys o OOM antiguos) |

### Tiempo real / OPC
| KPI | Valor | Lectura |
|---|---|---|
| Calidad OPC Good | **100 %** | 🟢 |
| Reconexiones | 0 | 🟢 puente estable |
| Dead-letter | **96** (todo `mapping_errors`) | 🟠 ver **Hallazgo D1** (no es fuga: ring-buffer acotado a 500) |
| Parser errors | 0 | 🟢 |
| Latencia OPC source→frame p95 | **5000 ms** | ⚠️ **dominada por desfase de reloj PLC↔VM**, no por procesamiento — ver **D2** |
| Latencia REAL de entrega (harness) | **p95 16–21 ms** | 🟢 el pipeline+socket es rapidísimo |
| Throughput (harness, ráfaga) | 2.446 entregas/s, **0 pérdida de sequence** | 🟢 |

### REST (peticiones sueltas, VM)
`/api/health` 3 ms · `/api/health/db` 4 ms · `/api/health/opc` 3 ms. Los `GET /api/plants/*`
responden desde cache RAM (`plants.controller.ts:16-17`, <50 ms por diseño).

### Base de datos
`audit_log` = **492 filas** (diminuta hoy) · `users ORDER BY created_at` → **filesort** (sin índice).
SQL es secundario por diseño (solo auth/auditoría/comandos; la telemetría no toca MySQL).

---

## 3. Estado de los hallazgos críticos previos (verificado en código)

| Prev. | Descripción | Estado hoy | Evidencia |
|---|---|---|---|
| **H1** | `Faulted` terminal sin auto-recuperación | ✅ **RESUELTO** | `bridge-orchestrator.service.ts:36-49` (recupera con `stop()`+retry/backoff) |
| **H4** | Fuga de `OPCUAClient`/sockets/FDs en reintentos | ✅ **RESUELTO** | `opcua-connectivity.adapter.ts:157-165` (`client.disconnect()` en el `catch`); medido: **31 FDs**, estable |
| **H26** | Logging por snapshot (~21.600 líneas/h) | ✅ **RESUELTO** | `structured-events.subscriber.ts:24` ahora `logger.debug` (invisible con `LOG_LEVEL=info`) |
| **H14** | Métrica `UNEXPECTED_LENGTH` nunca se registra | 🟡 **abierto (cosmético)** | tipo definido pero ningún `deadLetter.record('UNEXPECTED_LENGTH')`; `opc_parser_errors_total` subcuenta |

---

## 4. Desperdicios detectados (con recomendación y mejora estimada)

> Ninguno es un cuello de botella HOY (la VM tiene headroom de sobra). Son **higiene** y **headroom
> futuro** conforme crezcan plantas/clientes/tráfico. No se implementaron en esta fase.

### D1 · 96 señales en dead-letter, todas `mapping_errors` (INDEX_OUT_OF_RANGE / BUFFER_MISSING)
El mapping referencia índices/buffers que las tramas reales del PLC no entregan. **No es fuga** (ring
buffer acotado a 500), pero indica **desajuste mapping↔PLC real**. Ligado al pendiente externo del
**export L5X** y a los *fixtures reales* diferidos. **Recomendación:** revisar los índices marcados
con el L5X; hasta entonces, son señales `unmapped` esperadas. *(Correctitud de datos, no rendimiento.)*
Métricas: `opc_mapping_errors_total` en `metrics.service.ts:107`.

### D2 · La métrica `opc_subscription_latency_ms` está inflada por desfase de reloj PLC↔VM
p95 = 5000 ms, pero la latencia REAL de entrega (harness) es ~20 ms. Mide `sourceTimestamp`(reloj del
PLC) → recepción(reloj de la VM); si los relojes difieren, se infla. **Recomendación:** sincronizar
NTP en la VM y/o documentar que este KPI no es de rendimiento del backend. Impacto: fiabilidad del
panel, no CPU.

### D3 (P1) · `loadMapping()` re-lee y re-parsea 80 KB síncrono por request de informes ⭐⭐⭐⭐
`reports.service.ts:231` → `opc-mapping.loader.ts:164` (`readFileSync`+`JSON.parse` sin memoizar; los
demás consumidores sí memoizan). **Mejora:** memoizar / inyectar el `LoadedMapping` del módulo de
conectividad. **Estimado:** −(1–4 ms de bloqueo del event loop) por request de informes; fix trivial.

### D4 (P5) · Diff del snapshot por `JSON.stringify` en el hot path ⭐⭐⭐⭐
`plant-pipeline.service.ts:128` — serializa a JSON en **cada frame y cada barrido de liveness (2 s)**,
solo para comparar. **Mejora:** firma barata (concatenar `domainKey:value:quality:usable`) o comparar
campo a campo. **Estimado:** −CPU constante en el único hilo JS (hoy sobra, importa al escalar).

### D5 (P3) · Un INSERT de auditoría por cada GET de datos (`/api/plants/*`) ⭐⭐⭐
`audit.middleware.ts:7,32` audita también las lecturas → amplificación de escritura proporcional al
tráfico (motor del crecimiento de `audit_log`). **Mejora:** auditar solo escrituras y accesos
**denegados/no-2xx** de `/api/plants/*` (lo que el propio comentario prioriza). **Estimado:** menos
INSERTs y tabla más pequeña; alimenta D6.

### D6 (P2) · Purga diaria de `audit_log` no-sargable (`event_type <> …` + `at`) sin índice compuesto ⭐⭐
`audit-retention.service.ts:49`; índices en `0002_create_audit_log.sql:13-15` (falta `(event_type, at)`).
Hoy trivial (492 filas), crece con el tiempo. **Mejora:** índice `(event_type, at)` o purgar por rango
de `at`. **Estimado:** evita full-scan + locks en la purga cuando la tabla crezca.

### D7 (P6) · `users.list()` ordena por `created_at` sin índice (filesort) + sin paginación por defecto ⭐⭐⭐
`users.repository.ts:208`. **Confirmado filesort** por `EXPLAIN`. **Mejora:** índice `(created_at)` y
`LIMIT/OFFSET` por defecto. **Estimado:** bajo hoy (pocos usuarios), trivial de arreglar.

### D8 (P4) · `SELECT *` de usuario en cada request autenticado ⭐⭐
`jwt-auth.guard.ts:48` → `users.repository.ts:139` (`SELECT *` trae `password_hash`/`pepper_version`
sin necesidad). Lookup por PK, barato. **Mejora:** `SELECT` acotado a `id,email,name,role,plant,is_active`.

### D9 · Código muerto: `finalizeNoReserve()` wrapper inútil ⭐
`write.service.ts:214` (async que solo devuelve su argumento) + **H14** (métrica muerta). Limpieza.

---

## 5. Prioridad

`Prioridad = (Impacto × Frecuencia × Usuarios) / Complejidad`

| Hallazgo | Impacto | Frecuencia | Complejidad | Prioridad |
|---|---|---|---|---|
| D3 (P1) memoizar `loadMapping` | Medio | Media (pantalla reportes) | Baja | ⭐⭐⭐⭐ |
| D4 (P5) diff sin `JSON.stringify` | Medio-bajo | **Alta (cada frame, 24/7)** | Baja | ⭐⭐⭐⭐ |
| D7 (P6) índice + paginación users | Bajo | Baja | Baja | ⭐⭐⭐ |
| D5 (P3) no auditar GET de lectura | Medio | = tráfico REST | Baja-media | ⭐⭐⭐ |
| D1 mapping↔PLC (dead-letter) | Medio (datos) | 24/7 | **Alta (requiere L5X)** | ⭐⭐ |
| D2 NTP / KPI de latencia | Bajo | — | Baja | ⭐⭐ |
| D6 (P2) índice de purga | Bajo (crece) | 1×/día | Baja | ⭐⭐ |
| D8 (P4) `SELECT` acotado | Bajo | Alta | Baja | ⭐⭐ |
| D9 / H14 limpieza | Nulo | — | Baja | ⭐ |

**Lote recomendado (mayor ROI, ~½ día):** D3 + D4 + D7 + D8 (+ D5 con decisión de política de
auditoría). Todos de complejidad baja y sin cambiar contratos.

---

## 6. ROI

La VM **no está limitada por recursos hoy** (RSS 194/600 MB, CPU 1.3 %, lag 11 ms): el ROI **no** es
ahorro de $ cloud (VM interna de costo fijo) sino **headroom** y **mantenibilidad**:

- **D4 (P5)** elimina CPU constante en el **único** hilo JS → compra margen para más plantas/clientes
  sin tocar hardware. **Horas-dev:** ~1 h. **Riesgo:** bajo (hay tests del pipeline).
- **D3 (P1)** quita un `readFileSync`+parse de 80 KB por request de informes → menos contención del
  event loop en los 2 vCPU. **Horas-dev:** ~30 min. **Riesgo:** muy bajo.
- **D5/D6/D7/D8** reducen crecimiento de `audit_log`, filesort y bytes por request → **horas-dev:**
  ~2–3 h (incluye una migración de índices). **Riesgo:** bajo.
- **D1** (mapping↔PLC) tiene alto valor de *correctitud* pero depende del **L5X** (externo) → no
  bloquea; se agenda cuando llegue la documentación de la planta.

**Conclusión:** medio día de trabajo de baja complejidad asegura el headroom para escalar y limpia la
deuda; ninguna acción es urgente para la operación actual.

---

## 7. Auditoría continua

Re-ejecutar el colector para tendencias (imprime tabla por zona + JSON):
```bash
EFF_SSH=ptap npm run -w @ptap/api audit:efficiency          # informe legible
EFF_SSH=ptap npm run -w @ptap/api audit:efficiency -- --json # solo JSON (para histórico/panel)
```
Lee `/metrics`, `/health/opc`, `pm2 jlist` y `EXPLAIN` de forma pasiva (ninguna escritura en la VM).
El token de `/metrics` se lee del `.env` **en la VM** (nunca sale de allí ni aparece en este informe).

---

## 8. Puntos fuertes confirmados (no tocar)

Cache RAM como fuente única + diff antes de emitir por Socket.IO · `compression()` gzip
(`main.ts:21`) · pool MySQL con `queueLimit` · retención de auditoría con dos ventanas · argon2 en el
threadpool de libuv (no bloquea el event loop) + rate-limit en login/register · idempotencia de
comandos por índice UNIQUE · pipeline 100 % síncrono sin colas ni backpressure · timers con `unref()`
· H1/H4/H26 resueltos.
