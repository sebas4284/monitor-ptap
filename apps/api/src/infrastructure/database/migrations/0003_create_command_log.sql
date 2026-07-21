-- Fase 5: traza y idempotencia de comandos de escritura al PLC.
-- Es registro OPERATIVO/auditoría (regla 1 lo permite; NUNCA telemetría). idempotency_key
-- es UNIQUE: una fila 'pending' se reserva ANTES de escribir (insert-pending-first), así un
-- reintento con la misma clave no vuelve a accionar el equipo aunque el proceso se reinicie.
-- MySQL permite múltiples NULL en un índice UNIQUE, así que comandos sin clave no colisionan.
CREATE TABLE IF NOT EXISTS command_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  idempotency_key VARCHAR(120) NULL,
  plant_id VARCHAR(64) NOT NULL,
  target VARCHAR(64) NOT NULL,
  command VARCHAR(64) NOT NULL,
  user_id CHAR(36) NULL,
  user_email VARCHAR(255) NULL,
  role VARCHAR(16) NULL,
  ip VARCHAR(45) NULL,
  previous_value VARCHAR(64) NULL,
  written_value VARCHAR(64) NULL,
  confirmed_value VARCHAR(64) NULL,
  interlock_sequence INT NULL,
  status VARCHAR(32) NOT NULL,           -- pending | confirmed | failed | rejected
  reason VARCHAR(255) NULL,
  UNIQUE KEY uq_command_idempotency (idempotency_key),
  INDEX idx_command_plant (plant_id),
  INDEX idx_command_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
