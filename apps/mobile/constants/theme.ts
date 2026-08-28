import type { ViewStyle } from 'react-native';
import Colors from './colors';

/**
 * Tokens de diseño de Aquora — la versión React Native de las «variables CSS» (`:root { --x }`).
 *
 * Antes solo existía `colors.ts`; el espaciado, los radios, la tipografía y las sombras vivían como
 * números mágicos repetidos en 31 `StyleSheet` (borderRadius 4/5/6/8/10/12/14/16/18/21, fontSize
 * 9/10/11/12/13/14/15/16/17/20/28/34…). Un token se cambia en UN sitio y se propaga a toda la app,
 * exactamente como una Custom Property de CSS: es el «mantenibilidad» del PDF, traducido a RN.
 *
 * El color sigue viviendo en `colors.ts` (importado en toda la app); aquí se re-exporta para tener
 * una sola puerta de entrada al tema: `import { Colors, Spacing, Radius, Font } from '.../theme'`.
 */

/** Escala de espaciado (padding, margin, gap). Base 4, como la mayoría de sistemas de diseño. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/** Radios de borde. `pill` para chips redondeados; el círculo del icono usa width/2 aparte. */
export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 16,
  pill: 999,
} as const;

/**
 * Escala tipográfica NOMBRADA — sustituye a los `fontSize`/`fontWeight` sueltos por un rol legible.
 * Es la «jerarquía visual» del PDF: el tamaño ya no es un número mágico, es `title` o `caption`.
 */
export const Font = {
  size: {
    caption: 11, // etiquetas, chips, pies de nota
    small: 13, // texto secundario denso
    body: 14, // cuerpo por defecto
    subtitle: 16, // subtítulos, títulos de barra
    title: 20, // títulos de sección / "sin dato"
    display: 28, // valor grande de una señal
    hero: 34, // el % gigante del tanque
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    heavy: '800',
  },
} as const;

/**
 * Elevación de tarjeta. Solo props nativas: react-native-web las traduce a `box-shadow`, así que
 * NO hace falta un `Platform.select` con CSS a mano (que es lo que hoy se repite en los diálogos).
 * El tablero es plano (borde en vez de sombra), así que esto queda disponible para diálogos/menús.
 */
export const Shadow: { card: ViewStyle } = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
};

/**
 * Opacidad sobre un color hex → `#RRGGBBAA`. Reemplaza el frágil `Colors.success + '18'` (concatenar
 * un sufijo alfa de 2 dígitos a mano, repartido por decenas de componentes). `alpha` en 0..1.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export { Colors };

/** Tema agrupado, por si se prefiere un único import: `import Theme from '.../theme'`. */
const Theme = { colors: Colors, spacing: Spacing, radius: Radius, font: Font, shadow: Shadow, withAlpha };
export default Theme;
