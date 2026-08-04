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

## §4 · Soak test (24–72 h) — 🟡 EN CURSO desde 2026-08-03

Automatizado en [`scripts/soak-test.ts`](../apps/api/scripts/soak-test.ts). Arma el pipeline real en
memoria (`SimulatorBridgeAdapter → PlantPipelineService → PlantCache`), inyecta caos rotando tres
escenarios y muestrea a JSONL para poder graficar después. **No toca producción, no usa MySQL, no
abre puertos y no necesita sudo**: proceso aislado, matable en cualquier momento.

```bash
SOAK_HOURS=24 node --import tsx scripts/soak-test.ts
# ensayo corto para validar el arnés antes de comprometer 24 h:
SOAK_HOURS=0.03 SAMPLE_MS=20000 CHAOS_MS=18000 node --import tsx scripts/soak-test.ts
```

**Corrida en marcha (VM `192.168.30.50`):** lanzada el **2026-08-03 12:44 -05**, 24 h, muestreo cada
60 s, caos cada 30 min, `publishingInterval` 2000 ms (cadencia real de PTAP), 12 plantas.
Salida: `~/soak-20260803-124408.jsonl` · log: `~/soak.log`.

Caos rotativo, un escenario por ciclo:

| # | Acción | Qué prueba |
|---|---|---|
| 1 | `freeze()` | Notificaciones congeladas → watchdog → `Stale` → reciclaje automático |
| 2 | `faultBuffer()` | Degradación **aislada** de un buffer; el resto debe seguir operando |
| 3 | `stop()` + `start()` | Ciclo completo de caída y recuperación del adaptador |

Cada muestra registra `rss`, `heapUsed`, `external`, `activeHandles`, `activeRequests`, `snapshots`,
`deadLetter`, `reconnects` y `bridgeStatus`. Al terminar, el script emite un **veredicto automático**
contra los criterios de abajo.

**Criterio de aceptación §4:** RSS estable (< 10 % de variación), dead-letter acotado, sin fuga de
handles, y toda recuperación automática (salvo `Faulted`, que alerta).

**Ensayo previo (2.4 min, cadencia acelerada) — ✅ el arnés funciona:** RSS 74.66 → 75.72 MB
(**1.42 %**), handles 2 → 2, dead letter acotado en 107, los 3 escenarios de caos rotando. Producción
verificada intacta durante la corrida (`ptap-api` online, los tres `/api/health*` en 200).

> **Pendiente de esta sección:** `kill -9` + arranque en frío del backend completo, para medir el
> tiempo hasta `Connected` y hasta el primer snapshot. El soak cubre la estabilidad continua; ese
> escenario es de recuperación de proceso y se mide aparte.

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
| §4 Soak 24–72 h | 🟡 **EN CURSO** — automatizado y lanzado el 2026-08-03, veredicto el 2026-08-04 |
| §5 Replay contra tramas reales del PLC | ✅ **175 tramas, 12 plantas, 6 tests en verde** |

\* El PLC real expone **12** sitios (no 13): las 12 plantas del mapping se ejercitan en cada corrida.

## §5 · Replay contra tramas REALES del PLC — ✅ SALDADO 2026-08-03

Era la deuda declarada de la Fase 2. **Por qué importaba:** el resto de los tests corren contra el
simulador, y el simulador lo escribimos nosotros a partir de lo que *creemos* que hace el PLC. Un
test contra él confirma nuestra idea, no la realidad.

- **Captura:** [`scripts/capture-plc-fixture.ts`](../apps/api/scripts/capture-plc-fixture.ts) — graba
  los `RawPlantFrame` que emite el adaptador real, la misma estructura que consume el pipeline, así
  el fixture se inyecta sin intermediarios que enmascaren diferencias. **Solo lectura.**
- **Fixture:** `test/fixtures/plc-frames-2026-08-03.json` — **175 tramas**, las 12 plantas,
  capturadas contra `opc.tcp://10.10.51.225:59100` en una ventana de 45 s. Incluye procedencia
  (endpoint, fecha, protocolVersion) porque un fixture sin ella es imposible de interpretar después.
- **Replay:** [`test/plc-replay.test.ts`](../apps/api/test/plc-replay.test.ts), 6 tests, todos en
  verde: el pipeline procesa las 175 tramas sin lanzar; ninguna señal `usable` esconde un valor no
  finito ni un `null`; `sequence` es monotónico por planta; toda señal declara `confidence` y
  `mappingStatus` (regla 10); y **ningún buffer cambia de longitud entre tramas** — si el PLC
  redimensionara un array, el parser leería índices inexistentes y esto lo detecta.

```bash
npm run test:replay -w @ptap/api
CAPTURE_SECONDS=90 npm exec -w @ptap/api -- tsx scripts/capture-plc-fixture.ts   # recapturar
```

### 🔍 Hallazgo de la captura: 4 plantas con el dato quieto

En 45 s, con `quality: Good` y NodeIds resueltos en las 12:

| Tramas emitidas | Plantas |
|---|---|
| 19–22 | montebello · campoalegre · voragine · soledad · alto-los-mangos · sirena · san-antonio · quijote |
| **1** | **cascajal · km18 · pichinde · carbonero** |

El adaptador solo emite cuando el buffer **cambia**. Una sola trama = la lectura inicial y nada se
movió después. No es un fallo de conectividad (los NodeIds resuelven y la calidad es `Good`): es que
el dato de esos cuatro sitios está **congelado o en régimen absolutamente quieto**.

> **Consecuencia directa para las válvulas:** el interlock exige `liveness === 'live'`, es decir, ver
> el dato *moverse*. En esas cuatro plantas un comando sería rechazado con
> `409 INTERLOCK_FAILED: snapshot stable/frozen` **antes de escribir nada**. Conviene averiguar con
> la planta si esos PLC están operando, antes de dar por hecho que el mando remoto funcionará ahí.
