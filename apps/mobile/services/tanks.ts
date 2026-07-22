import type { PlantSnapshotDto, SignalDto } from './api';

/**
 * Tanques REALES derivados del snapshot de dominio (PLC → mapping → snapshot.signals).
 * La convención de domainKeys es por planta: tank<N>Level (m) y tank<N>Volume (m³);
 * cada planta expone los tanques que tenga mapeados y NADA se inventa aquí.
 *
 * percentage es null mientras la planta no confirme las dimensiones reales del tanque:
 * los max del mapping son cotas de plausibilidad (20 m / 10000 m³), y un % de llenado
 * calculado contra ellas engañaría al operador.
 */
export interface TankView {
  id: string; // 'tank-1'
  name: string; // 'Tanque 1'
  levelM: number | null; // null = sin valor numérico en el snapshot
  volumeM3: number | null;
  percentage: number | null; // null hasta tener capacidad confirmada
  /** Rango operativo del nivel entregado por el operador — se muestra en la tarjeta. */
  levelOpMin: number | null;
  levelOpMax: number | null;
  ts: string | null;
  /** true si la lectura de nivel cae fuera de [min, max] de validez (metadato de aviso). */
  outOfRange: boolean;
  /** true = tanque de OTRA planta retransmitido en el buffer de esta (pendiente de rectificar). */
  external: boolean;
}

const LEVEL_KEY = /^tank(\d+)Level$/;
const OWN_TANK_KEY = /^tank\d+(Level|Volume)$/;

interface ExternalTankDef {
  levelKey: string;
  volumeKey: string;
  name: string;
  fullLevelM: number;
}

/**
 * Tanques de OTRAS plantas retransmitidos en el buffer de la planta portadora (Soledad
 * concentra los sitios mínimos; pendiente de rectificar con el operador — ver notas de
 * opc_mapping.json). Se muestran en el tablero de la portadora con nombre
 * explícito y NO participan del estado de agua de esa planta (external: true).
 */
const EXTERNAL_TANKS: Record<string, ExternalTankDef[]> = {
  soledad: [
    { levelKey: 'sanAntonioTankLevel', volumeKey: 'sanAntonioTankVolume', name: 'Tanque San Antonio', fullLevelM: 2.5 },
    { levelKey: 'quijoteTankLevel', volumeKey: 'quijoteTankVolume', name: 'Tanque El Quijote', fullLevelM: 3 },
  ],
};

/**
 * true si el domainKey lo consume el tablero (tanque propio tank<N>Level/Volume
 * o tanque externo declarado). El tablero usa esto para NO duplicar la señal.
 */
export function isTankSignal(domainKey: string): boolean {
  if (OWN_TANK_KEY.test(domainKey)) return true;
  for (const list of Object.values(EXTERNAL_TANKS)) {
    if (list.some((t) => t.levelKey === domainKey || t.volumeKey === domainKey)) return true;
  }
  return false;
}

/**
 * Nivel de tanque LLENO (m), confirmado por el operador, por planta y número de tanque.
 * Solo con este dato se calcula % de llenado; sin entrada aquí, percentage queda null.
 * Confirmaciones del operador (2026-07-14/15): carbonero tanque 1 = 2.8 m;
 * alto-los-mangos tanque 1 = 2.5 m; soledad tanque 1 = 2.8 m; cascajal tanque 1 = 3 m;
 * sirena tanque 1 = 2.8 m y tanques 2/3/4 = 2.5 m; km18 tanques 1 y 2 = 2 m;
 * voragine tanque 1 = 1.97 m.
 */
const FULL_LEVEL_M: Record<string, Record<number, number>> = {
  carbonero: { 1: 2.8 },
  'alto-los-mangos': { 1: 2.5 },
  soledad: { 1: 2.8 },
  cascajal: { 1: 3 },
  sirena: { 1: 2.8, 2: 2.5, 3: 2.5, 4: 2.5 },
  km18: { 1: 2, 2: 2 },
  voragine: { 1: 1.97 },
};

// Política de datos (usuario, 2026-07-15): si hay valor numérico se muestra tal cual,
// sin filtrar por usable/reason. La interpretación es del frontend con el cliente.
function numericValue(signal: SignalDto | undefined): number | null {
  return signal && typeof signal.value === 'number' ? signal.value : null;
}

export function tanksFromSnapshot(snapshot: PlantSnapshotDto | undefined): TankView[] {
  if (!snapshot) return [];
  const found: Array<{ n: number; tank: TankView }> = [];
  for (const [domainKey, level] of Object.entries(snapshot.signals)) {
    const match = LEVEL_KEY.exec(domainKey);
    if (!match) continue;
    const n = Number(match[1]);
    const levelM = numericValue(level);
    const fullLevelM = FULL_LEVEL_M[snapshot.plantId]?.[n] ?? null;
    found.push({
      n,
      tank: {
        id: `tank-${n}`,
        name: `Tanque ${n}`,
        levelM,
        volumeM3: numericValue(snapshot.signals[`tank${n}Volume`]),
        percentage: levelM !== null && fullLevelM !== null ? (levelM / fullLevelM) * 100 : null,
        levelOpMin: level.opMin ?? null,
        levelOpMax: level.opMax ?? null,
        ts: level.ts,
        outOfRange: level.outOfRange ?? false,
        external: false,
      },
    });
  }
  const tanks = found.sort((a, b) => a.n - b.n).map((f) => f.tank);

  for (const ext of EXTERNAL_TANKS[snapshot.plantId] ?? []) {
    const level = snapshot.signals[ext.levelKey];
    if (!level) continue;
    const levelM = numericValue(level);
    tanks.push({
      id: `tank-ext-${ext.levelKey}`,
      name: ext.name,
      levelM,
      volumeM3: numericValue(snapshot.signals[ext.volumeKey]),
      percentage: levelM !== null ? (levelM / ext.fullLevelM) * 100 : null,
      levelOpMin: level.opMin ?? null,
      levelOpMax: level.opMax ?? null,
      ts: level.ts,
      outOfRange: level.outOfRange ?? false,
      external: true,
    });
  }
  return tanks;
}
