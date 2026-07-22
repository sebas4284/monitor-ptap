-- Verificación de correo (anti-bot). El flujo: registro → verificar correo → aprobación del admin.
-- `email_verified` es prerrequisito: un admin NO puede activar una cuenta sin correo verificado
-- (lo aplica users.service). Los usuarios YA existentes (sembrados/aprobados) se marcan verificados
-- para no bloquearlos con esta migración.
ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;
UPDATE users SET email_verified = 1;

-- Tokens de verificación de un solo uso. Se guarda el HASH SHA-256 del token (hex, 64 chars),
-- nunca el token en claro: una fuga de la BD no entrega enlaces válidos. Sin FK a users a
-- propósito (coherente con audit_log); la limpieza se hace por user_id al reenviar.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evt_token (token_hash),
  INDEX idx_evt_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
