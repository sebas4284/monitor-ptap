import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import os from 'node:os';

// Diagnostic CPU profile; this does not produce or replace a Lighthouse score.
const base = process.env.LH_BASE_URL || 'http://localhost:8082';
assert.ok(process.env.LH_EMAIL && process.env.LH_PASSWORD, 'Authorized test credentials required');
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const seed = await browser.newPage();
  await seed.goto(base + '/login', { waitUntil: 'networkidle2' });
  await seed.type('input[aria-label="Correo electrónico"]', process.env.LH_EMAIL);
  await seed.type('input[aria-label="Contraseña"]', process.env.LH_PASSWORD);
  await seed.click('button[aria-busy]');
  await seed.waitForFunction(() => location.pathname === '/tablero');
  await seed.waitForSelector('[aria-label="Buscar señal o unidad"]');
  await (await seed.createCDPSession()).send('Network.clearBrowserCache');
  await seed.close();
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 823, isMobile: true, deviceScaleFactor: 1.75 });
  const cdp = await page.createCDPSession();
  await cdp.send('Profiler.enable');
  const cpuStats = () => Object.fromEntries(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8')
    .trim().split('\n').map(line => { const [key, value] = line.split(/\s+/); return [key, Number(value)]; }));
  const beforeCpu = cpuStats();
  await cdp.send('Profiler.start');
  await page.goto(base + '/tablero', { waitUntil: 'networkidle2' });
  await page.waitForSelector('[aria-label="Buscar señal o unidad"]');
  const { profile } = await cdp.send('Profiler.stop');
  const afterCpu = cpuStats();
  assert.ok(profile.samples.length > 0, 'CPU sampling did not run');
  assert.equal(new URL(page.url()).pathname, '/tablero');
  fs.mkdirSync('/audit/profiles', { recursive: true });
  fs.writeFileSync('/audit/profiles/startup.cpuprofile', JSON.stringify(profile));
  const totals = new Map();
  for (let index = 0; index < profile.samples.length; index++) {
    const id = profile.samples[index];
    totals.set(id, (totals.get(id) || 0) + profile.timeDeltas[index]);
  }
  const rows = profile.nodes
    .map((node) => ({ ...node.callFrame, selfMs: (totals.get(node.id) || 0) / 1000 }))
    .sort((a, b) => b.selfMs - a.selfMs);
  fs.writeFileSync('/audit/profiles/self-time.json', JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows.slice(0, 25), null, 2));
  const metrics = await page.metrics();
  fs.writeFileSync('/audit/profiles/page-metrics.json', JSON.stringify(metrics, null, 2));
  const cpu = { cpuMax: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
    cpuset: fs.readFileSync('/sys/fs/cgroup/cpuset.cpus.effective', 'utf8').trim(),
    visibleCpuCount: os.cpus().length, availableParallelism: os.availableParallelism(),
    before: beforeCpu, after: afterCpu,
    delta: Object.fromEntries(Object.keys(afterCpu).map(key => [key, afterCpu[key] - beforeCpu[key]])) };
  assert.ok(cpu.delta.nr_throttled >= 0 && cpu.delta.nr_periods >= 0);
  fs.writeFileSync('/audit/profiles/cpu-cgroup.json', JSON.stringify(cpu, null, 2));
  console.log(JSON.stringify(metrics));
  console.log(JSON.stringify(cpu));
} finally {
  await browser.close();
}
