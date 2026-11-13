import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BridgeStatus, LivenessDto, LivenessState } from '@ptap/shared';
import Colors from '../constants/colors';
import { EN_INTEGRACION, formatSince, livenessBadge, plantStatus, plcFaultForBanner, systemHealth } from './plant-status';

const live = (state: LivenessDto['state'], lastChangeAt: string | null = null): LivenessDto => ({
  state,
  lastChangeAt,
  windowSec: 60,
});
// Fechas construidas en hora LOCAL para que el test no dependa de la zona horaria de la máquina.
const NOW = new Date(2026, 10, 4, 15, 30);

test('plant-status: live y stable son verdes y cuentan como en línea', () => {
  const a = plantStatus(live('live'), 'Connected', NOW);
  const b = plantStatus(live('stable'), 'Connected', NOW);
  assert.deepEqual([a.label, a.tone, a.online], ['En vivo', 'ok', true]);
  assert.deepEqual([b.label, b.tone, b.online], ['Estable', 'ok', true]);
});

test('plant-status: stable NUNCA es advertencia (operación normal)', () => {
  assert.equal(plantStatus(live('stable'), 'Connected', NOW).tone, 'ok');
});

test('plant-status: frozen es gris con la hora del último cambio', () => {
  const s = plantStatus(live('frozen', new Date(2026, 10, 4, 14, 5).toISOString()), 'Connected', NOW);
  assert.deepEqual([s.label, s.tone, s.online], ['Sin datos desde 14:05', 'muted', false]);
  assert.equal(plantStatus(live('frozen', null), 'Connected', NOW).label, 'Sin datos');
});

test('plant-status: el puente caído manda sobre la frescura y va en GRIS, nunca en rojo', () => {
  for (const b of ['Disconnected', 'Faulted', 'Connecting', 'Recovering'] as const) {
    const s = plantStatus(live('live'), b, NOW);
    assert.deepEqual([s.kind, s.label, s.tone, s.icon, s.online], ['no_link', 'Sin conexión', 'muted', 'cloud-offline-outline', false], b);
  }
  const stale = plantStatus(live('live'), 'Stale', NOW);
  assert.deepEqual([stale.kind, stale.label, stale.tone, stale.online], ['no_plc_data', 'Sin conexión', 'muted', false]);
});

test('plant-status: "Sin conexión" se distingue de "Sin datos desde…" por icono y texto', () => {
  const offline = plantStatus(live('live'), 'Disconnected', NOW);
  const frozen = plantStatus(live('frozen', new Date(2026, 10, 4, 14, 5).toISOString()), 'Connected', NOW);
  assert.notEqual(offline.icon, frozen.icon);
  assert.notEqual(offline.label, frozen.label);
  assert.equal(frozen.icon, 'time-outline');
});

test('formatSince: otro día incluye la fecha', () => {
  assert.equal(formatSince(new Date(2026, 10, 3, 9, 7).toISOString(), NOW), '03/11 09:07');
});

/**
 * Una planta en integración (Cabuyo, La Luisa, La Leonera y Gloria desde el 2026-10-19) está en
 * `frozen` porque aún no está conectada al PLC maestro. Nada de lo que la app pinte de ella puede
 * leerse como una caída: ni rojo, ni «sin conexión», ni «reintentando», ni un código PLC-0x.
 */
const SUENA_A_CAIDA = /reintent|sin conexi|PLC-0|congelad|fuera de l[ií]nea|intermitenc/i;

const PUENTES: (BridgeStatus | undefined)[] = ['Connecting', 'Connected', 'Recovering', 'Stale', 'Disconnected', 'Faulted', undefined];
const LIVENESS: LivenessState[] = ['live', 'stable', 'frozen'];

test('textos de «en integración»: ninguno suena a caída', () => {
  for (const [clave, texto] of Object.entries(EN_INTEGRACION)) {
    assert.doesNotMatch(texto, SUENA_A_CAIDA, `${clave}: «${texto}»`);
  }
  assert.match(EN_INTEGRACION.lecturas, /PLC maestro/, 'dice POR QUÉ no hay datos');
  assert.match(EN_INTEGRACION.lecturas, /integrador/, 'y de quién depende que los haya');
});

test('badge: en integración es gris «EN INTEGRACIÓN» en cualquier liveness, nunca el rojo de CONGELADO', () => {
  for (const state of LIVENESS) {
    for (const loading of [false, true]) {
      const b = livenessBadge(state, { integrationPending: true, loading });
      assert.equal(b.label, 'EN INTEGRACIÓN', `${state}/${loading}`);
      assert.equal(b.color, Colors.neutral);
      assert.notEqual(b.color, Colors.danger);
      assert.doesNotMatch(b.label, SUENA_A_CAIDA);
    }
  }
});

test('badge: sin integración, los estados de siempre no cambian', () => {
  assert.deepEqual(livenessBadge('live'), { color: Colors.success, label: 'EN VIVO' });
  assert.deepEqual(livenessBadge('stable'), { color: Colors.primaryLight, label: 'ESTABLE' });
  assert.deepEqual(livenessBadge('frozen'), { color: Colors.danger, label: 'CONGELADO · SIN CONEXIÓN' }, 'una planta conectada que se cae SÍ es roja');
  assert.deepEqual(livenessBadge('frozen', { integrationPending: false }), { color: Colors.danger, label: 'CONGELADO · SIN CONEXIÓN' });
  assert.deepEqual(livenessBadge('frozen', { loading: true }), { color: Colors.neutral, label: 'CONECTANDO…' }, 'la carga inicial no alarma');
});

test('vista Civil: en integración dice «Planta en integración» en gris con cualquier puente y liveness', () => {
  for (const puente of PUENTES) {
    for (const state of LIVENESS) {
      const h = systemHealth(puente, state, true);
      assert.equal(h.title, 'Planta en integración', `${puente}/${state}`);
      assert.equal(h.desc, EN_INTEGRACION.civil);
      assert.equal(h.color, Colors.neutral);
      assert.equal(h.icon, 'construct-outline');
      assert.doesNotMatch(`${h.title} ${h.desc}`, SUENA_A_CAIDA, `${puente}/${state}`);
    }
  }
});

test('vista Civil: sin integración, el veredicto de siempre (frozen manda; el puente decide el resto)', () => {
  const caida = systemHealth('Connected', 'frozen');
  assert.equal(caida.title, 'Sin conexión con la planta', 'una planta conectada que se cae SÍ lo dice');
  assert.equal(caida.color, Colors.danger);
  assert.match(caida.desc, /Reintentando/);
  assert.equal(systemHealth('Connected', 'frozen', false).title, 'Sin conexión con la planta');
  assert.equal(systemHealth('Connected', 'stable').title, 'Sistema operativo', 'proceso quieto es operación normal');
  assert.equal(systemHealth('Connected', 'live').title, 'Sistema operativo');
  assert.equal(systemHealth('Stale', 'live').title, 'Sistema con intermitencias');
  assert.equal(systemHealth('Faulted', 'stable').title, 'Sistema fuera de línea');
  assert.equal(systemHealth(undefined, 'live').title, 'Estado no disponible');
});

test('banner: en integración no anuncia ningún corte del PLC (ni PLC-01 ni PLC-02), sea cual sea el puente', () => {
  for (const puente of PUENTES) {
    assert.equal(plcFaultForBanner(puente, true), null, String(puente));
  }
});

test('banner: sin integración, la clasificación de siempre (classifyBridge)', () => {
  assert.equal(plcFaultForBanner('Connected'), null);
  assert.equal(plcFaultForBanner(undefined), null, 'sin estado del puente aún: nada que clasificar');
  assert.equal(plcFaultForBanner('Stale'), 'master_no_data');
  assert.equal(plcFaultForBanner('Stale', false), 'master_no_data');
  for (const puente of ['Connecting', 'Recovering', 'Disconnected', 'Faulted'] as const) {
    assert.equal(plcFaultForBanner(puente), 'route', puente);
  }
});
