import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { Font, withAlpha } from '../constants/theme';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import type { SignalDto } from '../services/api';
import { directionFor } from '../services/signal-kind';
import { GaugeCard } from './GaugeCard';
import { sameSignalCard } from './memo-compare';
import { BotonSilencio } from './BotonSilencio';

/** Formato numérico es-CO (coma decimal + separador de miles), coherente con el reloj del tablero. */
const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Tarjeta de caudal con barra de progreso 0-100%, estilo "Macromedidor" de xtio.
 * Requiere opMin y opMax numéricos y con rango > 0 para calcular el %; si faltan, o si el rango
 * es degenerado (opMin === opMax → dividir por cero daría "NaN%"), o el valor es null, cae a
 * GaugeCard — no hay con qué dibujar la barra.
 */
function FlowMeterCardBase({
  signal,
  name,
  icon,
  frozen = false,
  compact = false,
  plantId,
}: {
  signal: SignalDto;
  name: string;
  icon: string;
  frozen?: boolean;
  /**
   * Planta a la que pertenece la señal. Solo para la campana de silencio: el silenciado es por
   * planta Y señal, porque `outletFlow1` existe en las doce.
   */
  plantId?: string;
  /** Tablero en modo compacto: oculta las etiquetas 0%/N%/100% bajo la barra. */
  compact?: boolean;
}) {
  const numeric = typeof signal.value === 'number';
  const opMin = signal.opMin;
  const opMax = signal.opMax;
  const hasSpan = typeof opMin === 'number' && typeof opMax === 'number' && opMax - opMin > 0;

  if (!numeric || !hasSpan) {
    return <GaugeCard signal={signal} name={name} icon={icon} frozen={frozen} compact={compact} />;
  }

  const value = signal.value as number;
  const rawPct = ((value - (opMin as number)) / ((opMax as number) - (opMin as number))) * 100;
  const pct = Math.min(100, Math.max(0, rawPct));
  // Aviso: fuera del rango operativo (del backend) o valor que se sale del 0–100% de la barra.
  const outOfRange = Boolean(signal.outOfRange) || rawPct < 0 || rawPct > 100;
  const direction = directionFor(name);
  const accent = direction === 'inlet' ? Colors.accentInlet : direction === 'outlet' ? Colors.accentOutlet : Colors.primary;

  return (
    <Card frozen={frozen}>
      <View style={[styles.headerBar, { backgroundColor: withAlpha(accent, 0.13), borderColor: accent }]}>
        <Ionicons name={icon as never} size={16} color={accent} />
        <Text style={[styles.headerText, { color: accent }]} numberOfLines={1}>
          {(signal.label ?? name).toUpperCase()}
        </Text>
      </View>

      {(frozen || outOfRange) && (
        <View style={styles.tagsRow}>
          {frozen && <Badge label="congelado" tone={Colors.textSecondary} />}
          {outOfRange && <Badge label="fuera de rango" tone={Colors.danger} />}
        </View>
      )}

      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {fmt(value)}
        <Text style={styles.unit}> {signal.unit ?? ''}</Text>
      </Text>

      <View style={styles.barOuter}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: outOfRange ? Colors.danger : accent }]} />
      </View>
      {!compact && (
        <View style={styles.barLabels}>
          <Text style={styles.barLabelText}>0%</Text>
          <Text style={[styles.barLabelText, outOfRange && styles.barLabelAlert]}>{Math.round(pct)}%</Text>
          <Text style={styles.barLabelText}>100%</Text>
        </View>
      )}
    </Card>
  );
}

/** Memo con comparación POR VALOR — ver `memo-compare.ts`. */
export const FlowMeterCard = memo(FlowMeterCardBase, sameSignalCard);

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 10,
  },
  headerText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, flexShrink: 1 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  value: { fontSize: Font.size.display, fontWeight: Font.weight.heavy, color: Colors.textPrimary, marginBottom: 10, fontVariant: ['tabular-nums'] },
  unit: { fontSize: Font.size.body, fontWeight: Font.weight.regular, color: Colors.textSecondary },
  barOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    marginBottom: 4,
  },
  barFill: { height: '100%', borderRadius: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabelText: { fontSize: 12, color: Colors.textSecondary },
  barLabelAlert: { color: Colors.danger, fontWeight: '700' },
});
