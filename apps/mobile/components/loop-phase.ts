/**
 * Rangos para `value.interpolate(...)` que adelantan un bucle 0→1 en `offset` (fracción de vuelta)
 * y lo hacen volver a 0 al llegar a 1, igual que el bucle original.
 *
 * Sirve para escalonar burbujas y anillos con UN `Animated.loop` cada uno y sin `Animated.delay`:
 * un `loop(sequence([delay, timing]))` no reinicia el valor del `timing` tras la primera vuelta
 * (la secuencia ya terminó y su `reset` no lo alcanza), así que a partir de ahí la animación va de 1
 * a 1 y se queda quieta. Con fase en vez de retraso, además, todo arranca ya repartido.
 *
 * Está aparte del componente para poder probarlo sin React Native.
 */
export function phaseRange(offset: number): { inputRange: number[]; outputRange: number[] } {
  const o = ((offset % 1) + 1) % 1;
  if (o === 0) return { inputRange: [0, 1], outputRange: [0, 1] };
  const cut = 1 - o;
  // El salto 1→0 ocurre en `cut`; el épsilon mantiene inputRange estrictamente creciente.
  return { inputRange: [0, cut, cut + 1e-6, 1], outputRange: [o, 1, 0, o] };
}

/** Evalúa `phaseRange` como lo haría `interpolate` (lineal por tramos). Para tests. */
export function phaseAt(t: number, offset: number): number {
  const { inputRange: x, outputRange: y } = phaseRange(offset);
  for (let i = 1; i < x.length; i++) {
    if (t <= x[i]) return y[i - 1] + ((t - x[i - 1]) / (x[i] - x[i - 1])) * (y[i] - y[i - 1]);
  }
  return y[y.length - 1];
}
