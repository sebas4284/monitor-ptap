import { useState } from 'react';
import { Tabs, Redirect, router } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useAlerts } from '../../hooks/useAlerts';
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

  function goToAlerts() {
    onClose();
    router.push('/(app)/alertas');
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

          {/* Alertas REALES (derivadas del snapshot): solo tienen sentido para roles que ven el
              tablero. El Civil (solo estado básico) no recibe señales, así que no se le ofrece. */}
          {hasPermission('view_dashboard') && (
            <TouchableOpacity style={styles.drawerItem} onPress={goToAlerts}>
              <Ionicons name="notifications-outline" size={20} color={Colors.textPrimary} />
              <Text style={styles.drawerItemText}>Alertas</Text>
            </TouchableOpacity>
          )}

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

export default function AppLayout() {
  const [menuVisible, setMenuVisible] = useState(false);
  const { user, token, isLoading } = useAuth();
  // Conteo REAL de alertas (0 para el Civil, que no recibe señales). Se llama SIEMPRE, antes de
  // los early-return, para no violar las reglas de hooks.
  const { count: alertCount } = useAlerts();
  const isCivil = user?.role === 'civil';

  // GUARD de sesión para TODAS las rutas de (app). Cubre tres caminos al login:
  //  1. Recargar la página en una ruta profunda (/sensores, /ajustes…) sin sesión — antes la
  //     pantalla se renderizaba igual (solo index.tsx redirigía) y quedaba rota a punta de 401.
  //  2. El cierre AUTOMÁTICO a las 8 h (AuthContext vence el token y deja token=null).
  //  3. Un 401 del backend (token revocado/vencido): onUnauthorized hace logout y esto redirige.
  // Mientras se restaura la sesión persistida no se decide nada (evita el parpadeo al login).
  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }
  if (!token) return <Redirect href="/(auth)/login" />;

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
    // Campana con conteo REAL de alertas; toca para abrir la pantalla de alertas. El badge solo
    // aparece si hay alertas (nada de un "3" inventado). Para el Civil (sin señales) siempre 0.
    headerRight: () => (
      <TouchableOpacity style={{ marginRight: 16 }} hitSlop={8} onPress={() => router.push('/(app)/alertas')}>
        <View>
          <Ionicons name="notifications-outline" size={24} color="#fff" />
          {alertCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifText}>{alertCount > 9 ? '9+' : alertCount}</Text>
            </View>
          )}
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
                borderTopColor: Colors.divider,
                elevation: 0,
                shadowOpacity: 0,
              },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="tablero"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Tablero',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'grid' : 'grid-outline'} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="electrovalvulas"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Válvulas',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'toggle' : 'toggle-outline'} size={size} color={color} />
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
        {/* Fuera del tab bar: se entra desde el menú/campana. Solo roles con view_dashboard. */}
        <Tabs.Screen
          name="alertas"
          options={{
            href: null,
            ...HEADER_OPTS,
            headerTitle: 'Alertas',
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
  drawerDivider: {
    height: 1,
    backgroundColor: Colors.divider,
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
});
