import { View, StyleSheet, type ViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Radius } from '../../constants/theme';

/**
 * Tarjeta base del tablero — el contenedor que `GaugeCard`, `FlowMeterCard` y `TankGaugeCard`
 * repetían VERBATIM (mismo fondo, borde, radio y relleno, más `opacity: 0.55` al congelarse). Es la
 * «separación / reutilización» del PDF: el «look de tarjeta» vive en un solo sitio, así que un
 * cambio de radio o de borde se hace una vez y alcanza a las tres.
 *
 * El relleno (14) y el margen de rejilla (5) se conservan tal cual y CENTRALIZADOS aquí: son valores
 * finos que, al vivir en un único componente, dejan de ser números mágicos repartidos.
 */
export function Card({
  frozen = false,
  style,
  children,
  ...rest
}: ViewProps & { frozen?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View {...rest} style={[styles.card, frozen && styles.frozen, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 5, // canaleta de la rejilla de 2 columnas
    padding: 14, // relleno estándar de tarjeta
    backgroundColor: Colors.bg,
    borderRadius: Radius.xl, // 16
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  frozen: { opacity: 0.55 },
});
