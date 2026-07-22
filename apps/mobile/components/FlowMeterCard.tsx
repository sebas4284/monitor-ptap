import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto } from '../services/api';
import { directionFor } from '../services/signal-kind';
import { GaugeCard } from './GaugeCard';

/**
 * Tarjeta de caudal con barra de progreso 0-100%, estilo "Macromedidor" de xtio.
 * Requiere opMin y opMax numéricos para calcular el %; si faltan, o si el valor es null,
 * cae a GaugeCard — no hay con qué dibujar la barra (no es una decisión de UX).
 */
export function FlowMeterCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }) {
  const numeric = typeof signal.value === 'number';
  const hasBothBounds = typeof signal.opMin === 'number' && typeof signal.opMax === 'number';

  if (!numeric || !hasBothBounds) {
    return <GaugeCard signal={signal} name={name} icon={icon} />;
  }

  const value = signal.value as number;
  const opMin = signal.opMin as number;
  const opMax = signal.opMax as number;
  const pct = Math.min(100, Math.max(0, ((value - opMin) / (opMax - opMin)) * 100));
  const direction = directionFor(name);
  const accent = direction === 'inlet' ? Colors.accentInlet : direction === 'outlet' ? Colors.accentOutlet : Colors.primary;

  return (
    <View style={styles.card}>
      <View style={[styles.headerBar, { backgroundColor: accent + '22', borderColor: accent }]}>
        <Ionicons name={icon as never} size={16} color={accent} />
        <Text style={[styles.headerText, { color: accent }]}>{(signal.label ?? name).toUpperCase()}</Text>
      </View>

      <Text style={styles.value}>
        {value.toFixed(2)}
        <Text style={styles.unit}> {signal.unit ?? ''}</Text>
      </Text>

      <View style={styles.barOuter}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: accent }]} />
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.barLabelText}>0%</Text>
        <Text style={styles.barLabelText}>{Math.round(pct)}%</Text>
        <Text style={styles.barLabelText}>100%</Text>
      </View>
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
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 10,
  },
  headerText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  value: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  barOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    marginBottom: 4,
  },
  barFill: { height: '100%', borderRadius: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabelText: { fontSize: 10, color: Colors.textSecondary },
});
