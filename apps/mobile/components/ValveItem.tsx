import { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FLOW_CLOSED_THRESHOLD } from '../services/valves';
import type { SupervisedValve } from '../hooks/useValveSupervisor';
import Colors from '../constants/colors';
import { sameValveItem } from './memo-compare';

interface Props {
  valve: SupervisedValve;
  /** Acción de mando; recibe la válvula. Si falta, la fila es de solo lectura (rol sin permiso).
   *  Recibe la válvula en vez de cerrarse sobre ella para que la pantalla pueda pasar UNA función
   *  estable a todas las filas y el `memo` sirva de algo. */
  onToggle?: (valve: SupervisedValve) => void;
  /** La planta perdió la conexión: los valores mostrados son la última lectura. */
  frozen?: boolean;
  /** Hay una orden en vuelo para esta válvula. */
  busy?: boolean;
  /** Modo compacto: oculta la línea de diagnóstico con las palabras crudas del PLC. */
  compact?: boolean;
}

const STATE_LABEL: Record<SupervisedValve['state'], string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  unknown: 'Sin dato',
};

function ValveItemBase({ valve, onToggle, frozen = false, busy = false, compact = false }: Props) {
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
        {/* Los dos métodos, con la palabra cruda del PLC para diagnóstico. En modo compacto se
            ocultan: el veredicto y su procedencia ya están arriba, y el `16385` solo sirve a quien
            está depurando el mapping. Un desacuerdo entre métodos SIEMPRE se muestra (etiqueta
            arriba), así que ocultar esto no puede esconder una anomalía. */}
        {!compact && (
          <Text style={styles.methods}>
            Estado: {valve.byState ? STATE_LABEL[valve.byState] : '—'}
            {valve.rawState !== null ? ` (${valve.rawState})` : ''}
            {'   ·   '}
            Caudal: {valve.byFlow ? STATE_LABEL[valve.byFlow] : '—'}
          </Text>
        )}
      </View>

      <View style={styles.right}>
        <View style={[styles.badge, { backgroundColor: color + '18' }]}>
          <Text style={[styles.badgeText, { color }]}>{STATE_LABEL[shown]}</Text>
        </View>
        {onToggle && (
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: Colors.primary + '15' }]}
            onPress={() => onToggle(valve)}
            activeOpacity={0.7}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={
              busy
                ? `Enviando orden a ${valve.name}`
                : `${shown === 'open' ? 'Cerrar' : 'Abrir'} ${valve.name}. Pedirá confirmación.`
            }
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
        {/* Válvula sin canal de mando: se dice por qué no hay botón. Un hueco mudo haría pensar en
            un fallo de la app o en un permiso que falta, y no es ninguna de las dos cosas. */}
        {!valve.commandable && (
          <Text style={styles.sinMando} numberOfLines={2}>
            Sin canal de comando
          </Text>
        )}
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
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  toggleText: { fontSize: 12, fontWeight: '700' },
  // Discreta a propósito: informa de una limitación, no de un problema. Compite con el badge de
  // estado, que es lo que el operador viene a mirar.
  sinMando: { fontSize: 10, color: Colors.textSecondary, marginTop: 6, textAlign: 'right' },
});
