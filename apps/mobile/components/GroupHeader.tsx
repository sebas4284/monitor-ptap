import { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { GroupId } from '../services/signal-groups';

/**
 * Encabezado de un grupo de señales (Entrada / Salida / Proceso).
 *
 * **Candado de seguridad:** si el grupo trae algo fuera de rango, sin dato, o la planta está
 * congelada, `lockedOpen` es true y el encabezado deja de ser pulsable. Una anomalía no puede
 * quedar detrás de un gesto en un tablero de planta — la agrupación es para dar jerarquía, no para
 * esconder. Cuando está bloqueado se dice por qué, para que no parezca un botón roto.
 *
 * Recibe PRIMITIVAS, no el objeto grupo: los grupos se reconstruyen en cada push de ~2 s, así que
 * pasar el objeto dejaría el `memo` sin efecto.
 */
function GroupHeaderBase({
  id,
  title,
  count,
  anomalyCount,
  noDataCount,
  lockedOpen,
  collapsed,
  onToggle,
}: {
  id: GroupId;
  title: string;
  count: number;
  anomalyCount: number;
  noDataCount: number;
  lockedOpen: boolean;
  collapsed: boolean;
  onToggle: (id: GroupId) => void;
}) {
  const motivo =
    anomalyCount > 0
      ? `${anomalyCount} fuera de rango`
      : noDataCount > 0
        ? `${noDataCount} sin dato`
        : 'datos congelados';

  const body = (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.countPill}>
        <Text style={styles.countText}>{count}</Text>
      </View>

      {anomalyCount > 0 && (
        <View style={styles.alertPill}>
          <Ionicons name="alert-circle" size={12} color={Colors.danger} />
          <Text style={styles.alertText}>{anomalyCount}</Text>
        </View>
      )}

      <View style={styles.spacer} />

      {lockedOpen ? (
        <View style={styles.lockRow}>
          <Ionicons name="lock-closed" size={12} color={Colors.textSecondary} />
          <Text style={styles.lockText}>{motivo}</Text>
        </View>
      ) : (
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={18}
          color={Colors.textSecondary}
        />
      )}
    </View>
  );

  if (lockedOpen) {
    return (
      <View
        style={styles.header}
        accessibilityRole="header"
        accessibilityLabel={`${title}, ${count} señales. No se puede plegar: ${motivo}.`}
      >
        {body}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.header}
      onPress={() => onToggle(id)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${title}, ${count} señales. ${collapsed ? 'Desplegar' : 'Plegar'}.`}
    >
      {body}
    </TouchableOpacity>
  );
}

export const GroupHeader = memo(GroupHeaderBase);

const styles = StyleSheet.create({
  header: { paddingHorizontal: 5, paddingVertical: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary, letterSpacing: 0.3 },
  countPill: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  countText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  alertPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.danger + '18',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  alertText: { fontSize: 11, fontWeight: '700', color: Colors.danger },
  spacer: { flex: 1 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lockText: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },
});
