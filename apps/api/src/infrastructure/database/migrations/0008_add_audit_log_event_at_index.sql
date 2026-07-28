-- D6 (auditoría de eficiencia 2026-07-28): la purga diaria filtra `event_type <> 'opc.route_probe'`
-- + `at < NOW()-INTERVAL`. El índice simple de `event_type` no sirve para el rango de `at` a la vez;
-- un índice compuesto (event_type, at) permite acotar el barrido de la purga cuando la tabla crezca.
CREATE INDEX idx_audit_event_at ON audit_log (event_type, at);
