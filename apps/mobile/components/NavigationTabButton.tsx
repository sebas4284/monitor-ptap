import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useReducedMotion } from '../hooks/useReducedMotion';

export function NavigationTabButton(props: ComponentProps<typeof PlatformPressable>) {
  const selected = props['aria-selected'] === true || props.accessibilityState?.selected === true;
  const previous = useRef(selected);
  const [scale] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  useEffect(() => {
    const changed = previous.current !== selected;
    previous.current = selected;
    if (!changed || !selected || reduced) {
      scale.setValue(1);
      return;
    }
    scale.setValue(0.94);
    const animation = Animated.timing(scale, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => {
      animation.stop();
      scale.setValue(1);
    };
  }, [selected, reduced, scale]);
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <PlatformPressable {...props} />
    </Animated.View>
  );
}
