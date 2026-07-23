export type SignalCardKind = 'flow' | 'gauge';
export type SignalDirection = 'inlet' | 'outlet' | null;

/** Caudal usa la tarjeta con barra de progreso; todo lo demás usa la tarjeta simple. */
export function cardKindFor(domainKey: string): SignalCardKind {
  return domainKey.toLowerCase().includes('flow') ? 'flow' : 'gauge';
}

/** Dirección de la señal, derivada del prefijo del domainKey (inletFlow1, outletPressure1, ...). */
export function directionFor(domainKey: string): SignalDirection {
  if (domainKey.startsWith('inlet')) return 'inlet';
  if (domainKey.startsWith('outlet')) return 'outlet';
  return null;
}
