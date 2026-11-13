import type { LoadedMapping, MonitorTarget, SignalMapping } from '../mapping/opc-mapping.loader';
import type { RawBufferSample } from '../ports/connectivity-adapter.port';

/**
 * Vista de los buffers CRUDOS de una planta, al estilo de UA Expert, para el modo desarrollador.
 *
 * Por qué existe: el 2026-08-25 se descubrió que `cascajal.inletPressure1` lee 409,50 psi, que es
 * exactamente 4095/10 — el fondo de escala de un convertidor de 12 bits. Para llegar ahí hubo que
 * abrir fixtures a mano y cruzar índices entre plantas. Un admin no tiene por qué hacer eso: lo que
 * necesita es ver el array como lo ve el PLC, con el NodeId delante, y saber **qué señal consume
 * cada índice** — que es lo que convierte una tabla de números en algo accionable.
 *
 * Solo LECTURA. La edición del mapeo llega después, y a propósito: sin el informe por planta no hay
 * forma de verificar que un canal reapuntado quedó bien.
 */

/** Un índice del array, con lo que se sabe de él. */
export interface RawChannel {
  index: number;
  value: number | boolean | null;
  /** `domainKey` de la señal que lee este índice, si alguna. */
  domainKey: string | null;
  label: string | null;
  unit: string | null;
  /** true si la señal declara rango de validez y el valor cae fuera. Informativo. */
  outOfRange: boolean;
  /** true si la señal es de válvula: el mapeo de lo escribible no se toca desde la app. */
  locked: boolean;
}

export interface RawBufferView {
  browseName: string;
  channel: string;
  /** NodeId sin el índice de namespace, tal como vive en el mapping. */
  nsUri: string;
  identifier: string;
  dataType: string | null;
  /** Longitud declarada en el mapping (puede diferir de la real si el PLC cambió). */
  declaredLength: number | null;
  /** Longitud de la última muestra recibida. `null` si nunca llegó nada. */
  receivedLength: number | null;
  quality: string | null;
  statusCode: string | null;
  sourceTimestamp: string | null;
  /** Canales mostrados, ya filtrados (ver `debeMostrarse`). */
  channels: RawChannel[];
  /** Cuántos índices se ocultaron por valer 0 y no estar mapeados. */
  hiddenZeros: number;
}

export interface RawBuffersView {
  plantId: string;
  displayName: string;
  buffers: RawBufferView[];
}

/**
 * ¿Se muestra este índice?
 *
 * Regla: se ocultan los ceros, **salvo en `intOut`**, y salvo si el índice está mapeado.
 *
 * El motivo de la excepción, y conviene tenerlo claro porque es contraintuitivo: **`intOut` no es
 * donde el PLC escribe a las válvulas, es donde escribimos NOSOTROS.** El write spec de Cascajal
 * dice `target.channel = "intOut"`, `commands.open = 4096`, `pulse.holdMs = 300`; el backend pone el
 * valor, el PLC lo lee y actúa, y quien reporta el estado es `intIn`. Como el pulso se suelta a los
 * 300 ms, `intOut` está en cero casi todo el tiempo — así que un filtro «oculta ceros» lo
 * escondería entero justo cuando se quiere mirar qué se mandó.
 *
 * Y un índice mapeado se muestra aunque valga 0: que una señal declarada lea cero es información
 * (puede ser un caudalímetro muerto, como en Cascajal), no ruido que convenga esconder.
 */
export function debeMostrarse(channel: string, value: number | boolean | null, mapeado: boolean): boolean {
  if (mapeado) return true;
  if (channel === 'intOut') return true;
  if (value === null) return false;
  return value !== 0 && value !== false;
}

/** Índice de señales por buffer y posición, para saber quién consume cada canal. */
function porBufferEIndice(
  signals: SignalMapping[],
  targets: MonitorTarget[],
  plantId: string,
): Map<string, Map<number, SignalMapping>> {
  const mapa = new Map<string, Map<number, SignalMapping>>();
  // El buffer PRIMARIO de cada canal: el de más elementos declarados. Es la misma convención que
  // usa MappingEngine para resolver una señal sin `sourceBuffer`, y tiene que coincidir o la tabla
  // atribuiría el índice al buffer equivocado.
  const primario = new Map<string, string>();
  for (const t of targets) {
    if (t.plantId !== plantId) continue;
    const actual = primario.get(t.channel);
    const largoActual = actual ? (targets.find((x) => x.browseName === actual)?.arrayLength ?? 0) : -1;
    if (!actual || (t.arrayLength ?? 0) > largoActual) primario.set(t.channel, t.browseName);
  }

  for (const s of signals) {
    if (s.plantId !== plantId) continue;
    const buffer = s.sourceBuffer ?? primario.get(s.buffer);
    if (!buffer) continue;
    const porIndice = mapa.get(buffer) ?? new Map<number, SignalMapping>();
    porIndice.set(s.index, s);
    mapa.set(buffer, porIndice);
  }
  return mapa;
}

function fueraDeRango(s: SignalMapping, value: number | boolean | null): boolean {
  if (typeof value !== 'number') return false;
  if (s.min !== null && s.min !== undefined && value < s.min) return true;
  if (s.max !== null && s.max !== undefined && value > s.max) return true;
  return false;
}

/**
 * Compone la vista. **Función pura**: recibe el mapping y las últimas muestras, no toca red ni
 * sesión OPC. Así se prueba sin PLC, igual que `buildVerdict` y `buildRouteHistory`.
 *
 * `latest` puede estar vacío o incompleto: un buffer del que aún no llegó nada sale listado con sus
 * datos del mapping y `receivedLength: null`. Es información útil —dice que el NodeId existe en el
 * mapeo pero no ha entregado nada— y ocultarlo sería justo lo contrario de lo que busca esta vista.
 */
export function buildRawBuffersView(
  mapping: LoadedMapping,
  plantId: string,
  latest: Map<string, RawBufferSample> | undefined,
): RawBuffersView | null {
  const planta = mapping.plants.find((p) => p.plantId === plantId);
  if (!planta) return null;

  const porBuffer = porBufferEIndice(mapping.signals, mapping.targets, plantId);
  const buffers: RawBufferView[] = [];

  for (const t of mapping.targets) {
    if (t.plantId !== plantId) continue;
    const muestra = latest?.get(t.browseName);
    const señales = porBuffer.get(t.browseName) ?? new Map<number, SignalMapping>();
    const valores = muestra?.values ?? [];

    const channels: RawChannel[] = [];
    let hiddenZeros = 0;

    // Se recorre hasta el máximo entre lo recibido y lo declarado: si el mapping declara un índice
    // que la muestra no trae, hay que verlo — es justo el fallo que produce un dead-letter
    // INDEX_OUT_OF_RANGE, y esta tabla es donde debería poder diagnosticarse.
    const largo = Math.max(valores.length, ...[...señales.keys()].map((i) => i + 1), 0);
    for (let i = 0; i < largo; i++) {
      const s = señales.get(i);
      const value = i < valores.length ? valores[i] : null;
      if (!debeMostrarse(t.channel, value, Boolean(s))) {
        hiddenZeros++;
        continue;
      }
      channels.push({
        index: i,
        value,
        domainKey: s?.domainKey ?? null,
        label: s?.label ?? null,
        unit: s?.unit ?? null,
        outOfRange: s ? fueraDeRango(s, value) : false,
        // Las válvulas quedan bloqueadas ya en la vista, aunque aquí todavía no se edite nada: el
        // schema exige `confidence: confirmed` para lo escribible, y eso pide documento oficial de
        // la planta. Marcarlo desde el principio evita prometer una edición que no va a existir.
        locked: Boolean(s?.writable),
      });
    }

    buffers.push({
      browseName: t.browseName,
      channel: t.channel,
      nsUri: t.node.nsUri,
      identifier: t.node.identifier,
      dataType: t.dataType,
      declaredLength: t.arrayLength,
      receivedLength: muestra ? valores.length : null,
      quality: muestra?.quality ?? null,
      statusCode: muestra?.statusCode ?? null,
      sourceTimestamp: muestra?.sourceTimestamp ?? null,
      channels,
      hiddenZeros,
    });
  }

  return { plantId, displayName: planta.displayName, buffers };
}
