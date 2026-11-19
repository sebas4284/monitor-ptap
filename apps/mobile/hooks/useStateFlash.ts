import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { shouldFlash } from '../services/card-look';
import { useReduceMotion } from './useReduceMotion';

const NATIVE = Platform.OS !== 'web';

/**
 * Opacidad (0–1) de un destello breve cuando cambia el ESTADO de una tarjeta (entra o sale del
 * rango, pasa a "sin datos", rebose…; ver `signalState`/`tankState` en card-look.ts). Un simple
 * cambio de valor no destella: con datos en vivo, eso sería un parpadeo constante. Sin destello si
 * la planta está congelada o la persona pidió reducir movimiento.
 */
export function useStateFlash(state: string, frozen: boolean): Animated.Value {
  const reduce = useReduceMotion();
  const [flash] = useState(() => new Animated.Value(0));
  const last = useRef<string | undefined>(undefined);

  useEffect(() => {
    const previous = last.current;
    last.current = state;
    if (!shouldFlash(previous, state, frozen, reduce)) return;
    const anim = Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(flash, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE }),
    ]);
    anim.start();
    // Si se corta a medias (otro cambio, desmontaje), no dejar la tarjeta iluminada.
    return () => {
      anim.stop();
      flash.setValue(0);
    };
  }, [state, frozen, reduce, flash]);

  return flash;
}
