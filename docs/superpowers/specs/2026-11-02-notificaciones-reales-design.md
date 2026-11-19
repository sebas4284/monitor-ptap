# Notificaciones reales de Aquora

Objetivo: recibir avisos en Android y navegador fuera de Aquora, conservando la bandeja y el aislamiento por usuario/planta.

## Enfoques

- Mantener FCM Android y añadir Web Push estándar: recomendado. Reutiliza el envío Android existente y permite navegador cerrado mediante Push API/service worker, sin depender de configurar Firebase Web.
- FCM para ambas plataformas: posible, pero requiere registrar además la aplicación web en Firebase y añadir su SDK/configuración.
- Consultas periódicas: ya existen; no satisfacen la recepción web con la página cerrada.

El usuario confirmó Android y navegador. La elección Web Push estándar es propuesta de implementación.

## Diseño propuesto

1. Mantener FCM Android y completar su configuración cuando estén disponibles los artefactos del proyecto Firebase autorizado. No inventar claves ni afirmar entrega sin dispositivo real.
2. Añadir suscripciones Web Push autenticadas, vinculadas al usuario actual. Claves VAPID privadas sólo en servidor; pública en endpoint de configuración. Usar una biblioteca mantenida y revisar versión/procedencia antes de instalar.
3. Seleccionar destinatarios desde usuarios activos y permisos vigentes. Operarios reciben sólo su planta; administradores conservan acceso mult planta autorizado. Aplicar preferencias personales a cada envío.
4. Service worker sin caché de datos operativos: recibe push y abre la bandeja autenticada. Invalidar suscripción y estado local al cerrar/cambiar sesión; evitar que trabajos tardíos de una sesión publiquen avisos en otra.
5. Integrar activación, estado real y prueba dirigida en los controles de notificaciones existentes. HTTPS y permiso explícito del navegador son necesarios.
6. Pruebas con dos usuarios y plantas distintas, sesión cambiada durante solicitudes, bajas, permisos, fallos y suscripciones inválidas. Verificar typecheck/build y ejecución de pruebas pertinentes.

## Límites de aceptación

Pruebas simuladas demuestran lógica, no recepción física. Activación productiva requiere configuración del servidor, HTTPS, APK con Firebase y dispositivo/navegador autorizado. No enviar pruebas a funcionarios indiscriminadamente.

## Reparación independiente ya autorizada

Corregir las carreras de sesión detectadas en preferencias y sincronización de avisos, con regresiones automatizadas. Es necesaria aun antes de agregar el nuevo transporte.
