import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Ionicons from './AppIcon';
import { PlantSheet } from './PlantPicker';
import { useAuth } from '../context/AuthContext';
import { usePlant } from '../context/PlantContext';
import Colors from '../constants/colors';
import { Fonts } from '../constants/fonts';

const B = Colors.brand;
export function NavigationSearch() {
  const [open, setOpen] = useState(false);
  const { hasPermission } = useAuth();
  const { canSwitchPlant } = usePlant();
  const wide = useWindowDimensions().width >= 900;
  if (!canSwitchPlant || !hasPermission('view_dashboard')) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Buscar planta en el tablero"
        aria-haspopup="dialog"
        style={[styles.trigger, wide && styles.triggerWide]}
      >
        <Ionicons name="search-outline" color={B.textSecondary} size={20} />
        {wide && <Text style={styles.muted}>Buscar planta…</Text>}
      </Pressable>
      {open && (
        <PlantSheet
          searchOnly
          onClose={() => setOpen(false)}
          onPicked={() => {
            setOpen(false);
            router.push('/(app)/tablero');
          }}
        />
      )}
    </>
  );
}
export function ProfileButton({ onPress }: { onPress: () => void }) {
  const { user } = useAuth();
  const wide = useWindowDimensions().width >= 1100;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Perfil y menú de ${user?.name ?? 'usuario'}`}
      style={styles.trigger}
    >
      <Ionicons name="person-circle-outline" size={28} color={B.link} />
      {wide && (
        <Text numberOfLines={1} style={styles.profileName}>
          {user?.name}
        </Text>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  trigger: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  triggerWide: {
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: B.cardBorder,
    borderRadius: 10,
  },
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: B.textSecondary },
  profileName: { maxWidth: 130, fontFamily: Fonts.medium, fontSize: 13, color: B.text },
});
