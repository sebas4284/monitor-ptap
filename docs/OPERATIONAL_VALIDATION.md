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

# §4 Veredicto del soak a partir de su JSONL (post-mortem, sin re-correr las 24 h)
npm run validate:soak-report -- ~/soak-20260803-124408.jsonl --markdown

# §6 kill -9 + arranque en frío (mide contra el build compilado, como producción)
npm run build && npm run validate:coldstart

# Criterio de la Fase 2 medido sobre HTTP real (REST < 50 ms desde cache, 0 lecturas OPC)
npm run test:pipeline
```

Artefactos: [`test/operational-resilience.test.ts`](../apps/api/test/operational-resilience.test.ts),
[`scripts/operational-validation.ts`](../apps/api/scripts/operational-validation.ts),
[`scripts/soak-test.ts`](../apps/api/scripts/soak-test.ts),
[`scripts/soak-report.ts`](../apps/api/scripts/soak-report.ts),
[`scripts/cold-start.ts`](../apps/api/scripts/cold-start.ts) y
[`test/rest-cache-latency.test.ts`](../apps/api/test/rest-cache-latency.test.ts).

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

## §4 · Soak test (24–72 h) — ✅ SALDADO (corrida del 2026-08-03, veredicto leído el 2026-08-25)

Automatizado en [`scripts/soak-test.ts`](../apps/api/scripts/soak-test.ts). Arma el pipeline real en
memoria (`SimulatorBridgeAdapter → PlantPipelineService → PlantCache`), inyecta caos rotando tres
escenarios y muestrea a JSONL para poder graficar después. **No toca producción, no usa MySQL, no
abre puertos y no necesita sudo**: proceso aislado, matable en cualquier momento.

```bash
SOAK_HOURS=24 node --import tsx scripts/soak-test.ts
# ensayo corto para validar el arnés antes de comprometer 24 h:
SOAK_HOURS=0.03 SAMPLE_MS=20000 CHAOS_MS=18000 node --import tsx scripts/soak-test.ts
```

**Corrida del 2026-08-03 (VM `192.168.30.50`) — ✅ VÁLIDA Y COMPLETA.** Lanzada el 2026-08-03
12:44 -05 para 24 h (muestreo cada 60 s, caos cada 30 min, `publishingInterval` 2000 ms, 12 plantas;
salida `~/soak-20260803-124408.jsonl`). Corrió **las 24 horas enteras** y cerró con su línea de
veredicto: 1441 muestras, 48 ciclos de caos, 32 578 snapshots, 0 reconexiones, sin cortes.

| Criterio | Medido | |
|---|---|---|
| Duración | 24 h de 24 h | ✅ |
| Crecimiento del RSS | **0 %** (línea base 106,2 MB → último cuarto 106,2 MB) | ✅ |
| Fuga de handles | 0 → 0 | ✅ |
| Dead letter | 107, y **dejó de crecer** en las últimas 12 h | ✅ acotado |
| Estados del puente | `Connected` ×1425, `Disconnected` ×16, **`Faulted` ×0** | ✅ |

La memoria estuvo **plana en 106,2 MB durante 18 horas seguidas**: media de 106,1 MB en las primeras
6 h (con un valle de arranque a 96,4) y 106,2 MB exactos en cada uno de los tres cuartos siguientes.

> **Corrección de una entrada anterior de este mismo documento.** Entre el 2026-08-04 y el
> 2026-08-25 esta sección afirmó primero "🟡 EN CURSO, veredicto el 2026-08-04" y después
> "❌ NO VÁLIDA: murió a los pocos segundos". **Las dos eran falsas.** La corrida había terminado
> bien el 2026-08-04 y su veredicto estaba en el JSONL todo el tiempo; nadie lo abrió. El fallo del
> arnés que sí existe (el de los 3 argumentos, más abajo) se introdujo DESPUÉS de esta corrida, así
> que rompía las siguientes, no esta. Diagnosticar por el código actual una corrida vieja llevó a
> declarar inválidos datos perfectamente buenos y a pedir repetir 24 horas para nada.

Caos rotativo, un escenario por ciclo:

| # | Acción | Qué prueba |
|---|---|---|
| 1 | `freeze()` | Notificaciones congeladas → watchdog → `Stale` → reciclaje automático |
| 2 | `faultBuffer()` | Degradación **aislada** de un buffer; el resto debe seguir operando |
| 3 | `stop()` + `start()` | Ciclo completo de caída y recuperación del adaptador |

Cada muestra registra `rss`, `heapUsed`, `external`, `activeHandles`, `activeRequests`, `snapshots`,
`deadLetter`, `reconnects` y `bridgeStatus`. Al terminar, el script emite un **veredicto automático**
contra los criterios de abajo.

**Criterio de aceptación §4:** RSS estable, dead-letter acotado, sin fuga de handles, y toda
recuperación automática (salvo `Faulted`, que alerta).

> **El criterio de RSS cambió el 2026-08-25, y es la razón por la que esta corrida parecía fallar.**
> Antes medía DISPERSIÓN —`(max − min) / min < 10 %`— y con estos datos daba **10,95 % → ❌**, pese a
> que la memoria estuvo plana 18 horas: los 10 puntos salían del valle de arranque a 96,4 MB. Un
> criterio de fuga tiene que medir **crecimiento**, no dispersión; tal como estaba, penalizaba que
> el recolector de basura hiciera su trabajo. Ahora se compara la media del ÚLTIMO cuarto contra la
> del segundo (el primero se salta porque incluye el arranque) y se exige **< 2 %**. Un rojo falso
> hace tanto daño como un verde falso: cuesta relanzar 24 h, o salir a buscar una fuga que no está.
>
> `soak-report.ts` detecta los veredictos de formato antiguo (los que no traen `crecimientoPct`) y
> **recalcula ese criterio desde las muestras**, que es lo que permitió cerrar esta sección sin
> repetir la corrida.

**Ensayo previo (2.4 min, cadencia acelerada):** RSS 74.66 → 75.72 MB (**1.42 %**), handles 2 → 2,
dead letter acotado en 107, los 3 escenarios de caos rotando. Producción verificada intacta durante
la corrida (`ptap-api` online, los tres `/api/health*` en 200). **OJO:** este ensayo es ANTERIOR al
cambio de firma que rompió el arnés, así que su verde no dice nada del estado posterior — es
precisamente lo que hizo creer durante tres semanas que la corrida de 24 h estaba midiendo algo.

### 2026-08-25 · El fallo del arnés que sí existe (y que NO afectó a esta corrida)

Al retomar la sección se encontró un fallo real del arnés, que rompía cualquier corrida
posterior al 2026-08-03 (no esta): **`soak-test.ts`
construía `PlantPipelineService` con 3 argumentos cuando el pipeline ya pedía 4**
(`TankAutonomyStore`, añadido después de escribir el script). El barrido de liveness moría en el
primer tick con `Cannot read properties of undefined (reading 'get')`, es decir **a los ~2 segundos
de arrancar**. Se detectó al intentar relanzar el soak, y de ahí salió la conclusión equivocada de
que la corrida del 3-ago también había muerto así.

Corregido en esta fecha, junto con dos cosas que lo habrían delatado el mismo día:

- **`uncaughtException` / `unhandledRejection` se anotan en el JSONL** (`{"tipo":"fatal",...}`) y
  cierran el informe con lo medido. Un soak que se cae es un resultado válido; un soak que se cae
  sin dejar dicho por qué no lo es.
- **El veredicto ahora comprueba la duración (`>= 24 h`)**. Antes un ensayo de dos minutos imprimía
  `✅ CUMPLE` con las mismas letras que una corrida real, y ese verde es el que acaba copiado aquí
  como si valiera.
- **[`scripts/soak-report.ts`](../apps/api/scripts/soak-report.ts)** reconstruye el veredicto desde
  un JSONL ya existente, **incluso truncado** (recalcula con los mismos criterios y lo dice). Era el
  agujero de proceso de fondo: el veredicto solo existía por stdout, así que si la sesión que lanzó
  el soak se cerraba, los datos quedaban en disco sin forma de cerrar la sección.

**Estado:** el arnés vuelve a sobrevivir al régimen (ensayo de 1 min tras la corrección: 14 muestras,
5 ciclos de caos, handles 2 → 2, dead letter acotado en 110, sin excepciones). **La corrida de 24 h
hay que relanzarla**: la del 2026-08-03 no midió nada utilizable y esta sección sigue sin poder
cerrarse hasta que haya 24 h reales de reloj.

```bash
# En la VM, dentro de apps/api (no toca producción: proceso aparte, sin MySQL ni puertos)
SOAK_HOURS=24 nohup node --import tsx scripts/soak-test.ts > ~/soak.log 2>&1 &
# Al terminar (o si se corta), el veredicto:
npm run validate:soak-report -- ~/soak-<inicio>.jsonl --markdown
```

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
| §4 Soak 24–72 h | ✅ **24 h completas** — crecimiento de RSS **0 %**, 0 fugas de handles, dead letter acotado, 48 ciclos de caos, 0 `Faulted` |
| §5 Replay contra tramas reales del PLC | ✅ **175 tramas, 12 plantas, 6 tests en verde** |
| §6 Recuperación de proceso (`kill -9` + arranque en frío) | ✅ **Connected en ~3 s, primer snapshot en ~5 s, 0 intervención manual** |

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

---

## §6 · Recuperación de proceso (`kill -9` + arranque en frío) — ✅ SALDADO 2026-08-25

Último escenario del PROMPT MAESTRO que quedaba sin medir. Automatizado en
[`scripts/cold-start.ts`](../apps/api/scripts/cold-start.ts): levanta el gateway como proceso hijo en
un puerto efímero, cronometra el arranque, lo mata con **SIGKILL** y repite.

**Por qué SIGKILL y no SIGTERM:** un `SIGTERM` ejecuta `enableShutdownHooks()` y cierra la sesión OPC
con educación — es el camino feliz. Lo que hay que demostrar es que un corte brutal (OOM killer,
caída de la VM, `pm2 kill`) no deja nada que arreglar a mano.

**Por qué contra `dist/`:** producción corre `node dist/main.js`. Medido con `tsx` sobre `src/`, el
mismo arranque daba **13 s** en vez de 7 s — se estaría cronometrando transpilar TypeScript, algo que
producción no hace nunca. El script usa el build compilado cuando existe y avisa en voz alta cuando
no. Se aísla en `main.telemetry.ts` (puente + pipeline + REST, **sin MySQL**) con
`CONNECTIVITY_PROVIDER=simulator`: mide arrancar el gateway, no arrancar MySQL ni el RTT al PLC.

Corrida del **2026-08-25** (Node 24, Windows dev, `publishingInterval` 2000 ms, cadencia real):

| Ciclo | Modo | HTTP responde | `Connected` | Primer snapshot | `sequence` |
|---|---|---|---|---|---|
| 0 | arranque limpio | 7.013 s | 7.018 s | 8.985 s | — |
| 1 | **`kill -9`** | 2.813 s | 2.824 s | 4.813 s | 3 → 1, hueco detectable ✓ |
| 2 | **`kill -9`** | 3.351 s | 3.366 s | 5.317 s | 3 → 1, hueco detectable ✓ |

El arranque limpio cuesta el doble que los posteriores: paga la caché de página del SO en frío. Los
~2,8–3,4 s de los ciclos de `kill -9` son el número representativo de un reinicio en la VM, que es
lo que se quería saber. El primer snapshot llega siempre ≈ `Connected` + un `publishingInterval`:
el puente no espera nada de más, la cadencia manda.

**La afirmación del plan sobre el frontend, medida en vez de supuesta:** *"el frontend se recupera
solo vía sequence + refresh REST"*. La cache vive en RAM y muere con el proceso (regla 1), así que
tras el reinicio el `sequence` **retrocede** (3 → 1) en lugar de continuar. Esa discontinuidad es
exactamente el hueco que el cliente detecta para pedir refresh — el backend no tiene que avisar de
nada. Verificado en 2/2 ciclos.

**Veredicto §6:** recuperación automática en todos los ciclos, sin intervención manual (el proceso
vuelve con el mismo comando; en la VM lo relanza `pm2`), `Connected` y primer snapshot dentro de
presupuesto (15 s / 20 s), hueco de `sequence` detectable por el cliente en todos los ciclos.
