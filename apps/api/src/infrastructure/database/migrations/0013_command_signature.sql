-- Firma de las maniobras de válvula, e ítems silenciados por usuario.
--
-- POR QUÉ UNA FIRMA. En estas plantas no hay forma electrónica de confirmar que una válvula se
-- abrió: no llega estado eléctrico, y lo que se ve se deduce del caudal. El PLC no puede dar fe de
-- la maniobra, así que la evidencia tiene que ser OTRA COSA — quién dio la orden, a qué válvula, a
-- qué hora. Eso ya se guardaba; lo que faltaba era que no se pudiera tocar después y que se pudiera
-- ENSEÑAR: el operario, el jefe de planta y el admin tienen que poder ver el nombre de quien la
-- movió, no un identificador de cuenta que no le dice nada a nadie.
--
-- Es una cadena de hashes, no una firma por orden suelta: cada registro sella también el sello del
-- anterior. Alterar una fila —o borrarla, o colar una en medio— rompe la cadena desde ahí en
-- adelante y la verificación lo señala. Un sello independiente por fila no daría eso: se podría
-- borrar una maniobra entera sin dejar hueco.
--
-- No es criptografía de clave pública: es HMAC con un secreto del servidor. Prueba que el registro
-- no se ha alterado DESPUÉS, que es la pregunta real («¿esto es lo que pasó?»). No pretende probar
-- ante un tercero que el usuario no puede negar la orden — para eso haría falta una clave privada
-- por persona, y aquí la identidad la aporta el token de sesión.
ALTER TABLE command_log
  -- El nombre, congelado en el momento de la orden. Se guarda AQUÍ y no se resuelve por JOIN a
  -- propósito: si mañana la cuenta se renombra o se da de baja, el registro debe seguir diciendo
  -- quién la movió aquel día. Un histórico que cambia con el presente no es un histórico.
  ADD COLUMN user_name     VARCHAR(120) NULL AFTER user_email,
  -- Sello de esta fila: HMAC-SHA256 en hexadecimal.
  ADD COLUMN signature     CHAR(64)     NULL,
  -- Sello de la fila firmada inmediatamente anterior. NULL solo en la primera de la cadena.
  ADD COLUMN prev_signature CHAR(64)    NULL,
  ADD COLUMN signed_at     DATETIME(3)  NULL;

-- Recorrer la cadena en orden y encontrar la última firmada tiene que ser barato: se hace en cada
-- maniobra (para encadenar) y en cada verificación completa.
CREATE INDEX idx_command_signed ON command_log (signed_at);

-- Ítems concretos que un usuario no quiere que le suenen fuera de la app, como `planta:senal`.
--
-- Va junto a los tipos y no en una tabla aparte porque es la misma decisión del mismo usuario, se
-- lee siempre a la vez y son unas pocas señales por persona. Ausencia de fila = todo suena.
ALTER TABLE notification_prefs
  ADD COLUMN items_silenciados JSON NULL AFTER kinds_silenciados;
