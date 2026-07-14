/**
 * ETAPA 03 — Análisis (FASES 3–8 y 11). OFFLINE: no toca el servidor.
 * Consume output/01_nodes.json + output/02_readings.json y produce output/03_analysis.json.
 * Re-ejecutable libremente mientras se afinan las heurísticas.
 */
import { loadConfig } from '../config';
import { loadArtifact, saveArtifact } from '../lib/artifacts';
import { expandSignals, type Signal } from '../heuristics/signals';
import { buildSiteModels, pollingStrategy, type PollingRule, type SiteModel } from '../heuristics/model';
import type { NodesArtifact, ReadingsArtifact } from '../types';

export interface AnalysisArtifact {
  generadoEl: string;
  fuente: { nodos: string; lecturas: string; capturadoEl: string };
  arquitecturaDetectada: {
    tipo: string;
    descripcion: string;
    evidencia: string[];
  };
  semanticaDisponible: {
    engineeringUnitsEncontradas: number;
    euRangeEncontrados: number;
    descripcionesEncontradas: number;
    modeloOptixVacio: boolean;
    alarmasOptixVacias: boolean;
    conclusion: string;
  };
  fiabilidadMuestreo: {
    buffersArray: number;
    buffersArrayConRelecturaBad: number;
    conclusion: string;
  };
  sitios: SiteModel[];
  señales: Signal[];
  comandosCandidatos: Signal[];
  estrategiaComunicacion: PollingRule[];
  resumen: {
    totalSeñales: number;
    señalesConfirmadas: number;
    señalesRequierenValidacion: number;
    señalesEnCero: number;
    señalesConMovimiento: number;
    buffersEscribibles: number;
  };
}

export function analyze(nodes: NodesArtifact, readings: ReadingsArtifact): AnalysisArtifact {
  const signals = expandSignals(readings.readings);
  const sitios = buildSiteModels(signals);

  const comandosCandidatos = signals.filter(
    (s) => s.writableByServer && s.direction === 'maestro→plc_local',
  );

  const optixModelEmpty = nodes.roots.find((r) => r.label === 'OptixModel')?.nodeCount === 0;
  const optixAlarmsEmpty = nodes.roots.find((r) => r.label === 'OptixAlarms')?.nodeCount === 0;

  const withDescription = readings.readings.filter((r) => r.attrs.description).length;

  const arrayReadings = readings.readings.filter((r) => Array.isArray(r.samples[0]?.value));
  const arraysBadOnResample = arrayReadings.filter(
    (r) => r.samples.length > 1 && r.samples.slice(1).every((s) => s.statusCode.severity === 'Bad'),
  ).length;

  return {
    generadoEl: new Date().toISOString(),
    fuente: {
      nodos: '01_nodes.json',
      lecturas: '02_readings.json',
      capturadoEl: readings.capturedAt,
    },
    arquitecturaDetectada: {
      tipo: 'PLC maestro concentrador (gateway EtherNet/IP ↔ MSG)',
      descripcion:
        'El CompactLogix no controla directamente los equipos: intercambia BUFFERS DE ARRAY con los PLC locales de cada sitio mediante instrucciones MSG de Rockwell. ' +
        'Los datos de proceso llegan en arrays REAL/INT sin nombre por elemento; los comandos salen por arrays INT_OUT/REAL_OUT.',
      evidencia: [
        `Se detectaron ${sitios.length} sitios remotos en los nombres de los buffers: ${sitios.map((s) => s.site).join(', ')}`,
        'Existen estructuras MESSAGE (MSG_READ_* / MSG_WRITE_*) de Rockwell, una por sitio y por tipo de dato, con sus bits DN/ER/TO',
        'Los buffers de datos son Variables únicas con valor de tipo array (ValueRank≥1), no colecciones de nodos hijos',
        'Los tags Local:N:C/I/O corresponden a los módulos de E/S del propio chasis CompactLogix',
      ],
    },
    semanticaDisponible: {
      engineeringUnitsEncontradas: readings.stats.withEngineeringUnits,
      euRangeEncontrados: readings.readings.filter((r) => r.attrs.euRange).length,
      descripcionesEncontradas: withDescription,
      modeloOptixVacio: !!optixModelEmpty,
      alarmasOptixVacias: !!optixAlarmsEmpty,
      conclusion:
        readings.stats.withEngineeringUnits === 0 && optixModelEmpty
          ? 'EL SERVIDOR NO EXPONE SEMÁNTICA DE PROCESO. Ningún tag declara EngineeringUnits, EURange ni Description, ' +
            'y el modelo de datos del HMI Optix (Model/Alarms/Converters/Loggers) está vacío. ' +
            'Por lo tanto, el significado de cada índice de array NO es descubrible por OPC UA y NO PUEDE INFERIRSE CON CERTEZA. ' +
            'Requisito bloqueante: obtener el export L5X/ACD del programa del PLC (o la tabla de mapeo del integrador).'
          : 'Se encontró semántica parcial en el servidor; ver detalle por señal.',
    },
    fiabilidadMuestreo: {
      buffersArray: arrayReadings.length,
      buffersArrayConRelecturaBad: arraysBadOnResample,
      conclusion:
        `De ${arrayReadings.length} buffers de array, ${arraysBadOnResample} devolvieron BadInternalError al re-leerse ` +
        `(muestras 2 y 3). El driver RAEtherNet_IP de Optix hace fetch bajo demanda y no sostiene re-lecturas completas y ` +
        `frecuentes de todos los arrays a la vez. IMPLICACIÓN: la detección de movimiento/totalizadores por lectura puntual ` +
        `es NO CONCLUYENTE (solo la muestra 1 es fiable en muchos buffers); en producción, la evolución temporal DEBE ` +
        `observarse mediante una Subscription con MonitoredItems, no por polling agresivo de Read.`,
    },
    sitios,
    señales: signals,
    comandosCandidatos,
    estrategiaComunicacion: pollingStrategy(signals),
    resumen: {
      totalSeñales: signals.length,
      señalesConfirmadas: signals.filter((s) => s.estado === 'CONFIRMADO').length,
      señalesRequierenValidacion: signals.filter((s) => s.estado === 'REQUIERE VALIDACIÓN EN PLANTA').length,
      señalesEnCero: signals.filter((s) => s.movement.allZero).length,
      señalesConMovimiento: signals.filter((s) => s.movement.changed).length,
      buffersEscribibles: new Set(comandosCandidatos.map((s) => s.bufferBrowseName)).size,
    },
  };
}

export function runAnalyze(): AnalysisArtifact {
  const config = loadConfig();
  const nodes = loadArtifact<NodesArtifact>(config.outputDir, '01_nodes.json');
  const readings = loadArtifact<ReadingsArtifact>(config.outputDir, '02_readings.json');

  const artifact = analyze(nodes, readings);

  console.log(`[03] arquitectura: ${artifact.arquitecturaDetectada.tipo}`);
  console.log(`[03] sitios: ${artifact.sitios.map((s) => `${s.site}(${s.comunicacion.estado})`).join(' ')}`);
  console.log(
    `[03] señales=${artifact.resumen.totalSeñales} confirmadas=${artifact.resumen.señalesConfirmadas} ` +
      `requierenValidación=${artifact.resumen.señalesRequierenValidacion} enCero=${artifact.resumen.señalesEnCero} ` +
      `conMovimiento=${artifact.resumen.señalesConMovimiento}`,
  );
  console.log(`[03] comandos candidatos (escribibles hacia PLC local): ${artifact.comandosCandidatos.length}`);
  console.log(`[03] ${artifact.semanticaDisponible.conclusion}`);

  saveArtifact(config.outputDir, '03_analysis.json', artifact);
  return artifact;
}

if (require.main === module) {
  try {
    runAnalyze();
  } catch (err) {
    console.error(`\n[03] FALLÓ: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
