CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  event_type VARCHAR(64) NOT NULL,
  user_id CHAR(36) NULL,
  user_email VARCHAR(255) NULL,
  role VARCHAR(16) NULL,
  ip VARCHAR(45) NULL,
  method VARCHAR(10) NULL,
  path VARCHAR(255) NULL,
  status_code SMALLINT NULL,
  detail JSON NULL,
  INDEX idx_audit_at (at),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_event (event_type)
  -- Sin FK a users a propósito: una fila de auditoría debe sobrevivir al borrado del usuario
  -- que la generó. user_email/role son snapshots denormalizados al momento del evento.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
