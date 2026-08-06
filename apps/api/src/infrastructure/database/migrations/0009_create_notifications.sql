-- Bandeja de notificaciones persistente.
--
-- Por qué en MySQL y no en RAM como la telemetría: estas filas NO son telemetría (regla 1). Son
-- avisos operativos que deben sobrevivir a un reinicio del backend, conservar un historial de al
-- menos 24 h, y recordar QUIÉN los vio. Nada de eso se puede hacer derivándolos del snapshot en el
-- cliente, que es como funcionaban las alertas hasta ahora (memoria de sesión, se perdían al
-- recargar y no había forma de saber si alguien las había leído).
--
-- Regla de producto: el usuario NO puede borrar un aviso, solo marcarlo como visto. Por eso no hay
-- columna de borrado ni endpoint de DELETE — el historial es evidencia.

CREATE TABLE IF NOT EXISTS notification (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Clave de deduplicación: impide que el mismo problema genere un aviso por cada ciclo del
  -- detector. Incluye el día, de modo que un problema que persiste vuelve a avisar UNA vez al día
  -- (requisito operativo: "avisar al menos 1 vez al día hasta que se arregle").
  -- Formato: '<kind>:<plantId>[:<subject>]:<YYYY-MM-DD>'
  dedupe_key    VARCHAR(191) NOT NULL,

  kind          VARCHAR(32)  NOT NULL,  -- 'sensor_stale' | 'signal_out_of_range' | ...
  severity      VARCHAR(16)  NOT NULL,  -- 'critical' | 'warning' | 'info'

  plant_id      VARCHAR(64)  NOT NULL,
  -- Señal/tanque/válvula concreta, cuando aplica. Permite que el front navegue al item exacto.
  subject       VARCHAR(64)      NULL,

  title         VARCHAR(160) NOT NULL,
  message       TEXT         NOT NULL,

  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  -- La deduplicación se apoya en el índice ÚNICO: el detector hace INSERT y deja que la base
  -- rechace el duplicado (ER_DUP_ENTRY). Es atómico, así que dos ciclos simultáneos no pueden
  -- crear dos avisos del mismo problema.
  UNIQUE KEY uq_notification_dedupe (dedupe_key),
  -- El listado siempre es "las últimas N horas, más recientes primero".
  KEY idx_notification_created (created_at),
  KEY idx_notification_plant (plant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estado de lectura POR USUARIO: un aviso visto por el operador sigue sin ver para el jefe.
-- La ausencia de fila = no visto (no hace falta sembrar nada al crear el aviso ni al dar de alta
-- a un usuario nuevo).
CREATE TABLE IF NOT EXISTS notification_seen (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id         CHAR(36)        NOT NULL,
  seen_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (notification_id, user_id),
  -- Al purgar avisos viejos, sus marcas de visto se van con ellos.
  CONSTRAINT fk_seen_notification FOREIGN KEY (notification_id)
    REFERENCES notification (id) ON DELETE CASCADE,
  KEY idx_seen_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
