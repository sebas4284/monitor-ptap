import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from './AppIcon';
import Colors from '../constants/colors';
import { Fonts } from '../constants/fonts';
import type { PlantStatus } from '../services/plant-status';
import { formatSince } from '../services/plant-status';
import { PlantPickerTrigger } from './PlantPicker';

const B = Colors.brand;
/** Controles en fila para escritorio y apilados en pantallas estrechas. */
const KPI_MIN_WIDTH = 768;

export interface HeaderKpi {
  key: string;
  label: string;
  /** Ya formateado. Solo se pasa si el dato existe en el snapshot: nunca un valor de ejemplo. */
  value: string;
  unit?: string;
  color: string;
  alert: boolean;
}

/** Estado y cifras principales sin animación decorativa durante la operación. */
export function TableroHeader({
  plantName,
  status,
  lastChangeAt,
  kpis,
  right,
}: {
  plantName: string;
  /** null = aún sin snapshot: no se afirma ningún estado. */
  status: PlantStatus | null;
  lastChangeAt: string | null;
  kpis: HeaderKpi[];
  /** Controles a la derecha de la fila superior (reloj, densidad). */
  right?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= KPI_MIN_WIDTH;
  const tone = status ? (status.tone === 'ok' ? B.green : B.gray) : B.gray;
  const toneText = status?.tone === 'ok' ? B.green : B.textSecondary;
  // "Sin datos desde…" ya lleva su hora; a "En vivo"/"Estable" se le añade la del último cambio.
  const since =
    status?.online && lastChangeAt ? ` · último cambio ${formatSince(lastChangeAt)}` : '';

  return (
    <View style={[styles.header, wide ? styles.headerWide : styles.headerNarrow]}>
      <View style={[styles.content, wide && styles.contentWide]}>
        <View style={styles.identity}>
          <View style={styles.brandBar} accessible={false}>
            <View style={[styles.brandSeg, { flex: 55, backgroundColor: B.blue }]} />
            <View style={[styles.brandSeg, { flex: 30, backgroundColor: B.green }]} />
            <View style={[styles.brandSeg, { flex: 15, backgroundColor: B.yellow }]} />
          </View>
          <PlantPickerTrigger
            name={plantName}
            textStyle={wide ? styles.nameWide : styles.nameNarrow}
          />
          <View
            style={styles.statusRow}
            accessible
            accessibilityLabel={
              status ? `Estado: ${status.label}${since}` : 'Consultando el estado'
            }
            accessibilityLiveRegion="polite"
          >
            <Ionicons
              name={(status?.icon ?? 'help-circle-outline') as never}
              size={14}
              color={tone}
            />
            <Text style={styles.statusText}>
              <Text style={[styles.statusLabel, { color: toneText }]}>
                {status?.label ?? 'Consultando…'}
              </Text>
              {since}
            </Text>
          </View>
        </View>

        <View style={wide ? styles.controls : styles.controlsNarrow}>{right}</View>

        {kpis.length > 0 && (
          <View style={styles.kpis}>
            {kpis.map((k) => (
              <View
                key={k.key}
                style={[styles.kpi, wide && styles.kpiWide, k.alert && styles.kpiAlert]}
                accessible
                accessibilityLabel={`${k.label}: ${k.value}${k.unit ? ` ${k.unit}` : ''}${k.alert ? ', fuera de rango' : ''}`}
              >
                <Text style={styles.kpiLabel}>{k.label}</Text>
                <Text
                  style={[
                    styles.kpiValue,
                    !wide && styles.kpiValueNarrow,
                    { color: k.alert ? B.dangerText : k.color },
                  ]}
                >
                  {k.value}
                  {k.unit ? <Text style={styles.kpiUnit}> {k.unit}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: B.panel,
    borderBottomWidth: 1,
    borderBottomColor: B.divider,
    overflow: 'hidden',
  },
  headerWide: { paddingHorizontal: 32, paddingTop: 20, paddingBottom: 24 },
  headerNarrow: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 20 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlsNarrow: { alignItems: 'flex-end', gap: 6 },
  content: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  contentWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  identity: { gap: 6, flex: 1, minWidth: 160 },
  brandBar: { flexDirection: 'row', width: 64, height: 4, borderRadius: 2, overflow: 'hidden' },
  brandSeg: { height: '100%' },
  nameWide: { fontSize: 28, lineHeight: 38 },
  nameNarrow: { fontSize: 22, lineHeight: 30 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: Fonts.regular, fontSize: 14, color: B.textSecondary, flexShrink: 1 },
  statusLabel: { fontFamily: Fonts.medium },
  kpis: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: {
    minWidth: 88,
    flexGrow: 1,
    flexBasis: 88,
    backgroundColor: B.page,
    borderWidth: 1,
    borderColor: '#1E3A52',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  kpiWide: { paddingHorizontal: 16 },
  kpiValueNarrow: { fontSize: 18, lineHeight: 26 },
  kpiAlert: { borderColor: Colors.danger },
  kpiLabel: { fontFamily: Fonts.regular, fontSize: 12, color: B.textSecondary },
  kpiValue: {
    fontFamily: Fonts.semibold,
    fontSize: 24,
    lineHeight: 32,
    fontVariant: ['tabular-nums'],
  },
  kpiUnit: { fontFamily: Fonts.regular, fontSize: 13, color: B.textSecondary },
});
