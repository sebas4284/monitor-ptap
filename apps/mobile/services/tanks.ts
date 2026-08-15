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

const TANK_NUM = /^tank(\d+)(?:Level|Volume)$/;
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
 * El nivel de tanque LLENO ya NO vive aquí: viene del mapping en `opMax` de la señal de nivel.
 *
 * Había una tabla `FULL_LEVEL_M` escrita a mano en este archivo mientras la tarjeta mostraba el
 * `MAX` que llegaba del backend. **Dos fuentes de verdad para el mismo número**, y coincidían por
 * casualidad: bastaba corregir el máximo de una planta en el mapping para que el porcentaje
 * siguiera calculándose contra el valor viejo horneado en la app, sin ningún síntoma.
 *
 * Ahora hay una sola: el mapping. Si una planta no declara `opMax`, no hay porcentaje (null) —
 * inventarlo contra la cota de plausibilidad (20 m) engañaría al operador.
 */

// Política de datos (usuario, 2026-07-15): si hay valor numérico se muestra tal cual,
// sin filtrar por usable/reason. La interpretación es del frontend con el cliente.
function numericValue(signal: SignalDto | undefined): number | null {
  return signal && typeof signal.value === 'number' ? signal.value : null;
}

/**
 * Porcentaje de llenado = nivel / máximo del tanque.
 *
 * **NO se descuenta el mínimo operativo** (regla del cliente, 2026-08-15). El `MIN` de 1 m que se
 * muestra en la tarjeta es el umbral por debajo del cual la planta no consigue llevar agua a las
 * casas — es un límite de SERVICIO, no el fondo del tanque, y el nivel puede bajar de ahí. La
 * fórmula anterior de la app vieja, `(nivel−min)/(max−min)`, daba 0 % con el tanque a 1 m
 * teniendo agua: para el mismo tanque a 1.52 m mostraba 29 % donde el llenado real es 54 %.
 *
 * **Tampoco se recorta a 100 %.** Un valor por encima significa una de dos cosas, y ninguna se
 * arregla escondiéndola: o el agua se está rebosando, o el máximo configurado está por debajo del
 * real. Ambas necesitan que alguien las vea (lo detecta `TankOverflowDetector` en el backend).
 * Recortar en silencio era justo lo que hacía que un tanque marcara "lleno" mientras seguía
 * subiendo sin derramar — medido el 2026-08-15: Carbonero 2.96 m contra un máximo de 2.80.
 */
function percentageOf(levelM: number | null, fullLevelM: number | null): number | null {
  if (levelM === null || fullLevelM === null || fullLevelM <= 0) return null;
  // Un nivel NEGATIVO no es un tanque muy vacío: es un sensor que miente. Soledad reporta
  // -1.51 m con timestamp fresco (la sección volumen/nivel da 59,6 m², idéntica a la de Sirena,
  // así que el volumen se deriva bien y lo que está invertido es el signo). Calcular "-54 % de
  // llenado" convierte un dato roto en un número que parece medido. El nivel crudo SÍ se sigue
  // mostrando con su aviso rojo — los límites alertan, no ocultan.
  if (levelM < 0) return null;
  return (levelM / fullLevelM) * 100;
}

export function tanksFromSnapshot(snapshot: PlantSnapshotDto | undefined): TankView[] {
  if (!snapshot) return [];
  const found: Array<{ n: number; tank: TankView }> = [];
  // Un tanque existe si tiene Level Y/O Volume (antes solo se derivaba de Level → un tanque con
  // solo Volume mapeado desaparecía del tablero). Se recorre la UNIÓN de ambos keys.
  const nums = new Set<number>();
  for (const key of Object.keys(snapshot.signals)) {
    const m = TANK_NUM.exec(key);
    if (m) nums.add(Number(m[1]));
  }
  for (const n of nums) {
    const level = snapshot.signals[`tank${n}Level`];
    const volume = snapshot.signals[`tank${n}Volume`];
    const meta = level ?? volume; // metadatos de aviso: preferir el de nivel, si no el de volumen
    const levelM = numericValue(level);
    // El máximo del tanque sale del mapping (única fuente). Ojo: se toma de la señal de NIVEL,
    // no de `meta` — el opMax del volumen sería m³ y calcularía un porcentaje disparatado.
    const fullLevelM = level?.opMax ?? null;
    found.push({
      n,
      tank: {
        id: `tank-${n}`,
        name: `Tanque ${n}`,
        levelM,
        volumeM3: numericValue(volume),
        percentage: percentageOf(levelM, fullLevelM),
        levelOpMin: meta?.opMin ?? null,
        levelOpMax: meta?.opMax ?? null,
        ts: meta?.ts ?? null,
        outOfRange: meta?.outOfRange ?? false,
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
      percentage: percentageOf(levelM, ext.fullLevelM),
      levelOpMin: level.opMin ?? null,
      levelOpMax: level.opMax ?? null,
      ts: level.ts,
      outOfRange: level.outOfRange ?? false,
      external: true,
    });
  }
  return tanks;
}
