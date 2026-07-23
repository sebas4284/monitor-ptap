import { View, Text } from 'react-native';
import Colors from '../constants/colors';
import type { LivenessState } from '../services/api';

const LIVENESS: Record<LivenessState, { color: string; label: string }> = {
  live: { color: Colors.success, label: 'EN VIVO' },
  stable: { color: Colors.primaryLight, label: 'ESTABLE' },
  frozen: { color: Colors.danger, label: 'CONGELADO · SIN CONEXIÓN' },
};

/**
 * Badge de frescura REAL (ya no cosmético). Tres estados y solo UNO es una alarma:
 *   verde  EN VIVO   → los valores se están moviendo.
 *   azul   ESTABLE   → la sesión está sana y el proceso quieto. Normal, NO es un fallo:
 *                      un tanque a nivel constante se ve así durante horas.
 *   rojo   CONGELADO → perdimos la conexión con el PLC; lo que se muestre ya no es fiable.
 */
export function LiveBadge({ state }: { state: LivenessState }) {
  const { color, label } = LIVENESS[state];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        backgroundColor: Colors.surface,
        borderTopWidth: 1,
        borderTopColor: Colors.divider,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 8 }} />
      <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 1.2 }}>
        {label}
      </Text>
    </View>
  );
}
