import { useEffect, useMemo, useRef, useState } from 'react';
import { detectManual, type ValveState, type ValveView } from '../services/valves';

/**
 * Supervisor de electroválvulas: mantiene el estado MOSTRADO consistente con la realidad física.
 *
 * A veces la válvula se abre/cierra a mano. Entonces el caudal cruza el umbral (0.1) pero la
 * lectura eléctrica del PLC no reporta nada. Sin detectarlo, la app seguiría mostrando el estado
 * eléctrico viejo como si fuera el actual. Aquí se detecta y el estado mostrado pasa a seguir al
 * caudal (override) hasta que la lectura eléctrica coincida.
 *
 * El AVISO de que alguien la movió a mano lo publica el servidor en la bandeja de notificaciones
 * (`valve_manual`): así lo ve todo el equipo de la planta, no solo quien tuviera esta pantalla
 * abierta. Aquí solo se corrige lo que se MUESTRA.
 */
export interface SupervisedValve extends ValveView {
  /** Estado que la app muestra: sigue al caudal si se detectó operación manual. */
  effectiveState: ValveState;
  /** true si el estado mostrado viene de un override por operación manual. */
  manualOverride: boolean;
}

export function useValveSupervisor(plantId: string, valves: ValveView[]) {
  const [overrides, setOverrides] = useState<Record<string, ValveState>>({});

  // Lecturas anteriores por válvula, para detectar transiciones.
  const prev = useRef<Record<string, { flow: ValveState | null; state: ValveState | null }>>({});

  // Al cambiar de planta se descarta todo: los ids de válvula se repiten entre plantas.
  useEffect(() => {
    prev.current = {};
    setOverrides({});
  }, [plantId]);

  // Detección de operación manual + limpieza del override cuando el PLC ya coincide.
  useEffect(() => {
    for (const v of valves) {
      const before = prev.current[v.id];
      prev.current[v.id] = { flow: v.byFlow, state: v.byState };
      if (!before) continue; // primera lectura: no hay transición que juzgar

      // La app ya no manda órdenes desde esta pantalla: ningún cambio es "nuestro".
      const manual = detectManual(before.flow, v.byFlow, before.state, v.byState, false);

      if (manual) {
        setOverrides((o) => ({ ...o, [v.id]: manual === 'opened' ? 'open' : 'closed' }));
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
  }, [valves]);

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

  return { valves: supervised };
}
