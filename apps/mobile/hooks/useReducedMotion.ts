import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// A single native/web listener serves all animated components. Default to a stable
// state during SSR and until the preference is known.
let reduced = true;
let generation = 0;
let subscription: { remove(): void } | undefined;
const listeners = new Set<() => void>();

function update(value: boolean): void {
  if (reduced === value) return;
  reduced = value;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    const expected = ++generation;
    let changed = false;
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      update(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      // A preference change takes precedence over an earlier asynchronous read.
      if (expected === generation && !changed) update(value);
    }).catch(() => {});
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      generation++;
      subscription?.remove();
      subscription = undefined;
      reduced = true;
    }
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduced, () => true);
}
