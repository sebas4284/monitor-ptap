import { View, Text } from 'react-native';
import Colors from '../constants/colors';

export function LiveBadge() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        backgroundColor: Colors.surface,
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: Colors.success,
          marginRight: 8,
        }}
      />
      <Text
        style={{
          fontSize: 11,
          fontWeight: '600',
          color: Colors.textSecondary,
          letterSpacing: 1.2,
        }}
      >
        LIVE · AUTO REFRESH 30s
      </Text>
    </View>
  );
}
