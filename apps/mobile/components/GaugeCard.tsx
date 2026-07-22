import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto, UnusableReason } from '../services/api';
import { directionFor } from '../services/signal-kind';

const REASON_TEXT: Record<UnusableReason, string> = {
  BAD_QUALITY: 'calidad OPC no buena',
  INVALID_NUMBER: 'valor inválido',
  BRIDGE_STALE: 'sin datos frescos',
};

/**
 * Tarjeta simple de una señal de dominio (presión, pH, turbidez, temperatura, oxígeno,
 * conductividad, cloro). Política de datos (usuario, 2026-07-15): si hay valor numérico
 * SE MUESTRA tal cual; "sin dato" solo cuando value es null (rule: no fabricar números).
 */
export function GaugeCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }) {
  const numeric = typeof signal.value === 'number';
  const hasMin = typeof signal.opMin === 'number';
  const hasMax = typeof signal.opMax === 'number';
  const direction = directionFor(name);
  const accent =
    direction === 'inlet' ? Colors.accentInlet : direction === 'outlet' ? Colors.accentOutlet : Colors.textPrimary;

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon as never} size={20} color={Colors.primary} />
      </View>
      <Text style={styles.name}>{signal.label ?? name}</Text>

      {numeric ? (
        <Text style={[styles.value, { color: accent }]}>
          {(signal.value as number).toFixed(2)}
          <Text style={styles.unit}> {signal.unit ?? ''}</Text>
        </Text>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataValue}>sin dato</Text>
          {signal.reason && <Text style={styles.noDataReason}>{REASON_TEXT[signal.reason]}</Text>}
        </View>
      )}

      {(hasMin || hasMax) && (
        <Text style={styles.rangeText}>
          {hasMin ? `Mín: ${(signal.opMin as number).toFixed(2)}` : ''}
          {hasMin && hasMax ? '   ' : ''}
          {hasMax ? `Máx: ${(signal.opMax as number).toFixed(2)}` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 5,
    padding: 14,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  name: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textAlign: 'center' },
  value: { fontSize: 28, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  rangeText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  noData: { marginBottom: 6, alignItems: 'center' },
  noDataValue: { fontSize: 20, fontWeight: '700', color: Colors.neutral },
  noDataReason: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
});
