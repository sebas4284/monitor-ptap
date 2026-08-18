/**
 * ¿Qué plantas están congeladas, desde cuándo, y de quién es la culpa?
 *
 * Existe porque "la planta no se actualiza" tiene DOS causas que se ven igual en la aplicación y
 * se arreglan de forma opuesta:
 *
 *   A. **El servidor entrega datos viejos.** Su `SourceTimestamp` es antiguo. Reconectar no cambia
 *      nada: hay que escalar al integrador (sensor o enlace de campo caído).
 *   B. **Nosotros no los estamos leyendo.** El servidor tiene datos frescos pero nuestra
 *      Subscription está muerta, el buffer quedó faulted o la ruta se bloqueó. Eso SÍ es nuestro,
 *      y se arregla reciclando la sesión.
 *
 * La única medida que las separa es el **SourceTimestamp del propio servidor**, leído de forma
 * DIRECTA (`session.read`), sin pasar por nuestra Subscription — si preguntáramos por el mismo
 * canal que sospechamos roto, no probaríamos nada.
 *
 * Además hace DOS lecturas separadas para distinguir un valor que no cambia porque el proceso está
 * quieto (legítimo) de uno que no cambia porque nadie lo refresca.
 *
 * Uso (en la VM, que es quien alcanza el PLC):
 *   npx tsx scripts/diagnose-freshness.ts
 *   npx tsx scripts/diagnose-freshness.ts --intervalo 30    # segundos entre las dos lecturas
 *   npx tsx scripts/diagnose-freshness.ts --json            # salida procesable
 *
 * NUNCA escribe: solo `read`. Es seguro contra la planta real.
 */
import '../src/config/load-env';
import {
  AttributeIds,
  ClientSession,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
  TimestampsToReturn,
} from 'node-opcua';
import { loadMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';
import { resolveNamespaces } from '../src/infrastructure/connectivity/opcua/namespace-resolver';

/** Umbral por encima del cual una lectura se considera CONGELADA. */
const UMBRAL_MIN = 60;

/**
 * Canales de ENTRADA: los que el PLC refresca por su cuenta. Son los únicos que pueden estar
 * "congelados" en un sentido útil.
 *
 * `intOut` queda FUERA del veredicto a propósito: es el canal de COMANDO, lo escribimos nosotros.
 * Que lleve 24 días sin cambiar solo significa que nadie mandó una orden a esa válvula — es lo
 * normal y lo deseable. Incluirlo daba falsos congelados (Campoalegre salía congelada por su
 * INT_OUT mientras su REAL_IN respondía).
 */
const CANALES_DE_ENTRADA = new Set(['realIn', 'intIn']);

interface BufferRef {
  plantId: string;
  browseName: string;
  channel: string;
  nsUri: string;
  identifier: string;
}

interface Medida extends BufferRef {
  nodeId: string;
  ok: boolean;
  status: string;
  sourceTimestamp: Date | null;
  edadMin: number | null;
  valores1: unknown[];
  valores2: unknown[];
  indicesQueCambian: number[];
}

function arg(nombre: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}

/** Todos los buffers que el mapping REALMENTE usa para señales (no los que solo están declarados). */
function buffersConSenales(raw: unknown): BufferRef[] {
  const doc = raw as {
    plants: {
      plantId: string;
      opcBuffers?: Record<string, { browseName: string; node: { nsUri: string; identifier: string } }[]>;
      signals?: { buffer: string; sourceBuffer?: string }[];
    }[];
  };
  const out: BufferRef[] = [];

  for (const p of doc.plants) {
    const senales = p.signals ?? [];
    if (senales.length === 0) continue;

    const vistos = new Set<string>();
    for (const s of senales) {
      const canal = p.opcBuffers?.[s.buffer] ?? [];
      // Misma regla que MappingEngine: `sourceBuffer` exacto si lo declara; si no, el PRIMARIO
      // del canal, que es el de más elementos (los de tanque son sub-arrays cortos).
      const buf = s.sourceBuffer
        ? canal.find((b) => b.browseName === s.sourceBuffer)
        : [...canal].sort((a, b) => ((b as { arrayLength?: number }).arrayLength ?? 0) - ((a as { arrayLength?: number }).arrayLength ?? 0))[0];
      if (!buf || vistos.has(buf.browseName)) continue;
      vistos.add(buf.browseName);
      out.push({
        plantId: p.plantId,
        browseName: buf.browseName,
        channel: s.buffer,
        nsUri: buf.node.nsUri,
        identifier: buf.node.identifier,
      });
    }
  }
  return out;
}

async function leer(session: ClientSession, nodeId: string) {
  const dv = await session.read({ nodeId, attributeId: AttributeIds.Value }, TimestampsToReturn.Both);
  return {
    status: dv.statusCode.toString(),
    ok: dv.statusCode.isGood(),
    sourceTimestamp: dv.sourceTimestamp ?? null,
    valor: dv.value?.value,
  };
}

function comoArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : [v];
}

async function main(): Promise<void> {
  const intervaloSeg = Number(arg('intervalo', '20'));
  const json = process.argv.includes('--json');
  const endpoint = process.env.OPC_ENDPOINT;
  if (!endpoint) throw new Error('Falta OPC_ENDPOINT en el .env');

  const mapping = loadMapping();
  const refs = buffersConSenales(mapping.raw);

  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { maxRetry: 1 },
  });

  await client.connect(endpoint);
  const session = await client.createSession();

  try {
    // Mismo camino que el adaptador: nsUri → índice, en cada conexión.
    const nsArray = (await session.readNamespaceArray()) as string[];
    const indices = resolveNamespaces(nsArray, mapping.raw as never);

    const nodeIdDe = (r: BufferRef) => `ns=${indices.get(r.nsUri)};${r.identifier}`;

    const primera = new Map<string, unknown[]>();
    const medidas: Medida[] = [];

    for (const r of refs) {
      const id = nodeIdDe(r);
      const l = await leer(session, id);
      primera.set(id, comoArray(l.valor));
      medidas.push({
        ...r,
        nodeId: id,
        ok: l.ok,
        status: l.status,
        sourceTimestamp: l.sourceTimestamp,
        edadMin: l.sourceTimestamp ? (Date.now() - l.sourceTimestamp.getTime()) / 60000 : null,
        valores1: comoArray(l.valor),
        valores2: [],
        indicesQueCambian: [],
      });
    }

    if (!json) console.error(`  … esperando ${intervaloSeg} s para la segunda lectura`);
    await new Promise((r) => setTimeout(r, intervaloSeg * 1000));

    for (const m of medidas) {
      const l = await leer(session, m.nodeId);
      m.valores2 = comoArray(l.valor);
      const a = primera.get(m.nodeId) ?? [];
      m.indicesQueCambian = m.valores2
        .map((v, i) => (v !== a[i] ? i : -1))
        .filter((i) => i >= 0);
    }

    if (json) {
      console.log(JSON.stringify(medidas, null, 2));
      return;
    }

    // ── Informe por planta ────────────────────────────────────────────────
    const porPlanta = new Map<string, Medida[]>();
    for (const m of medidas) porPlanta.set(m.plantId, [...(porPlanta.get(m.plantId) ?? []), m]);

    const congeladas: string[] = [];
    const vivas: string[] = [];

    console.log(`\nEndpoint: ${endpoint}`);
    console.log(`Intervalo entre lecturas: ${intervaloSeg} s   ·   umbral de congelado: ${UMBRAL_MIN} min\n`);
    console.log('PLANTA            BUFFER                       EDAD DEL DATO      ¿CAMBIA?   ESTADO');
    console.log('─'.repeat(100));

    for (const [plantId, ms] of [...porPlanta.entries()].sort()) {
      // El veredicto se decide SOLO con los canales de entrada (ver CANALES_DE_ENTRADA).
      const entradas = ms.filter((m) => CANALES_DE_ENTRADA.has(m.channel));
      const edades = entradas.map((m) => m.edadMin).filter((e): e is number => e !== null);
      const masVieja = edades.length ? Math.max(...edades) : null;
      const algunCambio = entradas.some((m) => m.indicesQueCambian.length > 0);
      if (masVieja !== null && masVieja > UMBRAL_MIN && !algunCambio) congeladas.push(plantId);
      else vivas.push(plantId);

      for (const m of ms) {
        const edad =
          m.edadMin === null ? 'sin timestamp' : m.edadMin < 60 ? `${m.edadMin.toFixed(1)} min` : `${(m.edadMin / 1440).toFixed(1)} días`;
        const cambia = m.indicesQueCambian.length > 0 ? `sí (${m.indicesQueCambian.length})` : 'NO';
        const esComando = !CANALES_DE_ENTRADA.has(m.channel);
        const estado = !m.ok
          ? `⚠ ${m.status}`
          : esComando
            ? 'comando (no cuenta)'
            : m.indicesQueCambian.length > 0
              ? 'vivo'
              : m.edadMin !== null && m.edadMin > UMBRAL_MIN
                ? '🔴 CONGELADO'
                : 'quieto';
        console.log(
          `${plantId.padEnd(17)} ${m.browseName.padEnd(28)} ${edad.padStart(14)}   ${cambia.padStart(8)}   ${estado}`,
        );
      }
    }

    console.log('\n' + '─'.repeat(100));
    console.log(`CONGELADAS (${congeladas.length}): ${congeladas.join(', ') || '—'}`);
    console.log(`VIVAS      (${vivas.length}): ${vivas.join(', ') || '—'}`);

    // ── Veredicto de culpa, que es lo que decide a quién llamar ───────────
    const conTimestampViejo = medidas.filter(
      (m) => CANALES_DE_ENTRADA.has(m.channel) && m.edadMin !== null && m.edadMin > UMBRAL_MIN,
    );
    const conMalStatus = medidas.filter((m) => !m.ok);
    console.log('\nVEREDICTO');
    if (conMalStatus.length > 0) {
      console.log(`  ⚠ ${conMalStatus.length} buffer(s) con StatusCode no-Good → problema de RUTA o de nodo:`);
      for (const m of conMalStatus) console.log(`      ${m.plantId} ${m.browseName}: ${m.status}`);
    }
    if (conTimestampViejo.length > 0) {
      console.log(
        `  → ${conTimestampViejo.length} buffer(s) DE ENTRADA con SourceTimestamp viejo, leídos\n` +
          '    DIRECTAMENTE (sin pasar por nuestra Subscription). El servidor entrega el dato\n' +
          '    viejo por su cuenta: NO lo arregla reconectar. Es de campo — escalar al integrador.',
      );
      for (const m of conTimestampViejo) {
        console.log(`      ${m.plantId.padEnd(17)} ${m.browseName.padEnd(28)} ${(m.edadMin! / 1440).toFixed(1)} días`);
      }
    }
    if (conTimestampViejo.length === 0 && conMalStatus.length === 0) {
      console.log('  → Todos los buffers responden Good y con timestamp fresco.');
      console.log('    Si aun así la aplicación muestra datos viejos, el problema es NUESTRO');
      console.log('    (Subscription muerta o buffer faulted): mirar /api/health/opc y reciclar sesión.');
    }
    console.log('');
  } finally {
    await session.close().catch(() => undefined);
    await client.disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
