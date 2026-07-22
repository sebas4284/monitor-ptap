import { View, Text } from 'react-native';
import Colors from '../constants/colors';
import type { LivenessState } from '../services/api';

const LIVENESS: Record<LivenessState, { color: string; label: string }> = {
  live: { color: Colors.success, label: 'EN VIVO' },
  idle: { color: Colors.warning, label: 'SIN CAMBIOS RECIENTES' },
  stale: { color: Colors.danger, label: 'DATOS CONGELADOS' },
  unknown: { color: Colors.neutral, label: 'SIN HISTORIAL' },
};

/**
 * Badge de liveness REAL (ya no cosmético). El color y el texto reflejan el estado de
 * frescura de datos de la planta: verde=datos frescos, ámbar=sin cambios recientes,
 * rojo=congelado, gris=todavía no sabemos. Un verde significa datos frescos, no que el
 * componente exista.
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
