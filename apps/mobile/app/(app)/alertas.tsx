import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAlerts } from '../../hooks/useAlerts';
import { usePlant } from '../../context/PlantContext';
import type { Alert } from '../../services/alerts';
import Colors from '../../constants/colors';

function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function AlertRow({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const color = alert.severity === 'critical' ? Colors.danger : Colors.warning;
  const time = hhmm(alert.ts);
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Ionicons
        name={alert.severity === 'critical' ? 'alert-circle' : 'warning-outline'}
        size={20}
        color={color}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{alert.label}</Text>
          <Text style={[styles.value, { color }]}>
            {alert.value.toFixed(2)}
            {alert.unit ? ` ${alert.unit}` : ''}
          </Text>
        </View>
        <Text style={styles.message}>{alert.message}</Text>
        {time && <Text style={styles.time}>Última lectura {time}</Text>}
      </View>
      <TouchableOpacity onPress={onDismiss} hitSlop={8} style={styles.dismiss}>
        <Ionicons name="close" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

export default function AlertasScreen() {
  const { alerts, count, dismiss, dismissAll } = useAlerts();
  const { selectedPlant } = usePlant();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text style={styles.heading}>Alertas</Text>
            <Text style={styles.sub}>
              {selectedPlant.name} · {count === 0 ? 'sin alertas' : `${count} activa${count === 1 ? '' : 's'}`}
            </Text>
          </View>
          {count > 0 && (
            <TouchableOpacity onPress={dismissAll} style={styles.clearBtn} activeOpacity={0.8}>
              <Ionicons name="checkmark-done-outline" size={16} color={Colors.primary} />
              <Text style={styles.clearText}>Descartar todas</Text>
            </TouchableOpacity>
          )}
        </View>

        {count === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={44} color={Colors.success} />
            <Text style={styles.emptyTitle}>Todo en orden</Text>
            <Text style={styles.emptyText}>
              No hay señales fuera de rango en esta planta. Las alertas se calculan en vivo desde las
              lecturas del PLC; aparecerán aquí si un valor sale de su rango operativo o físico.
            </Text>
          </View>
        ) : (
          alerts.map((a) => <AlertRow key={a.id} alert={a} onDismiss={() => dismiss(a.id)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 16 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  heading: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  clearText: { fontSize: 12.5, fontWeight: '700', color: Colors.primary },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  value: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  message: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 17 },
  time: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },
  dismiss: { padding: 2 },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
});
