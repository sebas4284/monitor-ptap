import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { apiRegister } from '../../services/auth';
import { PLANTS } from '../../context/PlantContext';
import Colors from '../../constants/colors';

function alertWeb(title: string, message: string, onDismiss?: () => void) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n${message}`);
    onDismiss?.();
  } else {
    Alert.alert(title, message, onDismiss ? [{ text: 'OK', onPress: onDismiss }] : undefined);
  }
}

/**
 * Medidor de seguridad de la contraseña (0..4) para feedback visual. Cuenta: longitud ≥8,
 * mayúscula+minúscula, dígito, símbolo (y sube un punto si es larga ≥12). Las MISMAS reglas
 * mínimas las exige el backend; esto solo orienta al usuario.
 */
function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: Colors.divider };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 12 && score >= 3) score = 4;
  score = Math.min(4, score);
  const label = score <= 1 ? 'Débil' : score === 2 ? 'Media' : score === 3 ? 'Buena' : 'Fuerte';
  const color = score <= 1 ? Colors.danger : score === 2 ? Colors.warning : Colors.success;
  return { score, label, color };
}

/**
 * Alta de cuenta. NO hay selector de rol a propósito: toda cuenta nueva nace como **Civil**
 * (solo lectura) y solo un Administrador puede elevarla. Registrarse tampoco da acceso: la
 * cuenta queda pendiente hasta que un administrador la apruebe.
 *
 * Doble campo de correo y de contraseña: sin verificación por correo/SMS, confirmar ambos en el
 * formulario es lo que atrapa los typos (la causa real de "me registré y no puedo entrar").
 * Normalización: correo → minúsculas; nombre → MAYÚSCULAS; celular → 10 dígitos.
 */
export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [plant, setPlant] = useState<string>(PLANTS[0].id); // slug, no displayName
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: un humano lo deja vacío
  const [showPassword, setShowPassword] = useState(false);
  const [showPlantPicker, setShowPlantPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const plantLabel = PLANTS.find((p) => p.id === plant)?.name ?? plant;
  const strength = passwordStrength(password);

  // Primer filtro en cliente (el backend es la validación autoritativa). Mismas reglas.
  function validate(): string | null {
    const n = name.trim();
    if (n.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
    if (!/^[\p{L}\p{M} .'’-]+$/u.test(n)) return 'El nombre solo puede contener letras, espacios y . \' -';

    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return 'El correo no tiene un formato válido.';
    if (em !== emailConfirm.trim()) return 'Los correos no coinciden.';

    if (!/^\d{10}$/.test(phone)) return 'El celular debe tener exactamente 10 dígitos.';

    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'La contraseña debe incluir mayúscula y minúscula.';
    if (!/\d/.test(password)) return 'La contraseña debe incluir al menos un número.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'La contraseña debe incluir al menos un símbolo.';
    if (password !== passwordConfirm) return 'Las contraseñas no coinciden.';
    return null;
  }

  async function handleRegister() {
    const error = validate();
    if (error) {
      alertWeb('Revisa los datos', error);
      return;
    }
    setIsLoading(true);
    try {
      // No hay token: la cuenta queda pendiente de aprobación → de vuelta al login.
      const { message } = await apiRegister({
        name: name.trim(), // ya en MAYÚSCULAS por el input
        email: email.trim(), // ya en minúsculas por el input
        phone, // 10 dígitos
        plant,
        password,
        website, // honeypot; vacío para humanos
      });
      alertWeb('Cuenta creada', message, () => router.replace('/(auth)/login'));
    } catch (err) {
      alertWeb('No se pudo crear la cuenta', err instanceof Error ? err.message : 'Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.title}>Crear cuenta</Text>
            <Text style={styles.subtitle}>Monitor PTAP</Text>
          </View>

          <View style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
            <Text style={styles.noticeText}>
              Tu cuenta queda <Text style={styles.noticeStrong}>pendiente de aprobación</Text>: un
              administrador la habilita antes de que puedas entrar. Se crea como{' '}
              <Text style={styles.noticeStrong}>Civil</Text> (solo consulta). Deja un celular real
              donde el administrador pueda verificarte.
            </Text>
          </View>

          <Text style={styles.label}>Nombre completo</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(t) => setName(t.toUpperCase())}
            placeholder="TU NOMBRE"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="characters"
            maxLength={120}
          />

          <Text style={styles.label}>Correo</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(t) => setEmail(t.toLowerCase())}
            placeholder="tucorreo@ejemplo.com"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={255}
          />

          <Text style={styles.label}>Confirmar correo</Text>
          <TextInput
            style={styles.input}
            value={emailConfirm}
            onChangeText={(t) => setEmailConfirm(t.toLowerCase())}
            placeholder="Escríbelo de nuevo"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={255}
          />
          {emailConfirm.length > 0 && email.trim() !== emailConfirm.trim() && (
            <Text style={styles.errorHint}>Los correos no coinciden.</Text>
          )}

          <Text style={styles.label}>Celular</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
            placeholder="10 dígitos (ej. 3001234567)"
            placeholderTextColor={Colors.textSecondary}
            keyboardType="number-pad"
            maxLength={10}
          />

          <Text style={styles.label}>Planta</Text>
          <TouchableOpacity style={styles.select} onPress={() => setShowPlantPicker((v) => !v)} activeOpacity={0.8}>
            <Text style={styles.inputText}>{plantLabel}</Text>
            <Ionicons name={showPlantPicker ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
          {showPlantPicker && (
            <View style={styles.picker}>
              {PLANTS.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setPlant(p.id); // guarda el slug canónico
                    setShowPlantPicker(false);
                  }}
                >
                  <Ionicons
                    name={p.id === plant ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={p.id === plant ? Colors.primary : Colors.textSecondary}
                  />
                  <Text style={styles.pickerText}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={password}
              onChangeText={setPassword}
              placeholder="Mín. 8: mayúscula, minúscula, número y símbolo"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
            />
            <TouchableOpacity style={styles.eye} onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {/* Medidor de seguridad */}
          {password.length > 0 && (
            <View style={styles.strengthWrap}>
              <View style={styles.strengthBar}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.strengthSeg,
                      { backgroundColor: i < strength.score ? strength.color : Colors.divider },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthText, { color: strength.color }]}>{strength.label}</Text>
            </View>
          )}

          <Text style={styles.label}>Confirmar contraseña</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
              placeholder="Escríbela de nuevo"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
            />
          </View>
          {passwordConfirm.length > 0 && password !== passwordConfirm && (
            <Text style={styles.errorHint}>Las contraseñas no coinciden.</Text>
          )}

          {/* Honeypot anti-bot: fuera de pantalla para humanos, presente en el DOM para cazar bots. */}
          <TextInput
            value={website}
            onChangeText={setWebsite}
            style={styles.honeypot}
            autoComplete="off"
            autoCorrect={false}
            autoCapitalize="none"
            importantForAccessibility="no-hide-descendants"
          />

          <TouchableOpacity
            style={[styles.btnPrimary, isLoading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Crear cuenta</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace('/(auth)/login')} activeOpacity={0.7}>
            <Text style={styles.linkText}>Ya tengo cuenta — Iniciar sesión</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  hero: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.primary, letterSpacing: 0.5 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  notice: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.primary + '12',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  noticeStrong: { fontWeight: '700', color: Colors.textPrimary },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputText: { fontSize: 15, color: Colors.textPrimary },
  select: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  picker: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 6,
    overflow: 'hidden',
  },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  pickerText: { fontSize: 14, color: Colors.textPrimary },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 44 },
  eye: { position: 'absolute', right: 12 },
  hint: { fontSize: 11.5, color: Colors.textSecondary, marginTop: 6, lineHeight: 16 },
  errorHint: { fontSize: 11.5, color: Colors.danger, marginTop: 6 },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  strengthBar: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthSeg: { flex: 1, height: 5, borderRadius: 3 },
  strengthText: { fontSize: 11.5, fontWeight: '700', minWidth: 44, textAlign: 'right' },
  // Honeypot: fuera de la vista (no display:none, que algunos bots ignoran).
  honeypot: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -9999, top: -9999 },
  btnPrimary: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  linkBtn: { alignItems: 'center', marginTop: 16 },
  linkText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
});
