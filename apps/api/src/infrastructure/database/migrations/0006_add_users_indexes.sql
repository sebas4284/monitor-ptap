-- El panel de administración filtra por rol y por estado activo constantemente (la pestaña
-- "Pendientes" por defecto filtra is_active=0). Sin estos índices, cada filtro es un full table
-- scan que empeora conforme crece la tabla de usuarios.
ALTER TABLE users ADD INDEX idx_users_role (role);
ALTER TABLE users ADD INDEX idx_users_active (is_active);
