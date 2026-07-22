/**
 * Prueba de ruta servidor→PLC (diagnóstico del admin):
 *  - `buildVerdict` (puro): el veredicto NUNCA culpa a un tramo sin evidencia — cada combinación
 *    de sondas apunta al responsable correcto (servidor / ruta-o-planta / servicio del PLC).
 *  - `probeTcp` (red local real): puerto abierto → ok; puerto cerrado → refused. La distinción
 *    refused vs timeout es la clave del diagnóstico (host vivo vs paquetes descartados).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import {
  buildVerdict,
  pingHost,
  probeTcp,
  RouteCheckService,
  type ProbeResult,
  type RouteCheckReport,
} from '../src/infrastructure/connectivity/route-check.service';
import { msUntilNextTopOfHour, RouteProbeSampler } from '../src/infrastructure/connectivity/route-probe.sampler';
import { buildRouteHistory } from '../src/infrastructure/connectivity/diagnostics.controller';
import type { AuditEventRow, AuditLogService, AuditEntry } from '../src/infrastructure/audit/audit-log.service';

function probe(name: ProbeResult['name'], outcome: ProbeResult['outcome']): ProbeResult {
  return { name, target: 'x:1', outcome, ms: 1, detail: null };
}

// ── Veredicto (puro) ─────────────────────────────────────────────────────────

test('route-check: sin internet en el SERVIDOR → SRV-07, la culpa NO es de la planta', () => {
  const v = buildVerdict(probe('internet', 'timeout'), probe('plc', 'timeout'));
  assert.equal(v.code, 'SRV-07');
  assert.equal(v.where, 'servidor');
  assert.match(v.message, /no en la planta/i);
});

test('route-check: internet OK + PLC timeout → PLC-01 (ruta o planta, no el servidor)', () => {
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'timeout'));
  assert.equal(v.code, 'PLC-01');
  assert.equal(v.where, 'ruta-o-planta');
  assert.match(v.message, /no en el servidor/i);
});

test('route-check: internet OK + PLC rechaza → PLC-11 (host vivo, servicio OPC caído)', () => {
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'refused'));
  assert.equal(v.code, 'PLC-11');
  assert.equal(v.where, 'plc-servicio');
});

test('route-check: internet OK + PLC acepta → sin fallo de red (mirar la sesión OPC)', () => {
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'ok'));
  assert.equal(v.code, '—');
  assert.equal(v.where, 'ninguno');
});

test('route-check: error de socket hacia el PLC (p. ej. ENOTFOUND) también es ruta-o-planta', () => {
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'error'));
  assert.equal(v.code, 'PLC-01');
});

test('route-check: ping OK + TCP timeout → PLC-12 (host VIVO, puerto FILTRADO — evidencia 2026-07-22)', () => {
  // El caso real: Test-NetConnection dio PingSucceeded=True (21 ms) y TcpTestSucceeded=False.
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'timeout'), probe('ping', 'ok'));
  assert.equal(v.code, 'PLC-12');
  assert.equal(v.where, 'ruta-o-planta');
  assert.match(v.message, /VIVO/);
  assert.match(v.message, /FILTRANDO/i);
});

test('route-check: ping también muerto + TCP timeout → PLC-01 (host oscuro)', () => {
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'timeout'), probe('ping', 'timeout'));
  assert.equal(v.code, 'PLC-01');
});

test('route-check: el puerto aceptando manda sobre el ping (ruta OK aunque el ping fallara)', () => {
  const v = buildVerdict(probe('internet', 'ok'), probe('plc', 'ok'), probe('ping', 'timeout'));
  assert.equal(v.code, '—');
});

// ── Sonda TCP (red local real, sin OPC UA) ───────────────────────────────────

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

test('probeTcp: puerto abierto → ok con latencia medida', async () => {
  const { server, port } = await listen();
  try {
    const r = await probeTcp('plc', '127.0.0.1', port, 2000);
    assert.equal(r.outcome, 'ok');
    assert.equal(r.target, `127.0.0.1:${port}`);
    assert.ok(r.ms >= 0);
  } finally {
    server.close();
  }
});

test('probeTcp: puerto cerrado → refused (host vivo, nada escucha)', async () => {
  // Puerto recién liberado: el SO responde RST → ECONNREFUSED, no timeout.
  const { server, port } = await listen();
  await new Promise((resolve) => server.close(resolve));
  const r = await probeTcp('plc', '127.0.0.1', port, 2000);
  assert.equal(r.outcome, 'refused');
});

// ── Ping ICMP (comando del sistema) ──────────────────────────────────────────

test('pingHost: localhost responde → ok', async () => {
  const r = await pingHost('127.0.0.1');
  assert.equal(r.outcome, 'ok');
  assert.equal(r.name, 'ping');
});

test('pingHost: host con caracteres ilegítimos → error sin tocar el sistema', async () => {
  const r = await pingHost('1.2.3.4; rm -rf /');
  assert.equal(r.outcome, 'error');
  assert.equal(r.detail, 'host inválido');
});

// ── Sampler (registro continuo) ──────────────────────────────────────────────

test('sampler: una muestra corre las sondas y persiste opc.route_probe con veredicto compacto', async () => {
  const report: RouteCheckReport = {
    at: '2026-07-22T13:00:00.000Z',
    target: { endpoint: 'opc.tcp://181.204.165.66:59100', host: '181.204.165.66', port: 59100 },
    serverPublicIp: null,
    probes: [
      { name: 'internet', target: '8.8.8.8:53', outcome: 'ok', ms: 20, detail: null },
      { name: 'ping', target: '181.204.165.66', outcome: 'ok', ms: 21, detail: null },
      { name: 'plc', target: '181.204.165.66:59100', outcome: 'timeout', ms: 5000, detail: null },
    ],
    verdict: { code: 'PLC-12', where: 'ruta-o-planta', message: 'x' },
    bridge: { status: 'Connecting', reconnectCount: 0, lastNotificationAt: null },
  };
  const recorded: AuditEntry[] = [];
  const sampler = new RouteProbeSampler(
    { run: async () => report } as unknown as RouteCheckService,
    { record: async (e: AuditEntry) => void recorded.push(e) } as unknown as AuditLogService,
  );

  await sampler.sample();

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].eventType, 'opc.route_probe');
  const detail = recorded[0].detail as { source: string; code: string; bridge: string; probes: Record<string, { outcome: string; ms: number }> };
  assert.equal(detail.source, 'auto'); // las de cada hora en punto quedan marcadas automáticas
  assert.equal(detail.code, 'PLC-12');
  assert.equal(detail.bridge, 'Connecting');
  assert.equal(detail.probes.ping.outcome, 'ok');
  assert.equal(detail.probes.plc.outcome, 'timeout');

  // La prueba MANUAL (botón) también se GRABA — entra al registro como cualquier muestra.
  const returned = await sampler.manualCheck();
  assert.equal(returned.verdict.code, 'PLC-12');
  assert.equal(recorded.length, 2);
  assert.equal((recorded[1].detail as { source: string }).source, 'manual');
});

test('msUntilNextTopOfHour: siempre apunta a la próxima hora EN PUNTO', () => {
  const h530 = Date.UTC(2026, 6, 22, 5, 30, 0); // prueba manual a las 5:30 → automática a las 6:00
  assert.equal(msUntilNextTopOfHour(h530), 30 * 60_000);
  const h559 = Date.UTC(2026, 6, 22, 5, 59, 59, 500);
  assert.equal(msUntilNextTopOfHour(h559), 500);
  const enPunto = Date.UTC(2026, 6, 22, 6, 0, 0);
  assert.equal(msUntilNextTopOfHour(enPunto), 3_600_000); // ya en punto → la siguiente completa
});

test('sampler: nunca lanza aunque la prueba de ruta falle', async () => {
  const sampler = new RouteProbeSampler(
    { run: async () => { throw new Error('boom'); } } as unknown as RouteCheckService,
    { record: async () => undefined } as unknown as AuditLogService,
  );
  await assert.doesNotReject(() => sampler.sample());
});

// ── Resumen del registro continuo (puro) ─────────────────────────────────────

function sampleRow(at: string, code: string): AuditEventRow {
  return { at, eventType: 'opc.route_probe', detail: { code } };
}

test('buildRouteHistory: cuenta OK/fallo, calcula uptime y el inicio del corte VIGENTE', () => {
  const now = Date.now();
  const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  // Más reciente primero (como llega de la BD): 2 fallos vigentes tras un OK, y un fallo viejo.
  const rows = [
    sampleRow(iso(5), 'PLC-12'),
    sampleRow(iso(10), 'PLC-12'),
    sampleRow(iso(15), '—'),
    sampleRow(iso(20), 'PLC-01'),
    sampleRow(iso(60 * 30), 'PLC-01'), // fuera de la ventana de 24 h
  ];

  const { summary, samples } = buildRouteHistory(rows, 24);
  assert.equal(samples.length, 4, 'la muestra de hace 30 h queda fuera');
  assert.equal(summary.plcOk, 1);
  assert.equal(summary.uptimePct, 25);
  // El corte vigente empezó en la muestra de hace 10 min (la racha se rompe en el OK de hace 15).
  assert.equal(summary.downSince, rows[1].at);
});

test('buildRouteHistory: última muestra OK → sin corte vigente; sin muestras → resumen vacío', () => {
  const now = new Date().toISOString();
  const ok = buildRouteHistory([sampleRow(now, '—')], 24);
  assert.equal(ok.summary.downSince, null);
  assert.equal(ok.summary.uptimePct, 100);

  const empty = buildRouteHistory([], 24);
  assert.equal(empty.summary.samples, 0);
  assert.equal(empty.summary.downSince, null);
});
