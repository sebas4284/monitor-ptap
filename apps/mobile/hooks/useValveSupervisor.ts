import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendValveCommand } from '../services/api';
import { detectManual, interpretCommand, type CommandVerdict, type ValveState, type ValveView } from '../services/valves';

/**
 * Supervisor de electroválvulas: mantiene el estado de la app CONSISTENTE con la realidad física y
 * envía las órdenes por el canal oficial.
 *
 * Dos problemas que resuelve, ambos reportados desde planta:
 *  1. **Operación manual.** A veces la válvula se abre/cierra a mano. Entonces el caudal cruza el
 *     umbral (0.1) pero la lectura eléctrica del PLC no reporta nada. Si la app no lo detecta,
 *     acabaría mandando "abrir" a una válvula ya abierta. Aquí se detecta, se AVISA y el estado
 *     mostrado pasa a seguir al caudal (override) hasta que la lectura eléctrica coincida.
 *  2. **Saber qué pasó de verdad tras una orden.** Se distingue "la señal salió" de "el equipo
 *     respondió" (ver interpretCommand) y, tras enviar, se vigila unos segundos si el estado real
 *     cambió — así el operador no se queda con un "listo" que no ocurrió.
 */

/** Ventana tras una orden nuestra en la que un cambio NO se considera manual. */
const COMMAND_WINDOW_MS = 15_000;

export interface ValveEvent {
  id: string;
  at: string;
  valveId: string;
  kind: 'manual' | 'command';
  title: string;
  message: string;
}

export interface SupervisedValve extends ValveView {
  /** Estado que la app muestra: sigue al caudal si se detectó operación manual. */
  effectiveState: ValveState;
  /** true si el estado mostrado viene de un override por operación manual. */
  manualOverride: boolean;
}

export function useValveSupervisor(plantId: string, valves: ValveView[]) {
  const [events, setEvents] = useState<ValveEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ValveState>>({});

  // Lecturas anteriores por válvula, para detectar transiciones.
  const prev = useRef<Record<string, { flow: ValveState | null; state: ValveState | null }>>({});
  const lastCommandAt = useRef<Record<string, number>>({});

  // Al cambiar de planta se descarta todo: los ids de válvula se repiten entre plantas.
  useEffect(() => {
    prev.current = {};
    lastCommandAt.current = {};
    setOverrides({});
    setEvents([]);
  }, [plantId]);

  const pushEvent = useCallback((e: Omit<ValveEvent, 'id' | 'at'>) => {
    setEvents((list) => [{ ...e, id: `${e.valveId}-${Date.now()}-${list.length}`, at: new Date().toISOString() }, ...list].slice(0, 20));
  }, []);

  // Detección de operación manual + limpieza del override cuando el PLC ya coincide.
  useEffect(() => {
    for (const v of valves) {
      const before = prev.current[v.id];
      prev.current[v.id] = { flow: v.byFlow, state: v.byState };
      if (!before) continue; // primera lectura: no hay transición que juzgar

      const commandRecently = Date.now() - (lastCommandAt.current[v.id] ?? 0) < COMMAND_WINDOW_MS;
      const manual = detectManual(before.flow, v.byFlow, before.state, v.byState, commandRecently);

      if (manual) {
        const nuevo: ValveState = manual === 'opened' ? 'open' : 'closed';
        setOverrides((o) => ({ ...o, [v.id]: nuevo }));
        pushEvent({
          valveId: v.id,
          kind: 'manual',
          title: manual === 'opened' ? 'Válvula abierta manualmente' : 'Válvula cerrada manualmente',
          message:
            `${v.name}: el caudal indica que ahora está ${nuevo === 'open' ? 'ABIERTA' : 'CERRADA'}, ` +
            `pero el PLC no reportó ninguna maniobra eléctrica. Se asume operación MANUAL y se actualiza el estado.`,
        });
      } else if (v.byState !== null && overrides[v.id] && v.byState === overrides[v.id]) {
        // La lectura eléctrica ya coincide con el override: se deja de forzar.
        setOverrides((o) => {
          const { [v.id]: _drop, ...rest } = o;
          return rest;
        });
      }
    }
    // `overrides` se lee para poder limpiarlo; no debe re-disparar el efecto por sí mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valves, pushEvent]);

  // Memoizado: sin esto se creaba un array (y N objetos) nuevos en CADA render, rompiendo la
  // identidad de las props de todas las `ValveItem` y anulando su memo.
  const supervised = useMemo<SupervisedValve[]>(
    () =>
      valves.map((v) => {
        const ov = overrides[v.id];
        return { ...v, effectiveState: ov ?? v.state, manualOverride: ov !== undefined };
      }),
    [valves, overrides],
  );

  /**
   * Envía la orden. SIEMPRE se envía, incluso si la válvula ya está en ese estado (lo pidió el
   * operador): así el PLC recibe la orden igual y, si el estado de la app estaba desactualizado, la
   * respuesta lo corrige. Se avisa cuando ya estaba en ese estado.
   */
  const send = useCallback(
    async (valve: SupervisedValve, verb: 'open' | 'close'): Promise<CommandVerdict> => {
      setBusy(valve.id);
      lastCommandAt.current[valve.id] = Date.now();
      const yaEstaba = valve.effectiveState === (verb === 'open' ? 'open' : 'closed');
      try {
        const res = await sendValveCommand(plantId, verb, valve.id);
        const verdict = interpretCommand(res, verb, valve.name);
        const message = yaEstaba
          ? `Ya estaba ${verb === 'open' ? 'ABIERTA' : 'CERRADA'}, pero la orden se envió igual.\n\n${verdict.message}`
          : verdict.message;

        // Una orden confirmada es la verdad más fuerte: invalida cualquier override manual.
        if (verdict.ok) {
          setOverrides((o) => {
            const { [valve.id]: _drop, ...rest } = o;
            return rest;
          });
        }
        pushEvent({ valveId: valve.id, kind: 'command', title: verdict.title, message });
        return { ...verdict, message };
      } finally {
        setBusy(null);
      }
    },
    [plantId, pushEvent],
  );

  const dismiss = useCallback((id: string) => setEvents((l) => l.filter((e) => e.id !== id)), []);

  return { valves: supervised, events, send, busy, dismiss };
}
