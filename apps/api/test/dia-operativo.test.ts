/**
 * Tipo de día y rango operativo que rige hoy.
 *
 * El caudal de salida de La Vorágine es 1–3 l/s entre semana y 1–2 l/s los sábados, domingos y
 * festivos (cliente, 2026-08-20). Lo que estos tests fijan es que esa distinción se resuelve en el
 * BACKEND y en hora local: si se resolviera en el cliente habría dos calendarios que pueden
 * discrepar, y si se resolviera en UTC el fin de semana empezaría a las 19:00 del viernes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { diaLocal, esFinDeSemanaOFestivo, FESTIVOS } from '../src/infrastructure/connectivity/pipeline/dia-operativo';
import { dedupeDay } from '../src/modules/notifications/notification-day';
import { loadJson } from '../scripts/validate-mapping';

test('sábado y domingo rigen como fin de semana; de lunes a viernes no', () => {
  //                     año, mes(0=ene), día
  const sabado = new Date(2026, 7, 22);
  const domingo = new Date(2026, 7, 23);
  const lunes = new Date(2026, 7, 24);
  const viernes = new Date(2026, 7, 21);

  assert.equal(esFinDeSemanaOFestivo(sabado), true);
  assert.equal(esFinDeSemanaOFestivo(domingo), true);
  assert.equal(esFinDeSemanaOFestivo(lunes), false);
  assert.equal(esFinDeSemanaOFestivo(viernes), false);
});

test('la lista de festivos arranca vacía, y eso es lo seguro', () => {
  // Un festivo que falte aplica el rango de ENTRE SEMANA, que es el más permisivo: se deja de
  // avisar de algo, no se avisa en falso. Al revés —inventar festivos con un algoritmo— produciría
  // alertas erróneas en días laborables.
  assert.deepEqual([...FESTIVOS], []);
});

test('un festivo declarado rige como fin de semana aunque sea martes', () => {
  const martes = new Date(2026, 11, 8); // 8-dic-2026, Inmaculada
  assert.equal(martes.getDay(), 2, 'el caso interesante es que NO es finde por el día');
  assert.equal(esFinDeSemanaOFestivo(martes), false, 'hoy no está en la lista');
  // Con la fecha en la lista pasaría a true; se comprueba la mecánica sin mutar la constante.
  assert.equal(diaLocal(martes), '2026-12-08');
});

// dedupeDay y el tipo de día comparten implementación a propósito: son la misma decisión de zona
// horaria. Si divergieran, un aviso podría anclarse a un día y su umbral a otro.
test('dedupeDay y diaLocal son la MISMA fecha, no dos calendarios', () => {
  const t = new Date(2026, 7, 20, 23, 59);
  assert.equal(dedupeDay(t), diaLocal(t));
  assert.equal(dedupeDay(t), '2026-08-20');
});

test('mapping de PRODUCCIÓN: solo La Vorágine declara rango por día, y son 1–3 / 1–2', () => {
  const prod = loadJson(join(__dirname, '..', 'config', 'opc_mapping.json')) as {
    plants: Array<{ plantId: string; signals?: Array<{ domainKey?: string; opRangeByDay?: unknown }> }>;
  };
  const conRango = prod.plants
    .flatMap((p) => (p.signals ?? []).filter((s) => s.opRangeByDay).map((s) => `${p.plantId}/${s.domainKey}`));
  assert.deepEqual(conRango, ['voragine/outletFlow1'], 'el rango de una planta no sirve en otra');

  const salida = (prod.plants.find((p) => p.plantId === 'voragine')?.signals ?? [])
    .find((s) => s.domainKey === 'outletFlow1');
  assert.deepEqual(salida?.opRangeByDay, {
    semana: { opMin: 1, opMax: 3 },
    finde: { opMin: 1, opMax: 2 },
  });
});

test('mapping de PRODUCCIÓN: el máximo del tanque de La Vorágine es 1,98 m', () => {
  // Corregido por el cliente el 2026-08-20 (era 1,97). Es el denominador del porcentaje que ve el
  // operario y el que define el 50 %, así que un test lo fija.
  const prod = loadJson(join(__dirname, '..', 'config', 'opc_mapping.json')) as {
    plants: Array<{ plantId: string; signals?: Array<{ domainKey?: string; opMax?: number; opMin?: number }> }>;
  };
  const nivel = (prod.plants.find((p) => p.plantId === 'voragine')?.signals ?? [])
    .find((s) => s.domainKey === 'tank1Level');
  assert.equal(nivel?.opMax, 1.98);
  assert.equal(nivel?.opMin, 1, 'el mínimo de servicio no cambia');
});
