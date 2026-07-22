import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBasicStatus } from '../../hooks/useBasicStatus';
import { PLANTS } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import Colors from '../../constants/colors';
import type { LivenessState } from '../../services/api';

/**
 * Veredicto de "¿el sistema está funcionando?" para la vista Civil — la única pregunta que
 * el Civil necesita responder según la matriz oficial. Combina el estado del PUENTE con la
 * FRESCURA de datos (liveness), porque un puente Connected que ya no recibe datos no está
 * realmente "operativo": está congelado. La paleta es la misma que LiveBadge (coherencia).
 *
 * El parámetro se mantiene como `string` a propósito (aunque el DTO ya viene tipado con los 6
 * estados desde @ptap/shared — DEF-08): el `default` cubre cualquier valor inesperado de un
 * backend más nuevo sin romper la pantalla.
 */
function systemHealth(
  bridgeStatus: string | undefined,
  liveness: LivenessState,
): { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; desc: string } {
  // `frozen` manda sobre todo: si perdimos la fuente, da igual lo que diga el resto.
  if (liveness === 'frozen') {
    return { icon: 'close-circle', color: Colors.danger, title: 'Sin conexión con la planta', desc: 'No se están recibiendo datos en este momento. Reintentando automáticamente.' };
  }

  switch (bridgeStatus) {
    // Con la sesión sana, `live` y `stable` son AMBOS funcionamiento normal: una planta en
    // régimen estable (tanque a nivel constante) no es una avería y no debe alarmar al Civil.
    case 'Connected':
      return { icon: 'checkmark-circle', color: Colors.success, title: 'Sistema operativo', desc: 'La planta está en funcionamiento y enviando datos.' };
    case 'Recovering':
    case 'Stale':
    case 'Connecting':
      return { icon: 'alert-circle', color: Colors.warning, title: 'Sistema con intermitencias', desc: 'La conexión con la planta es inestable en este momento.' };
    case 'Disconnected':
    case 'Faulted':
      return { icon: 'close-circle', color: Colors.danger, title: 'Sistema fuera de línea', desc: 'No hay conexión con la planta en este momento.' };
    default:
      return { icon: 'help-circle-outline', color: Colors.neutral, title: 'Estado no disponible', desc: 'Aún no se reciben datos de la planta.' };
  }
}

export default function EstadoScreen() {
  const { user } = useAuth();
  const plantId = user?.plant ?? 'montebello';
  const plantName = PLANTS.find((p) => p.id === plantId)?.name ?? plantId;

  // Estado BÁSICO (no el snapshot detallado): la matriz oficial concede al Civil solo
  // "¿el sistema funciona?" y "¿hay agua?". El veredicto del agua lo deriva el backend, que
  // es quien tiene las lecturas de tanque — aquí nunca llegan valores crudos del PLC.
  const { data: status } = useBasicStatus(plantId);
  const system = systemHealth(status?.bridgeStatus, status?.liveness.state ?? 'frozen');

  const water =
    status?.waterAvailable === true
      ? { icon: 'water' as const, color: Colors.primaryLight, title: 'Agua disponible', desc: 'Los tanques de la planta tienen nivel suficiente.' }
      : status?.waterAvailable === false
        ? { icon: 'water-outline' as const, color: Colors.warning, title: 'Nivel bajo de agua', desc: 'Los tanques están por debajo del nivel mínimo.' }
        : { icon: 'help-circle-outline' as const, color: Colors.neutral, title: 'Sin datos de tanques', desc: 'Esta planta aún no tiene señales de tanque mapeadas.' };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Estado General del Sistema</Text>
        <Text style={styles.subheading}>{plantName}</Text>

        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: system.color + '20' }]}>
            <Ionicons name={system.icon} size={52} color={system.color} />
          </View>
          <Text style={styles.statusTitle}>{system.title}</Text>
          <Text style={styles.statusDesc}>{system.desc}</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: water.color + '20' }]}>
            <Ionicons name={water.icon} size={52} color={water.color} />
          </View>
          <Text style={styles.statusTitle}>{water.title}</Text>
          <Text style={styles.statusDesc}>{water.desc}</Text>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.infoText}>
            Acceso con vista básica. Contacte a un operador para información detallada.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 20 },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 24,
  },
  card: {
    backgroundColor: Colors.bg,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  statusDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.bg,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
