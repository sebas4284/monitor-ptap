import type { AuthUser } from '@ptap/shared';
import { API_BASE_URL } from './api';

/**
 * Autenticación REAL contra el backend (Fase 4). Cero mocks: el usuario, su rol y la
 * contraseña viven en MySQL (Argon2id + pepper) y el backend devuelve un JWT firmado.
 * El rol NO se deduce del email — viene de la base de datos.
 *
 * IMPORTANTE: requiere el arranque COMPLETO del backend (`npm run dev:api` → main.ts).
 * El arranque de telemetría (`start:telemetry`) NO monta /api/auth/login ni los guards.
 */

/**
 * Un fallo de red (backend apagado, IP equivocada en app.json) NO es una credencial mala:
 * decirlo así manda a la gente a revisar su contraseña cuando el problema es otro.
 */
async function postAuth(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `No se pudo conectar con el servidor (${API_BASE_URL}). ¿Está corriendo el backend completo (npm run dev:api)?`,
    );
  }
}

export async function apiLogin(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await postAuth('/api/auth/login', { email, password });

  if (res.status === 401) throw new Error('Credenciales inválidas');
  if (res.status === 429) throw new Error('Demasiados intentos. Espera un momento e intenta de nuevo.');
  if (!res.ok) throw new Error(`No se pudo iniciar sesión (HTTP ${res.status})`);

  return (await res.json()) as { token: string; user: AuthUser };
}

/**
 * Auto-registro. La cuenta nace SIEMPRE con rol `civil` (solo lectura) — el rol lo fija el
 * servidor, aquí NO se manda: la matriz oficial reserva la asignación de roles al
 * Administrador, que después puede elevar al usuario desde la pantalla "Usuarios".
 * Devuelve token+user para entrar directo.
 */
export async function apiRegister(data: {
  name: string;
  email: string;
  phone: string;
  plant: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  // sin `role`: el backend lo rechazaría (schema .strict)
  const res = await postAuth('/api/auth/register', data);

  if (res.status === 409) throw new Error('Ese correo ya está registrado');
  if (res.status === 429) throw new Error('Demasiados intentos. Espera un momento e intenta de nuevo.');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(msg ?? `No se pudo crear la cuenta (HTTP ${res.status})`);
  }

  return (await res.json()) as { token: string; user: AuthUser };
}
