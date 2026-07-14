import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto, UnusableReason } from '../services/api';

const REASON_TEXT: Record<UnusableReason, string> = {
  BAD_QUALITY: 'calidad OPC no buena',
  INVALID_NUMBER: 'valor inválido',
  OUT_OF_RANGE: 'fuera de rango físico',
  BRIDGE_STALE: 'sin datos frescos',
};

/**
 * Tarjeta de una señal de dominio. Distingue lo confirmado de lo inferido (regla 10):
 * un caudal inferido NO se ve igual que uno confirmado. Y una señal usable:false NUNCA
 * se muestra como número: "sin dato" + la razón. Nunca un número del que no nos fiamos.
 */
export function SignalCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }) {
  const isInferred = signal.confidence !== 'confirmed';
  const numeric = typeof signal.value === 'number';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon as never} size={18} color={Colors.primary} />
        </View>
        <Text style={styles.name}>{signal.label ?? name}</Text>
        {isInferred && (
          <View style={styles.inferredTag}>
            <Text style={styles.inferredText}>inferido</Text>
          </View>
        )}
      </View>

      {signal.usable && numeric ? (
        <Text style={styles.value}>
          {(signal.value as number).toFixed(2)}
          <Text style={styles.unit}> {signal.unit ?? ''}</Text>
        </Text>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataValue}>sin dato</Text>
          {signal.reason && <Text style={styles.noDataReason}>{REASON_TEXT[signal.reason]}</Text>}
        </View>
      )}

      {isInferred && (
        <Text style={styles.footnote}>
          * semántica inferida (no confirmada por documento de la planta)
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
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  inferredTag: {
    backgroundColor: '#FFF7ED',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inferredText: { fontSize: 9, fontWeight: '700', color: Colors.warning, letterSpacing: 0.5 },
  value: { fontSize: 28, fontWeight: '800', color: Colors.primary, marginBottom: 6 },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  noData: { marginBottom: 6 },
  noDataValue: { fontSize: 22, fontWeight: '700', color: Colors.neutral },
  noDataReason: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  footnote: { fontSize: 9, color: Colors.textSecondary, marginTop: 2 },
});
