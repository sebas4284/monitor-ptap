export interface AccessLevelFlags {
  raw: number;
  currentRead: boolean;
  currentWrite: boolean;
  historyRead: boolean;
  historyWrite: boolean;
}

export function decodeAccessLevel(raw: number | null | undefined): AccessLevelFlags {
  const value = typeof raw === 'number' ? raw : 0;
  return {
    raw: value,
    currentRead: (value & 0x01) !== 0,
    currentWrite: (value & 0x02) !== 0,
    historyRead: (value & 0x04) !== 0,
    historyWrite: (value & 0x08) !== 0,
  };
}
