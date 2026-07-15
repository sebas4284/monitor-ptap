import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Valve } from '../services/mock-data';
import Colors from '../constants/colors';

interface Props {
  valve: Valve;
  onToggle?: () => void;
}

export function ValveItem({ valve, onToggle }: Props) {
  const color = valve.isOpen ? Colors.success : Colors.danger;
  const label = valve.isOpen ? 'Abierta' : 'Cerrada';
  const iconName = valve.isOpen ? 'toggle' : 'toggle-outline';

  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={iconName} size={22} color={color} />
      </View>

      <View style={styles.info}>
        <Text style={styles.name}>{valve.name}</Text>
        <Text style={styles.desc}>{valve.description}</Text>
      </View>

      {onToggle ? (
        <TouchableOpacity
          style={[
            styles.toggleBtn,
            { backgroundColor: valve.isOpen ? Colors.danger + '15' : Colors.success + '15' },
          ]}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <Ionicons
            name={valve.isOpen ? 'close-circle-outline' : 'checkmark-circle-outline'}
            size={17}
            color={valve.isOpen ? Colors.danger : Colors.success}
          />
          <Text style={[styles.toggleText, { color: valve.isOpen ? Colors.danger : Colors.success }]}>
            {valve.isOpen ? 'Cerrar' : 'Abrir'}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.badge, { backgroundColor: color + '18' }]}>
          <Text style={[styles.badgeText, { color }]}>{label}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  desc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
