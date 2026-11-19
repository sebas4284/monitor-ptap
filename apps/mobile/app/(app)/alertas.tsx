import { memo, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '../../components/AppIcon';
import { router } from 'expo-router';
import { useNotifications } from '../../hooks/useNotifications';
import { useNovedades } from '../../hooks/useNovedades';
import { usePlant, PLANTS } from '../../context/PlantContext';
import {
  FAMILIAS,
  familiaDe,
  filtrarAvisos,
  formatWhen,
  type AppNotification,
  type FamiliaAviso,
} from '../../services/notifications';
import { ListSkeleton } from '../../components/Skeleton';
import { OfflineNotice } from '../../components/OfflineNotice';
import { RegistroIntegridadCard } from '../../components/RegistroIntegridadCard';
import { NovedadesLista } from '../../components/NovedadesLista';
import { versionMasReciente } from '../../services/novedades';
import Colors from '../../constants/colors';
import { Fonts } from '../../constants/fonts';

/**
 * Bandeja de notificaciones.
 *
 * Tres reglas de producto que la separan de la pantalla de alertas que había antes:
 *
 *  1. **Nada se borra.** No hay botón de descartar. El usuario solo las marca como vistas, y eso
 *     ocurre con el botón de marcar vistos. El historial es evidencia: si un sensor lleva 15 días caído,
 *     ese rastro tiene que poder enseñarse.
 *  2. **La campana se apaga al marcarlas vistas, no al resolverlas.** El aviso sigue en la lista.
 *  3. **Tocar un aviso lleva a la planta afectada**, seleccionándola primero.
 */
function severityOf(n: AppNotification): { color: string; icon: keyof typeof Ionicons.glyphMap } {
  // Una maniobra correcta NO es una alarma: pintarla de rojo con un triangulo ensenaria a leer el
  // registro de valvulas como un problema, cuando casi siempre es el registro de que alguien hizo
  // su trabajo.
  if (n.kind === 'valve_command') {
    return n.severity === 'info'
      ? { color: Colors.primary, icon: 'git-commit-outline' }
      : { color: Colors.warning, icon: 'git-commit-outline' };
  }
  if (n.kind === 'valve_manual') return { color: Colors.warning, icon: 'hand-left-outline' };
  if (n.kind === 'signature_broken') return { color: Colors.danger, icon: 'shield-outline' };
  if (n.kind === 'sensor_stale') return { color: Colors.danger, icon: 'pulse-outline' };
  if (n.severity === 'critical') return { color: Colors.danger, icon: 'alert-circle' };
  if (n.severity === 'warning') return { color: Colors.warning, icon: 'warning-outline' };
  return { color: Colors.primary, icon: 'information-circle-outline' };
}

const NotificationRow = memo(function NotificationRow({
  notification,
  onPress,
}: {
  notification: AppNotification;
  onPress: (n: AppNotification) => void;
}) {
  const { color, icon } = severityOf(notification);
  const nuevo = !notification.seen;
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: color }, nuevo && styles.cardNuevo]}
      onPress={() => onPress(notification)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${nuevo ? 'Sin ver. ' : ''}${notification.title}. ${notification.message} ${formatWhen(notification.createdAt)}. Toca para ir a la planta.`}
    >
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          {nuevo && <View style={[styles.dot, { backgroundColor: color }]} />}
          <Text style={[styles.title, nuevo && styles.titleNuevo]}>{notification.title}</Text>
        </View>
        <Text style={styles.message}>{notification.message}</Text>
        <Text style={styles.when}>{formatWhen(notification.createdAt)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
    </TouchableOpacity>
  );
});

/** Pestaña de familia. Lleva el número: un filtro que no dice cuántos hay obliga a probarlo. */
function Pestania({
  etiqueta,
  cuantos,
  activa,
  nuevo = false,
  onPress,
}: {
  etiqueta: string;
  cuantos: number;
  activa: boolean;
  /** Punto de aviso: hay algo sin ver detrás de esta pestaña. */
  nuevo?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.pestania, activa && styles.pestaniaActiva]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: activa }}
      accessibilityLabel={`${etiqueta}, ${cuantos}${nuevo ? ', sin ver' : ''}`}
    >
      {nuevo && <View style={[styles.dot, styles.pestaniaDot]} />}
      <Text style={[styles.pestaniaTexto, activa && styles.pestaniaTextoActiva]}>{etiqueta}</Text>
      <Text style={styles.pestaniaNum}>{cuantos}</Text>
    </TouchableOpacity>
  );
}

export default function AlertasScreen() {
  const { notifications, unseen, isLoading, isError, refetch, markSeen } = useNotifications();
  const novedadesQ = useNovedades();
  const { setSelectedPlant } = usePlant();
  const [familia, setFamilia] = useState<FamiliaAviso | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [soloNoVistos, setSoloNoVistos] = useState(false);
  const [antiguosPrimero, setAntiguosPrimero] = useState(false);
  /**
   * Qué se está mirando. Las novedades NO son una familia de avisos —no tienen planta, ni
   * gravedad, ni «visto» por usuario— así que no caben en `familia` sin mentir sobre lo que son.
   */
  const [vista, setVista] = useState<'avisos' | 'novedades'>('avisos');
  /** Versión que estaba sin ver al ABRIR la pestaña; fija el resalte mientras se lee. */
  const [versionNueva, setVersionNueva] = useState<string | null>(null);

  const visibles = useMemo(
    () => filtrarAvisos(notifications, familia, busqueda, soloNoVistos, antiguosPrimero),
    [notifications, familia, busqueda, soloNoVistos, antiguosPrimero],
  );

  // Cuántos hay de cada familia, para que las pestañas digan si vale la pena entrar. Un filtro que
  // lleva a una lista vacía sin avisar antes es peor que no tenerlo.
  const conteos = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of notifications) {
      const f = familiaDe(n.kind);
      if (f) c[f] = (c[f] ?? 0) + 1;
    }
    return c;
  }, [notifications]);

  function verAvisos(f: FamiliaAviso | null) {
    setVista('avisos');
    setFamilia(f);
  }

  function verNovedades() {
    // El resalte se decide UNA sola vez, al entrar. Si se derivara de la marca guardada, el
    // recuadro de «nuevo» se apagaría delante del usuario en el mismo gesto de abrirlo.
    setVersionNueva(novedadesQ.hayNueva ? versionMasReciente(novedadesQ.novedades) : null);
    setVista('novedades');
    novedadesQ.marcarVistas();
  }

  function abrir(n: AppNotification) {
    // Seleccionar la planta primero: el tablero muestra la que esté activa, así que sin esto el
    // usuario aterrizaría mirando otra planta y creería que el aviso es falso.
    const plant = PLANTS.find((p) => p.id === n.plantId);
    if (plant) setSelectedPlant(plant);
    // Una válvula se atiende en su pantalla; el resto son señales del tablero.
    const esValvula = n.subject?.startsWith('valve');
    router.push(esValvula ? '/(app)/electrovalvulas' : '/(app)/tablero');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={vista === 'novedades' ? novedadesQ.refetch : refetch}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.head}>
          <Text style={styles.heading}>Notificaciones</Text>
          <Text style={styles.sub}>
            {notifications.length === 0
              ? 'Historial de los últimos 3 días'
              : `${notifications.length} en los últimos 3 días${unseen > 0 ? ` · ${unseen} sin ver` : ''}`}
          </Text>
        </View>

        {/* El estado del libro de firmas va ARRIBA del todo: quien quiere saber si puede fiarse de
            lo que está leyendo lo quiere saber mientras lo lee. */}
        <RegistroIntegridadCard />

        {vista === 'avisos' && notifications.length > 0 && (
          <View style={styles.buscador}>
            <Ionicons name="search-outline" size={16} color={Colors.textSecondary} />
            <TextInput
              style={styles.buscadorInput}
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="Buscar por válvula, sensor o persona"
              placeholderTextColor={Colors.textSecondary}
              accessibilityLabel="Buscar dentro de las notificaciones"
              returnKeyType="search"
            />
            {busqueda.length > 0 && (
              <TouchableOpacity
                onPress={() => setBusqueda('')}
                hitSlop={10}
                accessibilityLabel="Borrar la búsqueda"
              >
                <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* La tira de pestañas aparece si hay ALGO que ofrecer: con la bandeja vacía, Novedades
            sigue teniendo contenido y esconderla la dejaría inalcanzable. */}
        {(notifications.length > 0 || novedadesQ.novedades.length > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pestanias}
          >
            <Pestania
              etiqueta="Todo"
              cuantos={notifications.length}
              activa={vista === 'avisos' && familia === null}
              onPress={() => verAvisos(null)}
            />
            {FAMILIAS.map((f) => (
              <Pestania
                key={f.id}
                etiqueta={f.etiqueta}
                cuantos={conteos[f.id] ?? 0}
                activa={vista === 'avisos' && familia === f.id}
                onPress={() => verAvisos(vista === 'avisos' && familia === f.id ? null : f.id)}
              />
            ))}
            <Pestania
              etiqueta="Novedades"
              cuantos={novedadesQ.novedades.length}
              activa={vista === 'novedades'}
              nuevo={novedadesQ.hayNueva}
              onPress={verNovedades}
            />
          </ScrollView>
        )}

        {vista === 'avisos' && notifications.length > 0 && (
          <View style={styles.filtros}>
            <TouchableOpacity style={[styles.limpiar, soloNoVistos && styles.pestaniaActiva]} onPress={() => setSoloNoVistos((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: soloNoVistos }}>
              <Text style={styles.limpiarTexto}>Solo sin ver</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.limpiar} onPress={() => setAntiguosPrimero((value) => !value)} accessibilityRole="button" accessibilityLabel={`Orden por fecha: ${antiguosPrimero ? 'más antiguos primero' : 'más recientes primero'}. Cambiar orden`}>
              <Text style={styles.limpiarTexto}>{antiguosPrimero ? 'Más antiguos primero' : 'Más recientes primero'}</Text>
            </TouchableOpacity>
            {unseen > 0 && <TouchableOpacity style={styles.limpiar} onPress={markSeen} accessibilityRole="button">
              <Text style={styles.limpiarTexto}>Marcar todos como vistos</Text>
            </TouchableOpacity>}
          </View>
        )}

        {vista === 'novedades' ? (
          <NovedadesLista
            novedades={novedadesQ.novedades}
            versionNueva={versionNueva}
            isLoading={novedadesQ.isLoading}
            isError={novedadesQ.isError}
            onRetry={novedadesQ.refetch}
          />
        ) : isLoading ? (
          <ListSkeleton rows={3} label="Cargando las notificaciones" />
        ) : isError ? (
          <OfflineNotice
            title="No se pudieron cargar las notificaciones."
            detail="No hay conexión con el servidor. El historial vive en el servidor, así que no hay copia local que mostrar."
            onRetry={refetch}
            retryLabel="Reintentar la carga de notificaciones"
          />
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={44} color={Colors.success} />
            <Text style={styles.emptyTitle}>Sin avisos</Text>
            <Text style={styles.emptyText}>
              No se ha registrado ningún aviso en los últimos 3 días. Aquí aparecerán las maniobras
              de válvula, las señales fuera de rango y los sensores que dejen de refrescarse.
            </Text>
          </View>
        ) : visibles.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={40} color={Colors.textSecondary} />
            <Text style={styles.emptyTitle}>Nada con ese filtro</Text>
            <Text style={styles.emptyText}>
              Hay {notifications.length} avisos en los últimos 3 días, pero ninguno coincide con lo
              que estás buscando.
            </Text>
            <TouchableOpacity
              style={styles.limpiar}
              onPress={() => {
                setFamilia(null);
                setBusqueda('');
                setSoloNoVistos(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Quitar el filtro y ver todos los avisos"
            >
              <Text style={styles.limpiarTexto}>Quitar el filtro</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {visibles.map((n) => (
              <NotificationRow key={n.id} notification={n} onPress={abrir} />
            ))}
            <Text style={styles.pie}>
              Los avisos quedan como historial. Usa “Marcar todos como vistos” para apagar la campana.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filtros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 16 },
  head: { marginBottom: 14 },
  buscador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 10,
    paddingHorizontal: 12,
    // 44 px de alto: se usa de pie y a veces con guantes.
    minHeight: 44,
    marginBottom: 10,
  },
  buscadorInput: {
    fontFamily: Fonts.regular,
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    paddingVertical: 10,
  },
  pestanias: { gap: 8, paddingBottom: 12 },
  pestania: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  pestaniaActiva: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  pestaniaDot: { backgroundColor: Colors.danger },
  pestaniaTexto: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.textSecondary },
  pestaniaTextoActiva: { color: Colors.primary },
  pestaniaNum: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.textSecondary },
  limpiar: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 10 },
  limpiarTexto: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primary },
  heading: { fontFamily: Fonts.semibold, fontSize: 20, color: Colors.textPrimary },
  sub: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  // Un aviso sin ver se distingue por fondo y borde, no solo por el punto: tiene que saltar a la
  // vista en una lista larga.
  cardNuevo: { backgroundColor: Colors.primary + '0E', borderColor: Colors.primary + '55' },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  title: { fontFamily: Fonts.medium, flex: 1, fontSize: 14, color: Colors.textPrimary },
  titleNuevo: { fontFamily: Fonts.semibold },
  message: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textSecondary, lineHeight: 21 },
  when: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.textPrimary },
  emptyText: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  pie: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
});
