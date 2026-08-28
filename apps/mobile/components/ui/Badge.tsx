import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Font, withAlpha } from '../../constants/theme';

/**
 * Chip de estado — el bloque `frozenTag`/`rangeTag` que las tres tarjetas del tablero repetían
 * palabra por palabra (fondo = color al ~13 %, borde y texto = color pleno). Un solo componente,
 * con el color como único parámetro.
 *
 * `tone` es el color base (p. ej. `Colors.danger` para «fuera de rango», `Colors.textSecondary`
 * para «congelado»). Con `withAlpha` se acabó el frágil `Colors.danger + '22'` escrito a mano.
 */
export function Badge({ label, tone = Colors.textSecondary }: { label: string; tone?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(tone, 0.13), borderColor: tone }]}>
      <Text style={[styles.text, { color: tone }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: Radius.sm, // 6
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: Font.size.caption, // 11
    fontWeight: Font.weight.bold, // '700'
    letterSpacing: 0.5,
  },
});
