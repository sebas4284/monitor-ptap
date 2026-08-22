import { getJson } from './api';

/**
 * Comprobación del libro de firmas de las maniobras de válvula.
 *
 * Firmar sin poder enseñar la comprobación es teatro: la cadena solo vale si cualquiera con permiso
 * puede pedir que se recorra y ver el resultado. El cálculo lo hace el servidor —es él quien tiene
 * el secreto— y aquí solo se lee.
 */

export interface EslabonRoto {
  id: number;
  /**
   * `firma_no_coincide`: los datos de esa maniobra cambiaron después de firmarse.
   * `eslabon_no_encaja`: apunta a un sello que no le corresponde, típico de una fila borrada o
   * insertada en medio.
   */
  motivo: 'firma_no_coincide' | 'eslabon_no_encaja';
  plantId: string;
  at: string;
}

export interface VerificacionFirmas {
  /** `false` si el servidor no tiene secreto de firma: entonces no se está firmando nada. */
  verificable: boolean;
  firmadas: number;
  integra: boolean;
  rotos: EslabonRoto[];
  mensaje: string;
}

export async function fetchVerificacionFirmas(): Promise<VerificacionFirmas> {
  return getJson('/api/command-signatures/verify');
}
