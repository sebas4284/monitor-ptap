/**
 * FASE 6 §5 — RECUPERACIÓN DE PROCESO: `kill -9` del backend y arranque en frío.
 *
 * Era el último escenario del PROMPT MAESTRO sin medir. El soak (§4) cubre la estabilidad
 * CONTINUA; esto cubre lo contrario: que el proceso muera de la peor forma posible (SIGKILL:
 * sin handlers, sin shutdown hooks, sin cierre de sesión OPC) y vuelva solo, midiendo:
 *
 *   - t hasta que el HTTP contesta        (proceso arriba)
 *   - t hasta BridgeStatus = Connected    (puente vivo)
 *   - t hasta el PRIMER snapshot          (dato de dominio disponible al frontend)
 *
 * Por qué SIGKILL y no SIGTERM: un SIGTERM ejecuta `enableShutdownHooks()` y cierra la sesión
 * OPC con educación — es el camino feliz. Lo que hay que demostrar es que un corte brutal
 * (OOM killer, caída de la VM, `pm2 kill`) no deja nada que arreglar a mano.
 *
 * Además comprueba la afirmación del plan sobre el frontend: "se recupera solo vía sequence +
 * refresh REST". Tras el reinicio el `sequence` NO continúa donde iba (la cache vive en RAM y
 * muere con el proceso, regla 1), así que RETROCEDE. Eso es exactamente el hueco que el cliente
 * detecta para pedir un refresh; el script lo mide en vez de darlo por supuesto.
 *
 * Aísla el arranque en `main.telemetry.ts` (puente + pipeline + REST, SIN MySQL) y
 * `CONNECTIVITY_PROVIDER=simulator`: mide el coste de arrancar el gateway, no el de MySQL ni
 * el RTT hasta el PLC de la planta. No toca producción, no usa la BD y usa un puerto efímero.
 *
 * Arranca el BUILD COMPILADO (`dist/main.telemetry.js`) cuando existe, porque es lo que corre en
 * la VM (`npm start` = `node dist/main.js`). Medirlo con `tsx` infla el numero varios segundos:
 * lo que se estaria cronometrando es transpilar TypeScript en cada arranque, algo que produccion
 * no hace nunca. Sin `dist/` cae a `tsx` y lo dice en voz alta.
 *
 * Ejecutar:
 *   npm run build && node --import tsx scripts/cold-start.ts
 *   CICLOS=3 node --import tsx scripts/cold-start.ts        # 1 arranque limpio + 3 kill -9
 *   MODO=tsx  node --import tsx scripts/cold-start.ts       # forzar el arranque sin compilar
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CICLOS = Number(process.env.CICLOS ?? 2);
const TIMEOUT_MS = Number(process.env.ARRANQUE_TIMEOUT_MS ?? 60_000);
const OUT = process.env.COLD_START_OUT ?? '';
/** Cuantos snapshots debe acumular la planta antes del SIGKILL, para que el hueco de sequence
 *  se vea de verdad (matar en sequence=1 y volver en 1 no demuestra discontinuidad). */
const SEQUENCE_MINIMA = Number(process.env.SEQUENCE_MINIMA ?? 3);

/** Presupuestos (env-ajustables): un arranque en frío del gateway no debería pasar de esto. */
const PRESUPUESTO_CONNECTED_MS = Number(process.env.PRESUPUESTO_CONNECTED_MS ?? 15_000);
const PRESUPUESTO_SNAPSHOT_MS = Number(process.env.PRESUPUESTO_SNAPSHOT_MS ?? 20_000);

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Puerto libre pedido al SO: no colisiona con el backend de desarrollo ni con producción. */
function puertoLibre(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const dir = srv.address();
      if (typeof dir === 'object' && dir) {
        const p = dir.port;
        srv.close(() => res(p));
      } else {
        srv.close(() => rej(new Error('no se pudo obtener un puerto libre')));
      }
    });
  });
}

interface Medicion {
  ciclo: number;
  modo: 'arranque-limpio' | 'kill-9';
  httpMs: number | null;
  connectedMs: number | null;
  primerSnapshotMs: number | null;
  sequenceAlMorir: number | null;
  sequenceTrasReinicio: number | null;
  huecoDetectable: boolean | null;
}

interface EstadoPlantas {
  plants: { plantId: string; bridgeStatus: string; liveness: string }[];
}

async function pedir<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // proceso aún no escucha (o ya murió): es información, no un error
  }
}

/** Espera activa hasta que `intento()` devuelva algo no-null. Devuelve los ms transcurridos. */
async function esperar<T>(t0: number, intento: () => Promise<T | null>): Promise<{ ms: number; valor: T } | null> {
  while (Date.now() - t0 < TIMEOUT_MS) {
    const valor = await intento();
    if (valor !== null) return { ms: Date.now() - t0, valor };
    await delay(25);
  }
  return null;
}

const DIST = resolve(__dirname, '..', 'dist', 'main.telemetry.js');
const FUENTE = resolve(__dirname, '..', 'src', 'main.telemetry.ts');
const MODO = (process.env.MODO ?? (existsSync(DIST) ? 'dist' : 'tsx')) as 'dist' | 'tsx';

function argumentos(): string[] {
  return MODO === 'dist' ? [DIST] : ['--import', 'tsx', FUENTE];
}

function arrancar(port: number): ChildProcess {
  const hijo = spawn(
    process.execPath,
    argumentos(),
    {
      cwd: resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        CONNECTIVITY_PROVIDER: 'simulator',
        // Cadencia real de PTAP para que el tiempo hasta el primer snapshot sea el de producción,
        // no uno acelerado que haría el número bonito y mentiroso.
        OPCUA_PUBLISHING_INTERVAL_MS: process.env.OPCUA_PUBLISHING_INTERVAL_MS ?? '2000',
        OPCUA_COALESCE_WINDOW_MS: process.env.OPCUA_COALESCE_WINDOW_MS ?? '2000',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // El log del hijo se traga a propósito salvo error: lo que interesa son los tiempos. Un fallo
  // de arranque sí se muestra, o el script parecería colgado sin explicar por qué.
  hijo.stderr?.on('data', (b: Buffer) => {
    const txt = b.toString();
    if (/Error|error:|throw/i.test(txt)) process.stderr.write(`  [hijo] ${txt}`);
  });
  return hijo;
}

/** Mata el proceso con SIGKILL y espera a que el SO lo dé por muerto de verdad. */
async function matar(hijo: ChildProcess): Promise<void> {
  if (hijo.exitCode !== null || hijo.signalCode !== null) return;
  const muerto = new Promise<void>((res) => hijo.once('exit', () => res()));
  hijo.kill('SIGKILL');
  await muerto;
}

async function medirArranque(
  port: number,
  ciclo: number,
  modo: Medicion['modo'],
): Promise<{ hijo: ChildProcess; medicion: Medicion; plantId: string | null }> {
  const t0 = Date.now();
  const hijo = arrancar(port);
  const base = `http://127.0.0.1:${port}/api`;

  const http = await esperar<EstadoPlantas>(t0, () => pedir<EstadoPlantas>(`${base}/plants`));
  const connected = http
    ? await esperar<EstadoPlantas>(t0, async () => {
        const p = await pedir<EstadoPlantas>(`${base}/plants`);
        return p && p.plants.some((x) => x.bridgeStatus === 'Connected') ? p : null;
      })
    : null;

  const plantId = connected?.valor.plants[0]?.plantId ?? http?.valor.plants[0]?.plantId ?? null;
  const snap = plantId
    ? await esperar<{ sequence: number }>(t0, async () => {
        const s = await pedir<{ sequence: number; pending?: boolean }>(`${base}/plants/${plantId}/snapshot`);
        return s && s.pending !== true && s.sequence > 0 ? s : null;
      })
    : null;

  return {
    hijo,
    plantId,
    medicion: {
      ciclo,
      modo,
      httpMs: http?.ms ?? null,
      connectedMs: connected?.ms ?? null,
      primerSnapshotMs: snap?.ms ?? null,
      sequenceAlMorir: null,
      sequenceTrasReinicio: snap?.valor.sequence ?? null,
      huecoDetectable: null,
    },
  };
}

async function main(): Promise<void> {
  const port = await puertoLibre();
  console.log(`\n=== FASE 6 §5 · kill -9 + arranque en frío ===`);
  console.log(`  puerto efímero  ${port}`);
  console.log(`  ciclos kill -9  ${CICLOS}`);
  console.log(`  provider        simulator (sin MySQL, sin PLC real)`);
  console.log(
    MODO === 'dist'
      ? `  arranque        dist/main.telemetry.js (build compilado, igual que produccion)\n`
      : `  arranque        tsx sobre src/ - INCLUYE el coste de transpilar, NO comparable con produccion (compila con npm run build)\n`,
  );

  const mediciones: Medicion[] = [];
  let vivo: ChildProcess | null = null;
  let plantId: string | null = null;

  try {
    // ── Arranque limpio (línea base) ────────────────────────────────────────────────────
    {
      const r = await medirArranque(port, 0, 'arranque-limpio');
      vivo = r.hijo;
      plantId = r.plantId;
      mediciones.push(r.medicion);
      console.log(
        `  [0] arranque limpio  http ${r.medicion.httpMs} ms · Connected ${r.medicion.connectedMs} ms · 1.º snapshot ${r.medicion.primerSnapshotMs} ms`,
      );
    }

    // ── N ciclos de kill -9 + arranque en frío ──────────────────────────────────────────
    for (let i = 1; i <= CICLOS; i++) {
      // Sequence justo antes del SIGKILL: es lo que el frontend tenía en la mano.
      // Dejar que la planta acumule algunos snapshots antes de matarla: asi el sequence previo
      // es claramente mayor que el que traera el proceso nuevo y el hueco es inequivoco.
      const antes = plantId
        ? (
            await esperar<{ sequence: number }>(Date.now(), async () => {
              const s = await pedir<{ sequence: number }>(
                `http://127.0.0.1:${port}/api/plants/${plantId}/snapshot`,
              );
              return s && s.sequence >= SEQUENCE_MINIMA ? s : null;
            })
          )?.valor ?? null
        : null;

      if (vivo) await matar(vivo);
      vivo = null;

      // Confirmar que MURIÓ: si el puerto sigue contestando, no se está midiendo un
      // arranque en frío sino una petición al proceso viejo.
      const muerto = await esperar(Date.now(), async () => {
        const p = await pedir<EstadoPlantas>(`http://127.0.0.1:${port}/api/plants`);
        return p === null ? true : null;
      });
      if (!muerto) throw new Error('el puerto sigue contestando tras SIGKILL: el proceso no murió');

      const r = await medirArranque(port, i, 'kill-9');
      vivo = r.hijo;
      plantId = r.plantId ?? plantId;
      r.medicion.sequenceAlMorir = antes?.sequence ?? null;
      // El hueco de sequence es lo que dispara el refresh REST en el cliente. Tras un
      // reinicio la cache RAM está vacía, así que el sequence retrocede: discontinuidad
      // detectable sin que el backend tenga que avisar de nada.
      r.medicion.huecoDetectable =
        r.medicion.sequenceAlMorir !== null && r.medicion.sequenceTrasReinicio !== null
          ? r.medicion.sequenceTrasReinicio !== r.medicion.sequenceAlMorir + 1
          : null;
      mediciones.push(r.medicion);
      console.log(
        `  [${i}] kill -9         http ${r.medicion.httpMs} ms · Connected ${r.medicion.connectedMs} ms · 1.º snapshot ${r.medicion.primerSnapshotMs} ms` +
          `  (sequence ${r.medicion.sequenceAlMorir} → ${r.medicion.sequenceTrasReinicio}${r.medicion.huecoDetectable ? ', hueco detectable ✓' : ''})`,
      );
    }
  } finally {
    if (vivo) await matar(vivo);
  }

  // ── Veredicto ───────────────────────────────────────────────────────────────────────
  const tras = mediciones.filter((m) => m.modo === 'kill-9');
  const todosRecuperados = tras.length > 0 && tras.every((m) => m.primerSnapshotMs !== null);
  const max = (f: (m: Medicion) => number | null): number =>
    Math.max(...mediciones.map((m) => f(m) ?? Number.POSITIVE_INFINITY));
  const maxConnected = max((m) => m.connectedMs);
  const maxSnapshot = max((m) => m.primerSnapshotMs);
  const okConnected = maxConnected <= PRESUPUESTO_CONNECTED_MS;
  const okSnapshot = maxSnapshot <= PRESUPUESTO_SNAPSHOT_MS;
  const huecos = tras.filter((m) => m.huecoDetectable === true).length;

  console.log(`\n--- Veredicto Fase 6 §5 ---`);
  console.log(`  recuperación automática tras kill -9   ${todosRecuperados ? '✅ todos los ciclos' : '❌ algún ciclo no volvió'}`);
  console.log(`  peor t hasta Connected                 ${maxConnected} ms   ${okConnected ? `✅ ≤ ${PRESUPUESTO_CONNECTED_MS} ms` : `❌ > ${PRESUPUESTO_CONNECTED_MS} ms`}`);
  console.log(`  peor t hasta primer snapshot           ${maxSnapshot} ms   ${okSnapshot ? `✅ ≤ ${PRESUPUESTO_SNAPSHOT_MS} ms` : `❌ > ${PRESUPUESTO_SNAPSHOT_MS} ms`}`);
  console.log(`  hueco de sequence detectable por el cliente   ${huecos}/${tras.length} ciclos`);
  console.log(`  intervención manual necesaria          ninguna (el proceso vuelve solo con el mismo comando)`);
  const ok = todosRecuperados && okConnected && okSnapshot;
  console.log(`\n  ${ok ? '✅ CUMPLE el escenario 5 de la Fase 6' : '❌ NO cumple — revisar la salida'}\n`);

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ port, modo: MODO, ciclos: CICLOS, mediciones, veredicto: { todosRecuperados, maxConnected, maxSnapshot, okConnected, okSnapshot, huecos, ok } }, null, 2));
    console.log(`  JSON → ${OUT}\n`);
  }

  process.exitCode = ok ? 0 : 1;
}

void main();
