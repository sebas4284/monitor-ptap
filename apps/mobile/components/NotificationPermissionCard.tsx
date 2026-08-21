import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { useDeviceNotifications } from '../hooks/useDeviceNotifications';

/**
 * Activar los avisos en el panel del sistema.
 *
 * El permiso se pide DESDE AQUÍ, con un toque, y no automáticamente al abrir la app: tanto los
 * navegadores como Android rechazan las peticiones sin gesto del usuario, y una denegación es
 * difícil de revertir (el diálogo ya no vuelve a aparecer).
 *
 * Cuando la plataforma no puede, se explica por qué en vez de mostrar un botón que no hará nada.
 */
export function NotificationPermissionCard() {
  const { supported, reason, permission, ask } = useDeviceNotifications();

  if (!supported) {
    return (
      <View style={[styles.card, styles.cardMuted]}>
        <Ionicons name="notifications-off-outline" size={20} color={Colors.textSecondary} />
        <View style={styles.body}>
          <Text style={styles.title}>Avisos del sistema no disponibles</Text>
          <Text style={styles.text}>{reason}</Text>
        </View>
      </View>
    );
  }

  if (permission === 'granted') {
    return (
      <View style={[styles.card, styles.cardOk]}>
        <Ionicons name="notifications" size={20} color={Colors.success} />
        <View style={styles.body}>
          <Text style={styles.title}>Avisos activados</Text>
          <Text style={styles.text}>
            Recibirás en el panel del dispositivo los avisos que elijas aquí abajo. Se revisa cada
            15 minutos y al abrir la aplicación.
          </Text>
        </View>
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <View style={[styles.card, styles.cardMuted]}>
        <Ionicons name="notifications-off-outline" size={20} color={Colors.warning} />
        <View style={styles.body}>
          <Text style={styles.title}>Avisos bloqueados</Text>
          <Text style={styles.text}>
            Los rechazaste antes y el sistema ya no vuelve a preguntar. Para activarlos hay que
            permitirlos a mano en los ajustes del navegador o del teléfono, en los permisos de esta
            aplicación.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, styles.cardAction]}
      onPress={() => void ask()}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Activar los avisos en el panel del dispositivo"
    >
      <Ionicons name="notifications-outline" size={20} color={Colors.primary} />
      <View style={styles.body}>
        <Text style={styles.title}>Activar avisos en el dispositivo</Text>
        <Text style={styles.text}>
          Para enterarte de un sensor caído sin tener la aplicación abierta. Toca para permitirlo.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 12,
    padding: 14,
  },
  cardAction: { borderColor: Colors.primary + '66', backgroundColor: Colors.primary + '0E' },
  cardOk: { borderColor: Colors.success + '55' },
  cardMuted: {},
  body: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  text: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 17 },
});
