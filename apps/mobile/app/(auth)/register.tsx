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
 * Alta de cuenta. NO hay selector de rol a propósito: toda cuenta nueva nace como **Civil**
 * (solo lectura) y solo un Administrador puede elevarla (matriz oficial: "Asignar roles a
 * los usuarios" → solo Admin). El backend además rechaza cualquier `role` que llegue en el
 * body, así que esto no es solo cosmético.
 *
 * Registrarse tampoco da acceso: la cuenta queda pendiente hasta que un administrador la
 * apruebe. Por eso aquí no se inicia sesión — solo se confirma y se vuelve al login.
 *
 * `plant` guarda el SLUG canónico (voragine), no el nombre visible (La Vorágine): el plantId
 * es la única identidad del sistema.
 */
export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [plant, setPlant] = useState<string>(PLANTS[0].id); // slug, no displayName
  const [password, setPassword] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: un humano lo deja vacío
  const [showPassword, setShowPassword] = useState(false);
  const [showPlantPicker, setShowPlantPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const plantLabel = PLANTS.find((p) => p.id === plant)?.name ?? plant;

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      alertWeb('Campos requeridos', 'Nombre, correo y contraseña son obligatorios.');
      return;
    }
    setIsLoading(true);
    try {
      // No hay token: la cuenta queda pendiente de aprobación → de vuelta al login.
      const { message } = await apiRegister({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
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
              <Text style={styles.noticeStrong}>Civil</Text> (solo consulta) y, si necesitas más acceso,
              el administrador puede ampliarlo. Deja un teléfono donde puedan verificarte.
            </Text>
          </View>

          <Text style={styles.label}>Nombre completo</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Tu nombre" placeholderTextColor={Colors.textSecondary} />

          <Text style={styles.label}>Correo</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="tucorreo@ejemplo.com"
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Teléfono</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Para que el administrador pueda verificarte"
            placeholderTextColor={Colors.textSecondary}
            keyboardType="phone-pad"
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
              placeholder="Mín. 8, con mayúscula, minúscula y número"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.eye} onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            La contraseña debe tener al menos 8 caracteres, con una mayúscula, una minúscula y un número.
          </Text>

          {/* Honeypot anti-bot: fuera de pantalla para humanos, pero presente en el DOM web para
              que un bot que rellena todo lo llene y el backend lo rechace. No lleva label. */}
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
