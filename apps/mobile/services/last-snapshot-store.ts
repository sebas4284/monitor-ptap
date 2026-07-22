/**
 * Última lectura conocida POR DISPOSITIVO — el respaldo visual cuando se cae la conexión.
 *
 * El backend guarda el último snapshot SOLO en RAM (regla maestra: la telemetría no se persiste
 * en el servidor). Eso deja dos huecos visuales que este módulo cierra EN EL CLIENTE:
 *   1. El backend se reinicia con el PLC caído → su cache nace vacía → `pending` sin señales.
 *   2. El dispositivo pierde al servidor y el usuario recarga → React Query pierde su memoria.
 * En ambos casos, la pantalla mostraba "sin datos". Con este respaldo muestra las ÚLTIMAS
 * lecturas capturadas del PLC, SIEMPRE marcadas como congeladas (liveness `frozen`): el tablero
 * nunca miente — se ve el último valor real con su hora, nunca un dato viejo aparentando frescura.
 *
 * Diseño: cache en memoria (lecturas síncronas para los hooks) + persistencia detrás
 * (localStorage en web, AsyncStorage en nativo), hidratada al arrancar. La escritura se
 * amortigua a una cada 15 s por planta — el push llega cada ~2 s y persistir cada uno
 * desgastaría storage sin mejorar el respaldo.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlantSnapshotDto, PlantBasicStatusDto } from './api';

const SNAPSHOT_PREFIX = 'ptap_last_snapshot_';
const BASIC_PREFIX = 'ptap_last_basic_';
const SAVE_EVERY_MS = 15_000;

const snapshots = new Map<string, PlantSnapshotDto>();
const basics = new Map<string, PlantBasicStatusDto>();
const lastPersistAt = new Map<string, number>();

// Versión para useSyncExternalStore: solo cambia al HIDRATAR (los hooks releen el respaldo
// cuando llega del storage). Las escrituras en vivo no notifican — mientras hay datos frescos
// nadie está mirando el respaldo, y notificar cada push solo duplicaría renders.
let version = 0;
const listeners = new Set<() => void>();

export function subscribeLastData(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lastDataVersion(): number {
  return version;
}

const isWeb = Platform.OS === 'web';
const hasLocalStorage = isWeb && typeof localStorage !== 'undefined';

function persist(key: string, value: string): void {
  if (isWeb) {
    if (!hasLocalStorage) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage lleno o modo privado: el respaldo simplemente no se actualiza */
    }
    return;
  }
  AsyncStorage.setItem(key, value).catch(() => undefined);
}

/** Hidratación inicial: web es síncrono (localStorage); nativo llega async y notifica. */
function hydrate(): void {
  if (isWeb) {
    if (!hasLocalStorage) return;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      try {
        if (key.startsWith(SNAPSHOT_PREFIX)) {
          snapshots.set(key.slice(SNAPSHOT_PREFIX.length), JSON.parse(localStorage.getItem(key) ?? '') as PlantSnapshotDto);
        } else if (key.startsWith(BASIC_PREFIX)) {
          basics.set(key.slice(BASIC_PREFIX.length), JSON.parse(localStorage.getItem(key) ?? '') as PlantBasicStatusDto);
        }
      } catch {
        /* entrada corrupta: se ignora */
      }
    }
    version++;
    return;
  }

  AsyncStorage.getAllKeys()
    .then(async (keys) => {
      const ours = keys.filter((k) => k.startsWith(SNAPSHOT_PREFIX) || k.startsWith(BASIC_PREFIX));
      if (ours.length === 0) return;
      const pairs = await AsyncStorage.multiGet(ours);
      for (const [key, value] of pairs) {
        if (!value) continue;
        try {
          if (key.startsWith(SNAPSHOT_PREFIX)) snapshots.set(key.slice(SNAPSHOT_PREFIX.length), JSON.parse(value) as PlantSnapshotDto);
          else basics.set(key.slice(BASIC_PREFIX.length), JSON.parse(value) as PlantBasicStatusDto);
        } catch {
          /* entrada corrupta: se ignora */
        }
      }
      version++;
      listeners.forEach((l) => l());
    })
    .catch(() => undefined);
}

hydrate();

export function getLastSnapshot(plantId: string): PlantSnapshotDto | null {
  return snapshots.get(plantId) ?? null;
}

export function getLastBasicStatus(plantId: string): PlantBasicStatusDto | null {
  return basics.get(plantId) ?? null;
}

/** Guarda una lectura REAL (nunca respuestas de espera sin señales — no hay nada que respaldar). */
export function rememberSnapshot(snapshot: PlantSnapshotDto): void {
  if (snapshot.pending || Object.keys(snapshot.signals).length === 0) return;
  snapshots.set(snapshot.plantId, snapshot);
  const key = `s:${snapshot.plantId}`;
  const now = Date.now();
  if (now - (lastPersistAt.get(key) ?? 0) < SAVE_EVERY_MS) return;
  lastPersistAt.set(key, now);
  persist(SNAPSHOT_PREFIX + snapshot.plantId, JSON.stringify(snapshot));
}

/** Guarda el estado básico solo con veredicto REAL de agua (null = sin datos, nada que respaldar). */
export function rememberBasicStatus(status: PlantBasicStatusDto): void {
  if (status.waterAvailable === null) return;
  basics.set(status.plantId, status);
  const key = `b:${status.plantId}`;
  const now = Date.now();
  if (now - (lastPersistAt.get(key) ?? 0) < SAVE_EVERY_MS) return;
  lastPersistAt.set(key, now);
  persist(BASIC_PREFIX + status.plantId, JSON.stringify(status));
}
