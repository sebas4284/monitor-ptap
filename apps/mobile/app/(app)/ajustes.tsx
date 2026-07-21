import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '@ptap/shared';
import { useAuth } from '../../context/AuthContext';
import { API_BASE_URL } from '../../services/api';
import { ConnectionDiagnostics } from '../../components/ConnectionDiagnostics';
import Colors from '../../constants/colors';

/**
 * Ajustes / Configuración. Además de los datos de la cuenta, muestra la MATRIZ DE PERMISOS
 * real del rol activo, derivada de ROLE_PERMISSIONS de @ptap/shared — la misma fuente que
 * usa el backend para decidir 401/403. O sea: lo que se ve aquí es lo que de verdad se
 * puede hacer, no una lista decorativa.
 *
 * Nota: ocultar o mostrar cosas aquí es comodidad de UI. La seguridad la aplica el backend.
 */
export default function AjustesScreen() {
  const { user, token, logout, hasPermission } = useAuth();

  const roleColor = user ? ROLE_COLORS[user.role] : Colors.primary;
  const allowed = PERMISSIONS.filter((p) => (user ? hasPermission(p) : false));
  const denied = PERMISSIONS.filter((p) => !(user ? hasPermission(p) : false));

  async function handleLogout() {
    await logout();
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Cuenta ─────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Tu cuenta</Text>
        <View style={styles.card}>
          <View style={styles.accountHead}>
            <View style={[styles.avatar, { backgroundColor: roleColor }]}>
              <Ionicons name="person" size={26} color="#fff" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.name}>{user?.name ?? '—'}</Text>
              <Text style={styles.meta}>{user?.email ?? '—'}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Rol</Text>
            <View style={[styles.badge, { backgroundColor: roleColor + '22' }]}>
              <Text style={[styles.badgeText, { color: roleColor }]}>
                {user ? ROLE_LABELS[user.role] : '—'}
              </Text>
            </View>
          </View>
          <Text style={styles.roleDesc}>{user ? ROLE_DESCRIPTIONS[user.role] : ''}</Text>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Planta</Text>
            <Text style={styles.rowValue}>{user?.plant ?? '—'}</Text>
          </View>
        </View>

        <Text style={styles.hint}>
          Tu rol lo asigna un administrador; no se puede cambiar desde aquí.
        </Text>

        {/* ── Permisos ───────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Permisos de tu rol</Text>
        <View style={styles.card}>
          {allowed.length > 0 && (
            <>
              <Text style={styles.permHeader}>Puedes</Text>
              {allowed.map((p) => (
                <View key={p} style={styles.permRow}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={styles.permText}>{PERMISSION_LABELS[p]}</Text>
                </View>
              ))}
            </>
          )}

          {denied.length > 0 && (
            <>
              <Text style={[styles.permHeader, allowed.length > 0 && styles.permHeaderSpaced]}>
                No puedes
              </Text>
              {denied.map((p) => (
                <View key={p} style={styles.permRow}>
                  <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
                  <Text style={[styles.permText, styles.permDenied]}>{PERMISSION_LABELS[p]}</Text>
                </View>
              ))}
            </>
          )}
        </View>
        <Text style={styles.hint}>
          Estos permisos son los que aplica el servidor: si intentas una acción no permitida,
          la API la rechaza (403) aunque la pantalla la mostrara.
        </Text>

        {/* ── Administración (solo admin) ────────────────────────── */}
        {hasPermission('manage_users') && (
          <>
            <Text style={styles.sectionTitle}>Administración</Text>
            <TouchableOpacity
              style={[styles.card, styles.linkCard]}
              onPress={() => router.push('/(app)/usuarios')}
              activeOpacity={0.8}
            >
              <Ionicons name="people-outline" size={20} color={Colors.primary} />
              <View style={styles.flex}>
                <Text style={styles.linkTitle}>Usuarios</Text>
                <Text style={styles.linkDesc}>Ver cuentas y asignar roles</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </>
        )}

        {/* ── Diagnóstico de conexión (solo admin: `system_config`) ── */}
        {hasPermission('system_config') && (
          <>
            <Text style={styles.sectionTitle}>Estado de conexión con el PLC</Text>
            <ConnectionDiagnostics />
          </>
        )}

        {/* ── Sesión / conexión ──────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Sesión y conexión</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Sesión</Text>
            <Text style={styles.rowValue}>{token ? 'Activa' : 'Sin sesión'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Servidor</Text>
            <Text style={[styles.rowValue, styles.mono]} numberOfLines={1}>{API_BASE_URL}</Text>
          </View>
          <Text style={styles.roleDesc}>
            La sesión se guarda en este dispositivo y sigue activa al recargar. Caduca a las 8 horas.
          </Text>
        </View>

        <TouchableOpacity style={styles.logout} onPress={() => void handleLogout()} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: 16, paddingBottom: 32 },
  flex: { flex: 1 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  accountHead: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 4 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  meta: { fontSize: 12.5, color: Colors.textSecondary, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowValue: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, maxWidth: '65%' },
  mono: { fontSize: 11.5, fontWeight: '400' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  roleDesc: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 8, lineHeight: 16 },
  hint: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 8, lineHeight: 16, fontStyle: 'italic' },
  permHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  permHeaderSpaced: { marginTop: 16 },
  permRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 4 },
  permText: { flex: 1, fontSize: 13, color: Colors.textPrimary, lineHeight: 18 },
  permDenied: { color: Colors.textSecondary },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkTitle: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  linkDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  logout: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.danger + '55',
  },
  logoutText: { color: Colors.danger, fontSize: 14, fontWeight: '700' },
});
