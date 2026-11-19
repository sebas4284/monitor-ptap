import { hasRangeAnomaly, type SignalDto } from '@ptap/shared';

export type SignalFilter = 'all' | 'ok' | 'alert' | 'missing';
export type SignalEntry = [string, SignalDto];
export function readingState(signal: SignalDto): Exclude<SignalFilter, 'all'> {
  if (signal.value === null || (typeof signal.value === 'number' && !Number.isFinite(signal.value)))
    return 'missing';
  return hasRangeAnomaly(signal) ? 'alert' : 'ok';
}
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export function filterReadings(
  entries: SignalEntry[],
  query: string,
  status: SignalFilter,
): SignalEntry[] {
  const needle = normalize(query.trim());
  return entries
    .filter(
      ([key, signal]) =>
        (status === 'all' || readingState(signal) === status) &&
        normalize(`${key} ${signal.label ?? ''} ${signal.unit ?? ''}`).includes(needle),
    )
    .sort((a, b) => (a[1].label ?? a[0]).localeCompare(b[1].label ?? b[0], 'es'));
}
