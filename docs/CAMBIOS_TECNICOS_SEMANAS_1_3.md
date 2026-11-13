# Cambios técnicos Aquora

Este documento describe comportamiento y componentes del código; no es una bitácora de actividades.

## Frontend y accesibilidad

- Se actualizó el inicio de sesión y el tablero, conservando los colores corporativos, la animación del agua del login y el soporte de movimiento reducido.
- Se mantuvieron las mejoras de navegación, lectura de datos congelados, estados de válvulas por planta y tipografía de alertas.
- Se agregó Ayuda local con búsqueda y respuestas para cada código vigente en `docs/CATALOGO_ERRORES.md`. No requiere red ni permite maniobras.
- Los filtros y búsquedas tienen pruebas de cobertura y estado vacío.

## API y OPC UA

- `GET /api/diagnostics/plant/:plantId` requiere `system_config` y valida la planta.
- El informe usual combina caché, salud de buffers, estado del puente y eventos existentes. No inicia lecturas OPC directas.
- `?probe=deep` consulta los buffers de la planta mediante la sesión OPC ya abierta; no crea otra conexión. Timestamp inválido o ausente, fecha futura o calidad distinta de Good producen frescura indeterminada.
- La composición del informe es una función pura y tiene cobertura sin PLC ni red. El endpoint comprueba 401/403/200 por autorización.

## Pruebas, seguridad y Docker

- El runner API descubre las pruebas automáticamente, usa argumentos sin shell y conserva códigos de fallo en Windows y Linux.
- Se mejoró la espera de reconexión observable y se añadieron pruebas de `DataValue` y regresiones del informe de estabilidad. El reporte no aprueba corridas cortadas ni más cortas que su objetivo.
- La configuración Dev Container fija Node, opera sin privilegios y mantiene scripts de instalación deshabilitados por defecto. CI cubre Ubuntu y Windows.
- No se añadieron dependencias para estos cambios. La instalación y validación usan el entorno aislado Docker.

## Validación reproducible

CI ejecuta typecheck, lint, seguridad de dependencias, pruebas de API/móvil, herramientas web y exportación web. Los casos del reporte de estabilidad son sintéticos: no equivalen a operar el PLC ni a realizar una corrida real de 72 horas.
