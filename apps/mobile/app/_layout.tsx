import '../global.css';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { PlantProvider } from '../context/PlantContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 30_000,
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
        </PlantProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
