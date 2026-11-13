import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../constants/colors';

export interface DataPoint {
  value: number;
  label?: string;
}

interface Props {
  data: number[] | DataPoint[];
  title?: string;
  unit?: string;
  /** Umbral normativo de alerta (ej. 2.0 NTU de turbiedad máxima según Resolución 2115). */
  threshold?: number;
  thresholdLabel?: string;
  accentColor?: string;
  height?: number;
}

/** Formateo numérico es-CO */
const fmt = (n: number, d = 2): string =>
  n.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Componente de Gráficos y Tendencias Industriales In-House (Clean-Room / REA).
 *
 * Características empresariales:
 * 1. CERO dependencias externas complejas (no requiere motores pesados C++ ni SVG wrappers).
 * 2. 100% código propio en TypeScript con geometría matemática y layouts flexbox nativos.
 * 3. Cálculo automático de tendencias (ascendente, descendente o estable), mín, máx y promedio.
 * 4. Línea de umbral normativo sanitario integrada.
 */
export function PtapTrendChart({
  data,
  title,
  unit = '',
  threshold,
  thresholdLabel,
  accentColor = Colors.primary,
  height = 90,
}: Props) {
  const points: number[] = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d) => (typeof d === 'number' ? d : d.value)).filter((v) => typeof v === 'number' && !isNaN(v));
  }, [data]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const sum = points.reduce((acc, v) => acc + v, 0);
    const avg = sum / points.length;

    // Tendencia: comparativa de la primera mitad contra la segunda
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (points.length >= 2) {
      const first = points[0];
      const last = points[points.length - 1];
      const diff = last - first;
      const span = max - min || 1;
      if (Math.abs(diff) / span > 0.08) {
        trend = diff > 0 ? 'up' : 'down';
      }
    }

    return { min, max, avg, trend };
  }, [points]);

  if (!stats || points.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={styles.emptyText}>Sin datos históricos suficientes</Text>
      </View>
    );
  }

  const { min, max, avg, trend } = stats;
  const span = max - min > 0 ? max - min : 1;

  // Umbral normalizado en escala 0-100% de altura
  const thresholdPct =
    threshold !== undefined && threshold >= min && threshold <= max
      ? Math.round(((threshold - min) / span) * 100)
      : null;

  return (
    <View style={styles.card}>
      {title ? (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.trendWrap}>
            <Text
              style={[
                styles.trendBadge,
                trend === 'up'
                  ? styles.trendUp
                  : trend === 'down'
                    ? styles.trendDown
                    : styles.trendStable,
              ]}
            >
              {trend === 'up' ? '↗ Subiendo' : trend === 'down' ? '↘ Bajando' : '→ Estable'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Área del gráfico de barras/segmentos normalizados */}
      <View style={[styles.chartArea, { height }]}>
        {/* Línea de umbral si aplica */}
        {thresholdPct !== null ? (
          <View style={[styles.thresholdLine, { bottom: `${thresholdPct}%` }]}>
            <Text style={styles.thresholdText}>
              {thresholdLabel ? `${thresholdLabel} (${threshold} ${unit})` : `Límite: ${threshold} ${unit}`}
            </Text>
          </View>
        ) : null}

        {/* Columnas normalizadas con interpolación */}
        <View style={styles.barsContainer}>
          {points.map((val, idx) => {
            const hPct = Math.max(8, Math.min(100, Math.round(((val - min) / span) * 100)));
            const isLatest = idx === points.length - 1;
            const exceedsThreshold = threshold !== undefined && val > threshold;

            return (
              <View key={idx} style={styles.barColumn}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: `${hPct}%`,
                      backgroundColor: exceedsThreshold
                        ? Colors.danger
                        : isLatest
                          ? accentColor
                          : accentColor + '70',
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      {/* Resumen estadístico inferior */}
      <View style={styles.footer}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>MÍN</Text>
          <Text style={styles.statValue}>
            {fmt(min)} {unit}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>PROM</Text>
          <Text style={styles.statValue}>
            {fmt(avg)} {unit}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>MÁX</Text>
          <Text style={styles.statValue}>
            {fmt(max)} {unit}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.divider,
    marginVertical: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  trendWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendBadge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  trendUp: {
    backgroundColor: Colors.warning + '1A',
    color: Colors.warning,
  },
  trendDown: {
    backgroundColor: Colors.primary + '1A',
    color: Colors.primary,
  },
  trendStable: {
    backgroundColor: Colors.divider,
    color: Colors.textSecondary,
  },
  chartArea: {
    width: '100%',
    position: 'relative',
    justifyContent: 'flex-end',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 4,
    overflow: 'hidden',
  },
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 8,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  thresholdLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.danger,
    borderStyle: 'dashed',
    zIndex: 10,
    paddingLeft: 4,
  },
  thresholdText: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.danger,
    marginTop: -12,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: '100%',
    width: '100%',
    gap: 3,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: '100%',
    minWidth: 4,
    borderRadius: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  statValue: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});
