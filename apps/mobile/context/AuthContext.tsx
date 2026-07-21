import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthUser, Permission } from '@ptap/shared';
import { hasPermission as checkPermission } from '@ptap/shared';
import { setAuthToken, setOnUnauthorized } from '../services/api';

const TOKEN_KEY = 'ptap_auth_token';
const USER_KEY = 'ptap_auth_user';

const storage = {
  getItem: (key: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(localStorage.getItem(key))
      : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(localStorage.setItem(key, value))
      : SecureStore.setItemAsync(key, value),
  deleteItem: (key: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(localStorage.removeItem(key))
      : SecureStore.deleteItemAsync(key),
};

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (perm: Permission) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restaura la sesión persistida y deja el cliente REST listo con ese token.
  useEffect(() => {
    Promise.all([
      storage.getItem(TOKEN_KEY),
      storage.getItem(USER_KEY),
    ])
      .then(([storedToken, storedUser]) => {
        setToken(storedToken ?? null);
        setAuthToken(storedToken ?? null); // el JWT restaurado viaja en las peticiones
        setUser(storedUser ? (JSON.parse(storedUser) as AuthUser) : null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Un 401 del backend (token vencido/revocado) limpia la sesión persistida.
  useEffect(() => {
    setOnUnauthorized(() => {
      void logout();
    });
    return () => setOnUnauthorized(null);
  }, []);

  async function login(newToken: string, newUser: AuthUser) {
    await Promise.all([
      storage.setItem(TOKEN_KEY, newToken),
      storage.setItem(USER_KEY, JSON.stringify(newUser)),
    ]);
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
  }

  async function logout() {
    await Promise.all([
      storage.deleteItem(TOKEN_KEY),
      storage.deleteItem(USER_KEY),
    ]);
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }

  function hasPermissionFn(perm: Permission): boolean {
    if (!user) return false;
    return checkPermission(user.role, perm);
  }

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, logout, hasPermission: hasPermissionFn }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
