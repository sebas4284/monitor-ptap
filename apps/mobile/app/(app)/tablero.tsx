import { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '../../components/AppIcon';
import { useSnapshot } from '../../hooks/useSnapshot';
import { useTime } from '../../hooks/useTime';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { GaugeCard } from '../../components/GaugeCard';
import { FlowMeterCard } from '../../components/FlowMeterCard';
import { TankGaugeCard } from '../../components/TankGaugeCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PICKER_PANEL_MIN_WIDTH, PlantPickerPanel } from '../../components/PlantPicker';
import { TableroHeader, type HeaderKpi } from '../../components/TableroHeader';
import { hasRangeAnomaly } from '@ptap/shared';
import { plantStatus, EN_INTEGRACION } from '../../services/plant-status';
import { anomalyBanner } from '../../services/card-look';
import { AnomalyBanner } from '../../components/AnomalyBanner';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { AppUpdateBanner } from '../../components/AppUpdateBanner';
import { DashboardWorkspace, DashboardActions } from '../../components/DashboardWorkspace';
import { DashboardSummary } from '../../components/DashboardSummary';
import { GroupHeader } from '../../components/GroupHeader';
import { DashboardSkeleton } from '../../components/Skeleton';
import { OfflineNotice } from '../../components/OfflineNotice';
import Colors from '../../constants/colors';
import { Fonts } from '../../constants/fonts';
import { groupTanks, tanksFromSnapshot } from '../../services/tanks';
import { cardKindFor } from '../../services/signal-kind';
import {
  dashboardSignals,
  groupSignals,
  summarize,
  type GroupId,
} from '../../services/signal-groups';
import { setCompact, toggleGroup, useDashboardPrefs } from '../../services/dashboard-prefs';

/** Formato numérico es-CO, igual que las tarjetas. */
const fmt = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format;

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
  const { hasPermission, user } = useAuth();
  const canView = hasPermission('view_dashboard');
  // Una SOLA suscripción por planta (compartida vía `plant-stream.ts`, aunque la cáscara de
  // pestañas también pida la misma), y con `enabled` atado al permiso: el Civil que llegue por
  // deep-link no dispara el fetch (403) ni el socket.
  const {
    data: snapshot,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useSnapshot(selectedPlant.id, canView);

  // Preferencias de presentación (densidad y grupos plegados), persistidas en el dispositivo.
  const prefs = useDashboardPrefs();

  // En móvil, detalle legible a una columna; el modo compacto conserva dos.
  const { width } = useWindowDimensions();
  const tanqueAnchoCompleto = width < 600;
  const singleColumn = width < 600 && !prefs.compact;

  const tanks = useMemo(() => tanksFromSnapshot(snapshot), [snapshot]);
  const tankGroups = useMemo(() => groupTanks(tanks), [tanks]);

  // Memoizado: antes se recalculaba en CADA render (dos predicados por clave), pese a que `tanks`
  // justo encima sí estaba memoizado.
  const signals = useMemo(() => dashboardSignals(snapshot?.signals), [snapshot]);

  const livenessState = snapshot?.liveness.state ?? 'frozen';
  const frozen = livenessState === 'frozen';
  // Aún no conectada al PLC maestro: su `frozen` no es una caída (ver services/plant-status.ts).
  const integrationPending = snapshot?.integrationPending === true;
  const groups = useMemo(() => groupSignals(signals, frozen), [signals, frozen]);
  // Derivado de los grupos, que ya contaron: recorrer otra vez las señales daría los mismos
  // números con el riesgo de que las dos cuentas se contradigan.
  const summary = useMemo(() => summarize(groups), [groups]);
  const hasContent = tanks.length > 0 || signals.length > 0;

  // El servidor se considera alcanzable si NO hubo error REST, o si aún así el socket ya nos
  // entregó datos (en React Query v5 `setQueryData` no limpia el estado 'error'): así el banner
  // rojo no contradice a las tarjetas que ya muestran datos en vivo.
  const apiReachable = !isError || (!!snapshot && !snapshot.pending);
  // Error DE VERDAD: falló la carga y no hay ni respaldo local que enseñar. Si hay respaldo, manda
  // el diseño de siempre (banner + datos congelados), que informa mejor que una pantalla de error.
  const showError = isError && !snapshot;

  const onToggleGroup = useCallback((id: GroupId) => toggleGroup(id), []);

  // Estado de la planta para el encabezado. Sin snapshot no se afirma nada.
  const status = useMemo(
    () => (snapshot ? plantStatus(snapshot.liveness, snapshot.bridgeStatus) : null),
    [snapshot],
  );

  // Franja roja: primera señal fuera de rango, con el mismo criterio que el resumen y la campana.
  const banner = useMemo(() => anomalyBanner(signals), [signals]);

  // Cifras clave del encabezado: SOLO las que existen en el snapshot (nunca un valor de ejemplo).
  const kpis = useMemo(() => {
    const out: HeaderKpi[] = [];
    const add = (key: string, label: string, color: string) => {
      const sig = snapshot?.signals[key];
      if (!sig || typeof sig.value !== 'number') return;
      out.push({
        key,
        label,
        value: fmt(sig.value),
        unit: sig.unit ?? undefined,
        color,
        alert: hasRangeAnomaly(sig),
      });
    };
    add('inletFlow1', 'Caudal de entrada', Colors.brand.inflow);
    add('outletFlow1', 'Caudal de salida', Colors.brand.outflow);
    if (signals.length > 0) {
      out.push({
        key: 'anomalies',
        label: 'Fuera de rango',
        value: String(summary.anomalies),
        color: Colors.brand.text,
        alert: summary.anomalies > 0,
      });
    }
    return out;
  }, [snapshot, signals.length, summary.anomalies]);

  // Guard de rol: el tablero detallado es para operador/jefe/admin. El Civil (solo estado
  // básico) no entra aquí ni siquiera por navegación directa. El backend igual responde 403.
  if (!canView) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.plantName}>Acceso restringido</Text>
          <Text style={styles.sectionSubtitle}>
            El tablero detallado no está disponible para tu rol.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const screen = (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ConnectionBanner
        apiReachable={apiReachable}
        bridgeStatus={snapshot?.bridgeStatus}
        integrationPending={integrationPending}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
            }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.scrollHeader}>
          {/* Encabezado de operación: nombre (abre "Elegir planta" si es Admin), estado y cifras clave. */}
          <TableroHeader
            plantName={snapshot?.displayName ?? selectedPlant.name}
            status={status}
            lastChangeAt={snapshot?.liveness.lastChangeAt ?? null}
            kpis={kpis}
            right={
              <>
                {hasContent && (
                  <TouchableOpacity
                    style={styles.densityBtn}
                    onPress={() => setCompact(!prefs.compact)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: prefs.compact }}
                    accessibilityLabel={
                      prefs.compact
                        ? 'Mostrar el detalle de cada tarjeta'
                        : 'Ver el tablero en modo compacto'
                    }
                  >
                    <Ionicons
                      name={prefs.compact ? 'list-outline' : 'grid-outline'}
                      size={18}
                      color={Colors.brand.textSecondary}
                    />
                  </TouchableOpacity>
                )}
                <Clock />
              </>
            }
          />
        </View>
        {/*
          El aviso de versión nueva vive AQUÍ además de en login y Ajustes.
          Antes solo estaba en esas dos, así que quien ya tenía la sesión abierta y no entraba a
          Ajustes no se enteraba nunca: dependía de que le caducara la sesión (8 h) para volver a
          ver el login. El tablero es la pantalla que todo el mundo abre.
          Va DENTRO del ScrollView a propósito, para que scrollee con el contenido en vez de
          comerse altura fija; y se auto-oculta en cuanto el versionCode instalado coincide con el
          publicado, así que no puede molestar a quien ya actualizó.
        */}
        <AppUpdateBanner modo="actualizacion" />

        <DashboardActions />

        {isLoading && !snapshot ? (
          <DashboardSkeleton />
        ) : showError ? (
          <OfflineNotice
            title="No se pudo cargar el tablero."
            detail="No hay conexión con el servidor y este dispositivo aún no tiene ninguna lectura guardada de esta planta."
            onRetry={() => void refetch()}
            retryLabel="Reintentar la carga del tablero"
          />
        ) : !hasContent ? (
          // Tres vacíos DISTINTOS: una planta en integración (aún no conectada al PLC maestro), sin
          // conexión y sin respaldo local aún (pending), o una planta que de verdad no tiene señales
          // en el mapping. Antes los dos últimos decían "no mapeada" y durante un corte eso
          // desinformaba. La integración va primero: su respuesta de espera también es `pending`, y
          // ahí «sin conexión con la planta» se leería como una caída.
          <View style={styles.info}>
            {integrationPending ? (
              <>
                <Text style={styles.infoText}>{EN_INTEGRACION.titulo}</Text>
                <Text style={styles.infoSub}>{EN_INTEGRACION.lecturas}</Text>
              </>
            ) : snapshot?.pending ? (
              <>
                <Text style={styles.infoText}>
                  Sin datos del PLC por ahora (sin conexión con la planta).
                </Text>
                <Text style={styles.infoSub}>
                  Cuando lleguen lecturas, este dispositivo recordará las últimas y las mostrará
                  aunque la conexión vuelva a caerse.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.infoText}>Esta planta no tiene señales mapeadas todavía.</Text>
                <Text style={styles.infoSub}>
                  Sus lecturas aparecerán aquí cuando sus señales estén conectadas al PLC maestro.
                </Text>
              </>
            )}
          </View>
        ) : (
          <>
            {/* Solo si alguna señal está fuera de rango (hasRangeAnomaly): cuál, valor y límite. */}
            {banner && <AnomalyBanner text={banner.text} more={banner.more} />}
            {signals.length > 0 && (
              <DashboardSummary
                total={summary.total}
                anomalies={summary.anomalies}
                noData={summary.noData}
                compact={prefs.compact}
              />
            )}

            {/* Los tanques propios no se mezclan con lecturas externas retransmitidas. */}
            {tanks.length > 0 && (
              <View>
                <Text accessibilityRole="header" style={styles.tankSectionTitle}>
                  Tanques propios de {selectedPlant.name} ({tankGroups.own.length})
                </Text>
                {tankGroups.own.length === 0 && <Text style={styles.tankSectionNote}>
                  No hay lecturas de tanques propios mapeadas para esta planta.
                </Text>}
                <View style={styles.grid}>
                  {tankGroups.own.map((tank) => (
                    <View key={tank.id} style={tanqueAnchoCompleto ? styles.cellFull : styles.cell}>
                      <TankGaugeCard tank={tank} frozen={frozen} still={!status?.online} plantId={selectedPlant.id} />
                    </View>
                  ))}
                </View>
                {tankGroups.external.length > 0 && (
                  <View style={styles.externalTankSection}>
                    <Text accessibilityRole="header" style={styles.tankSectionTitle}>
                      Lecturas de tanques externos ({tankGroups.external.length})
                    </Text>
                    <Text style={styles.tankSectionNote}>
                      Recibidas a través de {selectedPlant.name}. No se contabilizan como tanques propios de esta planta. Su asociación está pendiente de confirmar.
                    </Text>
                    <View style={styles.grid}>
                      {tankGroups.external.map((tank) => (
                        <View key={tank.id} style={tanqueAnchoCompleto ? styles.cellFull : styles.cell}>
                          <Text style={styles.externalTankLabel}>Lectura externa · vía {selectedPlant.name}</Text>
                          <TankGaugeCard tank={tank} frozen={frozen} still={!status?.online} plantId={selectedPlant.id} />
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}

            <DashboardWorkspace
              key={`${user?.id}:${selectedPlant.id}`}
              entries={signals}
              frozen={frozen}
              plantId={selectedPlant.id}
            />

            {groups.map((group) => {
              // `lockedOpen` gana siempre sobre la preferencia del usuario: un grupo con una señal
              // fuera de rango, sin dato, o con la planta congelada, se muestra sí o sí.
              const collapsed = !group.lockedOpen && prefs.collapsed.includes(group.id);
              return (
                <View key={group.id}>
                  <GroupHeader
                    id={group.id}
                    title={group.title}
                    count={group.entries.length}
                    anomalyCount={group.anomalyCount}
                    noDataCount={group.noDataCount}
                    lockedOpen={group.lockedOpen}
                    collapsed={collapsed}
                    onToggle={onToggleGroup}
                  />
                  {!collapsed && (
                    <View style={styles.grid}>
                      {group.entries.map(([domainKey, signal]) => {
                        const icon = ICONS[domainKey] ?? 'analytics-outline';
                        const Card = cardKindFor(domainKey) === 'flow' ? FlowMeterCard : GaugeCard;
                        return (
                          <View
                            key={domainKey}
                            style={singleColumn ? styles.cellFull : styles.cell}
                          >
                            <Card
                              signal={signal}
                              name={domainKey}
                              icon={icon}
                              frozen={frozen}
                              compact={prefs.compact}
                              plantId={selectedPlant.id}
                            />
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <LiveBadge
        state={livenessState}
        loading={isLoading && !snapshot}
        integrationPending={integrationPending}
      />
    </SafeAreaView>
  );

  // Escritorio: panel lateral fijo con las 12 plantas (solo Admin; para los demás no se pinta).
  return (
    <View style={styles.row}>
      {width >= PICKER_PANEL_MIN_WIDTH && <PlantPickerPanel />}
      {screen}
    </View>
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
  safe: { flex: 1, backgroundColor: Colors.brand.page },
  row: { flex: 1, flexDirection: 'row', backgroundColor: Colors.brand.page },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  content: { padding: 16, paddingBottom: 28 },
  scrollHeader: { marginHorizontal: -16, marginTop: -16, marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  densityBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.brand.cardBorder,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clock: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.brand.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  tankSectionTitle: { fontFamily: Fonts.semibold, fontSize: 16, lineHeight: 24, color: Colors.brand.text, marginHorizontal: 8, marginBottom: 8 },
  tankSectionNote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 20, color: Colors.brand.textSecondary, marginHorizontal: 8, marginBottom: 12 },
  externalTankSection: { borderTopWidth: 1, borderTopColor: Colors.brand.divider, paddingTop: 16, marginTop: 8 },
  externalTankLabel: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 18, color: Colors.brand.textSecondary, marginHorizontal: 8, marginBottom: 4 },
  cell: { width: '50%' },
  /** Fila entera: para los tanques en pantallas estrechas, donde el texto largo no cabe a la mitad. */
  cellFull: { width: '100%' },
  info: { paddingVertical: 48, alignItems: 'center', gap: 6 },
  infoText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  infoSub: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
