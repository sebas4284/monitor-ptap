import { getJson, patchJson, deleteJson } from './api';
import type { MappingPatch, ValoresSenal } from './mapping-edit-form';

/**
 * Editar el mapeo desde la app (modo desarrollador, solo `system_config`).
 *
 * Espejo de `SenalEditableDto` del backend. Se declara aquí y no en `@ptap/shared` por lo mismo que
 * `opc-raw.ts`: es un DTO de diagnóstico que solo consume esta pantalla, y subirlo al paquete
 * compartido lo volvería contrato entre las dos mitades para algo que va a cambiar cada vez que se
 * mejore la vista.
 */

export interface SenalEditable extends ValoresSenal {
  /** El nombre en inglés asignado a la señal: outletFlow1, tank1Level, inletPressure1… */
  domainKey: string;
  label: string | null;
  /** Canal declarado: realIn, intIn, intOut… */
  buffer: string;
  /** El buffer que de verdad la alimenta, ya resuelto por el servidor. */
  browseName: string | null;
  nsUri: string | null;
  identifier: string | null;
  dataType: string | null;
  declaredLength: number | null;
  mappingStatus: string;
  confidence: string;
  writable: boolean;
  /** Por qué no se puede editar, o `null` si sí. */
  bloqueada: string | null;
  override: {
    patch: MappingPatch;
    /** Lo que dice `config/opc_mapping.json`, para poder enseñar de dónde viene el cambio. */
    base: Partial<ValoresSenal>;
    by: string | null;
    at: string | null;
  } | null;
}

export interface PlantaEditable {
  plantId: string;
  displayName: string;
  senales: SenalEditable[];
}

export interface EntradaHistorial {
  plantId: string;
  domainKey: string;
  patch: MappingPatch;
  previous: MappingPatch;
  reverted: boolean;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
}

export async function fetchPlantaEditable(plantId: string): Promise<PlantaEditable> {
  return getJson<PlantaEditable>(`/api/opc/mapping/${plantId}`);
}

/**
 * Aplica la corrección. El servidor valida, guarda y la aplica en caliente; devuelve la señal **como
 * queda**, no como se pidió — si ajustó o rechazó algo, la pantalla lo ve.
 */
export async function aplicarCorreccion(
  plantId: string,
  domainKey: string,
  patch: MappingPatch,
): Promise<SenalEditable> {
  return patchJson<SenalEditable>(`/api/opc/mapping/${plantId}/${domainKey}`, patch);
}

/** Vuelve al mapeo del repositorio. No borra el registro: queda como reversión. */
export async function revertirCorreccion(plantId: string, domainKey: string): Promise<SenalEditable> {
  return deleteJson<SenalEditable>(`/api/opc/mapping/${plantId}/${domainKey}`);
}

export async function fetchHistorial(plantId: string, domainKey: string): Promise<EntradaHistorial[]> {
  const { historial } = await getJson<{ historial: EntradaHistorial[] }>(
    `/api/opc/mapping/${plantId}/${domainKey}/historial`,
  );
  return historial ?? [];
}

/** Los valores que rigen, en la forma que espera el formulario. */
export function valoresDe(s: SenalEditable): ValoresSenal {
  return {
    index: s.index,
    sourceBuffer: s.sourceBuffer,
    unit: s.unit,
    min: s.min,
    max: s.max,
    opMin: s.opMin,
    opMax: s.opMax,
  };
}
