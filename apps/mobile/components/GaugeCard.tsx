import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto, UnusableReason } from '../services/api';
import { directionFor } from '../services/signal-kind';
import { sameSignalCard } from './memo-compare';
import { BotonSilencio } from './BotonSilencio';

const REASON_TEXT: Record<UnusableReason, string> = {
  BAD_QUALITY: 'calidad OPC no buena',
  INVALID_NUMBER: 'valor inválido',
  BRIDGE_STALE: 'sin datos frescos',
};

/** Formato numérico es-CO (coma decimal + separador de miles), coherente con el reloj del tablero. */
const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Tarjeta simple de una señal de dominio (presión, pH, turbidez, temperatura, oxígeno,
 * conductividad, cloro, o una digital on/off). Política de datos (usuario, 2026-07-15): si hay
 * valor SE MUESTRA tal cual; "sin dato" solo cuando value es null (no fabricar números). Marca
 * `frozen` (planta sin conexión) y `outOfRange` (lectura fuera de límites) para no aparentar
 * frescura ni normalidad cuando no las hay.
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
  const outOfRange = Boolean(signal.outOfRange);
  const direction = directionFor(name);
  const accent =
    direction === 'inlet' ? Colors.accentInlet : direction === 'outlet' ? Colors.accentOutlet : Colors.textPrimary;

  return (
    <View style={[styles.card, frozen && styles.cardFrozen]}>
      <View style={styles.cabecera}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon as never} size={20} color={Colors.primary} />
        </View>
        {plantId ? <BotonSilencio plantId={plantId} subject={name} etiqueta={signal.label ?? name} /> : null}
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {signal.label ?? name}
      </Text>

      {(frozen || outOfRange) && (
        <View style={styles.tagsRow}>
          {frozen && (
            <View style={styles.frozenTag}>
              <Text style={styles.frozenTagText}>congelado</Text>
            </View>
          )}
          {outOfRange && (
            <View style={styles.rangeTag}>
              <Text style={styles.rangeTagText}>fuera de rango</Text>
            </View>
          )}
        </View>
      )}

      {numeric ? (
        <Text style={[styles.value, { color: outOfRange ? Colors.danger : accent }]} numberOfLines={1} adjustsFontSizeToFit>
          {fmt(signal.value as number)}
          <Text style={styles.unit}> {signal.unit ?? ''}</Text>
        </Text>
      ) : isBool ? (
        <Text style={[styles.value, { color: (signal.value as boolean) ? Colors.success : Colors.textSecondary }]}>
          {(signal.value as boolean) ? 'Encendido' : 'Apagado'}
        </Text>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataValue}>sin dato</Text>
          {signal.reason && <Text style={styles.noDataReason}>{REASON_TEXT[signal.reason] ?? 'sin dato utilizable'}</Text>}
        </View>
      )}

      {!compact && (hasMin || hasMax) && (
        <Text style={styles.rangeText}>
          {hasMin ? `Mín: ${fmt(signal.opMin as number)}` : ''}
          {hasMin && hasMax ? '   ' : ''}
          {hasMax ? `Máx: ${fmt(signal.opMax as number)}` : ''}
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
  card: {
    flex: 1,
    margin: 5,
    padding: 14,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
  },
  cardFrozen: { opacity: 0.55 },
  // La cabecera empuja la campana a la derecha sin mover el icono de su sitio.
  cabecera: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', alignSelf: 'stretch' },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  name: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textAlign: 'center' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 8 },
  rangeTag: {
    backgroundColor: Colors.danger + '22',
    borderColor: Colors.danger,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rangeTagText: { fontSize: 11, fontWeight: '700', color: Colors.danger, letterSpacing: 0.5 },
  frozenTag: {
    backgroundColor: Colors.textSecondary + '22',
    borderColor: Colors.textSecondary,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  frozenTagText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  value: { fontSize: 28, fontWeight: '800', marginBottom: 6, textAlign: 'center', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  rangeText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  noData: { marginBottom: 6, alignItems: 'center' },
  noDataValue: { fontSize: 20, fontWeight: '700', color: Colors.neutral },
  noDataReason: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
});
