import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { fetchTanks } from '../../services/mock-data';
import { useAuth } from '../../context/AuthContext';
import Colors from '../../constants/colors';

export default function EstadoScreen() {
  const { user } = useAuth();
  const plant = user?.plant ?? 'Montebello';

  const { data: tanks } = useQuery({
    queryKey: ['tanks', plant],
    queryFn: () => fetchTanks(plant),
    refetchInterval: 30_000,
  });

  const avgPct = tanks
    ? Math.round(tanks.reduce((sum, t) => sum + t.percentage, 0) / tanks.length)
    : null;
  const waterOk = (avgPct ?? 0) > 20;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Estado General del Sistema</Text>
        <Text style={styles.subheading}>{plant}</Text>

        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: Colors.success + '20' }]}>
            <Ionicons name="checkmark-circle" size={52} color={Colors.success} />
          </View>
          <Text style={styles.statusTitle}>Sistema operativo</Text>
          <Text style={styles.statusDesc}>La planta se encuentra en funcionamiento normal</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.iconCircle, { backgroundColor: (waterOk ? Colors.primaryLight : Colors.warning) + '20' }]}>
            <Ionicons
              name={waterOk ? 'water' : 'water-outline'}
              size={52}
              color={waterOk ? Colors.primaryLight : Colors.warning}
            />
          </View>
          <Text style={styles.statusTitle}>
            {waterOk ? 'Agua disponible' : 'Nivel bajo de agua'}
          </Text>
          {avgPct !== null && (
            <Text style={styles.statusDesc}>
              Nivel promedio de almacenamiento: {avgPct}%
            </Text>
          )}
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
