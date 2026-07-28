import { useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSnapshot } from '../../hooks/useSnapshot';
import { useTime } from '../../hooks/useTime';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { GaugeCard } from '../../components/GaugeCard';
import { FlowMeterCard } from '../../components/FlowMeterCard';
import { TankGaugeCard } from '../../components/TankGaugeCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import Colors from '../../constants/colors';
import type { SignalDto } from '../../services/api';
import { isTankSignal, tanksFromSnapshot } from '../../services/tanks';
import { cardKindFor } from '../../services/signal-kind';

/** Icono por domainKey conocido (cosmético). */
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

export default function TableroScreen() {
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canView = hasPermission('view_dashboard');
  // Una SOLA suscripción por pantalla (antes tablero + useTanques abrían dos), y con `enabled`
  // atado al permiso: el Civil que llegue por deep-link no dispara el fetch (403) ni el socket.
  const { data: snapshot, isLoading, isError, refetch, isRefetching } = useSnapshot(selectedPlant.id, canView);
  const tanks = useMemo(() => tanksFromSnapshot(snapshot), [snapshot]);

  const signals: [string, SignalDto][] = snapshot
    ? Object.entries(snapshot.signals).filter(([domainKey]) => !isTankSignal(domainKey))
    : [];
  const livenessState = snapshot?.liveness.state ?? 'frozen';
  const frozen = livenessState === 'frozen';
  const hasContent = tanks.length > 0 || signals.length > 0;
  // El servidor se considera alcanzable si NO hubo error REST, o si aún así el socket ya nos
  // entregó datos (en React Query v5 `setQueryData` no limpia el estado 'error'): así el banner
  // rojo no contradice a las tarjetas que ya muestran datos en vivo.
  const apiReachable = !isError || (!!snapshot && !snapshot.pending);

  // Guard de rol: el tablero detallado es para operador/jefe/admin. El Civil (solo estado
  // básico) no entra aquí ni siquiera por navegación directa. El backend igual responde 403.
  if (!hasPermission('view_dashboard')) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.plantName}>Acceso restringido</Text>
          <Text style={styles.sectionSubtitle}>El tablero detallado no está disponible para tu rol.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />
      <ConnectionBanner apiReachable={apiReachable} bridgeStatus={snapshot?.bridgeStatus} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[Colors.primary]} tintColor={Colors.primary} />
        }
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.plantName}>{snapshot?.displayName ?? selectedPlant.name}</Text>
            <Text style={styles.sectionSubtitle}>Tablero en tiempo real</Text>
          </View>
          <Clock />
        </View>

        {isLoading ? (
          <View style={styles.info}>
            <Text style={styles.infoText}>Cargando tablero…</Text>
          </View>
        ) : !hasContent ? (
          // Dos vacíos DISTINTOS: sin conexión y sin respaldo local aún (pending), o una planta
          // que de verdad no tiene señales en el mapping. Antes ambos decían "no mapeada" y
          // durante un corte eso desinformaba.
          <View style={styles.info}>
            {snapshot?.pending ? (
              <>
                <Text style={styles.infoText}>Sin datos del PLC por ahora (sin conexión con la planta).</Text>
                <Text style={styles.infoSub}>Cuando lleguen lecturas, este dispositivo recordará las últimas y las mostrará aunque la conexión vuelva a caerse.</Text>
              </>
            ) : (
              <>
                <Text style={styles.infoText}>Esta planta no tiene señales mapeadas todavía.</Text>
                <Text style={styles.infoSub}>Sin export L5X, solo Montebello expone caudal.</Text>
              </>
            )}
          </View>
        ) : (
          <>
            {tanks.length > 0 && (
              <View style={styles.grid}>
                {tanks.map((tank) => (
                  <View key={tank.id} style={styles.cell}>
                    <TankGaugeCard tank={tank} frozen={frozen} />
                  </View>
                ))}
              </View>
            )}

            {signals.length > 0 && (
              <View style={styles.grid}>
                {signals.map(([domainKey, signal]) => {
                  const icon = ICONS[domainKey] ?? 'analytics-outline';
                  return (
                    <View key={domainKey} style={styles.cell}>
                      {cardKindFor(domainKey) === 'flow' ? (
                        <FlowMeterCard signal={signal} name={domainKey} icon={icon} frozen={frozen} />
                      ) : (
                        <GaugeCard signal={signal} name={domainKey} icon={icon} frozen={frozen} />
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <LiveBadge state={livenessState} loading={isLoading && !snapshot} />
    </SafeAreaView>
  );
}

/** Reloj aislado: el tick de 1 s re-renderiza SOLO este texto, no todo el tablero (antes
 *  `useTime()` en la pantalla recomputaba señales/tanques cada segundo). */
function Clock() {
  const time = useTime();
  return (
    <Text style={styles.clock}>
      {time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </Text>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  cell: { width: '50%' },
  info: { paddingVertical: 48, alignItems: 'center' },
  infoText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  infoSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center' },
});
