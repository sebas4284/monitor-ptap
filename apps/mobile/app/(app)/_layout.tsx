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
import { ROLE_LABELS, ROLE_COLORS, type AuthUser } from '@ptap/shared';

function MenuModal({
  visible,
  onClose,
  user,
}: {
  visible: boolean;
  onClose: () => void;
  user: AuthUser | null;
}) {
  const { logout, hasPermission } = useAuth();

  async function handleLogout() {
    onClose();
    await logout();
    router.replace('/(auth)/login');
  }

  function goToUsers() {
    onClose();
    router.push('/(app)/usuarios');
  }

  function goToSettings() {
    onClose();
    router.push('/(app)/ajustes');
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

          {/* Solo Admin: la matriz oficial reserva la gestión de usuarios al Administrador.
              Ocultarlo es comodidad de UI — el backend igual responde 403 a los demás. */}
          {hasPermission('manage_users') && (
            <TouchableOpacity style={styles.drawerItem} onPress={goToUsers}>
              <Ionicons name="people-outline" size={20} color={Colors.textPrimary} />
              <Text style={styles.drawerItemText}>Usuarios</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.drawerItem} onPress={goToSettings}>
            <Ionicons name="settings-outline" size={20} color={Colors.textPrimary} />
            <Text style={styles.drawerItemText}>Ajustes</Text>
          </TouchableOpacity>

          {/* Aún no implementado: se marca como tal en vez de dejar un botón muerto que
              parezca roto en una demo. Las notificaciones/alertas son la Semana 6 del plan. */}
          <View style={[styles.drawerItem, styles.drawerItemDisabled]}>
            <Ionicons name="notifications-outline" size={20} color={Colors.textSecondary} />
            <Text style={[styles.drawerItemText, { color: Colors.textSecondary }]}>Notificaciones</Text>
            <Text style={styles.soonTag}>Próximamente</Text>
          </View>

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
        {/* Fuera del tab bar: se entra desde el menú, y solo si el rol tiene manage_users. */}
        <Tabs.Screen
          name="usuarios"
          options={{
            href: null,
            ...HEADER_OPTS,
            headerTitle: 'Usuarios',
          }}
        />
        {/* Fuera del tab bar: se entra desde el menú. Disponible para todos los roles. */}
        <Tabs.Screen
          name="ajustes"
          options={{
            href: null,
            ...HEADER_OPTS,
            headerTitle: 'Ajustes',
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
  drawerItemDisabled: { opacity: 0.55 },
  soonTag: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
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
