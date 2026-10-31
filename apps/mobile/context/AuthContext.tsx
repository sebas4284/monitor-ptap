import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setLastDataSession } from '../services/last-snapshot-store';
import { AppState } from 'react-native';
import type { AuthUser, Permission } from '@ptap/shared';
import { hasPermission as checkPermission } from '@ptap/shared';
import { setAuthToken, setOnUnauthorized, invalidateAuthRequests } from '../services/api';
import { desregistrarPush } from '../services/push-registration';
import { resetSocket } from '../services/socket';
// Claves, almacenamiento y lectura del `exp` viven en `session-store` para que la tarea de segundo
// plano —que corre sin React— pueda leer la misma sesión. Ver ese módulo.
import {
  TOKEN_KEY,
  USER_KEY,
  storage,
  tokenExpiryMs,
  invalidateSessionRestoration,
  resumeSessionRestoration,
} from '../services/session-store';

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
  const queryClient = useQueryClient();
  const transition = useRef(0);
  const logoutTransition = useRef<number | null>(null);
  const sessionWrites = useRef(Promise.resolve());
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(async () => {
    if (logoutTransition.current === transition.current) return sessionWrites.current;
    const expected = ++transition.current;
    logoutTransition.current = expected;
    invalidateSessionRestoration();
    invalidateAuthRequests();
    // Revoke visible data synchronously, before slow device/network cleanup.
    const clearing = setLastDataSession(null);
    void queryClient.cancelQueries();
    queryClient.clear();
    resetSocket();
    setToken(null);
    setUser(null);
    setIsLoading(false);
    // Push unregister still needs the outgoing JWT. Subsequent login waits for this operation.
    const unregistering = desregistrarPush();
    sessionWrites.current = sessionWrites.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await unregistering;
          await Promise.all([
            storage.deleteItem(TOKEN_KEY),
            storage.deleteItem(USER_KEY),
            clearing,
          ]);
        } finally {
          if (transition.current === expected) setAuthToken(null);
        }
      });
    await sessionWrites.current;
  }, [queryClient]);

  // Restaura la sesión persistida y deja el cliente REST listo con ese token. Una sesión
  // VENCIDA (el token pasó sus 8 h) se descarta aquí mismo: recargar la página no la revive
  // y el usuario cae en el login, no en una app que fallará con 401 en cada petición.
  useEffect(() => {
    const expected = transition.current;
    let mounted = true;
    Promise.all([storage.getItem(TOKEN_KEY), storage.getItem(USER_KEY)])
      .then(async ([storedToken, storedUser]) => {
        if (!mounted || expected !== transition.current) return;
        const exp = storedToken ? tokenExpiryMs(storedToken) : null;
        if (!storedToken || !storedUser || exp === null || exp <= Date.now()) {
          await logout();
          return;
        }
        const restored = JSON.parse(storedUser) as AuthUser;
        await setLastDataSession(restored);
        if (!mounted || expected !== transition.current) return;
        resumeSessionRestoration();
        setAuthToken(storedToken);
        setToken(storedToken);
        setUser(restored);
      })
      .catch(() => {
        if (mounted && expected === transition.current) void logout();
      })
      .finally(() => {
        if (mounted && expected === transition.current) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [logout]);

  // Un 401 del backend (token vencido/revocado) limpia la sesión persistida.
  useEffect(() => {
    setOnUnauthorized(() => {
      void logout();
    });
    return () => setOnUnauthorized(null);
  }, [logout]);

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
  }, [token, logout]);

  // En nativo los timers de JS se estrangulan con la app en background: si el token vence estando
  // en segundo plano, el setTimeout de arriba puede no haber disparado. Al volver a primer plano se
  // re-evalúa la expiración para cerrar la sesión de inmediato (no esperar al 401 de la próxima
  // petición, que podría no ocurrir si todo se sirve de cache/push).
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const exp = tokenExpiryMs(token);
      if (exp !== null && exp <= Date.now()) void logout();
    });
    return () => sub.remove();
  }, [token, logout]);

  const login = useCallback(
    async (newToken: string, newUser: AuthUser) => {
      const expected = ++transition.current;
      invalidateSessionRestoration();
      invalidateAuthRequests();
      const clearing = setLastDataSession(null);
      void queryClient.cancelQueries();
      queryClient.clear();
      resetSocket();
      setToken(null);
      setUser(null);
      sessionWrites.current = sessionWrites.current
        .catch(() => undefined)
        .then(async () => {
          await clearing;
          if (expected !== transition.current) return;
          await Promise.all([
            storage.setItem(TOKEN_KEY, newToken),
            storage.setItem(USER_KEY, JSON.stringify(newUser)),
          ]);
          if (expected !== transition.current) return;
          await setLastDataSession(newUser);
          if (expected !== transition.current) return;
          resumeSessionRestoration();
          setAuthToken(newToken);
          setToken(newToken);
          setUser(newUser);
          setIsLoading(false);
        });
      await sessionWrites.current;
    },
    [queryClient],
  );

  const hasPermission = useCallback(
    (perm: Permission): boolean => (user ? checkPermission(user.role, perm) : false),
    [user],
  );

  // El valor del provider se memoiza: envuelve TODA la app, y con un objeto literal nuevo en cada
  // render cualquier cambio de estado aquí invalidaba a los ~10 consumidores de `useAuth()`,
  // incluida la cáscara de pestañas. Con `login`/`logout`/`hasPermission` estables, el valor solo
  // cambia cuando cambia de verdad la sesión.
  const value = useMemo(
    () => ({ token, user, isLoading, login, logout, hasPermission }),
    [token, user, isLoading, login, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
