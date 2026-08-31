-- Correcciones del mapeo hechas desde la app (modo desarrollador).
--
-- POR QUÉ EXISTE. El 2026-08-25 se descubrió que `cascajal.inletPressure1` leía 409,50 psi porque
-- es 4095/10, el fondo de escala de un convertidor de 12 bits: el índice apuntaba al canal
-- equivocado. Corregirlo exigía editar `config/opc_mapping.json`, hacer commit, desplegar y
-- reiniciar el backend — media hora de trabajo de programador para mover un número que el admin de
-- la planta sabe cuál es. Esta tabla es lo que permite moverlo desde el teléfono y que surta efecto
-- en el momento.
--
-- ES CONFIGURACIÓN Y AUDITORÍA, NO TELEMETRÍA (regla 1). No guarda ni una lectura del PLC: guarda
-- quién decidió que tal señal se lee en tal índice, cuándo, y qué decía antes.
--
-- APPEND-ONLY, y esa es la decisión de fondo. Nunca se actualiza ni se borra una fila: cada cambio
-- añade una, y el override que rige es la ÚLTIMA de cada (planta, señal). Revertir tampoco borra —
-- inserta una fila con `reverted = 1`, que significa "vuelve a lo que dice el JSON del repositorio".
--
-- Es la misma disciplina del libro de firmas y de la bandeja de avisos: un histórico que cambia con
-- el presente no es un histórico. Si alguien reapunta un índice y la planta empieza a leer raro tres
-- días después, la pregunta que hay que poder responder es "¿qué se tocó y quién?", y con filas
-- mutables esa respuesta se habría perdido en el propio UPDATE.
CREATE TABLE IF NOT EXISTS mapping_override (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  plant_id     VARCHAR(64)  NOT NULL,
  -- El nombre en inglés de la señal (`domainKey`): outletFlow1, tank1Level, inletPressure1…
  domain_key   VARCHAR(64)  NOT NULL,

  -- Estado COMPLETO del override tras este cambio, no solo el campo tocado. Guardar el parche
  -- acumulado y no el delta hace que leer el efectivo sea una sola fila: sin esto habría que
  -- replegar toda la historia de la señal en cada arranque, y un hueco en la cadena cambiaría el
  -- resultado en silencio.
  patch        JSON         NOT NULL,
  -- Lo que regía ANTES de este cambio (`{}` si no había override). Permite deshacer un paso y, más
  -- importante, contar la historia sin recalcularla.
  previous     JSON         NOT NULL,
  -- 1 = reversión: esta señal vuelve a lo que dice `config/opc_mapping.json`.
  reverted     TINYINT(1)   NOT NULL DEFAULT 0,

  -- Quién. El nombre se CONGELA aquí, igual que en command_log: si mañana la cuenta se renombra o
  -- se da de baja, el registro debe seguir diciendo quién lo tocó aquel día.
  user_id      CHAR(36)     NULL,
  user_email   VARCHAR(190) NULL,
  user_name    VARCHAR(120) NULL,

  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- Resolver "el último de cada (planta, señal)" es lo que se hace en cada arranque y en cada
  -- edición. Con el id en el índice, el motor lo saca del propio índice sin tocar la tabla.
  INDEX idx_efectivo (plant_id, domain_key, id),
  INDEX idx_historia (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
