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
  TextInputProps,
} from 'react-native';

function alertWeb(title: string, message: string, onDismiss?: () => void) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n${message}`);
    onDismiss?.();
  } else {
    Alert.alert(title, message, onDismiss ? [{ text: 'OK', onPress: onDismiss }] : undefined);
  }
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { apiRegister } from '../../services/api';
import { PLANTS, type Plant } from '../../context/PlantContext';
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from '@ptap/shared';
import Colors from '../../constants/colors';

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [plant, setPlant] = useState<Plant>(PLANTS[0]);
  const [role, setRole] = useState<Role>('operador');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPlantPicker, setShowPlantPicker] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      alertWeb('Campos requeridos', 'Por favor completa todos los campos.');
      return;
    }
    setIsLoading(true);
    try {
      await apiRegister({ name, email, phone, plant, role, password });
      alertWeb(
        '¡Cuenta creada!',
        'Tu cuenta fue registrada. Ahora puedes iniciar sesión.',
        () => router.replace('/(auth)/login'),
      );
    } catch {
      alertWeb('Error', 'No se pudo crear la cuenta. Intenta de nuevo.');
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
          {/* Back */}
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={Colors.primary} />
          </TouchableOpacity>

          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.iconWrap}>
              <Ionicons name="person-add" size={40} color="#fff" />
            </View>
            <Text style={styles.title}>Crear cuenta</Text>
            <Text style={styles.subtitle}>Regístrate como operador PTAP</Text>
          </View>

          <Field
            label="Nombre completo"
            icon="person-outline"
            value={name}
            onChangeText={setName}
            placeholder="Juan Pérez"
            autoCapitalize="words"
          />
          <Field
            label="Correo electrónico"
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="operador@acueducto.co"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Field
            label="Teléfono"
            icon="call-outline"
            value={phone}
            onChangeText={setPhone}
            placeholder="+57 300 000 0000"
            keyboardType="phone-pad"
          />

          {/* Plant picker */}
          <Text style={styles.label}>Planta asignada</Text>
          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => { setShowPlantPicker(v => !v); setShowRolePicker(false); }}
            activeOpacity={0.8}
          >
            <Ionicons name="business-outline" size={20} color={Colors.textSecondary} />
            <Text style={[styles.inputText, { flex: 1 }]}>{plant}</Text>
            <Ionicons
              name={showPlantPicker ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
          {showPlantPicker && (
            <View style={styles.pickerDropdown}>
              {PLANTS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={styles.pickerOption}
                  onPress={() => { setPlant(p); setShowPlantPicker(false); }}
                >
                  <Ionicons
                    name={p === plant ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={Colors.primary}
                  />
                  <Text style={styles.pickerOptionText}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Role picker */}
          <Text style={styles.label}>Rol de usuario</Text>
          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => { setShowRolePicker(v => !v); setShowPlantPicker(false); }}
            activeOpacity={0.8}
          >
            <Ionicons name="shield-outline" size={20} color={Colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.inputText}>{ROLE_LABELS[role]}</Text>
            </View>
            <Ionicons
              name={showRolePicker ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
          {showRolePicker && (
            <View style={styles.pickerDropdown}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  style={styles.pickerOption}
                  onPress={() => { setRole(r); setShowRolePicker(false); }}
                >
                  <Ionicons
                    name={r === role ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={Colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerOptionText}>{ROLE_LABELS[r]}</Text>
                    <Text style={styles.pickerOptionDesc}>{ROLE_DESCRIPTIONS[r]}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Password */}
          <Text style={[styles.label, { marginTop: 14 }]}>Contraseña</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={20} color={Colors.textSecondary} />
            <TextInput
              style={[styles.inputText, styles.flex]}
              placeholder="Mínimo 6 caracteres"
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

          <TouchableOpacity
            style={[styles.btnPrimary, isLoading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnPrimaryText}>Crear cuenta</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  icon: string;
}

function Field({ label, icon, ...inputProps }: FieldProps) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <Ionicons name={icon as any} size={20} color={Colors.textSecondary} />
        <TextInput
          style={[styles.inputText, styles.flex]}
          placeholderTextColor={Colors.textSecondary}
          {...inputProps}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 24 },
  back: { marginBottom: 20 },
  hero: { alignItems: 'center', marginBottom: 28 },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 7,
  },
  title: { fontSize: 26, fontWeight: '800', color: Colors.primary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 5 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 8,
    marginTop: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  inputText: {
    fontSize: 15,
    color: Colors.textPrimary,
  },
  pickerDropdown: {
    marginTop: 4,
    backgroundColor: Colors.bg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pickerOptionText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  pickerOptionDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
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
});
