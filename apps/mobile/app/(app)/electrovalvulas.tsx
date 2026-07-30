import { useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, Platform, Alert, TouchableOpacity } from 'react-native';
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
import { useValveSupervisor, type SupervisedValve } from '../../hooks/useValveSupervisor';
import Colors from '../../constants/colors';

/**
 * Plantas donde el mando remoto está AUTORIZADO. Solo La Sirena por ahora: es la única cuyo canal se
 * verificó en campo de punta a punta (docs/PRUEBA_VALVULA_SIRENA.md — pulso capturado por testigo
 * independiente, MSG al PLC sin errores) y donde la planta autorizó operar. En el resto se ve el
 * estado REAL pero el botón avisa que está deshabilitado, en vez de fingir que funciona.
 */
const PLANTAS_CON_MANDO = new Set(['sirena']);

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
  const rawValves = useMemo(() => valvesFromSnapshot(snapshot), [snapshot]);
  const { valves, events, send, busy, dismiss } = useValveSupervisor(selectedPlant.id, rawValves);
  const livenessState = snapshot?.liveness.state ?? 'frozen';
  const frozen = livenessState === 'frozen';
  const apiReachable = !isError || (!!snapshot && !snapshot.pending);
  const mandoHabilitado = PLANTAS_CON_MANDO.has(selectedPlant.id);

  const openCount = valves.filter((v) => v.effectiveState === 'open').length;
  const closedCount = valves.filter((v) => v.effectiveState === 'closed').length;

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

  async function onToggle(valve: SupervisedValve) {
    if (!mandoHabilitado) {
      aviso(
        'Mando deshabilitado en esta planta',
        `El envío de órdenes a ${valve.name} está bloqueado temporalmente.\n\n` +
          'El canal de comando YA está funcionando y verificado contra el PLC (pulso por el canal 0, ' +
          'con confirmación y auditoría). Hoy solo La Sirena está autorizada para operar en remoto.\n\n' +
          'Mientras tanto, la válvula se opera desde el HMI de la planta.',
      );
      return;
    }
    // Si el estado es desconocido no se adivina: se ofrece explícitamente qué mandar.
    const verb: 'open' | 'close' = valve.effectiveState === 'open' ? 'close' : 'open';
    const verdict = await send(valve, verb);
    aviso(verdict.title, verdict.message);
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

        {/* Estado del mando: honesto y explícito, distinto según la planta. */}
        <View style={[styles.notice, mandoHabilitado && styles.noticeOk]}>
          <Ionicons
            name={mandoHabilitado ? 'checkmark-circle-outline' : 'information-circle-outline'}
            size={18}
            color={mandoHabilitado ? Colors.success : Colors.primary}
          />
          <Text style={styles.noticeText}>
            {mandoHabilitado ? (
              <>
                <Text style={{ fontWeight: '700' }}>Mando remoto ACTIVO en esta planta.</Text> Cada orden va por
                el canal oficial (pulso por el canal 0, con confirmación y auditoría). El estado que ves es el
                real, leído del equipo y corroborado con los caudales.
              </>
            ) : (
              <>
                <Text style={{ fontWeight: '700' }}>Mando remoto deshabilitado en esta planta.</Text> El canal
                está probado y listo; hoy solo La Sirena está autorizada. Lo que ves abajo es el estado REAL
                leído del equipo.
              </>
            )}
          </Text>
        </View>

        {/* Avisos: operación manual detectada y resultados de órdenes. */}
        {events.map((e) => (
          <TouchableOpacity
            key={e.id}
            style={[styles.event, e.kind === 'manual' ? styles.eventManual : styles.eventCmd]}
            onPress={() => dismiss(e.id)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={e.kind === 'manual' ? 'hand-left-outline' : 'send-outline'}
              size={16}
              color={e.kind === 'manual' ? Colors.warning : Colors.primary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTitle}>{e.title}</Text>
              <Text style={styles.eventMsg}>{e.message}</Text>
            </View>
            <Ionicons name="close" size={14} color={Colors.textSecondary} />
          </TouchableOpacity>
        ))}

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
              disabled={!mandoHabilitado}
              busy={busy === valve.id}
              onToggle={canControl ? () => void onToggle(valve) : undefined}
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
  noticeOk: { backgroundColor: Colors.success + '10', borderLeftColor: Colors.success },
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
  note: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },
});
