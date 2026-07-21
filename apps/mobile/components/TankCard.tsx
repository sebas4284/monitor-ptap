import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import type { TankView } from '../services/tanks';
import Colors from '../constants/colors';

interface Props {
  tank: TankView;
  /** true = la planta está congelada (sin conexión con el PLC): el nivel mostrado es el último
   *  conocido, no en vivo — se marca con su hora en vez de aparentar frescura. */
  stale?: boolean;
}

function waterColor(pct: number): string {
  if (pct >= 70) return Colors.primaryLight;
  if (pct >= 30) return '#4FC3F7';
  return '#81D4FA';
}

function horaDe(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TankCard({ tank, stale = false }: Props) {
  // percentage llega null hasta que la planta confirme la capacidad real del tanque;
  // en ese caso NO se dibuja % de llenado (sería inventado), solo nivel y volumen reales.
  const pct = tank.percentage !== null ? Math.min(100, Math.max(0, tank.percentage)) : null;
  const hasLevel = tank.levelM !== null;
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pct === null) return;
    Animated.timing(fillAnim, {
      toValue: pct,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [pct, fillAnim]);

  const fillHeight = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.card}>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{tank.name}</Text>
        {tank.outOfRange && (
          <View style={styles.rangeTag}>
            <Text style={styles.rangeTagText}>fuera de rango</Text>
          </View>
        )}
      </View>

      <View style={styles.tankWrap}>
        <View style={styles.tankOuter}>
          {pct !== null ? (
            <Animated.View
              style={[
                styles.fill,
                { height: fillHeight, backgroundColor: waterColor(pct) },
              ]}
            >
              <View style={styles.wave} />
            </Animated.View>
          ) : hasLevel ? (
            <View style={[styles.fill, styles.fillUnknownCapacity]} />
          ) : null}
        </View>
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.pctOverlay}>
            {pct !== null ? (
              <Text style={[styles.pctText, { color: pct > 55 ? '#fff' : Colors.primary }]}>
                {Math.round(pct)}%
              </Text>
            ) : (
              <Text
                style={[
                  styles.levelText,
                  { color: !hasLevel ? Colors.textSecondary : tank.outOfRange ? Colors.warning : Colors.primary },
                ]}
              >
                {hasLevel ? `${tank.levelM!.toFixed(1)} m` : '—'}
              </Text>
            )}
          </View>
        </View>
      </View>

      <View style={styles.info}>
        <InfoRow label="Nivel"   value={tank.levelM !== null ? `${tank.levelM.toFixed(2)} m` : 'Sin dato'} />
        <InfoRow label="Volumen" value={tank.volumeM3 !== null ? `${tank.volumeM3.toFixed(1)} m³` : 'Sin dato'} />
        <InfoRow label="Llenado" value={pct !== null ? `${Math.round(pct)}%` : 'Por confirmar'} />
        {(tank.levelOpMin !== null || tank.levelOpMax !== null) && (
          <InfoRow label="Rango" value={levelRangeText(tank)} />
        )}
        {stale && hasLevel && (
          <Text style={styles.staleNote}>
            {horaDe(tank.ts) ? `última lectura ${horaDe(tank.ts)} · sin actualizar` : 'sin actualizar'}
          </Text>
        )}
      </View>
    </View>
  );
}

function levelRangeText(tank: TankView): string {
  if (tank.levelOpMin !== null && tank.levelOpMax !== null) return `${tank.levelOpMin} a ${tank.levelOpMax} m`;
  if (tank.levelOpMax !== null) return `≤ ${tank.levelOpMax} m`;
  return `≥ ${tank.levelOpMin} m`;
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
    padding: 12,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  name: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  rangeTag: {
    backgroundColor: '#FFF7ED',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rangeTagText: { fontSize: 9, fontWeight: '700', color: Colors.warning, letterSpacing: 0.5 },
  tankWrap: {
    width: 64,
    height: 88,
    marginBottom: 12,
  },
  tankOuter: {
    width: 64,
    height: 88,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.primary + '40',
    backgroundColor: '#EEF2FF',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: {
    width: '100%',
    borderRadius: 8,
  },
  fillUnknownCapacity: {
    height: '100%',
    backgroundColor: 'rgba(79, 195, 247, 0.22)',
  },
  wave: {
    position: 'absolute',
    top: 3,
    left: 4,
    right: 4,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 3,
  },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  pctOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctText: {
    fontSize: 16,
    fontWeight: '800',
  },
  levelText: {
    fontSize: 14,
    fontWeight: '800',
  },
  info: {
    width: '100%',
    gap: 3,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  infoValue: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  staleNote: { fontSize: 10, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
});
