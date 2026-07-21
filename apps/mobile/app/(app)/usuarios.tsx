import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
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

/** Filtro por estado. `pendientes` (is_active=0) es la bandeja de entrada del admin. */
type StatusFilter = 'todos' | 'pendientes' | 'activos';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'pendientes', label: 'Pendientes' },
  { key: 'activos', label: 'Activos' },
  { key: 'todos', label: 'Todos' },
];

function isActiveOf(status: StatusFilter): boolean | undefined {
  if (status === 'pendientes') return false;
  if (status === 'activos') return true;
  return undefined;
}

/**
 * Gestión de usuarios — SOLO Administrador (matriz oficial: "Crear, editar y eliminar
 * usuarios" y "Asignar roles a los usuarios"). El backend es quien manda: exige los permisos
 * `manage_users`/`assign_roles` y responde 403 a cualquier otro rol. Ocultar esta pantalla
 * es comodidad de UI, NO la seguridad.
 *
 * Aquí es donde "alguien confirma" el rol: los usuarios se registran solos y quedan pendientes
 * hasta que un admin los aprueba (y, si corresponde, los eleva). Cada cambio queda auditado.
 *
 * La búsqueda y los filtros se resuelven en el servidor: la pantalla arranca en "Pendientes"
 * porque son las cuentas que esperan una decisión.
 */
export default function UsuariosScreen() {
  const { user: current, hasPermission } = useAuth();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('pendientes');
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);

  const load = useCallback(
    async (term: string, statusFilter: StatusFilter, role: Role | null) => {
      try {
        setError(null);
        setUsers(await fetchUsers({ search: term, role: role ?? undefined, isActive: isActiveOf(statusFilter) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounce: cada tecla es una consulta a la BD; 300 ms basta para que se sienta inmediato
  // sin disparar una petición por letra.
  useEffect(() => {
    const id = setTimeout(() => void load(search, status, roleFilter), 300);
    return () => clearTimeout(id);
  }, [load, search, status, roleFilter]);

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
      await setUserActive(target.id, !target.isActive);
      // Recargar, no parchear en memoria: al aprobar a alguien desde "Pendientes" la cuenta
      // deja de cumplir el filtro y debe desaparecer de la lista. Parchearla la dejaría ahí,
      // contradiciendo el filtro activo.
      await load(search, status, roleFilter);
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
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load(search, status, roleFilter)} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {status === 'pendientes' && !search && !roleFilter
              ? 'No hay cuentas pendientes de aprobación.'
              : 'Ningún usuario coincide con la búsqueda.'}
          </Text>
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.intro}>
              Las cuentas nuevas se registran como <Text style={styles.bold}>Civil</Text> y quedan{' '}
              <Text style={styles.bold}>pendientes</Text>: nadie entra hasta que las apruebes. Verifica a la
              persona (el teléfono aparece en la ficha), apruébala y asígnale el rol. Todo queda auditado.
            </Text>

            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={17} color={Colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar por nombre, correo o teléfono"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={17} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.chips}>
              {STATUS_TABS.map((tab) => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.chip, status === tab.key && styles.chipOn]}
                  onPress={() => setStatus(tab.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, status === tab.key && styles.chipTextOn]}>{tab.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.chips}>
              <TouchableOpacity
                style={[styles.chip, roleFilter === null && styles.chipOn]}
                onPress={() => setRoleFilter(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, roleFilter === null && styles.chipTextOn]}>Todo rol</Text>
              </TouchableOpacity>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, roleFilter === r && styles.chipOn]}
                  onPress={() => setRoleFilter(roleFilter === r ? null : r)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, roleFilter === r && styles.chipTextOn]}>{ROLE_LABELS[r]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const isSelf = item.id === current?.id;
          const busy = busyId === item.id;
          // Nunca inició sesión y está inactiva = recién registrada, esperando aprobación. Si ya
          // entró alguna vez, un admin la desactivó: son dos situaciones distintas y el botón
          // que corresponde ("Aprobar" vs "Reactivar") también.
          const isPending = !item.isActive && item.lastLoginAt === null;
          return (
            <View style={[styles.card, !item.isActive && styles.cardInactive, isPending && styles.cardPending]}>
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

              {isPending && (
                <View style={styles.pendingTag}>
                  <Ionicons name="time-outline" size={14} color={Colors.warning} />
                  <Text style={styles.pendingTagText}>
                    Pendiente de aprobación — verifica a la persona antes de habilitarla
                  </Text>
                </View>
              )}
              {!item.isActive && !isPending && (
                <Text style={styles.inactiveTag}>Cuenta desactivada — no puede iniciar sesión</Text>
              )}

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
                    name={
                      item.isActive
                        ? 'person-remove-outline'
                        : isPending
                          ? 'checkmark-circle-outline'
                          : 'person-add-outline'
                    }
                    size={16}
                    color={item.isActive ? Colors.danger : Colors.primary}
                  />
                  <Text style={[styles.actionText, item.isActive && { color: Colors.danger }]}>
                    {item.isActive ? 'Desactivar' : isPending ? 'Aprobar' : 'Reactivar'}
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
  header: { gap: 10, marginBottom: 4 },
  intro: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  bold: { fontWeight: '700', color: Colors.textPrimary },
  empty: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', paddingVertical: 28 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary, outlineStyle: 'none' as never },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: Colors.surface,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: Colors.textSecondary },
  chipTextOn: { color: '#fff' },
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
  // Pendiente ≠ desactivada: pide una acción, así que no se atenúa y se marca en ámbar.
  cardPending: { opacity: 1, borderColor: Colors.warning, backgroundColor: Colors.warning + '0C' },
  pendingTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  pendingTagText: { flex: 1, fontSize: 11.5, color: Colors.warning, fontWeight: '600' },
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
