-- D7 (auditoría de eficiencia 2026-07-28): `users.list()` ordena por `created_at DESC` y sin este
-- índice MySQL hace `filesort` (confirmado por EXPLAIN). Índice para servir el ORDER BY en orden.
CREATE INDEX idx_users_created_at ON users (created_at);
