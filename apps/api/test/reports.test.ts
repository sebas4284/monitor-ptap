/**
 * Motor de informes por métrica. Verifica: (1) una recolección completa escribe un CSV con las
 * columnas Fecha | Hora | Cantidad y N filas; (2) no se puede lanzar OTRA recolección del MISMO
 * informe mientras uno está en curso (lock); (3) informes de métricas DISTINTAS corren a la vez;
 * (4) una métrica inexistente da 404. Se usan intervalos cortos y un directorio temporal.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';

// Planta/métrica que existen en el mapping real.
const PLANT = 'voragine';
const METRIC = 'inletFlow1';
const METRIC2 = 'tank1Level';

function fakeCache(value: number | null): PlantCache {
  return { get: () => ({ plantId: PLANT, signals: { [METRIC]: { value }, [METRIC2]: { value } } }) } as unknown as PlantCache;
}

/** Construye un ReportsService fresco con env de prueba (el servicio lee env al construir). */
async function build(opts: { intervalMs: number; count: number; value?: number | null }) {
  process.env.REPORTS_DIR = mkdtempSync(join(tmpdir(), 'ptap-reports-'));
  process.env.REPORT_SAMPLE_INTERVAL_MS = String(opts.intervalMs);
  process.env.REPORT_SAMPLE_COUNT = String(opts.count);
  process.env.REPORTS_AUTO_INTERVAL_MS = String(60 * 60 * 1000); // lejos, no interfiere
  delete process.env.REPORTS_AUTO_PLANT;
  const { ReportsService } = await import('../src/modules/reports/reports.service');
  const svc = new ReportsService(fakeCache(opts.value ?? 42));
  svc.onModuleInit();
  return svc;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('reports: una recolección completa escribe un CSV con columnas Fecha,Hora,Cantidad y N filas', async () => {
  const svc = await build({ intervalMs: 15, count: 3, value: 42 });
  try {
    svc.generate(PLANT, METRIC);
    await wait(120); // 3 muestras a 15 ms
    const path = svc.filePath(PLANT, METRIC);
    assert.ok(path, 'debe existir el archivo');
    const csv = readFileSync(path as string, 'utf8');
    const lines = csv.replace(/﻿/g, '').trim().split('\n');
    assert.equal(lines[0], 'sep=,');
    assert.equal(lines[1], 'Fecha,Hora,Cantidad (l/s)');
    const dataRows = lines.slice(2);
    assert.equal(dataRows.length, 3, 'tres filas de datos');
    assert.match(dataRows[0], /^\d{4}-\d{2}-\d{2},\d{2}:\d{2},42\.00$/);
  } finally {
    svc.onModuleDestroy();
  }
});

test('reports: no se puede lanzar otra recolección del MISMO informe en curso (lock → 409)', async () => {
  const svc = await build({ intervalMs: 500, count: 5 }); // queda "collecting" un rato
  try {
    svc.generate(PLANT, METRIC);
    assert.throws(() => svc.generate(PLANT, METRIC), /en curso/i);
    const info = svc.list(PLANT).find((r) => r.metric === METRIC);
    assert.equal(info?.status, 'collecting');
  } finally {
    svc.onModuleDestroy();
  }
});

test('reports: informes de métricas DISTINTAS corren a la vez', async () => {
  const svc = await build({ intervalMs: 500, count: 5 });
  try {
    svc.generate(PLANT, METRIC);
    assert.doesNotThrow(() => svc.generate(PLANT, METRIC2), 'otra métrica no debe chocar con el lock');
    const list = svc.list(PLANT);
    assert.equal(list.find((r) => r.metric === METRIC)?.status, 'collecting');
    assert.equal(list.find((r) => r.metric === METRIC2)?.status, 'collecting');
  } finally {
    svc.onModuleDestroy();
  }
});

test('reports: una métrica inexistente → 404', async () => {
  const svc = await build({ intervalMs: 500, count: 5 });
  try {
    assert.throws(() => svc.generate(PLANT, 'metrica-que-no-existe'), /desconocida/i);
  } finally {
    svc.onModuleDestroy();
  }
});
