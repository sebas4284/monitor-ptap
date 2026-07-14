/**
 * ETAPA 02 — Atributos, unidades de ingeniería y muestras temporales (FASE 2).
 * Lee (Read, nunca Write) todos los atributos de cada Variable, las propiedades
 * EngineeringUnits / EURange / InstrumentRange, y N muestras de Value espaciadas
 * para detectar movimiento, totalizadores y escalamientos RAW→EU.
 */
// Nota: ClientSession.read de node-opcua emite TimestampsToReturn.Both, por lo que
// cada DataValue trae sourceTimestamp y serverTimestamp sin configuración extra.
import { AttributeIds } from 'node-opcua';
import type { DataValue, ReadValueIdOptions } from 'node-opcua';
import { loadConfig } from '../config';
import { connectReadOnly } from '../lib/client';
import { loadArtifact, saveArtifact } from '../lib/artifacts';
import { readInBatches } from '../lib/batching';
import { resolveTypeNames } from '../lib/datatype-resolver';
import { decodeAccessLevel } from '../lib/access-level';
import { sleep } from '../lib/throttle';
import {
  dataValueToSample,
  localizedTextToString,
  toJsonValue,
  variantTypeName,
} from '../lib/values';
import type {
  EndpointsArtifact,
  EuInformationJson,
  NodesArtifact,
  RangeJson,
  ReadingsArtifact,
  ValueSample,
  VariableReading,
} from '../types';

const EU_PROPERTY_NAMES = new Set(['engineeringunits', 'eurange', 'instrumentrange']);

const ATTRS: AttributeIds[] = [
  AttributeIds.Description,
  AttributeIds.DataType,
  AttributeIds.ValueRank,
  AttributeIds.ArrayDimensions,
  AttributeIds.AccessLevel,
  AttributeIds.UserAccessLevel,
  AttributeIds.MinimumSamplingInterval,
  AttributeIds.Historizing,
  AttributeIds.Value,
];

function asRange(v: unknown): RangeJson | null {
  const o = v as { low?: unknown; high?: unknown } | null;
  if (!o || typeof o.low !== 'number' || typeof o.high !== 'number') return null;
  return { low: o.low, high: o.high };
}

function asEuInformation(v: unknown): EuInformationJson | null {
  const o = v as
    | { displayName?: unknown; description?: unknown; unitId?: unknown; namespaceUri?: unknown }
    | null;
  if (!o) return null;
  const displayName = localizedTextToString(o.displayName);
  const description = localizedTextToString(o.description);
  const unitId = typeof o.unitId === 'number' ? o.unitId : null;
  if (displayName === null && description === null && unitId === null) return null;
  return {
    displayName,
    description,
    unitId,
    namespaceUri: typeof o.namespaceUri === 'string' ? o.namespaceUri : null,
  };
}

function analyzeMovement(samples: ValueSample[]): VariableReading['movement'] {
  const good = samples.filter((s) => s.statusCode.severity === 'Good');
  if (good.length === 0) return null;
  const numeric = good.every((s) => typeof s.value === 'number');
  if (!numeric) {
    const distinct = new Set(good.map((s) => JSON.stringify(s.value)));
    return {
      changed: distinct.size > 1,
      numeric: false,
      min: null,
      max: null,
      monotonicNonDecreasing: false,
    };
  }
  const values = good.map((s) => s.value as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  let monotonic = true;
  for (let i = 1; i < values.length; i++) if (values[i] < values[i - 1]) monotonic = false;
  return {
    changed: max !== min,
    numeric: true,
    min,
    max,
    monotonicNonDecreasing: monotonic && max > min,
  };
}

export async function runRead(): Promise<ReadingsArtifact> {
  const config = loadConfig();
  const preflight = loadArtifact<EndpointsArtifact>(config.outputDir, '00_endpoints.json');
  const nodesArtifact = loadArtifact<NodesArtifact>(config.outputDir, '01_nodes.json');
  const readBatch = preflight.effectiveBatches.read;

  const allVariables = nodesArtifact.nodes.filter((n) => n.nodeClass === 'Variable');
  // Las propiedades EU son hijas HasProperty: se leen con su padre, no como variables sueltas.
  const euProperties = allVariables.filter((n) => EU_PROPERTY_NAMES.has(n.browseName.toLowerCase()));
  const variables = allVariables.filter((n) => !EU_PROPERTY_NAMES.has(n.browseName.toLowerCase()));

  const euByParent = new Map<string, Record<string, string>>();
  for (const p of euProperties) {
    const entry = euByParent.get(p.parentNodeId) ?? {};
    entry[p.browseName.toLowerCase()] = p.nodeId;
    euByParent.set(p.parentNodeId, entry);
  }

  console.log(
    `[02] ${variables.length} variables a leer (+${euProperties.length} propiedades de ingeniería)`,
  );

  const conn = await connectReadOnly(config);
  try {
    // ── Muestra 1: todos los atributos + Value ────────────────────────────────
    const attrItems: ReadValueIdOptions[] = [];
    for (const v of variables) {
      for (const attributeId of ATTRS) attrItems.push({ nodeId: v.nodeId, attributeId });
    }
    const t0 = new Date();
    const attrValues = await readInBatches(
      conn.session,
      attrItems,
      readBatch,
      config.throttleMs,
      'atributos',
    );

    // ── Propiedades EU ────────────────────────────────────────────────────────
    const euItems: ReadValueIdOptions[] = euProperties.map((p) => ({
      nodeId: p.nodeId,
      attributeId: AttributeIds.Value,
    }));
    const euValues = euItems.length
      ? await readInBatches(conn.session, euItems, readBatch, config.throttleMs, 'unidades')
      : [];
    const euValueByNodeId = new Map<string, DataValue>();
    euProperties.forEach((p, i) => euValueByNodeId.set(p.nodeId, euValues[i]));

    // ── Resolución de DataTypes a nombres legibles ────────────────────────────
    const dataTypeNodeIds: string[] = [];
    variables.forEach((_, i) => {
      const dv = attrValues[i * ATTRS.length + 1]; // DataType
      const id = dv?.value?.value;
      if (id) dataTypeNodeIds.push(String(id));
    });
    const typeDefNodeIds = nodesArtifact.nodes
      .map((n) => n.typeDefinition)
      .filter((t): t is string => !!t);
    const typeNames = await resolveTypeNames(
      conn.session,
      [...dataTypeNodeIds, ...typeDefNodeIds],
      readBatch,
      config.throttleMs,
    );

    // ── Ensamblado de lecturas ────────────────────────────────────────────────
    const readings: VariableReading[] = variables.map((v, i) => {
      const base = i * ATTRS.length;
      const get = (offset: number) => attrValues[base + offset];
      const dataTypeId = get(1)?.value?.value ? String(get(1).value.value) : 'null';
      const arrayDimsRaw = get(3)?.value?.value;
      const valueDv = get(8);
      const eu = euByParent.get(v.nodeId) ?? {};
      const euDv = eu['engineeringunits'] ? euValueByNodeId.get(eu['engineeringunits']) : undefined;
      const euRangeDv = eu['eurange'] ? euValueByNodeId.get(eu['eurange']) : undefined;
      const instrDv = eu['instrumentrange'] ? euValueByNodeId.get(eu['instrumentrange']) : undefined;

      return {
        nodeId: v.nodeId,
        browseName: v.browseName,
        displayName: v.displayName,
        fullBrowsePath: v.fullBrowsePath,
        parentNodeId: v.parentNodeId,
        attrs: {
          description: get(0)?.value ? localizedTextToString(get(0).value.value) : null,
          dataType: { nodeId: dataTypeId, name: typeNames[dataTypeId] ?? dataTypeId },
          valueRank: typeof get(2)?.value?.value === 'number' ? (get(2).value.value as number) : -1,
          arrayDimensions: Array.isArray(arrayDimsRaw)
            ? (toJsonValue(arrayDimsRaw) as number[])
            : arrayDimsRaw && ArrayBuffer.isView(arrayDimsRaw)
              ? Array.from(arrayDimsRaw as unknown as ArrayLike<number>)
              : null,
          accessLevel: decodeAccessLevel(get(4)?.value?.value as number | undefined),
          userAccessLevel: (() => {
            const d = decodeAccessLevel(get(5)?.value?.value as number | undefined);
            return { raw: d.raw, currentRead: d.currentRead, currentWrite: d.currentWrite };
          })(),
          minimumSamplingInterval:
            typeof get(6)?.value?.value === 'number' ? (get(6).value.value as number) : null,
          historizing: get(7)?.value?.value === true,
          engineeringUnits: euDv?.value ? asEuInformation(euDv.value.value) : null,
          euRange: euRangeDv?.value ? asRange(euRangeDv.value.value) : null,
          instrumentRange: instrDv?.value ? asRange(instrDv.value.value) : null,
        },
        valueVariantType: valueDv?.value ? variantTypeName(valueDv.value) : null,
        samples: valueDv ? [dataValueToSample(valueDv, t0)] : [],
        movement: null,
      };
    });

    // ── Muestras 2..N: SOLO Value (los atributos son estáticos) ───────────────
    const valueItems: ReadValueIdOptions[] = variables.map((v) => ({
      nodeId: v.nodeId,
      attributeId: AttributeIds.Value,
    }));
    for (let s = 1; s < config.sampleCount; s++) {
      console.log(
        `[02] esperando ${config.sampleIntervalMs / 1000}s para la muestra ${s + 1}/${config.sampleCount}…`,
      );
      await sleep(config.sampleIntervalMs);
      const tN = new Date();
      const dvs = await readInBatches(
        conn.session,
        valueItems,
        readBatch,
        config.throttleMs,
        `muestra${s + 1}`,
      );
      dvs.forEach((dv, i) => readings[i].samples.push(dataValueToSample(dv, tN)));
    }

    for (const r of readings) r.movement = analyzeMovement(r.samples);

    const severityOf = (r: VariableReading) => r.samples[0]?.statusCode.severity ?? 'Bad';
    const artifact: ReadingsArtifact = {
      capturedAt: new Date().toISOString(),
      endpointUrl: config.endpointUrl,
      sampleCount: config.sampleCount,
      sampleIntervalMs: config.sampleIntervalMs,
      namespaces: nodesArtifact.namespaces,
      typeDefinitionNames: typeNames,
      readings,
      stats: {
        variablesRead: readings.length,
        goodValues: readings.filter((r) => severityOf(r) === 'Good').length,
        uncertainValues: readings.filter((r) => severityOf(r) === 'Uncertain').length,
        badValues: readings.filter((r) => severityOf(r) === 'Bad').length,
        withEngineeringUnits: readings.filter((r) => r.attrs.engineeringUnits).length,
        writableByServer: readings.filter((r) => r.attrs.accessLevel.currentWrite).length,
        writableByUser: readings.filter((r) => r.attrs.userAccessLevel.currentWrite).length,
        changedDuringSampling: readings.filter((r) => r.movement?.changed).length,
      },
    };

    console.log(
      `[02] leídas=${artifact.stats.variablesRead} good=${artifact.stats.goodValues} bad=${artifact.stats.badValues} ` +
        `conEU=${artifact.stats.withEngineeringUnits} escribibles(servidor)=${artifact.stats.writableByServer} ` +
        `escribibles(usuario)=${artifact.stats.writableByUser} conMovimiento=${artifact.stats.changedDuringSampling}`,
    );
    saveArtifact(config.outputDir, '02_readings.json', artifact);
    return artifact;
  } finally {
    await conn.session.close().catch(() => undefined);
    await conn.disconnect();
  }
}

if (require.main === module) {
  runRead().catch((err) => {
    console.error(`\n[02] FALLÓ: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
