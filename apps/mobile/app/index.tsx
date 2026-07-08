import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import Colors from '../constants/colors';

export default function Index() {
  const { token, user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!token) return <Redirect href="/(auth)/login" />;
  return <Redirect href={user?.role === 'civil' ? '/(app)/estado' : '/(app)/sensores'} />;
}
