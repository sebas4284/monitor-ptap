import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';
import type { TankView } from '../services/tanks';
import Colors from '../constants/colors';

interface Props {
  tank: TankView;
  /** La planta está congelada (sin conexión, mostrando la última lectura). Atenúa la tarjeta,
   *  la marca como congelada y NO anima la barra (los valores son viejos, no deben "moverse"). */
  frozen?: boolean;
}

function waterColor(pct: number): string {
  if (pct > 70) return Colors.success;
  if (pct >= 25) return Colors.warning;
  return Colors.danger;
}

function statusLabel(pct: number): string {
  if (pct > 70) return 'Alto';
  if (pct >= 25) return 'Medio';
  return 'Bajo';
}

export function TankGaugeCard({ tank, frozen = false }: Props) {
  // percentage llega null hasta que la planta confirme la capacidad real del tanque;
  // en ese caso NO se dibuja % de llenado (sería inventado), solo nivel y volumen reales.
  const pct = tank.percentage !== null ? Math.min(100, Math.max(0, tank.percentage)) : null;
  const hasLevel = tank.levelM !== null;
  // Fuera de rango: aviso del backend, o una lectura físicamente imposible (nivel negativo o
  // por encima del 100 % del tanque). Se muestra el valor crudo + etiqueta roja (política acordada).
  const outOfRange =
    tank.outOfRange ||
    (hasLevel && (tank.levelM as number) < 0) ||
    (tank.percentage !== null && (tank.percentage < 0 || tank.percentage > 100));
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pct === null) return;
    // Congelado: saltar al valor sin animar (el dato es viejo, no debe "moverse" en pantalla).
    if (frozen) {
      fillAnim.setValue(pct);
      return;
    }
    // Tween corto para que la barra acompañe al número sin quedar 900 ms por detrás.
    Animated.timing(fillAnim, {
      toValue: pct,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, frozen, fillAnim]);

  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.card, frozen && styles.cardFrozen]}>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{tank.name}</Text>
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

      <View style={styles.chipsRow}>
        {tank.levelOpMax !== null && (
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>MAX</Text>
            <Text style={styles.chipValue}>{tank.levelOpMax.toFixed(2)} m</Text>
          </View>
        )}
        {tank.levelOpMin !== null && (
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>MIN</Text>
            <Text style={styles.chipValue}>{tank.levelOpMin.toFixed(2)} m</Text>
          </View>
        )}
      </View>

      {pct !== null ? (
        <>
          <Text style={styles.pctText}>{Math.round(pct)}%</Text>
          <View style={[styles.statusBadge, { backgroundColor: waterColor(pct) + '30', borderColor: waterColor(pct) }]}>
            <Text style={[styles.statusText, { color: waterColor(pct) }]}>{statusLabel(pct)}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.pctTextUnknown}>{hasLevel ? `${tank.levelM!.toFixed(2)} m` : '—'}</Text>
      )}

      <View style={styles.barOuter}>
        {pct !== null && (
          <Animated.View style={[styles.barFill, { width: fillWidth, backgroundColor: waterColor(pct) }]} />
        )}
      </View>

      <View style={styles.info}>
        <InfoRow label="Nivel" value={tank.levelM !== null ? `${tank.levelM.toFixed(2)} m` : 'Sin dato'} />
        <InfoRow label="Volumen" value={tank.volumeM3 !== null ? `${tank.volumeM3.toFixed(1)} m³` : 'Sin dato'} />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
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
  cardFrozen: { opacity: 0.55 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  name: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  rangeTag: {
    backgroundColor: Colors.danger + '22',
    borderColor: Colors.danger,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rangeTagText: { fontSize: 9, fontWeight: '700', color: Colors.danger, letterSpacing: 0.5 },
  frozenTag: {
    backgroundColor: Colors.textSecondary + '22',
    borderColor: Colors.textSecondary,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  frozenTagText: { fontSize: 9, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  chipLabel: { fontSize: 9, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  chipValue: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  pctText: { fontSize: 34, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', fontVariant: ['tabular-nums'] },
  pctTextUnknown: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginVertical: 8,
  },
  statusBadge: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginTop: 4,
    marginBottom: 10,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  barOuter: {
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    marginBottom: 12,
  },
  barFill: { height: '100%', borderRadius: 5 },
  info: { gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 11, color: Colors.textSecondary },
  infoValue: { fontSize: 11, fontWeight: '600', color: Colors.textPrimary },
});
