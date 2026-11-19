import { createElement, type ReactNode } from 'react';

// Las ondas web usan SVG del navegador; Android conserva react-native-svg.
export default function WaterVector(props: {
  width: string | number;
  height: string | number;
  viewBox: string;
  preserveAspectRatio: string;
  children: ReactNode;
}) {
  return createElement('svg', { ...props, 'aria-hidden': true, focusable: false });
}

export function Path(props: { d: string; fill: string; fillOpacity?: number }) {
  return createElement('path', props);
}
