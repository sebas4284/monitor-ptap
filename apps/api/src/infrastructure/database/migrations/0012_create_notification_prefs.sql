-- Qué avisos quiere recibir cada usuario.
--
-- Hasta ahora la app avisaba de TODO y no había forma de elegir. Con seis plantas congeladas y un
-- detector por cada cosa, la bandeja de un admin acumulaba decenas de avisos al día de los que uno
-- o dos exigían moverse. Poder callar lo que a uno no le toca es lo que hace que se lea el resto.
--
-- POR QUÉ EN LA BASE Y NO EN EL DISPOSITIVO: el contador de la campana lo calcula el servidor
-- (`countUnseen`). Si el filtro viviera solo en el móvil, la campana diría «3» sobre una bandeja
-- que muestra dos cosas — y esa contradicción entre lo que se cuenta y lo que se ve es exactamente
-- la clase de fallo que este proyecto lleva semanas corrigiendo. Aquí hay una sola fuente de verdad
-- y además la elección sigue al usuario si cambia de teléfono.
--
-- SIN FILA = TODO LLEGA. Nadie tiene que configurar nada: quien no toque los ajustes recibe
-- exactamente lo mismo que hoy. Las preferencias son una resta explícita, nunca un valor por
-- defecto que alguien tenga que descubrir.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id           CHAR(36)    NOT NULL,

  -- Tipos que el usuario NO quiere que le avisen, como array JSON de `kind`
  -- (sensor_stale, signal_out_of_range, tank_level, tank_autonomy...). Se guarda la LISTA NEGRA y
  -- no la blanca a propósito: así un `kind` nuevo llega por defecto a todo el mundo en vez de
  -- quedar invisible hasta que cada uno lo active — un aviso que nadie ve porque se añadió después
  -- es peor que uno de más.
  kinds_silenciados JSON            NULL,

  -- Gravedad mínima que llega: info (todo) | warning | critical.
  min_severidad     VARCHAR(16) NOT NULL DEFAULT 'info',

  -- Franja de "no molestar", en hora local del dispositivo. Solo silencia la notificación del
  -- SISTEMA; jamás oculta nada de la bandeja. Si `desde` > `hasta` la franja cruza la medianoche
  -- (22:00–06:00), que es el caso normal.
  silencio_desde    TIME            NULL,
  silencio_hasta    TIME            NULL,

  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (user_id),
  CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
