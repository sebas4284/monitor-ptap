import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import type { Tank } from '../services/api';
import Colors from '../constants/colors';

interface Props {
  tank: Tank;
}

function waterColor(pct: number): string {
  if (pct >= 70) return Colors.primaryLight;
  if (pct >= 30) return '#4FC3F7';
  return '#81D4FA';
}

export function TankCard({ tank }: Props) {
  const pct = Math.min(100, Math.max(0, tank.percentage));
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: pct,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const fillHeight = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{tank.name}</Text>

      <View style={styles.tankWrap}>
        <View style={styles.tankOuter}>
          <Animated.View
            style={[
              styles.fill,
              { height: fillHeight, backgroundColor: waterColor(pct) },
            ]}
          >
            <View style={styles.wave} />
          </Animated.View>
        </View>
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.pctOverlay}>
            <Text style={[styles.pctText, { color: pct > 55 ? '#fff' : Colors.primary }]}>
              {Math.round(pct)}%
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.info}>
        <InfoRow label="Nivel"   value={`${tank.levelM.toFixed(1)} m`} />
        <InfoRow label="Rango"   value={`0–${tank.maxLevelM} m`} />
        <InfoRow label="Volumen" value={`${tank.volumeM3} m³`} />
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
  name: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
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
});
