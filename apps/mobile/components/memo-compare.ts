import type { SignalDto } from '../services/api';
import type { TankView } from '../services/tanks';
import type { SupervisedValve } from '../hooks/useValveSupervisor';

/**
 * Comparadores POR VALOR para `React.memo` de las tarjetas de dato.
 *
 * Por qué no basta el `React.memo` desnudo: el backend reconstruye el snapshot completo en cada
 * emisión (`plant-pipeline.service.ts` → `rebuildAndMaybeEmit`), así que **todos** los `SignalDto`
 * llegan con identidad nueva cada ~2 s aunque su número no haya cambiado. Con la comparación por
 * referencia que hace `memo` de fábrica, las 22 tarjetas de La Sirena se volverían a renderizar en
 * cada push igual que sin memo. Comparando los campos que de verdad se pintan, solo re-renderiza
 * la tarjeta cuyo valor cambió.
 *
 * Regla al tocar una tarjeta: si empiezas a mostrar un campo nuevo del DTO, **agrégalo aquí**. Un
 * campo pintado y no comparado se queda congelado en pantalla — es el modo de fallo de este patrón,
 * y en un tablero de planta significa mostrar un dato viejo como si fuera fresco.
 */

/** Campos de `SignalDto` que las tarjetas pintan. `quality`/`usable`/`ts` no se muestran. */
function sameSignal(a: SignalDto, b: SignalDto): boolean {
  return (
    a.value === b.value &&
    a.unit === b.unit &&
    a.label === b.label &&
    a.opMin === b.opMin &&
    a.opMax === b.opMax &&
    a.outOfRange === b.outOfRange &&
    a.reason === b.reason
  );
}

interface SignalCardProps {
  signal: SignalDto;
  name: string;
  icon: string;
  frozen?: boolean;
  /** Modo compacto del tablero: oculta las filas de rango. */
  compact?: boolean;
}

/** Para `GaugeCard` y `FlowMeterCard`. */
export function sameSignalCard(a: SignalCardProps, b: SignalCardProps): boolean {
  return (
    a.name === b.name &&
    a.icon === b.icon &&
    a.frozen === b.frozen &&
    a.compact === b.compact &&
    sameSignal(a.signal, b.signal)
  );
}

interface TankCardProps {
  tank: TankView;
  frozen?: boolean;
}

interface ValveItemProps {
  valve: SupervisedValve;
  onToggle?: (valve: SupervisedValve) => void;
  frozen?: boolean;
  busy?: boolean;
  compact?: boolean;
}

/**
 * Para `ValveItem`. `onToggle` se compara por referencia a propósito: la pantalla lo entrega
 * envuelto en `useCallback`, así que es estable, y si dejara de serlo esta comparación lo delata
 * con un re-render de más — nunca con una acción obsoleta.
 */
export function sameValveItem(a: ValveItemProps, b: ValveItemProps): boolean {
  if (a.frozen !== b.frozen || a.busy !== b.busy || a.compact !== b.compact) return false;
  if (a.onToggle !== b.onToggle) return false;
  const x = a.valve;
  const y = b.valve;
  return (
    x.id === y.id &&
    x.name === y.name &&
    x.effectiveState === y.effectiveState &&
    x.manualOverride === y.manualOverride &&
    x.source === y.source &&
    x.byState === y.byState &&
    x.byFlow === y.byFlow &&
    x.flowValue === y.flowValue &&
    x.flowUnit === y.flowUnit &&
    x.disagreement === y.disagreement &&
    x.rawState === y.rawState
  );
}

/** Para `TankGaugeCard`. */
export function sameTankCard(a: TankCardProps, b: TankCardProps): boolean {
  if (a.frozen !== b.frozen) return false;
  const x = a.tank;
  const y = b.tank;
  return (
    x.id === y.id &&
    x.name === y.name &&
    x.levelM === y.levelM &&
    x.volumeM3 === y.volumeM3 &&
    x.percentage === y.percentage &&
    x.levelOpMin === y.levelOpMin &&
    x.levelOpMax === y.levelOpMax &&
    x.outOfRange === y.outOfRange &&
    // La autonomía se pinta desde el 2026-08-21, así que entra aquí o la tarjeta se quedaría
    // enseñando la primera cifra para siempre — es la trampa que este archivo advierte arriba.
    // Se comparan los tres campos que se muestran, no el objeto: llega uno nuevo en cada snapshot
    // y comparar por referencia haría re-render en cada frame, que es justo lo que este memo evita.
    x.autonomy?.hoursTo0 === y.autonomy?.hoursTo0 &&
    x.autonomy?.hoursTo50 === y.autonomy?.hoursTo50 &&
    x.autonomy?.basis === y.autonomy?.basis
  );
}
