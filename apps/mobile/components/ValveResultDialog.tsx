import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { useWebEscape } from '../hooks/useWebEscape';
import type { CommandVerdict } from '../services/valves';

/**
 * Resultado de una orden de válvula, con **acuse de recibo obligatorio**.
 *
 * Por qué esto NO es un toast: el resto de avisos de la app pasaron a ser toasts no bloqueantes,
 * pero este no. Aquí se acaba de mover (o de intentar mover) un actuador físico de la planta, y el
 * veredicto puede ser "se envió pero NO se pudo confirmar" — información que el operador tiene que
 * leer antes de seguir, porque decide si va a verificar en sitio. Un aviso que se cierra solo a los
 * 3 segundos puede perderse mientras mira otra cosa.
 *
 * Respecto a lo que había antes (`window.alert()` en web) esto mejora en todo: no congela la
 * pestaña, distingue visualmente éxito de fallo, y es legible por un lector de pantalla. Lo que
 * conserva a propósito es la parte que importa — que no desaparece hasta que alguien lo cierra.
 */
interface Props {
  /** Veredicto a mostrar; `null` cierra el diálogo. */
  verdict: (CommandVerdict & { valveName: string }) | null;
  onClose: () => void;
}

export function ValveResultDialog({ verdict, onClose }: Props) {
  const visible = verdict !== null;
  useWebEscape(visible, onClose);

  if (!verdict) return null;

  const ok = verdict.ok;
  const color = ok ? Colors.success : Colors.danger;
  const icon = ok ? 'checkmark-circle' : 'alert-circle';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <View style={styles.headerRow}>
            <View style={[styles.icon, { backgroundColor: color + '1F' }]}>
              <Ionicons name={icon} size={24} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{verdict.title}</Text>
              <Text style={styles.valve}>{verdict.valveName}</Text>
            </View>
          </View>

          <ScrollView style={styles.messageWrap} contentContainerStyle={{ paddingRight: 4 }}>
            <Text style={styles.message}>{verdict.message}</Text>
          </ScrollView>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: color }]}
            onPress={onClose}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Entendido, cerrar el resultado"
          >
            <Text style={styles.btnText}>Entendido</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: Colors.bg,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.25)' } as object,
      default: {
        elevation: 8,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
    }),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, lineHeight: 21 },
  valve: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  messageWrap: { maxHeight: 260 },
  message: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  btn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10 },
  btnText: { fontSize: 14, fontWeight: '800', color: Colors.bg },
});
