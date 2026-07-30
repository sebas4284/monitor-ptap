import { useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSnapshot } from '../../hooks/useSnapshot';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { ValveItem } from '../../components/ValveItem';
import { PlantSelector } from '../../components/PlantSelector';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { LiveBadge } from '../../components/LiveBadge';
import { valvesFromSnapshot } from '../../services/valves';
import Colors from '../../constants/colors';

/**
 * El mando de válvulas está CABLEADO de punta a punta (canal oficial de comandos verificado en campo
 * el 2026-07-30: pulso de 4096 por el canal 0, con read-back y auditoría), pero permanece BLOQUEADO
 * en la app hasta que la planta autorice la operación remota. Se muestra el estado REAL y, si alguien
 * pulsa, se explica por qué no se envía — nunca un botón que parezca funcionar y no haga nada.
 */
const MANDO_HABILITADO = false;

function aviso(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function ElectrovalvulasScreen() {
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canView = hasPermission('view_dashboard'); // el Civil no ve electroválvulas
  const canControl = hasPermission('control_valves');

  const { data: snapshot, isLoading, isError, refetch, isRefetching } = useSnapshot(selectedPlant.id, canView);
  const valves = useMemo(() => valvesFromSnapshot(snapshot), [snapshot]);
  const livenessState = snapshot?.liveness.state ?? 'frozen';
  const frozen = livenessState === 'frozen';
  const apiReachable = !isError || (!!snapshot && !snapshot.pending);

  const openCount = valves.filter((v) => v.state === 'open').length;
  const closedCount = valves.filter((v) => v.state === 'closed').length;

  // Guard de rol de pantalla (coherente con tablero/reportes). Va tras TODOS los hooks.
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

  function onToggle(valveName: string) {
    if (!MANDO_HABILITADO) {
      aviso(
        'Mando deshabilitado por ahora',
        `El envío de órdenes a ${valveName} está bloqueado temporalmente.\n\n` +
          'El canal de comando YA está funcionando y verificado contra el PLC (pulso por el canal 0, ' +
          'con confirmación y auditoría). Queda bloqueado en la aplicación hasta que la planta autorice ' +
          'la operación remota.\n\nMientras tanto, la válvula se opera desde el HMI de la planta.',
      );
      return;
    }
    // Cuando se habilite: POST /api/plants/:plantId/commands { command:'open', target: valve.id }
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
            <Text style={styles.plantName}>{snapshot?.displayName ?? selectedPlant.name}</Text>
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

        {/* Estado del mando: honesto y explícito. */}
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.noticeText}>
            <Text style={{ fontWeight: '700' }}>Mando remoto deshabilitado por ahora.</Text> El canal está
            probado contra el PLC y listo; se habilitará cuando la planta lo autorice. Lo que ves abajo es el
            estado REAL leído del equipo.
          </Text>
        </View>

        {isLoading && !snapshot ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Cargando electroválvulas…</Text>
          </View>
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
          valves.map((valve) => (
            <ValveItem
              key={valve.id}
              valve={valve}
              frozen={frozen}
              disabled={!MANDO_HABILITADO}
              onToggle={canControl ? () => onToggle(valve.name) : undefined}
            />
          ))
        )}

        {valves.length > 0 && !canControl && (
          <Text style={styles.note}>Tu rol puede ver el estado, pero no operar válvulas.</Text>
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
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  loadingWrap: { paddingVertical: 44, alignItems: 'center', gap: 8 },
  loadingText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  loadingSub: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', paddingHorizontal: 20 },
  note: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },
});
