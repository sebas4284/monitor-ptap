import { useState } from 'react';
import { Tabs, router } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS, ROLE_COLORS } from '../../constants/roles';
import type { AuthUser } from '../../constants/roles';

function MenuModal({
  visible,
  onClose,
  user,
}: {
  visible: boolean;
  onClose: () => void;
  user: AuthUser | null;
}) {
  const { logout } = useAuth();

  async function handleLogout() {
    onClose();
    await logout();
    router.replace('/(auth)/login');
  }

  const roleColor = user ? ROLE_COLORS[user.role] : Colors.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.drawer} onPress={() => {}}>
          <View style={styles.drawerHeader}>
            <View style={styles.drawerAvatar}>
              <Ionicons name="person" size={28} color="#fff" />
            </View>
            <Text style={styles.drawerTitle}>{user?.name ?? 'Usuario'}</Text>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '30' }]}>
              <Text style={[styles.roleText, { color: '#fff' }]}>
                {user ? ROLE_LABELS[user.role] : '—'}
              </Text>
            </View>
            <Text style={styles.drawerSubtitle}>{user?.plant ?? 'Sistema de Monitoreo'}</Text>
          </View>

          <TouchableOpacity style={styles.drawerItem}>
            <Ionicons name="notifications-outline" size={20} color={Colors.textPrimary} />
            <Text style={styles.drawerItemText}>Notificaciones</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.drawerItem}>
            <Ionicons name="settings-outline" size={20} color={Colors.textPrimary} />
            <Text style={styles.drawerItemText}>Configuración</Text>
          </TouchableOpacity>

          <View style={styles.drawerDivider} />

          <TouchableOpacity style={styles.drawerLogout} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
            <Text style={styles.drawerLogoutText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TabBadge({ count }: { count: number }) {
  return (
    <View style={styles.tabBadge}>
      <Text style={styles.tabBadgeText}>{count}</Text>
    </View>
  );
}

export default function AppLayout() {
  const [menuVisible, setMenuVisible] = useState(false);
  const { user } = useAuth();
  const isCivil = user?.role === 'civil';

  const HEADER_OPTS = {
    headerStyle: { backgroundColor: Colors.primary },
    headerTintColor: '#fff',
    headerTitle: 'MONITOR / PTAP',
    headerTitleStyle: { fontWeight: '800' as const, fontSize: 16, letterSpacing: 1 },
    headerLeft: () => (
      <TouchableOpacity
        style={{ marginLeft: 16 }}
        hitSlop={8}
        onPress={() => setMenuVisible(true)}
      >
        <Ionicons name="menu" size={24} color="#fff" />
      </TouchableOpacity>
    ),
    headerRight: () => (
      <TouchableOpacity style={{ marginRight: 16 }} hitSlop={8}>
        <View>
          <Ionicons name="notifications-outline" size={24} color="#fff" />
          <View style={styles.notifBadge}>
            <Text style={styles.notifText}>3</Text>
          </View>
        </View>
      </TouchableOpacity>
    ),
  };

  return (
    <>
      <MenuModal visible={menuVisible} onClose={() => setMenuVisible(false)} user={user} />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textSecondary,
          tabBarStyle: isCivil
            ? { display: 'none' }
            : {
                backgroundColor: Colors.bg,
                borderTopColor: '#E5E7EB',
                elevation: 0,
                shadowOpacity: 0,
              },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="sensores"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Sensores',
            tabBarIcon: ({ color, size, focused }) => (
              <View>
                <Ionicons name={focused ? 'pulse' : 'pulse-outline'} size={size} color={color} />
                <TabBadge count={1} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="electrovalvulas"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Válvulas',
            tabBarIcon: ({ color, size, focused }) => (
              <View>
                <Ionicons name={focused ? 'toggle' : 'toggle-outline'} size={size} color={color} />
                <TabBadge count={2} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="tanques"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Tanques',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'water' : 'water-outline'} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="reportes"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Reportes',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'document-text' : 'document-text-outline'}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="estado"
          options={{
            href: null,
            ...HEADER_OPTS,
            headerTitle: 'Estado General',
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexDirection: 'row',
  },
  drawer: {
    width: 280,
    backgroundColor: Colors.bg,
    paddingBottom: 32,
  },
  drawerHeader: {
    backgroundColor: Colors.primary,
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 20,
    alignItems: 'flex-start',
  },
  drawerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  drawerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  roleBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  drawerSubtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    marginTop: 6,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  drawerItemText: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  drawerDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 20,
    marginVertical: 8,
  },
  drawerLogout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  drawerLogoutText: {
    fontSize: 15,
    color: Colors.danger,
    fontWeight: '600',
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  tabBadge: {
    position: 'absolute',
    right: -7,
    top: -3,
    backgroundColor: Colors.danger,
    borderRadius: 7,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
});
