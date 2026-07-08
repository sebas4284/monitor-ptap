import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTanques } from '../../hooks/useTanques';
import { usePlant } from '../../context/PlantContext';
import { TankCard } from '../../components/TankCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import Colors from '../../constants/colors';

export default function TanquesScreen() {
  const { data: tanks, isLoading, refetch, isRefetching } = useTanques();
  const { selectedPlant } = usePlant();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />

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
          <Text style={styles.plantName}>{selectedPlant}</Text>
          <Text style={styles.sectionSubtitle}>Niveles de tanques</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Cargando tanques…</Text>
          </View>
        ) : (
          <>
            <View style={styles.row}>
              {tanks?.slice(0, 2).map(t => <TankCard key={t.id} tank={t} />)}
            </View>
            <View style={styles.row}>
              {tanks?.slice(2, 4).map(t => <TankCard key={t.id} tank={t} />)}
            </View>
          </>
        )}
      </ScrollView>

      <LiveBadge />
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
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
});
