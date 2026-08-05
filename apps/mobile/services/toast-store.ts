/**
 * Avisos NO bloqueantes.
 *
 * Reemplaza a los cinco helpers duplicados de `window.alert()` / `Alert.alert()` que había en
 * electroválvulas, reportes, usuarios, login y registro. Un `window.alert` congela la pestaña
 * entera y obliga a un clic para seguir; para "informe generado" o "rol actualizado" es un peaje
 * absurdo.
 *
 * ⚠️ **Lo que NO debe pasar por aquí: el veredicto de un comando de válvula.** Un toast se cierra
 * solo y puede perderse, y ahí se está moviendo un actuador físico: ese resultado exige acuse de
 * recibo explícito (ver `ValveResultDialog`). El tipo `ToastKind` no incluye nada de mando a
 * propósito.
 *
 * Store de módulo + `useSyncExternalStore`, el mismo patrón que los descartes de `useAlerts`: así
 * no hace falta otro Context envolviendo el árbol.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

/** Un error se queda más tiempo: suele traer algo que leer. */
const DURATION: Record<ToastKind, number> = {
  success: 3200,
  info: 3800,
  error: 6000,
};

/** Tope de avisos simultáneos; por encima se descartan los más viejos. */
const MAX_VISIBLE = 3;

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

function push(kind: ToastKind, title: string, message?: string): void {
  const id = `toast-${++seq}`;
  toasts = [...toasts, { id, kind, title, message }].slice(-MAX_VISIBLE);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), DURATION[kind]),
  );
  emit();
}

export const toast = {
  success: (title: string, message?: string) => push('success', title, message),
  error: (title: string, message?: string) => push('error', title, message),
  info: (title: string, message?: string) => push('info', title, message),
};

/** Solo para pruebas: vacía la cola y sus temporizadores. */
export function resetToasts(): void {
  timers.forEach(clearTimeout);
  timers.clear();
  toasts = [];
  emit();
}
