// Config dinámica de Expo. Hereda TODO lo estático de app.json (Expo lo carga y lo pasa como
// `config`) y añade lo que depende del BUILD:
//
//  1. extra.apiBaseUrl — la URL del backend, horneada desde la variable de entorno API_BASE_URL.
//     services/api.ts la lee con Constants.expoConfig.extra.apiBaseUrl. Para la APK se construye
//     con API_BASE_URL=https://<tunnel>.trycloudflare.com (Cloudflare Tunnel al backend local).
//     Sin la variable (dev) cae a localhost. Es una URL pública, NO un secreto.
//
//  2. expo-build-properties — endurecimiento + optimización del release Android:
//     - usesCleartextTraffic:false → prohíbe HTTP en claro (todo va por HTTPS; cierra fugas de red).
//     - ProGuard/R8 + shrinkResources → APK más pequeño y ofuscado.
//     - min/target SDK explícitos.
//
//  3. android.permissions acotado al mínimo. Desde el 2026-08 se añaden dos, y solo dos, por los
//     avisos de sensor averiado en el panel de notificaciones:
//       - POST_NOTIFICATIONS: obligatorio desde Android 13 (API 33) para poder mostrar cualquier
//         notificación. Sin él el sistema las descarta en silencio.
//       - VIBRATE: estaba BLOQUEADO explícitamente; se desbloquea porque una notificación sin
//         vibración pasa desapercibida justo en el caso que importa (una planta caída).
//     RECEIVE_BOOT_COMPLETED lo añade `expo-background-task` por su cuenta: es lo que permite que
//     la tarea periódica siga programada tras reiniciar el teléfono.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
  },
  android: {
    ...config.android,
    permissions: ['INTERNET', 'POST_NOTIFICATIONS', 'VIBRATE'],
    // La plantilla base de Expo agrega permisos "opcionales" al manifest y `permissions` solo
    // AGREGA, nunca los quita — hay que bloquearlos explícitamente (tools:node="remove").
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    ...(config.plugins ?? []),
    'expo-notifications',
    'expo-background-task',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: false,
          enableProguardInReleaseBuilds: true,
          enableShrinkResources: true,
          minSdkVersion: 24,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
        },
      },
    ],
  ],
});
