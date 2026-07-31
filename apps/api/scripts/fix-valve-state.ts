/**
 * Quita `valve1State` de las plantas donde el índice 0 de `INT_IN` NO es la palabra de estado de la
 * válvula. Hallazgo de campo (2026-07-30), leyendo `INT_IN[0]` real en las 10 plantas:
 *
 *   sirena          16384  bits{14}                    ✅ patrón limpio "CERRADA"
 *   montebello      30250  bits{1,3,5,9,10,12,13,14}   ⚠️ bit14 por casualidad → diría "CERRADA" (FALSO)
 *   km18            30101  bits{0,2,4,7,8,10,12,13,14} ⚠️ bit14 + bit0     → diría "ABIERTA" (FALSO)
 *   voragine, soledad, cascajal, alto-los-mangos, campoalegre, pichinde, carbonero → sin bit14
 *
 * Es decir: replicar el índice 0 a ciegas publicaba un estado INVENTADO en al menos dos plantas.
 * Solo Sirena queda con `valve1State` (verificado). En las demás el frontend cae al método 2
 * (caudal), que es evidencia física. Cuando se confirme el índice/patrón de cada planta en campo se
 * vuelve a añadir — el protocolo de Vorágine, por ejemplo, dice que su estado está en la POSICIÓN 2,
 * no en la 0.
 *
 * Uso:  npm exec -w @ptap/api -- tsx scripts/fix-valve-state.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAPPING = join(__dirname, '..', 'config', 'opc_mapping.json');
const DRY = process.argv.includes('--dry');
/** Plantas cuyo estado de válvula está VERIFICADO en campo. Solo estas conservan `valve1State`. */
const ESTADO_VERIFICADO = new Set(['sirena']);

interface PlantDoc {
  plantId: string;
  signals?: Array<{ domainKey?: string }>;
}

function main(): void {
  const text = readFileSync(MAPPING, 'utf8');
  const before = JSON.parse(text) as { plants: PlantDoc[] };

  // Los buffers a conservar/quitar se identifican por `sourceBuffer` (INT_IN_<PLANTA>), único por sitio.
  const buffersAQuitar = new Set(
    before.plants
      .filter((p) => !ESTADO_VERIFICADO.has(p.plantId))
      .flatMap((p) =>
        (p.signals ?? [])
          .filter((s) => s.domainKey === 'valve1State')
          .map((s) => (s as { sourceBuffer?: string }).sourceBuffer ?? ''),
      )
      .filter(Boolean),
  );

  // Escaneo por LÍNEAS (determinista y rápido; un regex sobre bloques anidados hace backtracking):
  // se localiza la línea `"domainKey": "valve1State"`, se expande al `{` que abre y al `},` que cierra.
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const aBorrar = new Set<number>();
  const quitadas: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/"domainKey":\s*"valve1State"/.test(lines[i])) continue;
    let ini = i;
    while (ini > 0 && !/^\s*\{\s*$/.test(lines[ini])) ini--;
    let fin = i;
    while (fin < lines.length - 1 && !/^\s*\},?\s*$/.test(lines[fin])) fin++;
    const bloque = lines.slice(ini, fin + 1).join('\n');
    const buf = /"sourceBuffer":\s*"([^"]+)"/.exec(bloque)?.[1] ?? '';
    if (!buffersAQuitar.has(buf)) continue; // planta verificada: se conserva
    for (let k = ini; k <= fin; k++) aBorrar.add(k);
    const planta = before.plants.find((p) =>
      (p.signals ?? []).some((s) => s.domainKey === 'valve1State' && (s as { sourceBuffer?: string }).sourceBuffer === buf),
    );
    if (planta) quitadas.push(planta.plantId);
  }

  const nuevoTexto = lines.filter((_, idx) => !aBorrar.has(idx)).join(eol);
  text.length; // (el original ya no se usa)
  const textoFinal = nuevoTexto;

  const after = JSON.parse(textoFinal) as { plants: PlantDoc[] };
  const conEstado = after.plants.filter((p) => (p.signals ?? []).some((s) => s.domainKey === 'valve1State')).map((p) => p.plantId);
  const conComando = after.plants.filter((p) => (p.signals ?? []).some((s) => s.domainKey === 'valve1')).map((p) => p.plantId);

  console.log(`valve1State quitada de ${quitadas.length} planta(s): ${quitadas.join(', ') || '—'}`);
  console.log(`  conservan valve1State (verificado): ${conEstado.join(', ') || '—'}`);
  console.log(`  conservan valve1 (comando):         ${conComando.length} plantas`);
  if (conComando.length !== 10) throw new Error(`se esperaban 10 plantas con comando, hay ${conComando.length}`);

  if (DRY) {
    console.log('\n(--dry: no se escribió el archivo)');
    return;
  }
  writeFileSync(MAPPING, textoFinal);
  console.log(`\n${MAPPING} actualizado. Ejecuta: npm run -w @ptap/api validate:mapping`);
}

main();
