# Android push: diagnóstico del backend

## Estado observado en producción

Revisión host-local de sólo lectura: **2026-10-31 13:20:41 UTC**.

| Control | Resultado |
|---|---|
| Variable real consumida por `createFcmSender` | `FIREBASE_SERVICE_ACCOUNT_PATH` |
| Variable en `.env` productivo | Ausente |
| Variable en entorno inicial del proceso API, leído desde `/proc` | Ausente |
| Configuraciones `.env` relevantes y respaldos examinados | 9; ninguna contiene esa ruta |
| JSON Firebase/cuenta de servicio en ubicaciones conocidas de secretos/config/backups | 0 candidatos |
| `google-services.json` en móvil o `android/app` del host | Ausente en ambas rutas |
| Tokens registrados / Android / cuentas activas / vistos en 30 días | 0 / 0 / 0 / 0 |
| Coincidencia de proyecto servidor/Android | No comprobable: faltan los artefactos |
| Autenticación contra Google / envíos / escrituras DB / cambios de entorno | No realizados |

También se revisaron exclusivamente nombres de archivos de primer nivel en
el directorio Downloads del usuario que coincidieran con `firebase...adminsdk`,
`service-account` o `google-services` y extensión JSON: **0 coincidencias**;
no se leyeron contenidos de otros archivos. Estas búsquedas son acotadas y no
demuestran que no exista una credencial en otra ubicación.

No hay un proveedor FCM configurado ni un dispositivo nativo registrado con el
cual entregar avisos fuera de la app. El proyecto existente confirmado por el
usuario debe suministrar los artefactos correspondientes; no se crearon proyectos
ni claves nuevas. No se envió ninguna notificación a usuarios como diagnóstico.

## Contrato del mensaje ya implementado

`push.dispatcher.ts` ya genera una notificación FCM apta para presentación por el
SDK Android cuando el proceso de la app está en segundo plano o terminado:

- `notification.title/body`, además de `data` con valores string.
- `android.priority='high'`.
- Canal normal `aquora-avisos` o crítico `aquora-criticas`, definidos también en
  `@ptap/shared`, con prioridad visual alta/máxima.
- `tag` estable y `data.tag/channelId` para coordinar presentación en primer plano
  y respaldo sin duplicar el mismo aviso.

Los canales deben existir en la APK nativa y el permiso Android debe estar
concedido. No se sustituyó esta entrega por consultas periódicas: el respaldo
existente no demuestra funcionamiento push con la app cerrada. Un `force stop`
desde Ajustes requiere volver a abrir la app; recepción aceptada por FCM tampoco
prueba entrega ni presentación efectiva en un teléfono.

Se consultaron las APIs oficiales de Firebase y las declaraciones instaladas de
**firebase-admin 14.5.0**. Las declaraciones exactas usan `android.priority`,
`android.notification.channelId` y `Messaging.send(message, dryRun?)`. El test
existente valida además la transformación local al cable mediante el validador
real instalado; no llama a Google.

Fuentes primarias: [Admin Node Messaging](https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging),
[notificaciones Android](https://firebase.google.com/docs/cloud-messaging/android/receive),
[credenciales del servidor](https://firebase.google.com/docs/cloud-messaging/auth-server).

## Artefactos concretos pendientes

1. Configuración Android `google-services.json` del proyecto existente para la app
   **`com.ptap.monitor`**. Incorporarla al proceso autorizado de compilación nativa;
   está ignorada por Git y no debe confundirse con una cuenta de servicio.
2. Ruta/archivo de una cuenta de servicio ya autorizada para enviar FCM en ese
   proyecto. El backend actual consume JSON por `FIREBASE_SERVICE_ACCOUNT_PATH`;
   no utiliza automáticamente ADC ni `GOOGLE_APPLICATION_CREDENTIALS`. Mantener la
   clave fuera del repositorio, directorios públicos y respaldos accesibles por
   MySQL, con propietario del servicio y modos privados. Nunca pegarla en chat.
3. Comparar localmente ambos proyectos y el paquete Android; informar sólo el
   resultado de coincidencia. Configurar ruta y reinicio mediante la ventana que
   coordina el responsable, después de preservar evidencia.
4. Compilar/instalar la APK nativa actualizada, conceder permisos, abrir sesión y
   comprobar registro de al menos un token Android. El token es opaco: su texto no
   permite deducir de forma fiable el proyecto Firebase.
5. Desde el teléfono autorizado, ejecutar su botón de prueba y observar entrega
   en primer plano, segundo plano, pantalla bloqueada y proceso terminado. Esa
   prueba dirigida queda pendiente; no se afirma entrega real por pruebas unitarias.

## Herramienta y validación

`tools/vm/ptap-push-readiness.cjs` realiza consultas agregadas dentro de una
transacción de sólo lectura, verifica presencia/formato/permisos de la cuenta y
coincidencia con el cliente si existen, y sólo imprime booleanos/conteos. No pide
tokens OAuth ni envía mensajes. Archivos de configuración acotados a 128 KiB;
ubicaciones/nombres buscados limitados al contexto de la aplicación.

SHA256 ejecutado y comprobado antes de ejecutar en el host:
`081c258cb9503bb83da201f3ea657a1283bde2b2d7ee043622db9473545d5cf3`.

**34 pruebas de dispatcher/registro HTTP aprobadas**, incluida validación real
del payload y destinatarios/permisos, preferencias, reintentos, tokens inválidos y
estado sin credencial. **1 prueba de la herramienta aprobada**, con datos
sintéticos, clave RSA temporal local y comprobación de que proyecto/clave no se
imprimen. Ninguna prueba realizó envíos externos ni creó claves en la nube.

El gate acotado de la herramienta está en
`tools/vm/ptap-push-readiness.security-decision.json`. El contrato de backend era
correcto, por lo que no se introdujeron modificaciones cosméticas al payload ni
cambios de esquema/controlador para ocultar que falta la configuración externa.
