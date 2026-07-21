import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTanques } from '../../hooks/useTanques';
import { usePlant } from '../../context/PlantContext';
import { TankCard } from '../../components/TankCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import Colors from '../../constants/colors';
import type { TankView } from '../../services/tanks';

/** Agrupa los tanques en filas de 2 (la planta puede tener 1..N tanques mapeados). */
function chunkPairs(tanks: TankView[]): TankView[][] {
  const rows: TankView[][] = [];
  for (let i = 0; i < tanks.length; i += 2) rows.push(tanks.slice(i, i + 2));
  return rows;
}

export default function TanquesScreen() {
  const { tanks, isLoading, isError, data, refetch, isRefetching, livenessState } = useTanques();
  const { selectedPlant } = usePlant();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />
      <ConnectionBanner apiReachable={!isError} bridgeStatus={data?.bridgeStatus} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.plantName}>{selectedPlant.name}</Text>
          <Text style={styles.sectionSubtitle}>Niveles de tanques</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Cargando tanques…</Text>
          </View>
        ) : tanks.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="file-tray-outline" size={36} color={Colors.textSecondary} />
            <Text style={styles.emptyTitle}>Sin señales de tanque</Text>
            <Text style={styles.emptyText}>
              Esta planta aún no tiene tanques mapeados en el PLC. Aparecerán aquí
              cuando sus señales entren al mapping.
            </Text>
          </View>
        ) : (
          chunkPairs(tanks).map((row) => (
            <View key={row[0].id} style={styles.row}>
              {row.map((t) => <TankCard key={t.id} tank={t} stale={livenessState === 'frozen'} />)}
              {row.length === 1 && <View style={styles.cellFiller} />}
            </View>
          ))
        )}
      </ScrollView>

      <LiveBadge state={livenessState} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 12 },
  sectionHeader: {
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row' },
  cellFiller: { flex: 1, margin: 5 },
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyWrap: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
});
