import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { classifyBridge } from '@ptap/shared';
import Colors from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { useClientNetworkStatus } from '../hooks/useClientNetworkStatus';

/**
 * Aviso de corte de datos, en lenguaje de operador y CLASIFICADO por dónde falla. La cadena es
 * DISPOSITIVO → servidor → PLC, y cada tramo tiene su propio mensaje y su propio responsable:
 *
 * Lado del DISPOSITIVO (no se alcanza al servidor). Se distinguen tres, porque la acción es
 * distinta y confundirlas hace perder el tiempo:
 *  - offline     → no está conectado a ninguna red → "conéctate a una red" (es tuyo).
 *  - no-internet → tiene red pero sin salida a internet → "contacta a tu proveedor" (es del ISP).
 *  - servidor    → hay internet pero el servidor no responde → "avisa al administrador" (es del server).
 *
 * Lado del SERVIDOR (sí se alcanza al servidor, pero no hay datos):
 *  - PLC maestro (`bridgeStatus === 'Stale'`): hubo sesión y el maestro dejó de enviar. Todos.
 *  - Ruta (resto): el servidor no alcanza al PLC. Infraestructura: SOLO el admin (`system_config`)
 *    lo ve para escalarlo; un operador no ve banner (ya tiene la última lectura con su hora).
 */
export function ConnectionBanner({
  apiReachable,
  bridgeStatus,
}: {
  apiReachable: boolean;
  bridgeStatus: string | undefined;
}) {
  const { hasPermission } = useAuth();
  // Solo diagnostica la red del dispositivo cuando de verdad no se llega al servidor.
  const clientNet = useClientNetworkStatus(!apiReachable);

  if (!apiReachable) {
    switch (clientNet) {
      case 'offline':
        return (
          <Banner
            icon="cellular-outline"
            title="No estás conectado a una red"
            detail="Tu dispositivo no está en ninguna red. Conéctate a WiFi o a datos móviles."
          />
        );
      case 'no-internet':
        return (
          <Banner
            icon="wifi-outline"
            title="Tu red no tiene salida a internet"
            detail="Estás conectado a una red, pero no hay internet. Contacta a tu proveedor de internet."
          />
        );
      case 'checking':
        return (
          <Banner
            icon="sync-outline"
            title="Sin conexión con el servidor"
            detail="Comprobando el tipo de problema…"
          />
        );
      default: // 'online' → hay internet, el que no responde es el servidor
        return (
          <Banner
            icon="server-outline"
            title="El servidor no responde"
            detail="Tienes internet, pero el servidor del sistema no está respondiendo. Avisa al administrador del sistema."
          />
        );
    }
  }

  // apiReachable pero sin bridgeStatus aún: nada que clasificar todavía.
  if (!bridgeStatus) return null;

  const fault = classifyBridge(bridgeStatus);
  if (fault === 'ok') return null;

  if (fault === 'master_no_data') {
    return (
      <Banner
        icon="cloud-offline-outline"
        title="El PLC no está enviando datos"
        detail="La conexión con la planta está activa, pero el equipo dejó de enviar lecturas. Se muestran los últimos valores conocidos."
      />
    );
  }

  // fault === 'route': solo el admin. El resto no ve banner (Parte B cubre su experiencia).
  if (!hasPermission('system_config')) return null;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/(app)/ajustes')}>
      <Banner
        icon="git-network-outline"
        title="Sin conexión con el PLC (problema de ruta)"
        detail="El servidor no está alcanzando el PLC de la planta. Avisa al administrador de la planta. Toca para ver el diagnóstico."
      />
    </TouchableOpacity>
  );
}

function Banner({
  icon,
  title,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.banner}>
      <Ionicons name={icon} size={20} color={Colors.danger} />
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: Colors.danger + '12',
    borderLeftWidth: 3,
    borderLeftColor: Colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
  },
  texts: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.danger },
  detail: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
});
