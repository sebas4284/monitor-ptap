import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Sensor } from '../services/api';
import Colors from '../constants/colors';

interface Props {
  sensor: Sensor;
}

export function SensorCard({ sensor }: Props) {
  const progress = Math.min(1, Math.max(0, (sensor.value - sensor.min) / (sensor.max - sensor.min)));
  const isOk = sensor.status === 'ok';
  const barColor = isOk ? Colors.primaryLight : Colors.warning;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name={sensor.icon as any} size={18} color={Colors.primary} />
        </View>
        <Text style={styles.name}>{sensor.name}</Text>
        <View style={[styles.dot, { backgroundColor: isOk ? Colors.success : Colors.danger }]} />
      </View>

      <Text style={styles.value}>
        {sensor.value.toFixed(1)}
        <Text style={styles.unit}> {sensor.unit}</Text>
      </Text>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${progress * 100}%` as any, backgroundColor: barColor }]} />
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.label}>{sensor.min}</Text>
        <Text style={styles.label}>{sensor.max}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 5,
    padding: 14,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  value: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary,
    marginBottom: 10,
  },
  unit: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.textSecondary,
  },
  barTrack: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  label: {
    fontSize: 10,
    color: Colors.textSecondary,
  },
});
