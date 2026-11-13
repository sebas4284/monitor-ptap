import { getAuthGeneration, getAuthToken } from './api';
import { Platform } from 'react-native';

export interface NotificationSession {
  token: string;
  generation: number;
  scope: string;
  expiresAt: number;
}

/** Browser tabs share persisted login. A departed tab cannot keep using its old in-memory token. */
function persistedSessionMatches(token: string): boolean {
  if (Platform.OS !== 'web') return true;
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('ptap_auth_token') === token; }
  catch { return false; }
}

/** Local cache namespace only. Authorization still comes from the backend's current user row. */
export function notificationSession(): NotificationSession | null {
  const token = getAuthToken();
  if (!token || !persistedSessionMatches(token)) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub?: unknown; role?: unknown; plant?: unknown; exp?: unknown;
    };
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.role !== 'string' ||
        (payload.plant !== null && typeof payload.plant !== 'string') ||
        typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
    return {
      token, generation: getAuthGeneration(), expiresAt: payload.exp * 1000,
      scope: encodeURIComponent(JSON.stringify([payload.sub, payload.role, payload.plant])),
    };
  } catch {
    return null;
  }
}

export function isNotificationSession(session: NotificationSession): boolean {
  return session.token === getAuthToken() && session.generation === getAuthGeneration() && session.expiresAt > Date.now() && persistedSessionMatches(session.token);
}
