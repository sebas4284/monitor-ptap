import { Stack, Redirect } from 'expo-router';
import { useAuth } from '../../context/AuthContext';

export default function AuthLayout() {
  const { token, user, isLoading } = useAuth();

  // Guard inverso al de (app): con una sesión VIVA, caer en /login o /register (historial del
  // navegador, enlace guardado) devuelve a la app — la sesión persiste hasta sus 8 h y solo el
  // logout (manual o por expiración) muestra el login de nuevo.
  if (!isLoading && token) {
    return <Redirect href={user?.role === 'civil' ? '/(app)/estado' : '/(app)/sensores'} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
