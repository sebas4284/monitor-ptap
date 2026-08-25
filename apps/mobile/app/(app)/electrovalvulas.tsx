import { useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSnapshot } from '../../hooks/useSnapshot';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { ValveItem } from '../../components/ValveItem';
import { PlantSelector } from '../../components/PlantSelector';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { LiveBadge } from '../../components/LiveBadge';
import { ListSkeleton } from '../../components/Skeleton';
import { OfflineNotice } from '../../components/OfflineNotice';
import { valvesFromSnapshot } from '../../services/valves';
import { useValveSupervisor } from '../../hooks/useValveSupervisor';
import { useDashboardPrefs } from '../../services/dashboard-prefs';
import Colors from '../../constants/colors';

export default function ElectrovalvulasScreen() {
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canView = hasPermission('view_dashboard'); // el Civil no ve electroválvulas

  const { data: snapshot, isLoading, isError, refetch, isRefetching } = useSnapshot(selectedPlant.id, canView);
  const rawValves = useMemo(() => valvesFromSnapshot(snapshot), [snapshot]);
  const { valves } = useValveSupervisor(selectedPlant.id, rawValves);
  const livenessState = snapshot?.liveness.state ?? 'frozen';
  const frozen = livenessState === 'frozen';
  const apiReachable = !isError || (!!snapshot && !snapshot.pending);
  const showError = isError && !snapshot;
  const plantName = snapshot?.displayName ?? selectedPlant.name;

  // El hook hidrata además del almacenamiento: antes solo el tablero lo hacía, así que entrar
  // directo a esta pantalla (recarga web en /electrovalvulas) ignoraba la preferencia guardada.
  useDashboardPrefs();

  // Memoizado: eran dos recorridos completos del array en CADA render.
  const { openCount, closedCount } = useMemo(
    () => ({
      openCount: valves.filter((v) => v.effectiveState === 'open').length,
      closedCount: valves.filter((v) => v.effectiveState === 'closed').length,
    }),
    [valves],
  );

  // Guard de rol de pantalla (coherente con tablero/reportes). Va tras TODOS los hooks: si a
  // alguien le retiran el permiso con la pantalla abierta, el número de hooks no puede cambiar.
  if (!canView) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.plantName}>Acceso restringido</Text>
          <Text style={styles.sectionSubtitle}>Las electroválvulas no están disponibles para tu rol.</Text>
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
          <View style={{ flex: 1 }}>
            <Text style={styles.plantName}>{plantName}</Text>
            <Text style={styles.sectionSubtitle}>Electroválvulas</Text>
          </View>
          {valves.length > 0 && (
            <View style={styles.summary}>
              <Text style={[styles.summaryCount, { color: Colors.success }]}>{openCount} abiertas</Text>
              <Text style={styles.summaryDot}> · </Text>
              <Text style={[styles.summaryCount, { color: Colors.danger }]}>{closedCount} cerradas</Text>
            </View>
          )}
        </View>

        {isLoading && !snapshot ? (
          <ListSkeleton rows={3} label="Cargando las electroválvulas" />
        ) : showError ? (
          <OfflineNotice
            title="No se pudieron cargar las electroválvulas."
            detail="No hay conexión con el servidor y este dispositivo no tiene ninguna lectura guardada de esta planta. Sin estado real no se debe operar una válvula."
            onRetry={() => void refetch()}
            retryLabel="Reintentar la carga de las electroválvulas"
          />
        ) : valves.length === 0 ? (
          <View style={styles.loadingWrap}>
            <Ionicons name="git-branch-outline" size={34} color={Colors.textSecondary} />
            <Text style={styles.loadingText}>Esta planta no tiene electroválvulas mapeadas.</Text>
            <Text style={styles.loadingSub}>
              Solo los sitios con buffers de comando (INT_OUT/INT_IN) exponen válvulas. Los tanques
              retransmitidos por otra planta no tienen canal propio.
            </Text>
          </View>
        ) : (
          valves.map((valve) => <ValveItem key={valve.id} valve={valve} frozen={frozen} />)
        )}
      </ScrollView>

      <LiveBadge state={livenessState} loading={isLoading && !snapshot} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  content: { padding: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  summaryCount: { fontSize: 12, fontWeight: '700' },
  summaryDot: { color: Colors.textSecondary, fontSize: 12 },
  notice: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.primary + '10',
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  noticeOk: { backgroundColor: Colors.success + '10', borderLeftColor: Colors.success },
  noticeWarn: { backgroundColor: Colors.warning + '12', borderLeftColor: Colors.warning },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  event: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderRadius: 8,
    borderLeftWidth: 3,
    padding: 10,
    marginBottom: 8,
  },
  eventManual: { backgroundColor: Colors.warning + '12', borderLeftColor: Colors.warning },
  eventCmd: { backgroundColor: Colors.primary + '10', borderLeftColor: Colors.primary },
  eventTitle: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  eventMsg: { fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary, marginTop: 2 },
  loadingWrap: { paddingVertical: 44, alignItems: 'center', gap: 8 },
  loadingText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  loadingSub: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', paddingHorizontal: 20 },
});
