import type { SignalDto } from './api';
import { hasRangeAnomaly } from './alerts';
import { directionFor } from './signal-kind';
import { isTankSignal } from './tanks';
import { isValveSignal } from './valves';

/**
 * Agrupación de las señales del tablero por dirección de proceso.
 *
 * Motivo: en La Sirena el tablero pinta ~22 tarjetas y más de 100 números en una sola página, sin
 * jerarquía. La dirección (entrada/salida) ya se calculaba en `signal-kind.ts` pero solo se usaba
 * para elegir un color de acento. Aquí se usa para dar estructura.
 *
 * Regla de seguridad que gobierna esto: **estructurar y jerarquizar, nunca esconder una anomalía.**
 * Por eso un grupo con alguna señal anómala o congelada NO se puede plegar (`lockedOpen`), y la
 * definición de "anómala" es la MISMA que usa la campana de alertas (`hasRangeAnomaly`): si cada
 * pantalla tuviera su propio criterio, el tablero podría dejar plegar un grupo cuya señal ya está
 * generando una alerta.
 */

export type GroupId = 'inlet' | 'outlet' | 'process';

export interface SignalGroup {
  id: GroupId;
  title: string;
  entries: [string, SignalDto][];
  /** Señales del grupo con anomalía de rango (física u operativa). */
  anomalyCount: number;
  /** Señales del grupo sin valor utilizable. */
  noDataCount: number;
  /** true si el grupo NO puede plegarse: contiene algo que el operador debe ver sí o sí. */
  lockedOpen: boolean;
}

export interface DashboardSummary {
  total: number;
  anomalies: number;
  noData: number;
}

const TITLES: Record<GroupId, string> = {
  inlet: 'Entrada',
  outlet: 'Salida',
  process: 'Proceso',
};

const ORDER: GroupId[] = ['inlet', 'outlet', 'process'];

/** Señales de gauge del tablero: se excluyen tanques y válvulas, que tienen su propia tarjeta. */
export function dashboardSignals(
  signals: Record<string, SignalDto> | undefined,
): [string, SignalDto][] {
  if (!signals) return [];
  return Object.entries(signals).filter(([key]) => !isTankSignal(key) && !isValveSignal(key));
}

/**
 * Reparte las señales en grupos. Un grupo vacío no se devuelve — no hay encabezados huecos.
 *
 * `frozen` es de la planta entera: si la planta está congelada, TODOS los grupos quedan bloqueados
 * abiertos, porque el operador tiene que ver de un vistazo qué está mirando en frío.
 */
export function groupSignals(entries: [string, SignalDto][], frozen: boolean): SignalGroup[] {
  const buckets: Record<GroupId, [string, SignalDto][]> = { inlet: [], outlet: [], process: [] };

  for (const entry of entries) {
    buckets[directionFor(entry[0]) ?? 'process'].push(entry);
  }

  return ORDER.filter((id) => buckets[id].length > 0).map((id) => {
    const groupEntries = buckets[id];
    // Un solo recorrido para los dos conteos.
    let anomalyCount = 0;
    let noDataCount = 0;
    for (const [, signal] of groupEntries) {
      if (hasRangeAnomaly(signal)) anomalyCount++;
      if (signal.value === null) noDataCount++;
    }
    return {
      id,
      title: TITLES[id],
      entries: groupEntries,
      anomalyCount,
      noDataCount,
      // Nada que requiera atención puede quedar detrás de un gesto.
      lockedOpen: frozen || anomalyCount > 0 || noDataCount > 0,
    };
  });
}

/**
 * Titular del tablero: lo que el operador debe saber antes de leer un solo número.
 * Se deriva de los grupos, que ya contaron: recorrer otra vez las señales daría los mismos
 * números y abriría la puerta a que las dos cuentas se contradigan.
 */
export function summarize(groups: SignalGroup[]): DashboardSummary {
  return groups.reduce<DashboardSummary>(
    (acc, g) => ({
      total: acc.total + g.entries.length,
      anomalies: acc.anomalies + g.anomalyCount,
      noData: acc.noData + g.noDataCount,
    }),
    { total: 0, anomalies: 0, noData: 0 },
  );
}
