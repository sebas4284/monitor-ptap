import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FLOW_CLOSED_THRESHOLD } from '../services/valves';
import type { SupervisedValve } from '../hooks/useValveSupervisor';
import Colors from '../constants/colors';

interface Props {
  valve: SupervisedValve;
  /** Acción de mando. Si falta, la fila es de solo lectura (rol sin permiso). */
  onToggle?: () => void;
  /** La planta perdió la conexión: los valores mostrados son la última lectura. */
  frozen?: boolean;
  /** Hay una orden en vuelo para esta válvula. */
  busy?: boolean;
}

const STATE_LABEL: Record<SupervisedValve['state'], string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  unknown: 'Sin dato',
};

export function ValveItem({ valve, onToggle, frozen = false, busy = false }: Props) {
  // Se muestra el estado EFECTIVO: el que sigue al caudal si se detectó operación manual, para no
  // mandar "abrir" a algo que ya abrieron a mano.
  const shown = valve.effectiveState;
  const color = shown === 'open' ? Colors.success : shown === 'closed' ? Colors.danger : Colors.neutral;
  const iconName = shown === 'open' ? 'toggle' : 'toggle-outline';

  // Cómo se supo el estado, en lenguaje de operador.
  const fuente =
    valve.source === 'estado'
      ? 'lectura del PLC'
      : valve.source === 'caudal'
        ? `por caudal ${valve.flowValue?.toFixed(2)} ${valve.flowUnit ?? ''} (cerrada si ≤ ${FLOW_CLOSED_THRESHOLD})`
        : 'sin lectura de estado ni caudal';

  return (
    <View style={[styles.row, frozen && styles.rowFrozen]}>
      <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={iconName} size={22} color={color} />
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{valve.name}</Text>
          {frozen && (
            <View style={styles.tagNeutral}>
              <Text style={styles.tagNeutralText}>congelado</Text>
            </View>
          )}
          {valve.manualOverride && (
            <View style={styles.tagWarn}>
              <Text style={styles.tagWarnText}>operada manualmente</Text>
            </View>
          )}
          {valve.disagreement && !valve.manualOverride && (
            <View style={styles.tagWarn}>
              <Text style={styles.tagWarnText}>estado y caudal no coinciden</Text>
            </View>
          )}
        </View>
        <Text style={styles.desc}>{fuente}</Text>
        {/* Los dos métodos, siempre visibles: nunca se elige uno en silencio. */}
        <Text style={styles.methods}>
          Estado: {valve.byState ? STATE_LABEL[valve.byState] : '—'}
          {valve.rawState !== null ? ` (${valve.rawState})` : ''}
          {'   ·   '}
          Caudal: {valve.byFlow ? STATE_LABEL[valve.byFlow] : '—'}
        </Text>
      </View>

      <View style={styles.right}>
        <View style={[styles.badge, { backgroundColor: color + '18' }]}>
          <Text style={[styles.badgeText, { color }]}>{STATE_LABEL[shown]}</Text>
        </View>
        {onToggle && (
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: Colors.primary + '15' }]}
            onPress={onToggle}
            activeOpacity={0.7}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Ionicons
                name={shown === 'open' ? 'close-circle-outline' : 'checkmark-circle-outline'}
                size={16}
                color={Colors.primary}
              />
            )}
            <Text style={[styles.toggleText, { color: Colors.primary }]}>
              {busy ? 'Enviando…' : shown === 'open' ? 'Cerrar' : 'Abrir'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rowFrozen: { opacity: 0.55 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  desc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  methods: { fontSize: 11, color: Colors.textSecondary, marginTop: 3, fontVariant: ['tabular-nums'] },
  tagWarn: {
    backgroundColor: Colors.warning + '22',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagWarnText: { fontSize: 9, fontWeight: '700', color: Colors.warning, letterSpacing: 0.3 },
  tagNeutral: {
    backgroundColor: Colors.textSecondary + '22',
    borderColor: Colors.textSecondary,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagNeutralText: { fontSize: 9, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.3 },
  right: { alignItems: 'flex-end', gap: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  toggleText: { fontSize: 12, fontWeight: '700' },
});
