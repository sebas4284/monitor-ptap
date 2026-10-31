/** Authorized offline fallback. Hydrate only after restoring a valid session; never before auth.
 * Entries belong to a user + role + plant. Logout removes all device fallback data.
 * Storage operations are serialized so a pending write cannot land after cleanup.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasPermission as checkPermission, type AuthUser } from '@ptap/shared';
import type { PlantSnapshotDto, PlantBasicStatusDto } from './api';

const SNAPSHOT_PREFIX = 'ptap_last_snapshot_';
const BASIC_PREFIX = 'ptap_last_basic_';
const SAVE_EVERY_MS = 15_000;
const snapshots = new Map<string, PlantSnapshotDto>();
const basics = new Map<string, PlantBasicStatusDto>();
const lastPersistAt = new Map<string, number>();
let user: AuthUser | null = null;
let scope: string | null = null;
let generation = 0;
let version = 0;
let operations = Promise.resolve();
const listeners = new Set<() => void>();
const isWeb = Platform.OS === 'web';
function notify(): void {
  version++;
  listeners.forEach((listener) => listener());
}
export function subscribeLastData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function lastDataVersion(): number {
  return version;
}
/** Capture before starting a request/stream, then pass to writes and check callbacks. */
export function lastDataSession(): number {
  return generation;
}
export function isLastDataSession(expected: number): boolean {
  return user !== null && expected === generation;
}
function allowed(plantId: string, detail: boolean): boolean {
  return (
    !!user &&
    checkPermission(user.role, detail ? 'view_dashboard' : 'view_basic_status') &&
    (user.plant === plantId || checkPermission(user.role, 'view_all_plants'))
  );
}
function enqueue(operation: () => Promise<void>): Promise<void> {
  operations = operations.then(operation).catch(() => undefined);
  return operations;
}
async function keys(): Promise<string[]> {
  if (!isWeb) return [...(await AsyncStorage.getAllKeys())];
  if (typeof localStorage === 'undefined') return [];
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
    (key): key is string => !!key,
  );
}
async function remove(entries: string[]): Promise<void> {
  if (isWeb) entries.forEach((key) => localStorage.removeItem(key));
  else if (entries.length) await AsyncStorage.multiRemove(entries);
}
function ours(key: string): boolean {
  return key.startsWith(SNAPSHOT_PREFIX) || key.startsWith(BASIC_PREFIX);
}
function prefix(detail: boolean): string {
  return (detail ? SNAPSHOT_PREFIX : BASIC_PREFIX) + scope + ':';
}
/** Synchronous revocation; async cleanup/hydration is guarded by this transition's generation. */
export function setLastDataSession(next: AuthUser | null): Promise<void> {
  const previousScope = scope;
  user = next;
  scope = next ? encodeURIComponent(JSON.stringify([next.id, next.role, next.plant])) : null;
  const expected = ++generation;
  snapshots.clear();
  basics.clear();
  lastPersistAt.clear();
  notify();
  const snapshotPrefix = prefix(true);
  const basicPrefix = prefix(false);
  // Preserve only the same authorized identity on cold restore. Account changes purge everything.
  const purgeAll = !next || (previousScope !== null && previousScope !== scope);
  return enqueue(async () => {
    const entries = (await keys()).filter(ours);
    await remove(
      entries.filter(
        (key) => purgeAll || (!key.startsWith(snapshotPrefix) && !key.startsWith(basicPrefix)),
      ),
    );
    if (!isLastDataSession(expected)) return;
    const remaining = purgeAll
      ? []
      : entries.filter((key) => key.startsWith(snapshotPrefix) || key.startsWith(basicPrefix));
    const pairs = isWeb
      ? remaining.map((key) => [key, localStorage.getItem(key)] as const)
      : await AsyncStorage.multiGet(remaining);
    if (!isLastDataSession(expected)) return;
    for (const [key, value] of pairs) {
      if (!value) continue;
      try {
        const detail = key.startsWith(snapshotPrefix);
        const plantId = key.slice((detail ? snapshotPrefix : basicPrefix).length);
        const parsed = JSON.parse(value) as PlantSnapshotDto & PlantBasicStatusDto;
        if (parsed.plantId !== plantId || !allowed(plantId, detail)) continue;
        if (detail && !snapshots.has(plantId)) snapshots.set(plantId, parsed);
        if (!detail && !basics.has(plantId)) basics.set(plantId, parsed);
      } catch {
        /* corrupt fallback is ignored */
      }
    }
    notify();
  });
}
function persist(plantId: string, detail: boolean, value: string, expected: number): void {
  const key = prefix(detail) + plantId;
  const now = Date.now();
  if (now - (lastPersistAt.get(key) ?? 0) < SAVE_EVERY_MS) return;
  lastPersistAt.set(key, now);
  void enqueue(async () => {
    if (!isLastDataSession(expected)) return;
    if (isWeb) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } else await AsyncStorage.setItem(key, value);
  });
}
export function getLastSnapshot(plantId: string): PlantSnapshotDto | null {
  return allowed(plantId, true) ? (snapshots.get(plantId) ?? null) : null;
}
export function getLastBasicStatus(plantId: string): PlantBasicStatusDto | null {
  return allowed(plantId, false) ? (basics.get(plantId) ?? null) : null;
}
export function rememberSnapshot(snapshot: PlantSnapshotDto, expected: number): void {
  if (
    !isLastDataSession(expected) ||
    !allowed(snapshot.plantId, true) ||
    snapshot.pending ||
    Object.keys(snapshot.signals).length === 0
  )
    return;
  snapshots.set(snapshot.plantId, snapshot);
  persist(snapshot.plantId, true, JSON.stringify(snapshot), expected);
}
export function rememberBasicStatus(status: PlantBasicStatusDto, expected: number): void {
  if (
    !isLastDataSession(expected) ||
    !allowed(status.plantId, false) ||
    status.waterAvailable === null
  )
    return;
  basics.set(status.plantId, status);
  persist(status.plantId, false, JSON.stringify(status), expected);
}
