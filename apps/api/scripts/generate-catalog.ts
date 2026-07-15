/**
 * Generador de docs/DATA_CATALOG.md — el registro de los datos que el backend entrega:
 * qué señales existen por planta, cómo llamarlas (REST/Socket.IO + domainKey) y cómo
 * tratarlas en el front (contrato del DTO + convenciones).
 *
 * Deriva TODO de config/opc_mapping.json (fuente de verdad) — NO editar el .md a mano.
 * Idempotente: mismo mapping ⇒ mismo archivo byte a byte.
 * Ejecutar: npm run generate:catalog (generate:mapping lo encadena automáticamente).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'config', 'opc_mapping.json');
const DEST = join(__dirname, '..', '..', '..', 'docs', 'DATA_CATALOG.md');

interface Signal {
  buffer: string;
  sourceBuffer?: string;
  index: number;
  domainKey: string;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  opMin?: number;
  opMax?: number;
  confidence: string;
  writable: boolean;
}
interface BufferDesc {
  browseName: string;
  node: { nsUri: string; identifier: string };
  arrayLength: number | null;
  dataType: string | null;
}
interface Plant {
  plantId: string;
  displayName: string;
  opcBuffers: Record<string, BufferDesc[]>;
  signals: Signal[];
}
interface MappingDoc { version: string; notes?: string[]; plants: Plant[] }

function opRange(s: Signal): string {
  if (s.opMin != null && s.opMax != null) return `${s.opMin} a ${s.opMax}`;
  if (s.opMax != null) return `≤ ${s.opMax}`;
  if (s.opMin != null) return `≥ ${s.opMin}`;
  return '—';
}

function validity(s: Signal): string {
  return s.min != null && s.max != null ? `${s.min} a ${s.max}` : '—';
}

/** Buffer fuente de la señal: el declarado (sourceBuffer) o el primario del canal. */
function sourceOf(plant: Plant, s: Signal): BufferDesc | null {
  const bufs = plant.opcBuffers[s.buffer] ?? [];
  if (s.sourceBuffer) return bufs.find((b) => b.browseName === s.sourceBuffer) ?? null;
  return bufs.reduce<BufferDesc | null>(
    (best, b) => (!best || (b.arrayLength ?? 0) > (best.arrayLength ?? 0) ? b : best),
    null,
  );
}

function main(): void {
  const doc = JSON.parse(readFileSync(SRC, 'utf8')) as MappingDoc;
  const withSignals = doc.plants.filter((p) => p.signals.length > 0);
  const withoutSignals = doc.plants.filter((p) => p.signals.length === 0);

  const lines: string[] = [];
  const w = (s = '') => lines.push(s);

  w('# Catálogo de datos — Monitor PTAP');
  w();
  w(`> **GENERADO** desde \`apps/api/config/opc_mapping.json\` (v${doc.version}). NO editar a mano:`);
  w('> se regenera con `npm run generate:catalog -w @ptap/api` (y automáticamente con `generate:mapping`).');
  w();
  w('Registro de los datos que entrega el backend de telemetría: qué señales existen por');
  w('planta, cómo llamarlas y cómo tratarlas en el front. El backend entrega datos estables');
  w('y completos con sus metadatos; la **interpretación** de los valores es del equipo');
  w('frontend en diálogo con el cliente.');
  w();
  w('## Cómo consumir los datos');
  w();
  w('### REST (carga inicial / resincronización)');
  w();
  w('| Endpoint | Devuelve |');
  w('|---|---|');
  w('| `GET /api/plants` | Lista de plantas: `plantId`, `displayName`, `liveness`, `bridgeStatus` |');
  w('| `GET /api/plants/:plantId/snapshot` | `PlantSnapshotDto` de la planta (cache RAM, sin tocar el PLC) |');
  w();
  w('Base URL: puerto `:4000` del backend de telemetría (`npm run start:telemetry -w @ptap/api`).');
  w('En la app móvil se configura en `app.json → expo.extra.apiBaseUrl`.');
  w();
  w('### Socket.IO (push en tiempo real — el front NO hace polling)');
  w();
  w('| Acción | Evento | Payload |');
  w('|---|---|---|');
  w('| Suscribirse a una planta (al conectar y en cada reconexión) | emit `opc:subscribe` | `{ plantId }` |');
  w('| Recibir snapshot (solo cuando algo cambia) | on `opc:snapshot` | `PlantSnapshotDto` |');
  w('| Recibir cambios de frescura (broadcast, todas las plantas) | on `opc:liveness` | `{ plantId, state, lastChangeAt, windowSec }` |');
  w();
  w('`sequence` es monótono por planta: si llega N+2 sin haber visto N+1, hubo un hueco —');
  w('resincronizar por REST (el hook `useSnapshot` de la app móvil ya implementa este patrón).');
  w();
  w('### Contrato `SignalDto` (cada entrada de `snapshot.signals`)');
  w();
  w('| Campo | Tipo | Significado |');
  w('|---|---|---|');
  w('| `value` | `number \\| boolean \\| null` | Valor crudo del PLC. `null` = no hay número (NaN/∞ del PLC o buffer ausente) |');
  w('| `unit` | `string \\| null` | Unidad de ingeniería (`l/s`, `psi`, `m`, `m³`, `NTU`, `mg/L`, `µS/cm`, `pH`, `°C`) |');
  w('| `quality` | `Good \\| Bad \\| Uncertain` | Calidad OPC UA reportada por el servidor |');
  w('| `usable` | `boolean` | Veredicto del backend (calidad + rango de validez + frescura). **Metadato**: no oculta el valor |');
  w('| `reason` | `BAD_QUALITY \\| INVALID_NUMBER \\| OUT_OF_RANGE \\| BRIDGE_STALE` | Presente solo si `usable=false`; por qué |');
  w('| `mappingStatus` | `mapped \\| unmapped` | Si el índice tiene semántica asignada |');
  w('| `confidence` | `confirmed \\| inferred \\| estimated` | Solidez de la semántica (ver Convenciones) |');
  w('| `label` | `string \\| null` | Nombre humano en español, listo para mostrar |');
  w('| `ts` | `string \\| null` | SourceTimestamp OPC UA de la última muestra |');
  w('| `opMin` / `opMax` | `number` (opcionales) | Rango operativo entregado por el operador. El front lo MUESTRA junto al valor ("Mín: 1.00  Máx: 3.00", como en la app original) para que el cliente interprete la lectura |');
  w();
  w('### Política de visualización (acordada 2026-07-15)');
  w();
  w('**Si `value` es un número, se muestra tal cual, en cualquier planta.** Incluye valores');
  w('congelados (`BRIDGE_STALE`), negativos o fuera de escala (`OUT_OF_RANGE`): un -57 psi');
  w('significa algo y el cliente lo detecta precisamente porque está fuera de escala.');
  w('"sin dato" queda reservado para `value: null`. Los metadatos (`usable`, `reason`,');
  w('`quality`, `liveness`) viajan siempre en el DTO y quedan a disposición del front y el');
  w('cliente para las interpretaciones que acuerden (alarmas, avisos de congelado, etc.).');
  w();
  w('## Convenciones para el front');
  w();
  w('- **Identidad = (`plantId`, `domainKey`).** Los índices de array NO son transferibles');
  w('  entre plantas: `realIn[5]` es caudal en Montebello y nivel de tanque en Campoalegre.');
  w('  Nunca direccionar por índice.');
  w('- **domainKeys**: `inlet*`/`outlet*` + magnitud (`inletFlow1`, `outletPressure2`, …).');
  w('  Tanques propios: `tank<N>Level` (m) y `tank<N>Volume` (m³).');
  w('- **Pantalla Tanques**: se alimenta sola de `tank<N>Level/Volume`. En la app móvil,');
  w('  `apps/mobile/services/tanks.ts` concentra la regla: `isTankSignal()` (excluir tanques');
  w('  de listados generales de sensores), `EXTERNAL_TANKS` (tanques de otras plantas');
  w('  retransmitidos, p. ej. San Antonio y El Quijote vía Soledad) y `FULL_LEVEL_M`');
  w('  (niveles de tanque lleno confirmados, para % de llenado).');
  w('- **`min`/`max`** = rango de VALIDEZ física (produce `usable`/`OUT_OF_RANGE`, metadato).');
  w('  **`opMin`/`opMax`** = rango OPERATIVO/normativo entregado por el operador — insumo');
  w('  para alarmas o avisos que el front acuerde con el cliente.');
  w('- **`confidence: inferred`** = semántica confirmada por el operador vía HMI, sin');
  w('  documento oficial en el repo. `confirmed` exige documento en `docs/plant-documentation/`.');
  w('- **`liveness.state`** (`live | idle | stale | unknown`) es la frescura POR PLANTA:');
  w('  `unknown/stale` = el PLC maestro no está refrescando ese sitio (las señales llegan');
  w('  con el último valor conocido).');
  w();
  w('## Señales disponibles por planta');
  w();

  for (const plant of withSignals) {
    const sources = new Map<string, BufferDesc>();
    for (const s of plant.signals) {
      const src = sourceOf(plant, s);
      if (src) sources.set(src.browseName, src);
    }
    w(`### ${plant.displayName} (\`${plant.plantId}\`) — ${plant.signals.length} señales`);
    w();
    for (const src of sources.values()) {
      w(`Fuente: \`${src.browseName}\` (${src.dataType}[${src.arrayLength}], nsUri \`${src.node.nsUri}\`, \`${src.node.identifier}\`)`);
    }
    w();
    w('| Índice | domainKey | Señal | Unidad | Validez | Rango operativo | Confianza |');
    w('|---|---|---|---|---|---|---|');
    for (const s of [...plant.signals].sort((a, b) => a.index - b.index)) {
      w(`| ${s.index} | \`${s.domainKey}\` | ${s.label ?? '—'} | ${s.unit ?? '—'} | ${validity(s)} | ${opRange(s)} | ${s.confidence} |`);
    }
    w();
  }

  w('### Plantas sin señales mapeadas aún');
  w();
  for (const plant of withoutSignals) {
    w(`- ${plant.displayName} (\`${plant.plantId}\`)`);
  }
  w();
  w('## Cómo se registra una planta nueva');
  w();
  w('1. Agregar sus señales a `SIGNALS_BY_SITE` en `apps/api/scripts/generate-mapping.ts`');
  w('   (si el sitio tiene varios buffers del mismo canal e igual tamaño, declarar `sourceBuffer`).');
  w('2. `npm run generate:mapping -w @ptap/api` (regenera mapping y este catálogo).');
  w('3. `npm run validate:mapping -w @ptap/api` y `npm test -w @ptap/api`.');
  w('4. Reiniciar el backend de telemetría para que cargue el mapping nuevo.');
  w();
  w('## Notas vigentes del mapping');
  w();
  for (const note of doc.notes ?? []) {
    w(`- ${note}`);
  }
  w();

  writeFileSync(DEST, lines.join('\n'), 'utf8');
  console.log(`Generado ${DEST}`);
  console.log(`  plantas con señales: ${withSignals.length}/${doc.plants.length} | señales totales: ${withSignals.reduce((n, p) => n + p.signals.length, 0)}`);
}

main();
