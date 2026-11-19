import { createElement, memo, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import Svg, { Path } from './WaterVector';
import { wavePath } from './wave-path';
import { useReducedMotion } from '../hooks/useReducedMotion';
import Colors from '../constants/colors';

const WIDTH = 64;
const HEIGHT = 10;
const PATH = wavePath(4, 20);
const CSS = '@keyframes aquora-tank-drift{from{transform:translateX(0)}to{transform:translateX(-64px)}}@media(prefers-reduced-motion:reduce){.aquora-tank-wave{animation:none!important}}';

/** La onda conserva su ciclo aunque lleguen lecturas nuevas al resto de la tarjeta. */
export const TankWave = memo(function TankWave({ still }: { still: boolean }) {
  const reduced = useReducedMotion();
  const moving = !reduced && !still;
  const [drift] = useState(() => new Animated.Value(0));
  const translateX = useMemo(() => drift.interpolate({ inputRange: [0, 1], outputRange: [0, -WIDTH] }), [drift]);
  useEffect(() => {
    if (!moving || Platform.OS === 'web') return;
    const animation = Animated.loop(Animated.timing(drift, {
      toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    animation.start();
    return () => { animation.stop(); drift.setValue(0); };
  }, [moving, drift]);
  if (!moving) return null;
  const wave = <Svg width={WIDTH * 2} height={HEIGHT} viewBox="0 0 400 100" preserveAspectRatio="none">
    <Path d={PATH} fill={Colors.login.waveMid} />
  </Svg>;
  if (Platform.OS === 'web') return <>
    {createElement('style', null, CSS)}
    {createElement('div', { className: 'aquora-tank-wave', 'aria-hidden': true,
      style: { position: 'absolute', left: 0, top: -HEIGHT + 2, width: WIDTH * 2, height: HEIGHT,
        pointerEvents: 'none', animation: 'aquora-tank-drift 4s linear infinite' } }, wave)}
  </>;
  return <Animated.View pointerEvents="none" style={[styles.wave, { transform: [{ translateX }] }]}>{wave}</Animated.View>;
});

const styles = StyleSheet.create({ wave: { position: 'absolute', left: 0, top: -HEIGHT + 2, width: WIDTH * 2, height: HEIGHT } });
