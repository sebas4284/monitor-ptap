import { memo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Ionicons from './AppIcon';
import Colors from '../constants/colors';
import { Fonts } from '../constants/fonts';
import type { SignalDto } from '../services/api';
import { directionLook, isAnomalous, signalState } from '../services/card-look';
import { useStateFlash } from '../hooks/useStateFlash';
import { GaugeCard } from './GaugeCard';
import { BotonSilencio } from './BotonSilencio';
import { sameSignalCard } from './memo-compare';

const B = Colors.brand;

/** Formato numérico es-CO (coma decimal + separador de miles), coherente con el reloj del tablero. */
const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Tarjeta de caudal con barra de rango operativo (referencia TableroEscritorio: "Mín · Fuera de
 * rango · Máx"). Requiere opMin y opMax numéricos y con rango > 0; si faltan, o si el rango es
 * degenerado (opMin === opMax → dividir por cero daría "NaN%"), o el valor es null, cae a
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
  /** Tablero en modo compacto: oculta la fila Mín/Máx bajo la barra. */
  compact?: boolean;
}) {
  const numeric = typeof signal.value === 'number';
  const opMin = signal.opMin;
  const opMax = signal.opMax;
  const hasSpan = typeof opMin === 'number' && typeof opMax === 'number' && opMax - opMin > 0;
  // Hooks antes de cualquier retorno: el número de hooks no puede cambiar entre renders.
  const flash = useStateFlash(signalState(signal), frozen);

  if (!numeric || !hasSpan) {
    return (
      <GaugeCard
        signal={signal}
        name={name}
        icon={icon}
        frozen={frozen}
        compact={compact}
        plantId={plantId}
      />
    );
  }

  const value = signal.value as number;
  const rawPct = ((value - (opMin as number)) / ((opMax as number) - (opMin as number))) * 100;
  const pct = Math.min(100, Math.max(0, rawPct));
  // Mismo criterio que la campana (rango físico u operativo) + la barra que se sale del 0–100 %.
  const anomaly = isAnomalous(signal) || rawPct < 0 || rawPct > 100;
  const dir = directionLook(name);
  const accent = dir?.color ?? B.blue;
  const label = signal.label ?? name;

  return (
    <View style={[styles.card, anomaly && styles.cardAnomaly, frozen && styles.cardFrozen]}>
      <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
      <View style={styles.top}>
        <Ionicons name={icon as never} size={16} color={accent} />
        <Text style={styles.name} numberOfLines={2}>
          {label}
        </Text>
        {plantId ? <BotonSilencio plantId={plantId} subject={name} etiqueta={label} /> : null}
      </View>
      {dir && (
        <View style={styles.dirRow}>
          <Ionicons name={dir.icon} size={12} color={dir.color} />
          <Text style={[styles.dirText, { color: dir.color }]}>{dir.label}</Text>
        </View>
      )}

      <Text
        style={[styles.value, { color: anomaly ? B.dangerText : accent }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {fmt(value)}
        <Text style={styles.unit}> {signal.unit ?? ''}</Text>
      </Text>

      <View style={styles.barOuter}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%`, backgroundColor: anomaly ? Colors.danger : accent },
          ]}
        />
      </View>
      {!compact && (
        <View style={styles.barLabels}>
          <Text style={styles.barLabelText}>Mín {fmt(opMin as number)}</Text>
          {anomaly ? (
            <Text style={[styles.barLabelText, { color: B.dangerText }]}>Fuera de rango</Text>
          ) : frozen ? (
            <Text style={styles.barLabelText}>Congelado</Text>
          ) : null}
          <Text style={styles.barLabelText}>Máx {fmt(opMax as number)}</Text>
        </View>
      )}
    </View>
  );
}

/** Memo con comparación POR VALOR — ver `memo-compare.ts`. */
export const FlowMeterCard = memo(FlowMeterCardBase, sameSignalCard);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 5,
    padding: 16,
    backgroundColor: B.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1B3044',
    overflow: 'hidden',
  },
  cardAnomaly: { borderColor: Colors.danger, borderWidth: 1.5 },
  cardFrozen: { borderStyle: 'dashed' },
  flash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(36,145,204,0.2)',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, color: B.textSecondary },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dirText: { fontFamily: Fonts.medium, fontSize: 12 },
  value: {
    fontFamily: Fonts.semibold,
    fontSize: 30,
    lineHeight: 38,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontFamily: Fonts.regular, fontSize: 14, color: B.textSecondary },
  barOuter: {
    height: 6,
    borderRadius: 3,
    backgroundColor: B.divider,
    overflow: 'hidden',
    marginTop: 12,
  },
  barFill: { height: '100%', borderRadius: 3 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 6 },
  barLabelText: { fontFamily: Fonts.regular, fontSize: 12, color: B.textSecondary },
});
