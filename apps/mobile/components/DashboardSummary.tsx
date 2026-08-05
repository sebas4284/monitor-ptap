import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';

/**
 * Titular del tablero: cuántas señales hay, cuántas están fuera de rango y cuántas sin dato.
 *
 * Existe porque el tablero de una planta grande son ~22 tarjetas y más de 100 números: sin esto,
 * saber si algo va mal exige recorrerlos todos con la vista. La lectura correcta es "1 fuera de
 * rango" primero, y el detalle después.
 *
 * Recibe PRIMITIVAS, no el objeto resumen: ese objeto se reconstruye en cada push de ~2 s, así que
 * pasarlo entero dejaría el `memo` sin efecto (comparación por referencia siempre distinta).
 */
function DashboardSummaryBase({
  total,
  anomalies,
  noData,
  compact,
}: {
  total: number;
  anomalies: number;
  noData: number;
  compact: boolean;
}) {
  const allGood = anomalies === 0 && noData === 0;

  return (
    <View
      style={styles.strip}
      accessibilityRole="summary"
      accessibilityLabel={
        allGood
          ? `${total} señales, todas dentro de rango`
          : `${total} señales. ${anomalies} fuera de rango. ${noData} sin dato.`
      }
    >
      <Stat icon="analytics-outline" color={Colors.textSecondary} value={total} label="señales" />
      <Stat
        icon={anomalies > 0 ? 'alert-circle' : 'checkmark-circle-outline'}
        color={anomalies > 0 ? Colors.danger : Colors.success}
        value={anomalies}
        label="fuera de rango"
      />
      <Stat
        icon="help-circle-outline"
        color={noData > 0 ? Colors.warning : Colors.textSecondary}
        value={noData}
        label="sin dato"
      />
      {compact && (
        <View style={styles.compactTag}>
          <Text style={styles.compactTagText}>compacto</Text>
        </View>
      )}
    </View>
  );
}

function Stat({
  icon,
  color,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export const DashboardSummary = memo(DashboardSummaryBase);

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, color: Colors.textSecondary },
  compactTag: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  compactTagText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
});
