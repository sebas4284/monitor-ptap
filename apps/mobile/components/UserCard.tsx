import { memo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ROLES, ROLE_LABELS, ROLE_COLORS, ROLE_DESCRIPTIONS, type Role, type UserSummary } from '@ptap/shared';
import Colors from '../constants/colors';

/**
 * Ficha de usuario de la pantalla de administración.
 *
 * Extraída del `renderItem` de `usuarios.tsx`, donde era un closure inline de ~126 líneas que se
 * recreaba en cada render de la pantalla — así que la `FlatList` no podía reciclar nada y cada
 * pulsación de tecla en el buscador repintaba las 50 fichas. Ahora es un componente memoizado con
 * callbacks estables que reciben el usuario.
 */
interface Props {
  user: UserSummary;
  /** true si la ficha es la del propio administrador que está mirando. */
  isSelf: boolean;
  /** Hay una operación en vuelo sobre este usuario. */
  busy: boolean;
  /** true si el selector de rol está desplegado para este usuario. */
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onToggleActive: (user: UserSummary) => void | Promise<void>;
  onChangeRole: (user: UserSummary, role: Role) => void | Promise<void>;
}

function UserCardBase({
  user,
  isSelf,
  busy,
  expanded,
  onToggleExpand,
  onToggleActive,
  onChangeRole,
}: Props) {
  // Otro administrador: los admins son mutuamente intocables (el backend lo rechaza).
  const isOtherAdmin = user.role === 'admin' && !isSelf;
  const locked = isSelf || isOtherAdmin; // acciones deshabilitadas
  // Aprobar-primero: no se puede cambiar el rol hasta que la cuenta esté aprobada/activa
  // (evita crear un "admin pendiente" que luego no se puede aprobar ni degradar).
  const roleLocked = locked || !user.isActive;
  // Nunca inició sesión y está inactiva = recién registrada, esperando aprobación. Si ya entró
  // alguna vez, un admin la desactivó: son dos situaciones distintas y el botón que corresponde
  // ("Aprobar" vs "Reactivar") también.
  const isPending = !user.isActive && user.lastLoginAt === null;

  return (
    <View style={[styles.card, !user.isActive && styles.cardInactive, isPending && styles.cardPending]}>
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <Text style={styles.name}>
            {user.name} {isSelf && <Text style={styles.selfTag}>(tú)</Text>}
          </Text>
          <Text style={styles.meta}>{user.email}</Text>
          {user.phone && <Text style={styles.meta}>{user.phone}</Text>}
          <Text style={styles.meta}>Planta: {user.plant}</Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: ROLE_COLORS[user.role] + '22' }]}>
          <Text style={[styles.roleBadgeText, { color: ROLE_COLORS[user.role] }]}>
            {ROLE_LABELS[user.role]}
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

      {/* Estado del correo (informativo). La activación NO exige correo verificado salvo que se
          active REQUIRE_EMAIL_VERIFICATION en el backend (hoy off, sin canal de envío). */}
      <View style={styles.verifyTag}>
        <Ionicons
          name={user.emailVerified ? 'mail-open-outline' : 'mail-unread-outline'}
          size={13}
          color={user.emailVerified ? Colors.success : Colors.textSecondary}
        />
        <Text style={[styles.verifyTagText, { color: user.emailVerified ? Colors.success : Colors.textSecondary }]}>
          {user.emailVerified ? 'Correo verificado' : 'Correo sin verificar'}
        </Text>
      </View>

      {!user.isActive && !isPending && (
        <Text style={styles.inactiveTag}>Cuenta desactivada — no puede iniciar sesión</Text>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.action, (busy || roleLocked) && styles.actionDisabled]}
          disabled={busy || roleLocked}
          onPress={() => onToggleExpand(user.id)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || roleLocked, expanded }}
          accessibilityLabel={`Cambiar el rol de ${user.name}`}
        >
          <Ionicons name="swap-horizontal-outline" size={16} color={Colors.primary} />
          <Text style={styles.actionText}>Cambiar rol</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.action, (busy || locked) && styles.actionDisabled]}
          disabled={busy || locked}
          onPress={() => void onToggleActive(user)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || locked }}
          accessibilityLabel={`${user.isActive ? 'Desactivar' : isPending ? 'Aprobar' : 'Reactivar'} la cuenta de ${user.name}`}
        >
          <Ionicons
            name={
              user.isActive
                ? 'person-remove-outline'
                : isPending
                  ? 'checkmark-circle-outline'
                  : 'person-add-outline'
            }
            size={16}
            color={user.isActive ? Colors.danger : Colors.primary}
          />
          <Text style={[styles.actionText, user.isActive && { color: Colors.danger }]}>
            {user.isActive ? 'Desactivar' : isPending ? 'Aprobar' : 'Reactivar'}
          </Text>
        </TouchableOpacity>

        {busy && <ActivityIndicator size="small" color={Colors.primary} />}
      </View>

      {isSelf && (
        <Text style={styles.selfHint}>
          No puedes cambiar tu propio rol ni desactivarte (evita perder el acceso de administrador).
        </Text>
      )}
      {isOtherAdmin && (
        <Text style={styles.selfHint}>
          No puedes modificar a otro administrador. La gestión de administradores se hace fuera de la app.
        </Text>
      )}
      {!user.isActive && !locked && (
        <Text style={styles.selfHint}>Aprueba la cuenta primero; luego podrás asignarle un rol.</Text>
      )}

      {expanded && (
        <View style={styles.rolePicker}>
          {ROLES.map((r) => (
            <TouchableOpacity
              key={r}
              style={styles.roleOption}
              onPress={() => void onChangeRole(user, r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: r === user.role }}
              accessibilityLabel={`${ROLE_LABELS[r]}. ${ROLE_DESCRIPTIONS[r]}`}
            >
              <Ionicons
                name={r === user.role ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={r === user.role ? Colors.primary : Colors.textSecondary}
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
}

export const UserCard = memo(UserCardBase);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  cardInactive: { opacity: 0.75 },
  cardPending: { borderColor: Colors.warning, borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  flex: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  selfTag: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  roleBadgeText: { fontSize: 11, fontWeight: '700' },
  pendingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: Colors.warning + '12',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pendingTagText: { flex: 1, fontSize: 11.5, color: Colors.warning, fontWeight: '600' },
  verifyTag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  verifyTagText: { fontSize: 11, fontWeight: '600' },
  inactiveTag: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 8, fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 12.5, fontWeight: '700', color: Colors.primary },
  selfHint: { fontSize: 11, color: Colors.textSecondary, marginTop: 8, fontStyle: 'italic' },
  rolePicker: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 10,
    gap: 4,
  },
  roleOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 7 },
  roleOptionText: { fontSize: 13.5, fontWeight: '700', color: Colors.textPrimary },
  roleOptionDesc: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 1 },
});
