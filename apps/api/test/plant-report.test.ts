import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFreshness, FreshnessService } from '../src/infrastructure/connectivity/opcua/freshness.service';
import { buildPlantReport, type PlantReportInput } from '../src/infrastructure/connectivity/diagnostics/plant-report';
import { PlantReportService } from '../src/infrastructure/connectivity/diagnostics/plant-report.service';
import type { ConnectivityAdapter, AdapterDiagnostics } from '../src/infrastructure/connectivity/ports/connectivity-adapter.port';
import type { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { AuditLogService } from '../src/infrastructure/audit/audit-log.service';
import type { LoadedMapping } from '../src/infrastructure/connectivity/mapping/opc-mapping.loader';

const at = '2026-11-11T12:00:00.000Z';
const now = Date.parse(at);
test('freshness never reports green for missing, invalid, future or non-Good source timestamps', () => {
  for (const timestamp of [null, 'invalid', '2026-11-12T12:00:00Z']) assert.equal(assessFreshness('realIn', true, timestamp, now).veredicto, 'indeterminado');
  assert.equal(assessFreshness('realIn', false, at, now).veredicto, 'indeterminado');
  assert.equal(assessFreshness('realIn', true, at, now).veredicto, 'fresco');
  assert.equal(assessFreshness('realIn', true, '2026-11-10T12:00:00Z', now).veredicto, 'congelado');
  assert.equal(assessFreshness('intOut', true, '2026-11-10T12:00:00Z', now).veredicto, 'comando');
});

test('report filters plant buffers/anomalies without degrading healthy buffers or inventing signal timestamps', () => {
  const input = {
    plantId: 'a', displayName: 'A', at,
    diagnostics: { bridgeStatus: 'Connected', lastNotificationAt: at, perPlant: [{plantId: 'a', lastFrameAt: at}] } as AdapterDiagnostics,
    buffers: [
      {plantId: 'a', browseName: 'good', channel: 'realIn', resolved: true, faulted: false, reason: null},
      {plantId: 'a', browseName: 'bad', channel: 'intIn', resolved: false, faulted: true, reason: 'bad node'},
      {plantId: 'b', browseName: 'other', channel: 'realIn', resolved: false, faulted: true, reason: 'other'},
    ],
    snapshot: null, anomalies: [{plantId: 'b', domainKey:'x', at, type:'BUFFER_MISSING', detail:'other'}],
    routeEvents: [], connectionEvents: [],
  } satisfies PlantReportInput;
  const report = buildPlantReport(input);
  assert.equal(report.buffers.length, 2);
  assert.equal(report.buffers[0].faulted, false);
  assert.equal(report.buffers[0].sourceTimestamp, null);
  assert.equal(report.buffers[1].faulted, true);
  assert.deepEqual(report.anomalies, []);
  assert.deepEqual(report.signals, []);
  assert.equal(report.freshness, null);
  assert.equal(report.deepProbe, false);
});

test('cache report performs zero direct reads; explicit deep reads only selected plant; unknown plant is 404', async () => {
  let reads = 0;
  const adapter = {
    getDiagnostics: () => ({bridgeStatus:'Connected', perPlant:[]} as unknown as AdapterDiagnostics),
    getBufferHealth: () => [],
    readBufferFreshness: async (plantId: string) => { reads++; assert.equal(plantId, 'a'); return {sourceTimestamp:null, statusCode:'BadUserAccessDenied', good:false}; },
  } as unknown as ConnectivityAdapter;
  const mapping = {plants:[{plantId:'a', displayName:'A', livenessWindowSec:null}], targets:[
    {plantId:'a', browseName:'a-in', channel:'realIn'}, {plantId:'b', browseName:'b-in', channel:'realIn'},
  ]} as LoadedMapping;
  const pipeline = {getMapping:()=>mapping, getLatestBuffers:()=>undefined, getDeadLetter:()=>({recent:[]})} as unknown as PlantPipelineService;
  const audit = {listByEventType:async()=>[]} as unknown as AuditLogService;
  const service = new PlantReportService(adapter, pipeline, new PlantCache(), audit, new FreshnessService(adapter));
  await service.report('a');
  assert.equal(reads, 0);
  const deep = await service.report('a', true);
  assert.equal(reads, 1);
  assert.equal(deep.freshness?.[0].veredicto, 'indeterminado');
  await assert.rejects(service.report('unknown'), {status:404});
  assert.equal(reads, 1);
});

test('deep diagnostics stays indeterminate on unavailable simulator or failing session', async () => {
  const targets = [{plantId:'a', browseName:'in', channel:'realIn'}] as LoadedMapping['targets'];
  for (const adapter of [{}, {readBufferFreshness:async()=>{throw new Error('session lost');}}]) {
    const service = new FreshnessService(adapter as ConnectivityAdapter);
    const result = await service.probe(targets);
    assert.equal(result[0].veredicto, 'indeterminado');
    assert.equal(result[0].sourceTimestamp, null);
  }
});
