import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ROLES, ROLE_LABELS, ROLE_COLORS, ROLE_DESCRIPTIONS, type Role, type UserSummary } from '@ptap/shared';
import { fetchUsers, setUserActive, updateUserRole } from '../../services/users';
import { useAuth } from '../../context/AuthContext';
import Colors from '../../constants/colors';

function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Gestión de usuarios — SOLO Administrador (matriz oficial: "Crear, editar y eliminar
 * usuarios" y "Asignar roles a los usuarios"). El backend es quien manda: exige los permisos
 * `manage_users`/`assign_roles` y responde 403 a cualquier otro rol. Ocultar esta pantalla
 * es comodidad de UI, NO la seguridad.
 *
 * Aquí es donde "alguien confirma" el rol: los usuarios se registran solos como Civil y un
 * admin los eleva desde esta lista. Cada cambio queda en el audit log.
 */
export default function UsuariosScreen() {
  const { user: current, hasPermission } = useAuth();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setUsers(await fetchUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!hasPermission('manage_users')) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.deniedTitle}>Acceso restringido</Text>
          <Text style={styles.deniedBody}>La gestión de usuarios es exclusiva del Administrador.</Text>
        </View>
      </SafeAreaView>
    );
  }

  async function changeRole(target: UserSummary, role: Role) {
    setExpandedId(null);
    if (target.role === role) return;
    setBusyId(target.id);
    try {
      const updated = await updateUserRole(target.id, role);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      notify('No se pudo cambiar el rol', err instanceof Error ? err.message : 'Intenta de nuevo.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(target: UserSummary) {
    setBusyId(target.id);
    try {
      const updated = await setUserActive(target.id, !target.isActive);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      notify('No se pudo cambiar el estado', err instanceof Error ? err.message : 'Intenta de nuevo.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
        ListHeaderComponent={
          <Text style={styles.intro}>
            Las cuentas nuevas se registran como <Text style={styles.bold}>Civil</Text> (solo consulta).
            Asigna aquí el rol que corresponda tras verificar a la persona. Cada cambio queda auditado.
          </Text>
        }
        renderItem={({ item }) => {
          const isSelf = item.id === current?.id;
          const busy = busyId === item.id;
          return (
            <View style={[styles.card, !item.isActive && styles.cardInactive]}>
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={styles.name}>
                    {item.name} {isSelf && <Text style={styles.selfTag}>(tú)</Text>}
                  </Text>
                  <Text style={styles.meta}>{item.email}</Text>
                  {item.phone && <Text style={styles.meta}>{item.phone}</Text>}
                  <Text style={styles.meta}>Planta: {item.plant}</Text>
                </View>
                <View style={[styles.roleBadge, { backgroundColor: ROLE_COLORS[item.role] + '22' }]}>
                  <Text style={[styles.roleBadgeText, { color: ROLE_COLORS[item.role] }]}>
                    {ROLE_LABELS[item.role]}
                  </Text>
                </View>
              </View>

              {!item.isActive && <Text style={styles.inactiveTag}>Cuenta desactivada — no puede iniciar sesión</Text>}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.action, (busy || isSelf) && styles.actionDisabled]}
                  disabled={busy || isSelf}
                  onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color={Colors.primary} />
                  <Text style={styles.actionText}>Cambiar rol</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.action, (busy || isSelf) && styles.actionDisabled]}
                  disabled={busy || isSelf}
                  onPress={() => void toggleActive(item)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={item.isActive ? 'person-remove-outline' : 'person-add-outline'}
                    size={16}
                    color={item.isActive ? Colors.danger : Colors.primary}
                  />
                  <Text style={[styles.actionText, item.isActive && { color: Colors.danger }]}>
                    {item.isActive ? 'Desactivar' : 'Activar'}
                  </Text>
                </TouchableOpacity>

                {busy && <ActivityIndicator size="small" color={Colors.primary} />}
              </View>

              {isSelf && (
                <Text style={styles.selfHint}>
                  No puedes cambiar tu propio rol ni desactivarte (evita perder el acceso de administrador).
                </Text>
              )}

              {expandedId === item.id && (
                <View style={styles.rolePicker}>
                  {ROLES.map((r) => (
                    <TouchableOpacity key={r} style={styles.roleOption} onPress={() => void changeRole(item, r)}>
                      <Ionicons
                        name={r === item.role ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={r === item.role ? Colors.primary : Colors.textSecondary}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.roleOptionText}>{ROLE_LABELS[r]}</Text>
                        <Text style={styles.roleOptionDesc}>{ROLE_DESCRIPTIONS[r]}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  deniedTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  deniedBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  list: { padding: 16, gap: 12 },
  intro: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, marginBottom: 4 },
  bold: { fontWeight: '700', color: Colors.textPrimary },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: Colors.danger + '15', padding: 12, margin: 16, borderRadius: 10,
  },
  errorText: { flex: 1, color: Colors.danger, fontSize: 13 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  cardInactive: { opacity: 0.65 },
  cardHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  name: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  selfTag: { fontSize: 12, fontWeight: '400', color: Colors.textSecondary },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  roleBadgeText: { fontSize: 11, fontWeight: '700' },
  inactiveTag: { fontSize: 11.5, color: Colors.danger, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 16, alignItems: 'center', marginTop: 12 },
  action: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  actionDisabled: { opacity: 0.35 },
  actionText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  selfHint: { fontSize: 11, color: Colors.textSecondary, marginTop: 8, fontStyle: 'italic' },
  rolePicker: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 8, gap: 2 },
  roleOption: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8 },
  roleOptionText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  roleOptionDesc: { fontSize: 11.5, color: Colors.textSecondary },
});
