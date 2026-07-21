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

function alertWeb(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { apiLogin } from '../../services/auth';
import Colors from '../../constants/colors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      alertWeb('Campos requeridos', 'Por favor completa todos los campos.');
      return;
    }
    setIsLoading(true);
    try {
      const { token, user } = await apiLogin(email.trim(), password);
      await login(token, user);
      router.replace(user.role === 'civil' ? '/(app)/estado' : '/(app)/sensores');
    } catch (err) {
      // Mostrar el motivo REAL: un servidor caído o un rate-limit no son una contraseña mala.
      // Decir siempre "credenciales inválidas" manda a la gente a revisar lo que no falla.
      alertWeb('Error de acceso', err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.shieldWrap}>
              <Ionicons name="shield-checkmark" size={42} color="#fff" />
            </View>
            <Text style={styles.title}>Monitor PTAP</Text>
            <Text style={styles.subtitle}>Ingresa a tu cuenta de operador</Text>
          </View>

          {/* Email */}
          <Text style={styles.label}>Correo electrónico</Text>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={20} color={Colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="operador@acueducto.co"
              placeholderTextColor={Colors.textSecondary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Password */}
          <Text style={[styles.label, { marginTop: 14 }]}>Contraseña</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={20} color={Colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={Colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={8}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Primary button */}
          <TouchableOpacity
            style={[styles.btnPrimary, isLoading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnPrimaryText}>Ingresar</Text>
            }
          </TouchableOpacity>

          {/* El alta crea SIEMPRE una cuenta Civil (solo consulta); elevar el rol es
              potestad de un administrador. Ver app/(auth)/register.tsx. */}
          <TouchableOpacity
            style={styles.btnOutline}
            onPress={() => router.push('/(auth)/register')}
            activeOpacity={0.8}
          >
            <Text style={styles.btnOutlineText}>Crear cuenta nueva</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>Las cuentas nuevas se crean como Civil (solo consulta).</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  hero: { alignItems: 'center', marginBottom: 36 },
  shieldWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 6,
  },
  hint: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  btnPrimary: {
    marginTop: 28,
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnOutline: {
    marginTop: 12,
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlineText: { color: Colors.primary, fontSize: 16, fontWeight: '700' },
});
