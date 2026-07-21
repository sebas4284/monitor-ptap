import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSnapshot } from '../../hooks/useSnapshot';
import { useTime } from '../../hooks/useTime';
import { usePlant } from '../../context/PlantContext';
import { SignalCard } from '../../components/SignalCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import Colors from '../../constants/colors';
import type { SignalDto } from '../../services/api';
import { isTankSignal } from '../../services/tanks';

/** Icono por domainKey conocido (cosmético). Los tanques no van aquí: viven en Tanques. */
const ICONS: Record<string, string> = {
  inletFlow1: 'water-outline',
  inletFlow2: 'water-outline',
  outletFlow1: 'water-outline',
  outletFlow2: 'water-outline',
  inletPressure1: 'speedometer-outline',
  inletPressure2: 'speedometer-outline',
  outletPressure1: 'speedometer-outline',
  outletPressure2: 'speedometer-outline',
  inletTurbidity: 'color-filter-outline',
  outletTurbidity: 'color-filter-outline',
  inletOxygen: 'leaf-outline',
  conductivity: 'flash-outline',
  inletPh: 'flask-outline',
  outletPh: 'flask-outline',
  inletTemperature: 'thermometer-outline',
  outletTemperature: 'thermometer-outline',
  outletChlorine: 'eyedrop-outline',
};

export default function SensoresScreen() {
  const { selectedPlant } = usePlant();
  const { data: snapshot, isLoading, isError, refetch, isRefetching } = useSnapshot(selectedPlant.id);
  const time = useTime();

  const timeStr = time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // Los tanques (propios y externos) se muestran SOLO en la pantalla Tanques.
  const signals: [string, SignalDto][] = snapshot
    ? Object.entries(snapshot.signals).filter(([domainKey]) => !isTankSignal(domainKey))
    : [];
  const livenessState = snapshot?.liveness.state ?? 'frozen';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />
      <ConnectionBanner apiReachable={!isError} bridgeStatus={snapshot?.bridgeStatus} />

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
            <Text style={styles.infoSub}>San Antonio y El Quijote son sitios mínimos: sus tanques llegan retransmitidos en el buffer de Soledad.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {signals.map(([domainKey, signal]) => (
              <View key={domainKey} style={styles.cell}>
                <SignalCard
                  signal={signal}
                  name={domainKey}
                  icon={ICONS[domainKey] ?? 'analytics-outline'}
                  stale={livenessState === 'frozen'}
                />
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
