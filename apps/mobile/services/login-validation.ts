/** Errores de validación del login, uno por campo. Un campo sin error no aparece. */
export interface LoginFieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validación local antes de llamar al backend. Los mensajes se muestran JUNTO al campo; el toast
 * queda solo para lo que responde el servidor o la red.
 */
export function validateLogin(email: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const e = email.trim();
  if (!e) errors.email = 'Escribe tu correo.';
  else if (!EMAIL_RE.test(e)) errors.email = 'Escribe un correo válido, como nombre@empresa.co.';
  if (!password.trim()) errors.password = 'Escribe tu contraseña.';
  return errors;
}
