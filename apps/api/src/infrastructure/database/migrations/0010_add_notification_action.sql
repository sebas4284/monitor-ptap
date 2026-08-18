-- QUÉ HACER ante el aviso, en una frase.
--
-- Los avisos describían el síntoma y, con suerte, el diagnóstico, pero ninguno decía qué hacer. El
-- único que justifica salir corriendo —un tanque rebosando— cerraba con "Revisar la planta: se está
-- perdiendo agua tratada": ni qué válvula tocar, ni a quién llamar.
--
-- Va en columna propia y no concatenado al `message` a propósito: el mensaje se corta a una línea en
-- el panel de notificaciones de Android y por debajo del pliegue en la tarjeta de la bandeja, así
-- que una instrucción metida al final del párrafo no se lee nunca. Separada, el front la pinta
-- destacada y arriba.
--
-- NULL cuando no hay una acción clara. Inventarse una es peor que dejarla vacía: enseña a ignorar
-- el campo.
ALTER TABLE notification
  ADD COLUMN action VARCHAR(240) NULL AFTER message;
