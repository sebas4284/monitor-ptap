import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthUser, Permission } from '@ptap/shared';
import { hasPermission as checkPermission } from '@ptap/shared';
import { setAuthToken, setOnUnauthorized } from '../services/api';
import { resetSocket } from '../services/socket';

const TOKEN_KEY = 'ptap_auth_token';
const USER_KEY = 'ptap_auth_user';

/**
 * Instante de expiración (ms epoch) del JWT, leyendo el `exp` del payload. NO verifica la firma
 * — eso es del backend en cada petición; aquí solo se lee el reloj de la sesión para que la app
 * cierre sola a la hora que el backend ya decidió (JWT_EXPIRES_IN, 8 h). null = sin exp legible;
 * en ese caso el cierre queda en manos del 401 del backend.
 */
function tokenExpiryMs(token: string): number | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

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

  // Restaura la sesión persistida y deja el cliente REST listo con ese token. Una sesión
  // VENCIDA (el token pasó sus 8 h) se descarta aquí mismo: recargar la página no la revive
  // y el usuario cae en el login, no en una app que fallará con 401 en cada petición.
  useEffect(() => {
    Promise.all([
      storage.getItem(TOKEN_KEY),
      storage.getItem(USER_KEY),
    ])
      .then(([storedToken, storedUser]) => {
        const exp = storedToken ? tokenExpiryMs(storedToken) : null;
        if (storedToken && exp !== null && exp <= Date.now()) {
          void storage.deleteItem(TOKEN_KEY);
          void storage.deleteItem(USER_KEY);
          return; // sin sesión: el guard de rutas manda al login
        }
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

  // Cierre AUTOMÁTICO al vencer el token (8 h): sin esto, una app abierta pero quieta (sin
  // peticiones) seguiría mostrando la sesión como viva más allá de su expiración. Al dispararse,
  // logout() deja token=null y el guard de (app)/_layout redirige al login solo.
  useEffect(() => {
    if (!token) return;
    const exp = tokenExpiryMs(token);
    if (exp === null) return; // sin exp legible: el 401 del backend hará el cierre
    const remaining = exp - Date.now();
    if (remaining <= 0) {
      void logout();
      return;
    }
    const timer = setTimeout(() => void logout(), remaining);
    return () => clearTimeout(timer);
  }, [token]);

  async function login(newToken: string, newUser: AuthUser) {
    await Promise.all([
      storage.setItem(TOKEN_KEY, newToken),
      storage.setItem(USER_KEY, JSON.stringify(newUser)),
    ]);
    setAuthToken(newToken);
    // Cierra cualquier socket previo para que el próximo se abra con ESTE token (no el de una
    // sesión anterior que hubiera quedado abierta).
    resetSocket();
    setToken(newToken);
    setUser(newUser);
  }

  async function logout() {
    await Promise.all([
      storage.deleteItem(TOKEN_KEY),
      storage.deleteItem(USER_KEY),
    ]);
    setAuthToken(null);
    // Corta el stream de datos del usuario que sale: sin esto el WS seguiría vivo y recibiendo
    // snapshots con el JWT ya sin sesión.
    resetSocket();
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
