import { memo, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  Platform,
} from 'react-native';
import Ionicons from './AppIcon';
import { router } from 'expo-router';
import Colors from '../constants/colors';
import { SignalDistributionBar } from './SignalDistributionBar';
import { Fonts } from '../constants/fonts';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import { formatWhen } from '../services/notifications';
import {
  filterReadings,
  readingState,
  type SignalEntry,
  type SignalFilter,
} from '../services/dashboard-view';

const B = Colors.brand;
const STATES = {
  ok: { label: 'En rango', color: B.green, icon: 'checkmark-circle-outline' },
  alert: { label: 'Fuera de rango', color: B.dangerText, icon: 'alert-circle-outline' },
  missing: { label: 'Sin dato', color: B.textSecondary, icon: 'help-circle-outline' },
} as const;
const FILTERS: { value: SignalFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'ok', label: 'En rango' },
  { value: 'alert', label: 'Fuera de rango' },
  { value: 'missing', label: 'Sin dato' },
];
const PAGE_SIZE = 10;

export function DashboardActions() {
  const { hasPermission } = useAuth();
  return (
    <View style={styles.actions}>
      <Text style={styles.description}>
        Supervisa las lecturas y el estado de la planta seleccionada.
      </Text>
      <View style={styles.toolbar}>
        <Pressable
          style={styles.action}
          accessibilityRole="button"
          onPress={() => router.push('/(app)/alertas')}
        >
          <Ionicons name="notifications-outline" color={B.link} size={18} />
          <Text style={styles.actionText}>Alertas</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          accessibilityRole="button"
          onPress={() => router.push('/(app)/electrovalvulas')}
        >
          <Ionicons name="options-outline" color={B.link} size={18} />
          <Text style={styles.actionText}>Válvulas</Text>
        </Pressable>
        {hasPermission('export_data') && (
          <Pressable
            style={styles.action}
            accessibilityRole="button"
            onPress={() => router.push('/(app)/reportes')}
          >
            <Ionicons name="document-text-outline" color={B.link} size={18} />
            <Text style={styles.actionText}>Informes</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export const DashboardWorkspace = memo(function DashboardWorkspace({
  entries,
  frozen,
  plantId,
}: {
  entries: SignalEntry[];
  frozen: boolean;
  plantId: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SignalFilter>('all');
  const [page, setPage] = useState(0);
  const width = useWindowDimensions().width;
  const wide = width >= 1100;
  const rows = useMemo(() => filterReadings(entries, query, filter), [entries, query, filter]);
  const counts = useMemo(
    () =>
      entries.reduce(
        (all, [, signal]) => {
          all[readingState(signal)]++;
          return all;
        },
        { ok: 0, alert: 0, missing: 0 },
      ),
    [entries],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);

  return (
    <View style={styles.workspace}>
      <View style={[styles.analysis, wide && styles.analysisWide]}>
        <View style={styles.panel}>
          <Text style={styles.title} accessibilityRole="header">
            Estado de las señales
          </Text>
          <Text style={styles.description}>
            {frozen
              ? 'Últimas lecturas recibidas · datos congelados'
              : 'Distribución de las lecturas actuales'}
          </Text>
          {entries.length === 0 ? (
            <Text style={styles.empty}>Aún no hay señales disponibles para esta planta.</Text>
          ) : (
            <View style={styles.distribution}>
              {(Object.keys(STATES) as (keyof typeof STATES)[]).map((key) => (
                <View key={key} style={styles.statRow}>
                  <View style={styles.labelRow}>
                    <Ionicons name={STATES[key].icon} color={STATES[key].color} size={18} />
                    <Text style={styles.text}>{STATES[key].label}</Text>
                    <Text style={styles.count}>{counts[key]}</Text>
                  </View>
                  <SignalDistributionBar
                    fraction={counts[key] / entries.length}
                    color={STATES[key].color}
                    label={`${STATES[key].label}: ${counts[key]} de ${entries.length} señales`}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
        <RecentActivity plantId={plantId} />
      </View>

      <View style={styles.tablePanel}>
        <View style={styles.headingRow}>
          <Text style={styles.title} accessibilityRole="header">
            Lecturas de la planta
          </Text>
          <Text style={styles.description}>
            {rows.length} de {entries.length} señales
          </Text>
        </View>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={20} color={B.textSecondary} />
          <TextInput
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setPage(0);
            }}
            placeholder="Buscar señal o unidad"
            placeholderTextColor={B.placeholder}
            accessibilityLabel="Buscar señal o unidad"
            style={styles.input}
          />
          {!!query && (
            <Pressable
              onPress={() => {
                setQuery('');
                setPage(0);
              }}
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda"
              style={styles.iconButton}
            >
              <Ionicons name="close" size={20} color={B.textSecondary} />
            </Pressable>
          )}
        </View>
        <View style={styles.toolbar}>
          {FILTERS.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => {
                setFilter(item.value);
                setPage(0);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === item.value }}
              aria-pressed={filter === item.value}
              style={[styles.filter, filter === item.value && styles.filterActive]}
            >
              <Text style={styles.text}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        {frozen && (
          <Text style={styles.description}>
            Datos congelados: los valores no representan una lectura actual.
          </Text>
        )}
        {width < 600 && rows.length > 0 && (
          <Text style={styles.small}>Desliza la tabla para ver todas las columnas.</Text>
        )}
        {rows.length === 0 ? (
          <Text style={styles.empty}>No hay lecturas que coincidan con estos filtros.</Text>
        ) : (
          <ScrollView
            horizontal
            contentContainerStyle={styles.tableScroll}
            tabIndex={Platform.OS === 'web' ? 0 : undefined}
            role={Platform.OS === 'web' ? 'region' : undefined}
            accessibilityLabel={
              Platform.OS === 'web' ? 'Desplazar columnas de lecturas' : undefined
            }
          >
            <View role="table" accessibilityLabel="Lecturas de la planta" style={styles.table}>
              <View role="row" style={[styles.tableRow, styles.tableHead]}>
                <Text role="columnheader" style={[styles.column, styles.text]}>
                  Señal
                </Text>
                <Text role="columnheader" style={[styles.valueColumn, styles.text]}>
                  Valor
                </Text>
                <Text role="columnheader" style={[styles.statusColumn, styles.text]}>
                  Estado
                </Text>
              </View>
              {rows
                .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                .map(([key, signal]) => {
                  const state = STATES[readingState(signal)];
                  const value =
                    typeof signal.value === 'boolean'
                      ? signal.value
                        ? 'Activo'
                        : 'Inactivo'
                      : typeof signal.value === 'number' && Number.isFinite(signal.value)
                        ? signal.value.toLocaleString('es-CO', { maximumFractionDigits: 2 })
                        : '—';
                  return (
                    <View role="row" key={key} style={styles.tableRow}>
                      <Text role="cell" style={[styles.column, styles.text]}>
                        {signal.label ?? key}
                      </Text>
                      <Text role="cell" style={[styles.valueColumn, styles.text]}>
                        {value}
                        {signal.value !== null && signal.unit ? ` ${signal.unit}` : ''}
                      </Text>
                      <View role="cell" style={[styles.statusColumn, styles.labelRow]}>
                        <Ionicons name={state.icon} color={state.color} size={16} />
                        <Text style={[styles.small, { color: state.color }]}>{state.label}</Text>
                      </View>
                    </View>
                  );
                })}
            </View>
          </ScrollView>
        )}
        <View style={styles.pagination}>
          <Pressable
            disabled={currentPage === 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: currentPage === 0 }}
            onPress={() => setPage(currentPage - 1)}
            style={[styles.action, currentPage === 0 && styles.disabled]}
          >
            <Text style={styles.actionText}>Anterior</Text>
          </Pressable>
          <Text style={styles.small}>
            Página {currentPage + 1} de {pages}
          </Text>
          <Pressable
            disabled={currentPage + 1 >= pages}
            accessibilityRole="button"
            accessibilityState={{ disabled: currentPage + 1 >= pages }}
            onPress={() => setPage(currentPage + 1)}
            style={[styles.action, currentPage + 1 >= pages && styles.disabled]}
          >
            <Text style={styles.actionText}>Siguiente</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

function RecentActivity({ plantId }: { plantId: string }) {
  const { notifications, isLoading, isError, refetch } = useNotifications();
  const recent = useMemo(
    () =>
      notifications
        .filter((item) => item.plantId === plantId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 4),
    [notifications, plantId],
  );
  return (
    <View style={styles.panel}>
      <View style={styles.headingRow}>
        <Text style={styles.title} accessibilityRole="header">
          Actividad reciente
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(app)/alertas')}
          style={styles.action}
        >
          <Text style={styles.actionText}>Ver bandeja</Text>
        </Pressable>
      </View>
      <Text style={styles.description}>Avisos registrados de esta planta</Text>
      {isLoading ? (
        <ActivityIndicator color={B.blue} accessibilityLabel="Cargando actividad" />
      ) : isError ? (
        <Pressable accessibilityRole="button" onPress={refetch} style={styles.action}>
          <Text style={styles.actionText}>No se pudo cargar. Reintentar</Text>
        </Pressable>
      ) : recent.length === 0 ? (
        <Text style={styles.empty}>No hay avisos recientes para esta planta.</Text>
      ) : (
        recent.map((item) => (
          <View key={item.id} style={styles.activity}>
            <Text style={styles.text}>{item.title}</Text>
            <Text style={styles.small}>
              {formatWhen(item.createdAt)} · {item.seen ? 'Visto' : 'Sin leer'}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { gap: 20, marginVertical: 20 },
  actions: { gap: 12, paddingVertical: 12, paddingHorizontal: 5 },
  description: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 20, color: B.textSecondary },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  actionText: { fontFamily: Fonts.medium, fontSize: 13, color: B.link },
  analysis: { gap: 16 },
  analysisWide: { flexDirection: 'row' },
  panel: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: B.cardBorder,
    borderRadius: 16,
    backgroundColor: B.card,
    padding: 20,
    gap: 8,
  },
  title: { fontFamily: Fonts.semibold, fontSize: 18, color: B.text },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  distribution: { gap: 16, marginTop: 16 },
  statRow: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { fontFamily: Fonts.regular, fontSize: 14, color: B.text },
  count: {
    marginLeft: 'auto',
    fontFamily: Fonts.semibold,
    color: B.text,
    fontVariant: ['tabular-nums'],
  },
  track: { height: 8, backgroundColor: B.divider, borderRadius: 4, overflow: 'hidden' },
  empty: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: B.textSecondary,
    paddingVertical: 20,
  },
  tablePanel: {
    borderWidth: 1,
    borderColor: B.cardBorder,
    borderRadius: 16,
    padding: 16,
    backgroundColor: B.card,
    gap: 12,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: B.searchBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    outlineColor: B.blue,
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: B.text,
  },
  iconButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  filter: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: B.cardBorder,
  },
  filterActive: { backgroundColor: B.selected, borderColor: B.blue },
  tableScroll: { flexGrow: 1 },
  table: { flex: 1, minWidth: 480 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: B.divider,
  },
  tableHead: { backgroundColor: B.panel },
  column: { flex: 1, paddingLeft: 8 },
  valueColumn: { width: 120, fontVariant: ['tabular-nums'] },
  statusColumn: { width: 150 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  small: { fontFamily: Fonts.regular, fontSize: 12, color: B.textSecondary },
  disabled: { opacity: 0.4 },
  activity: { gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: B.divider },
});
