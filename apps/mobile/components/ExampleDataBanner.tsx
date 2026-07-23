import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';

/**
 * Aviso VISIBLE de que una pantalla muestra datos de EJEMPLO (no telemetría real del PLC). Honra
 * "el tablero nunca miente": mientras una feature no consuma datos reales (válvulas por el canal de
 * comandos, reportes reales), el usuario debe saber que lo que ve es un placeholder. Se retira en
 * cuanto la pantalla pase a datos reales.
 */
export function ExampleDataBanner({ detail }: { detail?: string }) {
  return (
    <View style={styles.banner}>
      <Ionicons name="construct-outline" size={18} color={Colors.warning} />
      <View style={styles.texts}>
        <Text style={styles.title}>Datos de ejemplo</Text>
        <Text style={styles.detail}>
          {detail ?? 'Esta sección aún no muestra datos reales del PLC. Es una vista de demostración.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: Colors.warning + '14',
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginHorizontal: 16,
    marginTop: 12,
  },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontWeight: '700', color: Colors.warning },
  detail: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
});
