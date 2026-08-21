import { memo, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useNotifications } from '../../hooks/useNotifications';
import { useNotificationPrefs } from '../../services/notification-prefs';
import { usePlant, PLANTS } from '../../context/PlantContext';
import { formatWhen, type AppNotification } from '../../services/notifications';
import { ListSkeleton } from '../../components/Skeleton';
import { OfflineNotice } from '../../components/OfflineNotice';
import Colors from '../../constants/colors';

/**
 * Bandeja de notificaciones.
 *
 * Tres reglas de producto que la separan de la pantalla de alertas que había antes:
 *
 *  1. **Nada se borra.** No hay botón de descartar. El usuario solo las marca como vistas, y eso
 *     ocurre solo por entrar aquí. El historial es evidencia: si un sensor lleva 15 días caído,
 *     ese rastro tiene que poder enseñarse.
 *  2. **La campana se apaga al verlas, no al resolverlas.** Al montar esta pantalla se marcan
 *     vistas; el aviso sigue en la lista, sin resalte.
 *  3. **Tocar un aviso lleva a la planta afectada**, seleccionándola primero.
 */
function severityOf(n: AppNotification): { color: string; icon: keyof typeof Ionicons.glyphMap } {
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

export default function AlertasScreen() {
  const [verSilenciados, setVerSilenciados] = useState(false);
  const { notifications, unseen, isLoading, isError, refetch, markSeen } = useNotifications(verSilenciados);
  const { prefs } = useNotificationPrefs();
  const { setSelectedPlant } = usePlant();

  // ¿Tiene sentido ofrecer el interruptor? Solo si esta persona está callando algo. A quien no
  // filtra nada, un interruptor de "ver también lo silenciado" no le dice nada.
  const filtra = prefs.mutedKinds.length > 0 || prefs.minSeverity !== 'info';

  // Entrar aquí ES verlas. Se marca al montar y cada vez que cambia lo que se está mirando: si se
  // destapan los silenciados, esos también quedan vistos — se acaban de enseñar.
  useEffect(() => {
    markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verSilenciados]);

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
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        <View style={styles.head}>
          <Text style={styles.heading}>Notificaciones</Text>
          <Text style={styles.sub}>
            {notifications.length === 0
              ? 'Historial de los últimos 3 días'
              : `${notifications.length} en los últimos 3 días${unseen > 0 ? ` · ${unseen} sin ver` : ''}`}
          </Text>
          {filtra ? (
            <TouchableOpacity
              style={styles.filtro}
              onPress={() => setVerSilenciados((v) => !v)}
              activeOpacity={0.7}
              accessibilityRole="switch"
              accessibilityState={{ checked: verSilenciados }}
              accessibilityLabel="Ver también los avisos silenciados"
            >
              <Ionicons
                name={verSilenciados ? 'eye-outline' : 'eye-off-outline'}
                size={15}
                color={verSilenciados ? Colors.primary : Colors.textSecondary}
              />
              <Text style={[styles.filtroTexto, verSilenciados && styles.filtroActivo]}>
                {verSilenciados ? 'Mostrando también los silenciados' : 'Ver también los silenciados'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {isLoading ? (
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
            <Text style={styles.emptyTitle}>Sin novedades</Text>
            <Text style={styles.emptyText}>
              No se ha registrado ningún aviso en los últimos 3 días. Aquí aparecerán las señales
              fuera de rango y los sensores que dejen de refrescarse.
            </Text>
          </View>
        ) : (
          <>
            {notifications.map((n) => (
              <NotificationRow key={n.id} notification={n} onPress={abrir} />
            ))}
            <Text style={styles.pie}>
              Los avisos no se pueden borrar: quedan como historial. Al entrar aquí se marcan como
              vistos y la campana deja de avisar.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 16 },
  head: { marginBottom: 14 },
  filtro: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, marginTop: 2 },
  filtroTexto: { fontSize: 12.5, color: Colors.textSecondary },
  filtroActivo: { color: Colors.primary, fontWeight: '600' },
  heading: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
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
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  titleNuevo: { fontWeight: '800' },
  message: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 17 },
  when: { fontSize: 11.5, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  pie: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
});
