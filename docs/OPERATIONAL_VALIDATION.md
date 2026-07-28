# Validación Operacional (Fase 6) — Gateway OPC UA Monitor PTAP

> Fase 6 del PROMPT MAESTRO. **No agrega features**: valida que el puente OPC UA sobrevive a la
> operación real (caos de conectividad, carga, latencia, soak) **sin intervención manual**.
> Los escenarios destructivos se ejecutan contra el **simulador** (`CONNECTIVITY_PROVIDER=simulator`),
> que emula TODOS los estados del bridge; el PLC real solo para pruebas no invasivas.

**Última ejecución:** 2026-07-28 · Node 22 · Windows (dev). El pipeline manejado es el REAL
(`SimulatorBridgeAdapter` → `PlantPipelineService` → `PlantCache` → Socket.IO); solo se acortan los
temporizadores. Reproducible con los comandos de cada sección.

---

## Cómo reproducir

```bash
cd apps/api

# §1 Caos de conectividad (suite automatizada, ~5 s)
npm run test:operational

# §2–§3 Carga + latencia extremo a extremo (harness con Socket.IO real)
#   Nominal (cadencia de PTAP):
CLIENTS=60 DURATION_MS=15000 PUBLISHING_MS=100 npm run validate:operational
#   Ráfaga / alta carga:
CLIENTS=80 DURATION_MS=10000 PUBLISHING_MS=20  npm run validate:operational
```

Artefactos: [`test/operational-resilience.test.ts`](../apps/api/test/operational-resilience.test.ts) y
[`scripts/operational-validation.ts`](../apps/api/scripts/operational-validation.ts).

---

## §1 · Caos de conectividad — ✅ 6/6

Suite `test/operational-resilience.test.ts`. Cada escenario maneja el pipeline real y usa las
perillas de emulación del simulador (`freeze`, `faultBuffer`, `setRecycleOutcome`, `setHeartbeatOutcome`).

| Escenario | Qué prueba | Resultado | Evidencia |
|---|---|---|---|
| **Arranque en frío** | `start()` → `Connected` + primer snapshot | ✅ primer snapshot **~78 ms** | transición `Connecting→Connected`, snapshot emitido |
| **Notificaciones congeladas** | Subscription muerta → watchdog → reciclaje | ✅ `Connected→Stale→Connected` **automático (~234 ms)**, snapshots reanudan sin reiniciar | log `watchdog: sin notificaciones en 120ms` → `subscription reciclada` |
| **Buffer/NodeId caído** | Un buffer faulted degrada SOLO ese buffer | ✅ puente sigue `Connected`, `buffersFaulted≥1`, las demás plantas siguen fluyendo | `getBufferHealth()` marca solo el objetivo |
| **Fallo irrecuperable** | Reciclaje falla repetidas veces | ✅ termina en **`Faulted`** (terminal), transición registrada con motivo → **alertable** | `Stale→Faulted (reciclaje de sesión falló)` |
| **Heartbeat en fallo** | N fallos consecutivos de heartbeat | ✅ `Connected→Recovering→Connected`, `reconnectCount` sube (recicla sesión sin reiniciar) | `heartbeat: 2 fallos consecutivos` → `sesión reciclada` |
| **Integridad de sequence** | Operación normal prolongada | ✅ `sequence` **estrictamente +1 por planta, 0 huecos** | 60+ snapshots por planta verificados |

**Conclusión §1:** ningún escenario de caos requiere intervención manual para recuperarse, salvo el
diseñado para terminar en `Faulted` (que **debe** alertar y lo hace mediante la transición registrada).

---

## §2 · Carga  &  §3 · Latencia extremo a extremo — ✅ CUMPLE

Harness `scripts/operational-validation.ts`: pipeline real expuesto por un **servidor Socket.IO real**
en puerto efímero + **N clientes `socket.io-client` reales** repartidos round-robin por las 12 plantas.
La latencia mide **frame del PLC (simulado) llega al backend → parser → mapping → quality → snapshot
builder → Socket.IO → cliente** (excluye la espera del `publishingInterval`, que es la cadencia de push
determinista, no latencia de proceso).

**Presupuesto objetivo (spec):** `p95 < 1 publishingInterval + 500 ms`.

| Corrida | Clientes | Cadencia | Entregas | Throughput | Huecos | Regresiones | Latencia p50 / p95 / p99 / max | Event-loop lag p95 / max | Presupuesto |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| **Nominal** | 60 | 100 ms | 7.740 | 516/s | **0** | **0** | 9.5 / **20.6** / 24.5 / 28.2 ms | 24.2 / 34.0 ms | **✅** (< 600 ms) |
| **Ráfaga** | 80 | 20 ms | 24.480 | **2.447/s** | **0** | **0** | 6.2 / **16.2** / 19.1 / 24.8 ms | 16.7 / 37.2 ms | **✅** (< 520 ms) |

**Conclusión §2/§3:**
- **Sin pérdida de `sequence`** (0 huecos, 0 regresiones) ni con 60 ni con 80 clientes concurrentes.
- **Latencia p95 ≈ 16–21 ms**, muy por debajo del presupuesto en ambos regímenes.
- El **event loop no se bloquea** bajo la ráfaga (todos los buffers cambiando a >2.400 entregas/s):
  lag máximo ~37 ms, sin degradación de latencia.

---

## §4 · Soak test (24–72 h) — ⏳ PROCEDIMIENTO (pendiente de correr fuera de sesión)

No es ejecutable dentro de una sesión de trabajo (24–72 h). Procedimiento para correrlo en la VM o en
un entorno de staging:

1. **Arrancar** el backend con el simulador y caos periódico:
   ```bash
   CONNECTIVITY_PROVIDER=simulator pm2 start apps/api/dist/main.js --name ptap-soak
   ```
2. **Inyectar caos programado** cada ~30 min (cron o script): alternar `freeze`/recuperación y
   `faultBuffer` vía un endpoint admin de prueba o reiniciando el proveedor simulado.
3. **Vigilar 24–72 h** con Prometheus/`/metrics` + `/health/opc`:
   - `process_resident_memory_bytes` (RSS) → **variación < 10 %** (sin crecimiento monotónico = sin fugas).
   - `opc_dead_letter_total` → **acotado** (ring buffer, no crece sin límite).
   - Handles/listeners: `nodejs_active_handles` estable (sin fuga de sockets/listeners).
   - `opc_reconnects_total` coherente con el caos inyectado.
4. **Recuperación de proceso** (`kill -9` + arranque en frío): medir tiempo hasta `Connected` y hasta el
   primer snapshot; el front se re-sincroniza solo vía `sequence` + refresh REST (ya validado en §1 y en
   el front, `useSnapshot.ts`).

**Criterio de aceptación §4:** RSS estable (< 10 % de variación), dead-letter acotado, sin fuga de
handles, y toda recuperación automática (salvo `Faulted`, que alerta).

> **Observabilidad ya disponible para el soak:** las 9 métricas Prometheus del gateway
> (`opc_notifications_total`, `opc_reconnects_total`, `opc_subscription_latency_ms`,
> `opc_quality_good/bad_total`, `opc_parser_errors_total`, `opc_mapping_errors_total`,
> `opc_dead_letter_total`, `opc_bridge_status`) + `/health/opc` (503 si el puente no está `Connected`).

---

## Resumen

| Sección | Estado |
|---|---|
| §1 Caos de conectividad | ✅ **6/6 automatizado** |
| §2 Carga (13*/≥50 clientes, ráfaga sin bloquear event loop) | ✅ **60 y 80 clientes, 0 pérdida de sequence** |
| §3 Latencia p50/p95/p99 dentro de presupuesto | ✅ **p95 ≈ 16–21 ms « 520–600 ms** |
| §4 Soak 24–72 h | ⏳ **Procedimiento documentado** (correr fuera de sesión) |

\* El PLC real expone **12** sitios (no 13): las 12 plantas del mapping se ejercitan en cada corrida.

**Pendiente a futuro (acordado):** fixtures de tramas del PLC **real** grabadas como replay de test —
hoy los tests usan el simulador; los datos reales existen pero requieren ajustes antes de fijarse.
