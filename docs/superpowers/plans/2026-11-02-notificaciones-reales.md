# Plan de notificaciones reales

Diseño aprobado por el usuario el 2026-11-02. Se trabaja sobre el árbol actual preservando cambios anteriores.

1. Aislamiento móvil: notification-session.ts, notification-prefs.ts, notification-sync.ts y device-notifications.ts. Capturar generación, separar caché por identidad/planta y cortar respuestas/publicaciones tardías. Probar A→B durante red, almacenamiento y permiso/canales.
2. Aislamiento FCM: revalidar propietario, cuenta activa y permiso de planta antes de cada intento. Baja condicionada al propietario para no eliminar un token reasignado. Probar cambio de cuenta y rol durante esperas/reintentos.
3. Web Push backend: nueva tabla web_push_subscription (endpoint hash único, user_id, keys, binding aleatorio), repositorio, controlador y dispatcher. Endpoints autenticados GET /notifications/web-push/config, POST /subscriptions, POST /subscriptions/remove, POST /test. Reutilizar planDeMensajes y reglas de permisos. Validar endpoints contra proveedores HTTPS conocidos para impedir SSRF. VAPID por entorno, secretos fuera de Git. Respuesta registro {pushActivo,binding}; configuración {pushActivo,publicKey}. Mensaje {title,body,tag,critical,binding}; worker sólo muestra cuando binding coincide con estado local vigente. Límite de suscripciones por usuario, borrar 404/410 sólo si dueño/binding siguen iguales. Pruebas de autorización, validación, destinatarios y fallos.
4. Cliente web: web-push-registration.ts + public/aquora-push-sw.js; integrar push-registration.ts, hook y tarjeta existentes. Registrar worker sin caché de páginas; vinculación local persistida en IndexedDB accesible al worker. Invalidar estado antes de baja/logout; serializar operaciones y rechazar resultados de sesión vieja. Al abrir notificación ir a bandeja autenticada. Pruebas de worker y carreras con mocks.
5. Configuración Firebase: verificar proyecto de cuenta autorizada, registrar paquete Android com.ptap.monitor y obtener configuración pública. Preparar credencial servidor; confirmar en el momento cualquier creación de acceso persistente que lo requiera. No revelar secretos. Revisar procedencia de dependencias y configuración antes de incorporar.
6. Integración: tests push/scope y nuevos tests, typecheck y build. Documentar requisitos productivos y probar recepción real sólo en dispositivo autorizado disponible. No confundir aceptación del proveedor con presentación física.

## Foco de revisión

- Respuestas de A completadas después de iniciar B.
- Token/endpoint reasignado durante envío o reintento.
- Endpoint arbitrario usado como SSRF.
- Mensaje en cola de una suscripción antigua tras logout.
- Backend sin claves o navegador sin permiso: estado honesto, respaldo conservado.
