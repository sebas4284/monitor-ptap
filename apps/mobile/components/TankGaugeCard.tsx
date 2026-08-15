import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { memo, useEffect, useRef } from 'react';
import type { TankView } from '../services/tanks';
import Colors from '../constants/colors';
import { sameTankCard } from './memo-compare';

/** Cambio de nivel por debajo del cual no vale la pena animar (en puntos porcentuales).
 *  La animación de ancho NO puede usar el driver nativo, así que cada tween corre en el hilo de
 *  JS. Con un push cada ~2 s y varios tanques por planta, animar un cambio imperceptible es puro
 *  coste: por debajo de este umbral se salta al valor final. */
const MIN_DELTA_PCT = 0.5;

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

function TankGaugeCardBase({ tank, frozen = false }: Props) {
  // percentage llega null hasta que la planta confirme la capacidad real del tanque;
  // en ese caso NO se dibuja % de llenado (sería inventado), solo nivel y volumen reales.
  //
  // Se separan dos cosas que antes eran una sola y por eso ocultaban un fallo:
  //  - `pctReal`  es lo que se ESCRIBE. Puede pasar de 100 (Carbonero midió 2.96 m contra un
  //     máximo configurado de 2.80 → 106 %). Recortarlo hacía que el tanque dijera "lleno"
  //     mientras seguía subiendo sin derramar, que es exactamente el defecto reportado.
  //  - `pctBarra` es lo que se DIBUJA, acotado a [0,100] porque la barra no tiene dónde crecer.
  const pctReal = tank.percentage;
  const pct = pctReal !== null ? Math.min(100, Math.max(0, pctReal)) : null;
  const hasLevel = tank.levelM !== null;
  // Fuera de rango: aviso del backend, o una lectura físicamente imposible (nivel negativo o
  // por encima del 100 % del tanque). Se muestra el valor crudo + etiqueta roja (política acordada).
  const outOfRange =
    tank.outOfRange ||
    (hasLevel && (tank.levelM as number) < 0) ||
    (tank.percentage !== null && (tank.percentage < 0 || tank.percentage > 100));
  const fillAnim = useRef(new Animated.Value(0)).current;
  /** Último valor al que se llevó la barra: permite saltarse los tweens imperceptibles. */
  const shownPct = useRef<number | null>(null);

  useEffect(() => {
    if (pct === null) return;
    const previous = shownPct.current;
    shownPct.current = pct;
    // Congelado: saltar al valor sin animar (el dato es viejo, no debe "moverse" en pantalla).
    // Primer render o cambio imperceptible: también se salta, para no gastar el hilo de JS en un
    // tween que nadie distingue (la barra de ancho no admite driver nativo).
    if (frozen || previous === null || Math.abs(pct - previous) < MIN_DELTA_PCT) {
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
          {/* El número es el REAL, sin recortar: si marca 106 % hay que verlo, no esconderlo. */}
          <Text style={styles.pctText}>{Math.round(pctReal as number)}%</Text>
          <View style={[styles.statusBadge, { backgroundColor: waterColor(pct) + '30', borderColor: waterColor(pct) }]}>
            <Text style={[styles.statusText, { color: waterColor(pct) }]}>{statusLabel(pct)}</Text>
          </View>
          {(pctReal as number) > 100 && (
            <Text style={styles.excedido}>
              Por encima del máximo configurado ({tank.levelOpMax?.toFixed(2) ?? '—'} m). O el tanque
              está rebosando, o ese máximo está mal.
            </Text>
          )}
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

/** Memo con comparación POR VALOR — ver `memo-compare.ts`. */
export const TankGaugeCard = memo(TankGaugeCardBase, sameTankCard);

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
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  chipLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  chipValue: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  pctText: { fontSize: 34, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  excedido: {
    fontSize: 12,
    color: Colors.danger,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 8,
  },
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
