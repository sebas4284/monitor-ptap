import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSensores } from '../../hooks/useSensores';
import { useTime } from '../../hooks/useTime';
import { usePlant } from '../../context/PlantContext';
import { SensorCard } from '../../components/SensorCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import Colors from '../../constants/colors';

export default function SensoresScreen() {
  const { data: sensors, isLoading, refetch, isRefetching } = useSensores();
  const { selectedPlant } = usePlant();
  const time = useTime();

  const timeStr = time.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

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
        {/* Section header */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.plantName}>{selectedPlant}</Text>
            <Text style={styles.sectionSubtitle}>Sensores en tiempo real</Text>
          </View>
          <Text style={styles.clock}>{timeStr}</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Cargando sensores…</Text>
          </View>
        ) : (
          <>
            <View style={styles.row}>
              {sensors?.slice(0, 2).map(s => <SensorCard key={s.id} sensor={s} />)}
            </View>
            <View style={styles.row}>
              {sensors?.slice(2, 4).map(s => <SensorCard key={s.id} sensor={s} />)}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  plantName: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  clock: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
});
