# Push Android con la app en segundo plano o cerrada

El envío usa FCM directo: `getDevicePushTokenAsync()` obtiene el token nativo y el
API lo registra para el usuario. El servidor envía un mensaje `notification` con
datos y prioridad alta; Android lo presenta sin depender de que React o la tarea
periódica estén ejecutándose. Los canales compartidos son `aquora-avisos` y
`aquora-criticas`.

## Estado comprobado el 2026-10-31

- La VM no tiene `apps/mobile/google-services.json`, su copia Android ni recursos
  Google Services generados. El APK anterior existe, pero no se ha construido un
  APK nuevo con Firebase en este trabajo.
- El API no tiene `FIREBASE_SERVICE_ACCOUNT_PATH` en la configuración persistida
  ni en su proceso actual. Hay cero teléfonos registrados. La coincidencia del
  proyecto entre Android y servidor sigue sin poder comprobarse.
- El cliente espera a crear los canales antes de pedir permiso o token FCM,
  reintenta errores transitorios mientras está abierto y vuelve a registrar al
  cambiar la sesión o volver al primer plano. Un registro tardío no reactiva una
  sesión cerrada; la baja usa las credenciales del usuario saliente.

Estos cambios de código por sí solos no habilitan FCM: faltan los dos artefactos
del proyecto Firebase existente.

## Artefactos necesarios del proyecto ya autorizado

1. Configuración pública de una app **Android** con paquete `com.ptap.monitor`,
   descargada desde la configuración del proyecto Firebase: `google-services.json`.
   Conservarla fuera de Git y señalarla con `GOOGLE_SERVICES_JSON=/ruta/absoluta`;
   también se admite `apps/mobile/google-services.json` (ignorado por Git).
2. Cuenta de servicio autorizada para enviar FCM desde el API, en el **mismo
   proyecto**, instalada por el administrador en la ruta privada del servidor y
   referenciada con `FIREBASE_SERVICE_ACCOUNT_PATH`. Su llave privada nunca entra
   en el APK, en `extra`, en Git ni en la configuración Android.
3. Comprobar que FCM HTTP v1 está habilitado y que esa cuenta dispone de permiso
   de envío al proyecto. No crear un proyecto o claves nuevos para sustituir
   silenciosamente al proyecto existente.

El config de Expo rechaza una cuenta de servicio usada por error como
configuración Android y verifica que exista un cliente para `com.ptap.monitor`.
`PTAP_REQUIRE_FCM=1` obliga a fallar si falta el archivo; sin esta bandera, la
compilación web y el desarrollo sin FCM siguen siendo posibles.

## Reconstrucción nativa coordinada

La configuración de Firebase y el canal por defecto requieren un **APK nuevo**;
desplegar el API o la web no actualiza la instalación Android existente.
Preservar el árbol nativo/keystore actual antes del prebuild y comprobar la firma
del APK final. El árbol nativo existente está desactualizado respecto del config
Expo: no basta ejecutar Gradle sobre él.

Toolchain verificado por la preparación de build en esta VM:

```sh
export JAVA_HOME=/home/xpertic_app/android-build/jdk
export ANDROID_HOME=/home/xpertic_app/android-build/sdk
export GRADLE_USER_HOME=/home/xpertic_app/android-build/gradle-home
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
export GOOGLE_SERVICES_JSON=/ruta/corporativa/google-services.json
export PTAP_REQUIRE_FCM=1
export API_BASE_URL=https://DOMINIO_HTTPS_DE_PRODUCCION
```

Se dispone de Temurin 17.0.20, plataforma Android 37, build tools 37.0.0,
NDK 27.1.12297006 y Gradle 9.4.1. Expo SDK 58/RN 0.88 requiere compile SDK 37;
`app.config.js` ya lo declara. La preparación debe regenerar Android con el config
actual y usar Gradle 9.4.1; el wrapper nativo anterior apunta a 9.3.1.

Después del respaldo y la actualización de versión para distribución, desde
`apps/mobile`:

```sh
node ../../node_modules/expo/bin/cli prebuild --platform android --no-install
cd android
/home/xpertic_app/android-build/gradle-9.4.1/bin/gradle \
  --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx1024m assembleRelease
```

Comprobar que la regeneración conserva permisos/canales y Google Services, que el
paquete sigue siendo `com.ptap.monitor`, que el version code supera al instalado y
que la huella del firmante coincide con la publicación anterior. No distribuir un
APK que obligue a desinstalar la aplicación por cambiar de firmante sin una
migración autorizada. No se ejecutó un prebuild ni un build nativo en esta revisión.

## Aceptación real en un teléfono autorizado

1. Instalar el APK correcto, abrirlo, iniciar sesión con una cuenta habilitada
   para avisos y conceder el permiso de notificaciones. Debe obtener token FCM y
   registrarse contra el servidor configurado; no imprimir el token en evidencias.
2. Desde el botón de prueba del propio usuario, verificar recepción en primer
   plano, segundo plano y tras cerrar normalmente la app, también con pantalla
   bloqueada. Registrar sólo estados/contadores y resultado observado.
3. Al tocar el aviso, comprobar que abre la aplicación; la consulta de la bandeja
   sigue exigiendo la sesión correspondiente.

Expo Go para Android no admite push remoto; usar la instalación nativa. Si la
persona usa **Forzar detención** en ajustes Android, debe abrir otra vez la app
antes de recibir notificaciones. La consulta periódica y los mensajes de datos
solos no sustituyen una entrega FCM visible con la app cerrada. No se ha realizado
una prueba de recepción en dispositivo físico en este trabajo.

Fuentes: [Expo SDK 58 Notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)
y [estados de entrega de notificaciones](https://docs.expo.dev/push-notifications/what-you-need-to-know/).
