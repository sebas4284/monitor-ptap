-- Contacto del usuario, capturado en el auto-registro. Nullable: los usuarios sembrados
-- (db:seed-users) y los creados antes de esta migración no lo tienen.
-- Para qué sirve: el registro crea SIEMPRE rol 'civil'; cuando alguien pide más acceso, el
-- administrador necesita con qué verificar QUIÉN es antes de elevarle el rol (matriz oficial:
-- "Asignar roles a los usuarios" → solo Admin).
ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL AFTER email;
