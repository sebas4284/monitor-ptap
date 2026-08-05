import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { PlantProvider } from '../context/PlantContext';
import { ToastHost } from '../components/ToastHost';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // SIN sondeo por defecto, a propósito: cada consulta declara su propia cadencia y así un
      // `useQuery` nuevo no hereda tráfico en silencio. Antes el default de 30 s se aplicaba a
      // cualquiera que no lo sobrescribiera — y `['route-history']`, que es un historial de 20 h,
      // acabó sondeando cada 30 s sin que nadie lo hubiera decidido.
      refetchInterval: false,
      staleTime: 15_000,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PlantProvider>
          <Stack screenOptions={{ headerShown: false }} />
          {/* Pila de avisos no bloqueantes, montada UNA sola vez en la raíz para que también
              cubra las pantallas de (auth) — login y registro también dan feedback. */}
          <ToastHost />
        </PlantProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
