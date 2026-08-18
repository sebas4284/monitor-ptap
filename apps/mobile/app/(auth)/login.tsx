import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppUpdateBanner } from '../../components/AppUpdateBanner';
import { useAuth } from '../../context/AuthContext';
import { apiLogin } from '../../services/auth';
import { toast } from '../../services/toast-store';
import Colors from '../../constants/colors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      toast.error('Campos requeridos', 'Por favor completa todos los campos.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Correo inválido', 'Escribe un correo con formato válido.');
      return;
    }
    setIsLoading(true);
    try {
      const { token, user } = await apiLogin(email.trim(), password);
      await login(token, user);
      router.replace(user.role === 'civil' ? '/(app)/estado' : '/(app)/tablero');
    } catch (err) {
      // Mostrar el motivo REAL: un servidor caído o un rate-limit no son una contraseña mala.
      // Decir siempre "credenciales inválidas" manda a la gente a revisar lo que no falla.
      toast.error('Error de acceso', err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
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
            <Image
              source={require('../../assets/aquora-logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Aquora, creado por Xpertic"
            />
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
              maxLength={255}
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
              maxLength={200}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(v => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
            >
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

          {/* En WEB ofrece descargar la app (mismo gesto que "crear cuenta nueva"); en la APK avisa
              si la instalada se quedó atrás. El propio componente decide cuál aplica y si mostrarse
              — aquí no hace falta ramificar por plataforma. */}
          <AppUpdateBanner modo="descarga" />
          <AppUpdateBanner modo="actualizacion" />
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
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
  },
  hero: { alignItems: 'center', marginBottom: 20 },
  logo: {
    width: 152,
    aspectRatio: 545 / 459,
    marginBottom: 4,
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
    marginTop: 22,
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
