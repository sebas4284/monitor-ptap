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
  levelM: number | null; // null = sin dato usable
  volumeM3: number | null;
  percentage: number | null; // null hasta tener capacidad confirmada
  /** true si el nivel o el volumen cayeron fuera de [min, max] del mapping — aviso de
   * futura alerta; el valor real igual se muestra (levelM/volumeM3 no se anulan por esto). */
  outOfRange: boolean;
  ts: string | null;
}

const LEVEL_KEY = /^tank(\d+)Level$/;

/**
 * Nivel de tanque LLENO (m), confirmado por el operador, por planta y número de tanque.
 * Solo con este dato se calcula % de llenado; sin entrada aquí, percentage queda null.
 * Confirmaciones del operador (2026-07-14): carbonero tanque 1 = 2.8 m;
 * alto-los-mangos tanque 1 = 2.5 m.
 */
const FULL_LEVEL_M: Record<string, Record<number, number>> = {
  carbonero: { 1: 2.8 },
  'alto-los-mangos': { 1: 2.5 },
};

function usableNumber(signal: SignalDto | undefined): number | null {
  return signal && signal.usable && typeof signal.value === 'number' ? signal.value : null;
}

export function tanksFromSnapshot(snapshot: PlantSnapshotDto | undefined): TankView[] {
  if (!snapshot) return [];
  const found: Array<{ n: number; tank: TankView }> = [];
  for (const [domainKey, level] of Object.entries(snapshot.signals)) {
    const match = LEVEL_KEY.exec(domainKey);
    if (!match) continue;
    const n = Number(match[1]);
    const volume = snapshot.signals[`tank${n}Volume`];
    const levelM = usableNumber(level);
    const fullLevelM = FULL_LEVEL_M[snapshot.plantId]?.[n] ?? null;
    found.push({
      n,
      tank: {
        id: `tank-${n}`,
        name: `Tanque ${n}`,
        levelM,
        volumeM3: usableNumber(volume),
        percentage: levelM !== null && fullLevelM !== null ? (levelM / fullLevelM) * 100 : null,
        outOfRange: Boolean(level.outOfRange || volume?.outOfRange),
        ts: level.ts,
      },
    });
  }
  return found.sort((a, b) => a.n - b.n).map((f) => f.tank);
}
