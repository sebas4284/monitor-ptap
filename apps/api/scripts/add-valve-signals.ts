/**
 * Replica la señal writable `valve1` (canal 0, pulso 4096) en TODAS las plantas que tengan los
 * buffers `intOut` + `intIn`, con la MISMA forma verificada en campo en La Sirena (2026-07-30).
 *
 * Por qué un script y no 10 ediciones a mano: el mapping tiene formato compacto hecho a mano
 * (objetos en una línea). Este script inserta el bloque como TEXTO, así que preserva el formato
 * del resto del archivo (un `JSON.stringify` reformatearía las 2.400 líneas).
 *
 * Es IDEMPOTENTE: si la planta ya tiene `valve1`, la salta.
 *
 * Semántica aplicada (instrucción del operador, 2026-07-30): «puede que tengan más válvulas pero
 * siempre será mín. 1 y se escribirá por el canal 0; para abrir será 4096 en todas».
 *   - COMANDO  : intOut[0], `open: 4096` (bit12), modo bitmask, pulso de 300 ms.
 *   - READ-BACK: intIn[0], `expectedValue: 16385` (bit14+bit0) — INFERIDO del patrón de Vorágine,
 *     nunca observado en `16385`. Si en alguna planta el estado vive en otro índice, el read-back
 *     simplemente NO confirmará (reporta `failed`, jamás un falso éxito): degrada seguro.
 *
 * Uso:  npm exec -w @ptap/api -- tsx scripts/add-valve-signals.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAPPING = join(__dirname, '..', 'config', 'opc_mapping.json');
const DRY = process.argv.includes('--dry');

interface PlantDoc {
  plantId: string;
  opcBuffers?: Record<string, Array<{ browseName?: string }>>;
  signals?: Array<{ domainKey?: string }>;
}

function valveBlock(intOut: string, intIn: string, eol: string): string {
  // Formato idéntico al bloque verificado en campo (sirena), con indentación de 8 espacios.
  // `eol` se respeta para no mezclar CRLF/LF en un archivo que git normaliza en Windows.
  return `        {
          "buffer": "intOut",
          "sourceBuffer": "${intOut}",
          "index": 0,
          "domainKey": "valve1",
          "label": "Válvula 1",
          "mappingStatus": "mapped",
          "confidence": "confirmed",
          "writable": true,
          "write": {
            "target": { "channel": "intOut", "sourceBuffer": "${intOut}", "index": 0 },
            "commands": { "open": 4096 },
            "mode": "bitmask",
            "pulse": { "holdMs": 300 },
            "readBack": {
              "channel": "intIn",
              "sourceBuffer": "${intIn}",
              "index": 0,
              "confirmsWrittenValue": false,
              "expectedValue": 16385
            },
            "timeoutMs": 5000,
            "rollbackValue": 0,
            "permission": "control_valves"
          }
        },
`.replace(/\n/g, eol);
}

/**
 * Plantas cuyo ESTADO de válvula está verificado en campo. Solo a estas se les añade `valve1State`.
 * Motivo (hallazgo 2026-07-30): leer `INT_IN[0]` en las 10 plantas mostró que solo Sirena tiene el
 * patrón limpio `16384` (bit14). En `montebello` (30250) y `km18` (30101) el bit14 está encendido por
 * casualidad, así que publicar ese estado afirmaba "CERRADA"/"ABIERTA" FALSAMENTE. Ver
 * scripts/fix-valve-state.ts. Añadir una planta aquí SOLO tras confirmar su índice y patrón en campo.
 */
const ESTADO_VERIFICADO = new Set(['sirena']);

/**
 * Señal de SOLO LECTURA con el estado de la válvula (método 1 de la interpretación de válvulas):
 * `intIn[0]` es una máscara de bits → bit14 = estado válido/presente, bit0 = abierta(1)/cerrada(0).
 * Es decir 16384 = CERRADA y 16385 = ABIERTA. `confidence: inferred` porque el patrón viene de las
 * notas de Vorágine y en campo solo se ha OBSERVADO el 16384 (cerrada), nunca el 16385.
 * Al ser read-only no hay riesgo: si el índice fuera otro, se verá "sin dato" y el frontend cae al
 * método 2 (caudal).
 */
function valveStateBlock(intIn: string, eol: string): string {
  return `        {
          "buffer": "intIn",
          "sourceBuffer": "${intIn}",
          "index": 0,
          "domainKey": "valve1State",
          "label": "Estado de la válvula 1",
          "mappingStatus": "mapped",
          "confidence": "inferred",
          "writable": false
        },
`.replace(/\n/g, eol);
}

function main(): void {
  let text = readFileSync(MAPPING, 'utf8');
  const doc = JSON.parse(text) as { plants: PlantDoc[] };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  const added: string[] = [];
  const skipped: Array<{ plantId: string; why: string }> = [];

  for (const plant of doc.plants) {
    const intOut = plant.opcBuffers?.intOut?.[0]?.browseName;
    const intIn = plant.opcBuffers?.intIn?.[0]?.browseName;

    const hasCmd = plant.signals?.some((s) => s.domainKey === 'valve1');
    // Solo se considera "falta el estado" si la planta lo tiene verificado; si no, NO se añade.
    const hasState = plant.signals?.some((s) => s.domainKey === 'valve1State') || !ESTADO_VERIFICADO.has(plant.plantId);
    if (hasCmd && hasState) {
      skipped.push({ plantId: plant.plantId, why: 'ya tiene valve1 + valve1State' });
      continue;
    }
    if (!intOut || !intIn) {
      skipped.push({ plantId: plant.plantId, why: `sin buffer ${!intOut ? 'intOut' : 'intIn'} → NO hay canal donde escribir` });
      continue;
    }

    // Anclar en el `"signals": [` que sigue al plantId de ESTA planta (las plantas son secuenciales).
    const pidIdx = text.indexOf(`"plantId": "${plant.plantId}"`);
    if (pidIdx < 0) {
      skipped.push({ plantId: plant.plantId, why: 'no se encontró su plantId en el texto' });
      continue;
    }
    const anchor = `"signals": [${eol}`;
    const sigIdx = text.indexOf(anchor, pidIdx);
    if (sigIdx < 0) {
      skipped.push({ plantId: plant.plantId, why: 'no se encontró su array signals' });
      continue;
    }
    const insertAt = sigIdx + anchor.length;
    const block = (hasCmd ? '' : valveBlock(intOut, intIn, eol)) + (hasState ? '' : valveStateBlock(intIn, eol));
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
    added.push(`${plant.plantId}${hasCmd ? ' (solo estado)' : ''}`);
  }

  // Verificación: el resultado sigue siendo JSON válido y cada planta tocada tiene su valve1.
  const after = JSON.parse(text) as { plants: PlantDoc[] };
  for (const label of added) {
    const id = label.replace(' (solo estado)', '');
    const p = after.plants.find((x) => x.plantId === id);
    if (!p?.signals?.some((s) => s.domainKey === 'valve1')) throw new Error(`verificación falló (valve1) en ${id}`);
    if (!p?.signals?.some((s) => s.domainKey === 'valve1State')) throw new Error(`verificación falló (valve1State) en ${id}`);
  }

  console.log(`Añadida valve1 en ${added.length} planta(s): ${added.join(', ') || '—'}`);
  for (const s of skipped) console.log(`  · omitida ${s.plantId}: ${s.why}`);

  if (DRY) {
    console.log('\n(--dry: no se escribió el archivo)');
    return;
  }
  if (added.length > 0) {
    writeFileSync(MAPPING, text);
    console.log(`\n${MAPPING} actualizado. Ejecuta: npm run -w @ptap/api validate:mapping`);
  } else {
    console.log('\nNada que hacer.');
  }
}

main();
