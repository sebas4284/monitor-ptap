import { memo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Ionicons from './AppIcon';
import Colors from '../constants/colors';
import { Fonts } from '../constants/fonts';
import type { SignalDto, UnusableReason } from '../services/api';
import { directionLook, isAnomalous, signalState } from '../services/card-look';
import { useStateFlash } from '../hooks/useStateFlash';
import { sameSignalCard } from './memo-compare';
import { BotonSilencio } from './BotonSilencio';

const B = Colors.brand;

const REASON_TEXT: Record<UnusableReason, string> = {
  BAD_QUALITY: 'calidad OPC no buena',
  INVALID_NUMBER: 'valor inválido',
  BRIDGE_STALE: 'sin datos frescos',
};

/** Formato numérico es-CO (coma decimal + separador de miles), coherente con el reloj del tablero. */
const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Tarjeta simple de una señal de dominio (caudal, presión, pH, turbidez, temperatura, oxígeno,
 * conductividad, cloro, o una digital on/off). Política de datos (usuario, 2026-07-15): si hay
 * valor SE MUESTRA tal cual; "sin dato" solo cuando value es null (no fabricar números).
 *
 * - Fuera de rango (físico u OPERATIVO, `hasRangeAnomaly`) → borde y valor en rojo. Es el único rojo.
 * - Entrada/salida → icono + etiqueta + su azul. Sin dirección → texto normal.
 * - Congelada → atenuada y con etiqueta. El número nunca se anima: al cambiar, la tarjeta destella.
 */
function GaugeCardBase({
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
  /** Tablero en modo compacto: oculta la fila Mín/Máx, que es la que más ruido aporta por tarjeta. */
  compact?: boolean;
}) {
  const numeric = typeof signal.value === 'number';
  const isBool = typeof signal.value === 'boolean';
  const hasMin = typeof signal.opMin === 'number';
  const hasMax = typeof signal.opMax === 'number';
  const anomaly = isAnomalous(signal);
  const dir = directionLook(name);
  const accent = dir?.color ?? B.text;
  const flash = useStateFlash(signalState(signal), frozen);
  const label = signal.label ?? name;

  return (
    <View style={[styles.card, anomaly && styles.cardAnomaly, frozen && styles.cardFrozen]}>
      <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
      <View style={styles.top}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon as never} size={18} color={accent} />
        </View>
        <View style={styles.flex} />
        {plantId ? <BotonSilencio plantId={plantId} subject={name} etiqueta={label} /> : null}
      </View>

      <Text style={styles.name} numberOfLines={2}>
        {label}
      </Text>
      {dir && (
        <View style={styles.dirRow}>
          <Ionicons name={dir.icon} size={12} color={dir.color} />
          <Text style={[styles.dirText, { color: dir.color }]}>{dir.label}</Text>
        </View>
      )}

      {numeric ? (
        <Text
          style={[styles.value, { color: anomaly ? B.dangerText : accent }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {fmt(signal.value as number)}
          <Text style={styles.unit}> {signal.unit ?? ''}</Text>
        </Text>
      ) : isBool ? (
        <Text
          style={[styles.value, { color: (signal.value as boolean) ? B.green : B.textSecondary }]}
        >
          {(signal.value as boolean) ? 'Encendido' : 'Apagado'}
        </Text>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataValue}>sin dato</Text>
          {signal.reason && (
            <Text style={styles.noDataReason}>
              {REASON_TEXT[signal.reason] ?? 'sin dato utilizable'}
            </Text>
          )}
        </View>
      )}

      {(frozen || anomaly) && (
        <View style={styles.tagsRow}>
          {anomaly && (
            <View style={styles.tag}>
              <Ionicons name="alert-circle" size={13} color={Colors.danger} />
              <Text style={[styles.tagText, { color: B.dangerText }]}>Fuera de rango</Text>
            </View>
          )}
          {frozen && (
            <View style={styles.tag}>
              <Ionicons name="time-outline" size={13} color={B.gray} />
              <Text style={styles.tagText}>Congelado</Text>
            </View>
          )}
        </View>
      )}

      {!compact && (hasMin || hasMax) && (
        <Text style={[styles.rangeText, anomaly && { color: B.dangerText }]}>
          {hasMin ? `Mín ${fmt(signal.opMin as number)}` : ''}
          {hasMin && hasMax ? '  ·  ' : ''}
          {hasMax ? `Máx ${fmt(signal.opMax as number)}` : ''}
        </Text>
      )}
    </View>
  );
}

/**
 * Memo con comparación POR VALOR: el snapshot se reconstruye entero cada ~2 s, así que la
 * comparación por referencia de `memo` no ahorraría ni un render. Ver `memo-compare.ts`.
 */
export const GaugeCard = memo(GaugeCardBase, sameSignalCard);

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  top: { flexDirection: 'row', alignItems: 'flex-start' },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: B.panel,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  name: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: B.textSecondary },
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
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { fontFamily: Fonts.medium, fontSize: 12, color: B.textSecondary },
  rangeText: { fontFamily: Fonts.regular, fontSize: 12, color: B.textSecondary, marginTop: 6 },
  noData: { marginTop: 6 },
  noDataValue: { fontFamily: Fonts.semibold, fontSize: 20, color: B.textSecondary },
  noDataReason: { fontFamily: Fonts.regular, fontSize: 12, color: B.textSecondary, marginTop: 2 },
});
