import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SupervisedValve } from '../hooks/useValveSupervisor';
import Colors from '../constants/colors';
import { sameValveItem } from './memo-compare';

interface Props {
  valve: SupervisedValve;
  /** La planta perdió la conexión: los valores mostrados son la última lectura. */
  frozen?: boolean;
}

const STATE_LABEL: Record<SupervisedValve['state'], string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  unknown: 'Sin dato',
};

function ValveItemBase({ valve, frozen = false }: Props) {
  // Se muestra el estado EFECTIVO: el que sigue al caudal si se detectó operación manual, para no
  // dar por abierto/cerrado algo que ya se movió a mano.
  const shown = valve.effectiveState;
  const color = shown === 'open' ? Colors.success : shown === 'closed' ? Colors.danger : Colors.neutral;
  const iconName = shown === 'open' ? 'toggle' : 'toggle-outline';

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
        </View>
      </View>

      <View style={styles.right}>
        <View style={[styles.badge, { backgroundColor: color + '18' }]}>
          <Text style={[styles.badgeText, { color }]}>{STATE_LABEL[shown]}</Text>
        </View>
      </View>
    </View>
  );
}

/** Memo con comparación POR VALOR — ver `memo-compare.ts`. */
export const ValveItem = memo(ValveItemBase, sameValveItem);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    // Antes '#E5E7EB' (gris claro), resto de la paleta clara que nunca se usó: sobre el fondo
    // oscuro real se veía como un borde blanco fuera de sistema.
    borderColor: Colors.divider,
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
  tagWarn: {
    backgroundColor: Colors.warning + '22',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagWarnText: { fontSize: 11, fontWeight: '700', color: Colors.warning, letterSpacing: 0.3 },
  tagNeutral: {
    backgroundColor: Colors.textSecondary + '22',
    borderColor: Colors.textSecondary,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagNeutralText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.3 },
  right: { alignItems: 'flex-end', gap: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
