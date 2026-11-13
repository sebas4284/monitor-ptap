# Web Push de Aquora en producción

El navegador recibe avisos mediante Push API y un service worker. Android conserva su transporte FCM. Ambos reutilizan las preferencias personales y las reglas de acceso de la bandeja. La bandeja sigue siendo la fuente de verdad; las pruebas automatizadas usan emisores simulados y no demuestran recepción física.

## Servidor

Aplicar la migración `apps/api/src/infrastructure/database/migrations/0016_web_push_subscription.sql` con el procedimiento habitual `npm run db:migrate --workspace=@ptap/api`, después de revisar el destino y disponer de respaldo. No se ha aplicado a producción durante esta implementación.

Configurar mediante el gestor de secretos del entorno:

| Variable | Contenido |
| --- | --- |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Clave pública P-256 VAPID en base64url sin relleno. El cliente la recibe mediante el endpoint de configuración. |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Clave privada correspondiente, sólo en servidor. No incluir en repositorio, aplicación, capturas ni logs. |
| `WEB_PUSH_VAPID_SUBJECT` | Contacto del operador del servicio, con formato `mailto:` o URL HTTPS válido para VAPID. |

Conservar el par VAPID entre reinicios y despliegues. Una rotación exige renovar las suscripciones de los navegadores; planificar el periodo de transición. No hace falta Firebase Web para este transporte. Sin configuración completa y válida, el servidor informa `pushActivo: false` y `publicKey: null`.

Cada cuenta puede registrar hasta diez suscripciones. El endpoint pertenece a una sola cuenta y binding. El binding es un UUID aleatorio creado por el cliente para distinguir sesiones del navegador; no sustituye la autenticación. El servidor limita los endpoints a proveedores HTTPS conocidos: FCM, Mozilla, Apple y los subdominios WNS permitidos. Un proveedor nuevo requiere revisar y ampliar esa lista; no se aceptan URLs arbitrarias. La dependencia `web-push` 3.6.7 no sigue redirecciones HTTP.

Antes de enviar, el servidor relee el propietario, binding, cuenta activa y permisos actuales para todas las plantas del mensaje. Las preferencias se aplican al construir los avisos y los resúmenes. Una respuesta 404/410 elimina la suscripción sólo si propietario y binding aún coinciden; otros errores conservan el registro. No hay reintento automático Web Push: un fallo deja el aviso disponible en bandeja. El proveedor recibe mensajes con TTL de cinco minutos y timeout de socket de diez segundos.

## Contrato HTTP

Todas las rutas requieren Bearer JWT vigente, cuenta activa, permiso `view_dashboard` y ámbito de planta válido. El usuario lo determina el servidor desde la sesión, nunca desde un campo del cuerpo.

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /api/notifications/web-push/config` | — | `{ pushActivo, publicKey }` |
| `POST /api/notifications/web-push/subscriptions` | `{ endpoint, keys: { p256dh, auth }, binding }` | `{ pushActivo, binding }` |
| `POST /api/notifications/web-push/subscriptions/remove` | `{ endpoint, binding }` | `{ quitado }` |
| `POST /api/notifications/web-push/test` | `{ endpoint, binding }` | `{ pushActivo, telefonos, enviados, fallidos }` |

`telefonos` conserva el nombre del DTO compartido: en esta ruta cuenta la suscripción web dirigida, con valor cero o uno. `enviados` significa aceptación del transporte, no confirmación de que la persona vio un banner. La prueba sólo apunta a la suscripción indicada y perteneciente a quien la solicita; no envía a toda la organización. Los POST responden 201 cuando se procesan correctamente; datos inválidos producen 400.

## Navegador y publicación

Publicar la aplicación mediante HTTPS y servir `/aquora-push-sw.js` como JavaScript real del mismo origen. Evitar que el fallback de rutas SPA devuelva HTML para ese archivo. El worker se registra con scope `/`; comprobar en las herramientas del navegador que está activo y actualizado. Se solicita con `updateViaCache: none`; revisar igualmente las cabeceras del proxy/CDN al desplegar cambios del worker. No añade un manejador `fetch` ni caché de páginas o datos operativos.

El navegador necesita Service Workers, Push API, Notifications, IndexedDB y permiso de notificaciones concedido explícitamente. Las restricciones del sistema operativo, ahorro de batería, modo privado y políticas del navegador pueden limitar la entrega o presentación. En plataformas que exigen instalar la web como aplicación, comprobar ese requisito con el navegador de destino.

El payload contiene `{ title, body, tag, critical, binding }`. El worker sólo muestra un aviso cuyo binding coincide con el estado local activo de IndexedDB. Al cerrar o cambiar sesión, el cliente revoca primero ese estado local, incluso sin red, e intenta dar de baja la suscripción en el servidor. Las operaciones tardías de una sesión anterior deben quedar invalidadas, también entre pestañas. El click abre la ruta autenticada fija `/alertas`; el payload no controla la URL.

La revocación local reduce la posibilidad de presentar mensajes encolados para una sesión anterior. No permite recuperar datos que el proveedor ya aceptó ni garantiza que un banner aceptado por el sistema no se haya mostrado brevemente antes del cierre. Tampoco permite retirar contenido que una persona ya vio. Una cuenta o planta modificada en el servidor corta envíos futuros tras su revalidación; no revoca un aviso que ya estaba en tránsito. Tratar títulos y cuerpos como información visible en el panel de notificaciones del dispositivo y evaluar ese uso con la política de datos de la organización.

## Prueba de aceptación física

1. Usar una cuenta y un navegador autorizados en el origen HTTPS productivo. Comprobar estado del worker, permiso concedido y configuración activa. No copiar claves privadas a las herramientas del navegador.
2. Activar avisos, cerrar o poner en segundo plano la web y enviar una prueba dirigida desde sus ajustes. Verificar banner y apertura de `/alertas` con sesión autenticada. Repetir con el navegador cerrado según el comportamiento admitido por esa plataforma.
3. Con dos cuentas y plantas distintas, comprobar que cada una recibe sólo su ámbito, que una cuenta desactivada deja de recibir nuevos avisos y que se respetan los silenciamientos. No generar alarmas operativas ni enviar pruebas indiscriminadas.
4. Cambiar o cerrar sesión durante una activación y con dos pestañas abiertas; repetir sin red. Verificar que la sesión anterior no puede reactivar su estado local ni presentar un aviso nuevo después de la revocación. Reabrir y comprobar el estado y el respaldo.
5. Si se rota VAPID, verificar renovación de la suscripción y repetir la prueba física. Registrar navegador, versión, sistema operativo, origen, fecha y resultado sin incluir tokens, endpoints completos ni claves.

La aceptación productiva exige estos ensayos sobre dispositivos disponibles y configuración real del entorno. Un typecheck correcto, un build correcto o un emisor simulado no sustituyen esa comprobación.
