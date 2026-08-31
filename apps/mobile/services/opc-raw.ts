import { getJson } from './api';

/**
 * Buffers CRUDOS de una planta, como los ve el PLC. Alimenta el modo desarrollador.
 *
 * Los tipos son un espejo de lo que compone `buildRawBuffersView` en el backend. Se declaran aquí
 * en vez de importarlos de `@ptap/shared` porque son un DTO de DIAGNÓSTICO, no del dominio: solo lo
 * consume esta pantalla, y meterlo en el paquete compartido lo volvería contrato entre las dos
 * mitades para algo que puede cambiar de forma cada vez que se mejore la vista.
 */

export interface RawChannel {
  index: number;
  /** `null` cuando el mapping declara el índice y la muestra no lo trae (dead-letter en potencia). */
  value: number | boolean | null;
  /** Señal que consume este índice, o `null` si nadie lo lee. */
  domainKey: string | null;
  label: string | null;
  unit: string | null;
  outOfRange: boolean;
  /** Señal de válvula: lo escribible no se edita desde la app. */
  locked: boolean;
}

export interface RawBufferView {
  browseName: string;
  channel: string;
  nsUri: string;
  identifier: string;
  dataType: string | null;
  declaredLength: number | null;
  /** `null` si por ese NodeId nunca llegó una muestra. */
  receivedLength: number | null;
  quality: string | null;
  statusCode: string | null;
  sourceTimestamp: string | null;
  channels: RawChannel[];
  /** Índices en cero y sin mapear que se ocultaron para que la tabla sea legible. */
  hiddenZeros: number;
}

export interface RawBuffersView {
  plantId: string;
  displayName: string;
  buffers: RawBufferView[];
}

/** Sale de la cache del pipeline: NO dispara ninguna lectura al PLC. Exige `system_config`. */
export async function fetchRawBuffers(plantId: string): Promise<RawBuffersView> {
  return getJson<RawBuffersView>(`/api/opc/raw/${plantId}`);
}

/**
 * El valor, tal como se lee. Coma decimal (es-CO) para que cuadre con el resto de la app, y **sin
 * redondear a menos de dos decimales**: la vista existe justo para reconocer números como 409,50,
 * que es el fondo de escala de un ADC de 12 bits disfrazado de presión.
 */
export function formatValorCrudo(value: number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (!Number.isFinite(value)) return String(value);
  return value.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

/** `Float[50]`, o `Float` si el mapping no declara longitud. */
export function tipoYLargo(b: RawBufferView): string {
  const tipo = b.dataType ?? '¿tipo?';
  return b.declaredLength === null ? tipo : `${tipo}[${b.declaredLength}]`;
}
