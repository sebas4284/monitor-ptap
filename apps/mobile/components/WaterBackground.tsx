import { createElement, memo, useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Path } from './WaterVector';
import Colors from '../constants/colors';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { wavePath } from './wave-path';

const LAYERS = [
  { color: Colors.login.waveBack, height: '100%', seconds: 12, amplitude: 12 },
  { color: Colors.login.waveMid, height: '84%', seconds: 10, amplitude: 16 },
  { color: Colors.login.waveFront, height: '68%', seconds: 8, amplitude: 20 },
] as const;
const WEB_MOTION = '@keyframes aquora-water-drift{from{transform:translateX(0)}to{transform:translateX(-50%)}}@media(prefers-reduced-motion:reduce){.aquora-water-wave{animation:none!important}}';

// Web: transformaciones CSS; Android/iOS: driver nativo, sin renders React por frame.
export const WaterBackground = memo(function WaterBackground({ level }: { level: number }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [drift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (Platform.OS === 'web' || reduced || width === 0) return;
    const animation = Animated.loop(Animated.timing(drift, {
      toValue: 1, duration: 10000, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    animation.start();
    return () => { animation.stop(); drift.setValue(0); };
  }, [reduced, width, drift]);
  return (
    <View
      pointerEvents="none"
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      onLayout={Platform.OS === 'web' ? undefined : (event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.water, { height: `${Math.max(0, Math.min(1, level)) * 100}%` }]}
    >
      {Platform.OS === 'web' && createElement('style', null, WEB_MOTION)}
      {LAYERS.map((layer, index) => {
        const wave = <Svg width="100%" height="100%" viewBox="0 0 200 100" preserveAspectRatio="none">
          <Path d={wavePath(2, layer.amplitude)} fill={layer.color} />
        </Svg>;
        return Platform.OS === 'web'
          ? createElement('div', {
            key: layer.color, className: 'aquora-water-wave',
            style: { position: 'absolute', left: 0, bottom: 0, width: '200%', height: layer.height,
              animation: reduced ? 'none' : `aquora-water-drift ${layer.seconds}s linear infinite`,
              animationDirection: index === 1 ? 'reverse' : 'normal' },
          }, wave)
          : <Animated.View key={layer.color} style={{ position: 'absolute', left: 0, bottom: 0,
            width: width * 2, height: layer.height,
            transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: index === 1 ? [-width, 0] : [0, -width] }) }] }}>
            {wave}
          </Animated.View>;
      })}
    </View>
  );
});
const styles = StyleSheet.create({ water: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' } });
