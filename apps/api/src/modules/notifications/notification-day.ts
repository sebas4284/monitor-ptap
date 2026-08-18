/**
 * El «día» al que se ancla la deduplicación de avisos.
 *
 * **Local, no UTC**, y no es un detalle: era `now.toISOString().slice(0, 10)`, y con Colombia en
 * UTC−5 eso hace que la clave cambie a las **19:00 hora local**. Como todas las condiciones
 * persistentes cambian de clave en el mismo barrido, el operario recibía de golpe la ráfaga entera
 * del día —treinta y tantos avisos— a las siete de la tarde, con la planta vacía, y el móvil se los
 * colapsaba en un «37 avisos nuevos» sin severidad ni planta. Peor aún: un aviso creado a las 18:55
 * se repetía a las 19:05.
 *
 * Con el día local, la tanda diaria cae al **cambio de fecha real**, y el operario se encuentra los
 * avisos del día al empezar el turno, que es cuando puede hacer algo con ellos.
 *
 * Se usan los captadores locales (`getFullYear`/`getMonth`/`getDate`) a propósito, en vez de fijar
 * un desfase de −5: así el día es el del reloj del servidor. La VM de producción corre en hora de
 * Colombia; si algún día se moviera de zona, esto la sigue sin tocar código, y un desfase fijo
 * habría mentido en silencio.
 */
export function dedupeDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
