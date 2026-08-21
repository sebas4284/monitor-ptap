export type SignalCardKind = 'flow' | 'gauge';
export type SignalDirection = 'inlet' | 'outlet' | null;

/** Caudal usa la tarjeta con barra de progreso; todo lo demás usa la tarjeta simple. */
export function cardKindFor(domainKey: string): SignalCardKind {
  // Los caudales se pintan como cualquier otra señal, con `GaugeCard`.
  //
  // La tarjeta con barra de progreso (`FlowMeterCard`) solo se dibuja cuando la señal declara
  // opMin/opMax, y hasta el 2026-08-21 NINGÚN caudal los tenía: la barra nunca se había visto en
  // producción. Al declarar el rango del caudal de salida de La Vorágine —que se añadió para poder
  // avisar cuando se sale de 1-3 l/s— la barra apareció de golpe, y dejó la entrada y la salida de
  // la misma planta con dos estilos distintos.
  //
  // El cliente pidió expresamente mantener el estilo de la de entrada. La barra no se borra: sigue
  // disponible en `FlowMeterCard` si algún día se quiere, pero declarar un rango para ALARMAR no
  // debe cambiar de paso el aspecto de la tarjeta. Son dos decisiones distintas.
  return 'gauge';
}

/** Dirección de la señal, derivada del prefijo del domainKey (inletFlow1, outletPressure1, ...). */
export function directionFor(domainKey: string): SignalDirection {
  if (domainKey.startsWith('inlet')) return 'inlet';
  if (domainKey.startsWith('outlet')) return 'outlet';
  return null;
}
