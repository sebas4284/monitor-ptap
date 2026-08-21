-- Promedio HORARIO del caudal de salida, por planta.
--
-- Por qué existe: la autonomía del tanque con la entrada abierta es una proyección —«si cerraras la
-- entrada ahora, aguantaría X»— y para eso hace falta el consumo TÍPICO del día, no el caudal
-- instantáneo. El cliente lo pidió así (2026-08-20) para que el operario decida con criterio antes
-- de cerrar, no después.
--
-- Por qué en la base y no en memoria: un promedio en RAM se pierde en cada despliegue, y hoy se
-- despliega a diario. Una autonomía que se queda sin referencia cada vez que se reinicia el backend
-- no sirve para planificar nada.
--
-- Por qué esto NO viola la regla de "no persistir telemetría": no se guardan muestras crudas. Se
-- guarda UN agregado por planta y hora —24 filas por planta al día, ~4.400 al mes para las 12— que
-- es un dato derivado y acotado, no una serie temporal del proceso. La telemetría sigue viviendo en
-- RAM y muriendo con ella.
CREATE TABLE IF NOT EXISTS flow_hourly (
  plant_id    VARCHAR(64)  NOT NULL,
  domain_key  VARCHAR(64)  NOT NULL,

  -- Inicio de la hora, en hora LOCAL del servidor (igual criterio que dedupeDay y el tipo de día:
  -- la VM corre en hora de Colombia y un "día" en UTC empezaría a las 19:00).
  hour_start  DATETIME     NOT NULL,

  avg_lps     DOUBLE       NOT NULL,
  -- Cuántas muestras respaldan el promedio. Una hora con 3 muestras no merece la misma confianza
  -- que una con 60, y sin este número no habría forma de distinguirlas.
  samples     INT UNSIGNED NOT NULL,

  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (plant_id, domain_key, hour_start),
  KEY idx_flow_hourly_recent (plant_id, domain_key, hour_start DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
