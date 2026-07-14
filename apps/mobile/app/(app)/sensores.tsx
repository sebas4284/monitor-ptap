import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSnapshot } from '../../hooks/useSnapshot';
import { useTime } from '../../hooks/useTime';
import { usePlant } from '../../context/PlantContext';
import { SignalCard } from '../../components/SignalCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import Colors from '../../constants/colors';
import type { SignalDto } from '../../services/api';

/** Icono por domainKey conocido (cosmético). */
const ICONS: Record<string, string> = {
  inletFlow1: 'water-outline',
  inletFlow2: 'water-outline',
  outletFlow1: 'water-outline',
  outletFlow2: 'water-outline',
  outletPressure1: 'speedometer-outline',
};

export default function SensoresScreen() {
  const { selectedPlant } = usePlant();
  const { data: snapshot, isLoading, refetch, isRefetching } = useSnapshot(selectedPlant.id);
  const time = useTime();

  const timeStr = time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const signals: Array<[string, SignalDto]> = snapshot ? Object.entries(snapshot.signals) : [];
  const livenessState = snapshot?.liveness.state ?? 'unknown';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[Colors.primary]} tintColor={Colors.primary} />
        }
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.plantName}>{snapshot?.displayName ?? selectedPlant.name}</Text>
            <Text style={styles.sectionSubtitle}>Señales de proceso en tiempo real</Text>
          </View>
          <Text style={styles.clock}>{timeStr}</Text>
        </View>

        {isLoading ? (
          <View style={styles.info}>
            <Text style={styles.infoText}>Cargando señales…</Text>
          </View>
        ) : signals.length === 0 ? (
          <View style={styles.info}>
            <Text style={styles.infoText}>Esta planta no tiene señales mapeadas todavía.</Text>
            <Text style={styles.infoSub}>Sin export L5X, solo Montebello expone caudal (inferido).</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {signals.map(([domainKey, signal]) => (
              <View key={domainKey} style={styles.cell}>
                <SignalCard signal={signal} name={domainKey} icon={ICONS[domainKey] ?? 'analytics-outline'} />
              </View>
            ))}
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  clock: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%' },
  info: { paddingVertical: 48, alignItems: 'center' },
  infoText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  infoSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center' },
});
