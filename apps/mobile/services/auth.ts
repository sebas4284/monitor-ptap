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
  // 403 = la contraseña ERA correcta, pero la cuenta está pendiente de aprobación o
  // desactivada. El backend explica cuál: mostrar su mensaje evita mandar a alguien a
  // reintentar una contraseña que ya es buena.
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Tu cuenta aún no está habilitada.');
  }
  if (res.status === 429) throw new Error('Demasiados intentos. Espera un momento e intenta de nuevo.');
  if (!res.ok) throw new Error(`No se pudo iniciar sesión (HTTP ${res.status})`);

  return (await res.json()) as { token: string; user: AuthUser };
}

/** Respuesta del auto-registro: la cuenta queda pendiente, NO hay sesión. */
export interface RegisterResult {
  status: 'pending_approval';
  email: string;
  message: string;
}

/**
 * Auto-registro. La cuenta nace con rol `civil` (solo lectura) y **pendiente de aprobación**:
 * ambas cosas las fija el servidor, aquí no se mandan. No hay token — el usuario no entra
 * hasta que un Administrador habilite la cuenta desde la pantalla "Usuarios", que es también
 * donde puede elevarle el rol.
 */
export async function apiRegister(data: {
  name: string;
  email: string;
  phone: string;
  plant: string;
  password: string;
  /** Honeypot anti-bot: un humano lo deja vacío; el backend rechaza si llega con contenido. */
  website?: string;
}): Promise<RegisterResult> {
  // sin `role`: el backend lo rechazaría (schema .strict). El teléfono vacío se OMITE (el backend
  // valida formato cuando viene); enviar '' fallaría la validación.
  const { phone, website, ...rest } = data;
  const payload: Record<string, string> = { ...rest };
  if (phone.trim()) payload.phone = phone.trim();
  if (website) payload.website = website; // solo viaja si un bot lo llenó (para que el backend lo cace)
  const res = await postAuth('/api/auth/register', payload);

  if (res.status === 409) throw new Error('Ese correo ya está registrado');
  if (res.status === 429) throw new Error('Demasiados intentos. Espera un momento e intenta de nuevo.');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(msg ?? `No se pudo crear la cuenta (HTTP ${res.status})`);
  }

  return (await res.json()) as RegisterResult;
}
