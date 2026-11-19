import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Tabs, Redirect, router, useIsFocused, usePathname } from 'expo-router';
import { NavigationTabButton } from '../../components/NavigationTabButton';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  useWindowDimensions,
  Platform,
} from 'react-native';
import Ionicons from '../../components/AppIcon';
import Colors from '../../constants/colors';
import { Fonts, usePoppins } from '../../constants/fonts';
import { useAuth } from '../../context/AuthContext';
import { usePlant } from '../../context/PlantContext';
import { useUnseenNotifications } from '../../hooks/useNotifications';
import { NavigationSearch, ProfileButton } from '../../components/NavigationSearch';
import { NotificationOptIn } from '../../components/NotificationOptIn';
import { usePendingUsers } from '../../hooks/usePendingUsers';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useWebEscape } from '../../hooks/useWebEscape';
import { navigationItems } from '../../services/navigation-menu';
import { ROLE_LABELS, ROLE_COLORS, type AuthUser } from '@ptap/shared';

const B = Colors.brand;
/** Desde este ancho las pestañas pasan a una barra lateral (como el panel de plantas del tablero). */
const SIDEBAR_MIN_WIDTH = 1024;

function MainScene({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  // A stable tag preserves tab state when focus changes; inactive scenes cannot receive focus.
  if (Platform.OS === 'web')
    return createElement(
      'div',
      {
        role: focused ? 'main' : undefined,
        inert: !focused,
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          position: 'relative',
        },
      },
      children,
    );
  return <View style={styles.layout}>{children}</View>;
}

const renderMainScene = ({ children }: { children: ReactNode }) => (
  <MainScene>{children}</MainScene>
);

function HeaderFocusGroup({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  if (Platform.OS === 'web')
    return createElement(
      'div',
      {
        inert: !focused,
        style: { display: 'contents' },
      },
      children,
    );
  return <>{children}</>;
}

/**
 * Título de la cabecera: "Aquora · planta". Aislado para que el cambio de planta repinte solo este
 * texto y no las opciones de las 7 pestañas. Sin el logo: a la altura de la cabecera sus letras son
 * ilegibles y repetían "Aquora"; el logo va en el encabezado con agua del tablero.
 */
function HeaderTitle() {
  const { selectedPlant } = usePlant();
  const wide = useWindowDimensions().width >= 700;
  return (
    <View
      style={styles.titleRow}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`Aquora, planta ${selectedPlant.name}`}
    >
      <Text style={styles.titleBrand}>Aquora</Text>
      {wide && (
        <Text style={styles.titlePlant} numberOfLines={1}>
          · {selectedPlant.name}
        </Text>
      )}
    </View>
  );
}

/**
 * Campana de notificaciones AISLADA.
 *
 * Cuenta avisos **NO VISTOS**, no alertas activas. Es la diferencia que pidió operación: la
 * campana se apaga cuando alguien los mira, no cuando el problema se resuelve — un sensor caído
 * hace 15 días deja de gritar en rojo una vez leído, pero sigue en el historial.
 *
 * Vive en su propia hoja para que su sondeo no repinte la cáscara de pestañas entera, igual que
 * el `<Clock />` de `tablero.tsx`.
 */
function AlertBell() {
  const unseen = useUnseenNotifications();
  return (
    <TouchableOpacity
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      hitSlop={8}
      onPress={() => router.push('/(app)/alertas')}
      accessibilityRole="button"
      accessibilityLabel={
        unseen > 0
          ? `Notificaciones: ${unseen > 9 ? '9+' : unseen} sin ver`
          : 'Notificaciones: ninguna sin ver'
      }
    >
      <View>
        <Ionicons name="notifications-outline" size={24} color={B.text} aria-hidden />
        {unseen > 0 && (
          <View style={styles.notifBadge}>
            <Text style={styles.notifText}>{unseen > 9 ? '9+' : unseen}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** Botón de menú aislado: `usePendingUsers` sondea cada 60 s y no debe repintar la cáscara. */
function MenuButton({ onPress }: { onPress: () => void }) {
  const { count } = usePendingUsers();
  return (
    <TouchableOpacity
      style={{
        marginLeft: 12,
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      hitSlop={8}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Menú. ${count} cuentas pendientes de aprobar` : 'Menú'}
    >
      <View>
        <Ionicons name="menu" size={24} color={B.text} />
        {/* Punto de aviso: hay cuentas pendientes de aprobar (solo lo ve un admin). */}
        {count > 0 && (
          <View style={styles.menuDot}>
            <Text style={styles.notifText}>{count > 9 ? '9+' : count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function MenuModal({
  visible,
  onClose,
  user,
  mode,
}: {
  visible: boolean;
  onClose: () => void;
  user: AuthUser | null;
  mode: 'navigation' | 'account';
}) {
  const { logout, hasPermission } = useAuth();
  const { count: pendingCount } = usePendingUsers();

  async function handleLogout() {
    onClose();
    await logout();
    router.replace('/(auth)/login');
  }

  const pathname = usePathname();
  useWebEscape(visible, onClose);

  const roleColor = user ? ROLE_COLORS[user.role] : Colors.primary;

  const reducedMotion = useReducedMotion();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cerrar el menú"
      >
        <Pressable
          style={styles.drawer}
          onPress={() => {}}
          // Aísla el menú del resto del árbol para los lectores de pantalla mientras está abierto.
          accessibilityViewIsModal
          role="dialog"
          accessibilityLabel={mode === 'navigation' ? 'Menú principal' : 'Menú de usuario'}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.drawerHeader}>
              <Pressable
                onPress={onClose}
                style={styles.drawerClose}
                accessibilityRole="button"
                accessibilityLabel="Cerrar menú"
              >
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
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

            <Text style={styles.drawerSection}>{mode === 'navigation' ? 'Navegación' : 'Cuenta'}</Text>
            {mode === 'navigation' && navigationItems(hasPermission).map((item) => {
              const selected = pathname === item.path.replace('/(app)', '');
              return (
                <Pressable
                  key={item.path}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityState={{ selected }}
                  aria-pressed={selected}
                  onPress={() => {
                    onClose();
                    router.push(item.path);
                  }}
                  style={({ pressed }) => [
                    styles.drawerItem,
                    selected && styles.drawerItemSelected,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={selected ? B.link : B.textSecondary}
                  />
                  <Text style={[styles.drawerItemText, selected && { color: B.link }]}>
                    {item.name}
                  </Text>
                  {item.path === '/(app)/usuarios' && pendingCount > 0 && (
                    <View style={styles.pendingPill}>
                      <Text style={styles.pendingPillText}>
                        {pendingCount > 9 ? '9+' : pendingCount} pendiente
                        {pendingCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {mode === 'account' && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ajustes de usuario"
                  onPress={() => {
                    onClose();
                    router.push('/(app)/ajustes');
                  }}
                  style={({ pressed }) => [styles.drawerItem, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="settings-outline" size={20} color={B.textSecondary} />
                  <Text style={styles.drawerItemText}>Ajustes de usuario</Text>
                </Pressable>
                <View style={styles.drawerDivider} />
                <TouchableOpacity
                  style={styles.drawerLogout}
                  onPress={handleLogout}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar sesión"
                >
                  <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
                  <Text style={styles.drawerLogoutText}>Cerrar sesión</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function AppLayout() {
  const [menuMode, setMenuMode] = useState<'navigation' | 'account' | null>(null);
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const reducedMotion = useReducedMotion();
  const [arrowProgress] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const target = navigationCollapsed ? 0 : 1;
    if (reducedMotion) {
      arrowProgress.setValue(target);
      return;
    }
    const animation = Animated.timing(arrowProgress, {
      toValue: target,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [navigationCollapsed, reducedMotion, arrowProgress]);
  const { user, token, isLoading } = useAuth();
  // Poppins para los componentes del tablero; si falla la carga se sigue con la fuente del sistema.
  const [fontsLoaded, fontError] = usePoppins();
  const isCivil = user?.role === 'civil';
  const sidebar = useWindowDimensions().width >= SIDEBAR_MIN_WIDTH;

  // Las opciones solo cambian al adaptar o contraer la navegación. `setMenuMode` es estable,
  // y los conteos viven ahora dentro de `<AlertBell/>` y `<MenuButton/>`, no aquí. La planta vive
  // dentro de `<HeaderTitle/>` por la misma razón. Las pantallas con título propio (Alertas,
  // Usuarios…) lo sobrescriben con `headerTitle: 'texto'` y heredan el estilo.
  const HEADER_OPTS = useMemo(
    () => ({
      headerStyle: { backgroundColor: B.panel, borderBottomWidth: 1, borderBottomColor: B.divider },
      headerShadowVisible: false,
      headerTintColor: B.text,
      headerTitleAlign: 'left' as const,
      headerTitle: () => <HeaderTitle />,
      headerTitleStyle: { fontFamily: Fonts.semibold, fontSize: 17, color: B.text },
      headerLeft: () => (
        <HeaderFocusGroup>
          <MenuButton onPress={() => setMenuMode('navigation')} />
        </HeaderFocusGroup>
      ),
      headerRight: () => (
        <HeaderFocusGroup>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 }}>
            <NavigationSearch />
            <AlertBell />
            <ProfileButton onPress={() => setMenuMode('account')} />
          </View>
        </HeaderFocusGroup>
      ),
    }),
    [],
  );

  // GUARD de sesión para TODAS las rutas de (app). Cubre tres caminos al login:
  //  1. Recargar la página en una ruta profunda (/sensores, /ajustes…) sin sesión — antes la
  //     pantalla se renderizaba igual (solo index.tsx redirigía) y quedaba rota a punta de 401.
  //  2. El cierre AUTOMÁTICO a las 8 h (AuthContext vence el token y deja token=null).
  //  3. Un 401 del backend (token revocado/vencido): onUnauthorized hace logout y esto redirige.
  // Mientras se restaura la sesión persistida no se decide nada (evita el parpadeo al login).
  if (isLoading || (Platform.OS !== 'web' && !fontsLoaded && !fontError)) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: B.page }}
      >
        <ActivityIndicator size="large" color={B.blue} />
      </View>
    );
  }
  if (!token) return <Redirect href="/(auth)/login" />;

  return (
    <View style={styles.layout}>
      {/* La franja de permiso vive AQUÍ, no en Ajustes. El permiso del sistema no se puede pedir
          solo —los navegadores lo rechazan y Android lo cuenta como denegado para siempre—, así que
          hace falta un gesto del usuario; y hasta ahora ese gesto solo era posible si alguien
          entraba a Ajustes y encontraba la tarjeta. Quien no lo hiciera no recibía un solo aviso en
          el móvil sin manera de enterarse. Montarla en la cáscara también registra la tarea de
          fondo (`useDeviceNotifications`), que era el otro motivo por el que casi nadie los recibía. */}
      <NotificationOptIn />
      {/* Montado solo mientras está abierto: un `<Modal visible={false}>` monta igual su subárbol,
          y con él un segundo observador de `usePendingUsers` que re-renderizaba el cajón cerrado
          cada 60 s. El badge del botón de menú sigue vivo por su cuenta. */}
      {menuMode && <MenuModal visible onClose={() => setMenuMode(null)} user={user} mode={menuMode} />}
      <Tabs
        screenLayout={renderMainScene}
        screenOptions={{
          tabBarActiveTintColor: B.link,
          tabBarInactiveTintColor: B.textSecondary,
          // Escritorio: navegación agrupada bajo la cabecera. Celular: barra inferior.
          tabBarPosition: sidebar ? 'left' : 'bottom',
          tabBarVariant: 'uikit',
          tabBarLabelPosition: sidebar ? 'beside-icon' : 'below-icon',
          tabBarShowLabel: !sidebar || !navigationCollapsed,
          tabBarActiveBackgroundColor: sidebar ? B.selected : undefined,
          tabBarStyle: isCivil
            ? { display: 'none' }
            : sidebar
              ? [styles.rail, navigationCollapsed && styles.railCollapsed]
              : styles.bottomBar,
          tabBarItemStyle: sidebar ? styles.railItem : styles.bottomItem,
          tabBarBackground: sidebar
            ? () => (
                <View style={styles.railSurface} pointerEvents="none">
                  <View style={styles.railHeading}>
                    {!navigationCollapsed && <Text style={styles.railHeadingText}>Navegación</Text>}
                  </View>
                </View>
              )
            : undefined,
          // Celular: raya azul de 2 px arriba de la pestaña activa (referencia TableroMovil). Es el
          // mismo botón que pinta la barra por defecto; solo se le añade el borde según aria-selected.
          tabBarButton: ({ style, ...props }) => (
            <NavigationTabButton
              {...props}
              style={[
                style,
                !sidebar && styles.tabTop,
                !sidebar && props['aria-selected'] && styles.tabTopActive,
              ]}
            />
          ),
          tabBarLabelStyle: {
            fontFamily: Fonts.medium,
            fontSize: sidebar ? 14 : 11,
            lineHeight: sidebar ? 20 : 18,
          },
        }}
      >
        <Tabs.Screen
          name="tablero"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Tablero',
            tabBarAccessibilityLabel: 'Tablero',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'grid' : 'grid-outline'}
                size={size}
                color={typeof color === 'string' ? color : Colors.primary}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="electrovalvulas"
          // Mantener los efectos de supervisión activos mientras una maniobra está pendiente.
          activityEnabled={false}
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Válvulas',
            tabBarAccessibilityLabel: 'Válvulas',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'toggle' : 'toggle-outline'}
                size={size}
                color={typeof color === 'string' ? color : Colors.primary}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="reportes"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Reportes',
            tabBarAccessibilityLabel: 'Reportes',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'document-text' : 'document-text-outline'}
                size={size}
                color={typeof color === 'string' ? color : Colors.primary}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="estado"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
            ...HEADER_OPTS,
            headerTitle: 'Estado General',
          }}
        />
        {/* Fuera del tab bar: se entra desde el menú/campana. Solo roles con view_dashboard. */}
        <Tabs.Screen
          name="alertas"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
            ...HEADER_OPTS,
            headerTitle: 'Alertas',
          }}
        />
        {/* Fuera del tab bar: se entra desde el menú, y solo si el rol tiene manage_users. */}
        <Tabs.Screen
          name="usuarios"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
            ...HEADER_OPTS,
            headerTitle: 'Usuarios',
          }}
        />
        {/* Fuera del tab bar: se entra desde el menú. Disponible para todos los roles. */}
        <Tabs.Screen
          name="ajustes"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
            ...HEADER_OPTS,
            headerTitle: 'Ajustes',
          }}
        />
        <Tabs.Screen
          name="ayuda"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
            ...HEADER_OPTS,
            headerTitle: 'Ayuda',
          }}
        />
        {/* Fuera del tab bar: se entra desde Ajustes, y el backend solo la sirve con
            `system_config`. La pantalla vuelve a comprobarlo por su cuenta. */}
        <Tabs.Screen
          name="revision"
          options={{
            href: null,
            ...HEADER_OPTS,
            headerTitle: 'Revisión por planta',
          }}
        />
        <Tabs.Screen
          name="desarrollador"
          options={{
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
            ...HEADER_OPTS,
            headerTitle: 'Modo desarrollador',
          }}
        />
      </Tabs>
      {sidebar && !isCivil && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={navigationCollapsed ? 'Expandir navegación' : 'Contraer navegación'}
          aria-expanded={!navigationCollapsed}
          onPress={() => setNavigationCollapsed((value) => !value)}
          style={({ pressed }) => [
            styles.navigationToggle,
            { left: (navigationCollapsed ? 72 : 220) - 44 - 8 },
            pressed && styles.navigationTogglePressed,
          ]}
        >
          <Animated.View
            style={{
              transform: [
                {
                  rotate: arrowProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '180deg'],
                  }),
                },
              ],
            }}
          >
            <Ionicons name="chevron-forward" size={20} color={B.link} />
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { flex: 1 },
  navigationToggle: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    zIndex: 30,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: B.panel,
    borderWidth: 1,
    borderColor: B.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationTogglePressed: { backgroundColor: B.selected },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  titleBrand: { fontFamily: Fonts.semibold, fontSize: 17, color: B.text },
  titlePlant: { fontFamily: Fonts.regular, fontSize: 15, color: B.textSecondary, flexShrink: 1 },
  // Etiquetas junto al icono en escritorio; navegación inferior en móvil.
  rail: {
    width: 220,
    minWidth: 220,
    maxWidth: 220,
    backgroundColor: B.panel,
    borderRightWidth: 0,
    paddingTop: 80,
    paddingHorizontal: 12,
  },
  railSurface: { flex: 1, backgroundColor: B.panel },
  railCollapsed: { width: 72, minWidth: 72, maxWidth: 72 },
  railHeading: { height: 64, justifyContent: 'center', paddingHorizontal: 24 },
  railHeadingText: { fontFamily: Fonts.semibold, fontSize: 14, color: B.textSecondary },
  railItem: { borderRadius: 10, marginVertical: 4, minHeight: 48, paddingHorizontal: 4 },
  bottomItem: { height: 58 },
  tabTop: { borderTopWidth: 2, borderTopColor: 'transparent' },
  tabTopActive: { borderTopColor: B.blue },
  // Poppins es más alta que la fuente del sistema: con el alto por defecto la etiqueta quedaba
  // aplastada a 9 px y cortada abajo.
  bottomBar: {
    backgroundColor: B.panel,
    borderTopColor: B.divider,
    elevation: 0,
    shadowOpacity: 0,
    height: 66,
    paddingTop: 4,
    paddingBottom: 4,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    flexDirection: 'row',
  },
  drawer: {
    width: 280,
    maxWidth: '100%',
    backgroundColor: B.panel,
    paddingBottom: 16,
  },
  drawerHeader: {
    backgroundColor: B.selected,
    paddingTop: 24,
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
    fontFamily: Fonts.semibold,
    paddingRight: 20,
  },
  drawerClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerSection: {
    fontFamily: Fonts.medium,
    color: B.textSecondary,
    fontSize: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
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
    minHeight: 52,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  drawerItemSelected: { backgroundColor: B.selected },
  drawerItemText: {
    fontSize: 15,
    color: B.text,
    fontFamily: Fonts.medium,
    flexShrink: 1,
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
    backgroundColor: '#B91C1C',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  menuDot: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  pendingPill: {
    marginLeft: 'auto',
    backgroundColor: Colors.danger,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pendingPillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
