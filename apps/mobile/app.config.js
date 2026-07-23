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
//  3. android.permissions acotado a INTERNET — el único permiso que la app necesita (la telemetría
//     viaja por HTTPS/WebSocket; no se usa ubicación, cámara, almacenamiento, etc.).
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
  },
  android: {
    ...config.android,
    permissions: ['INTERNET'],
    // La plantilla base de Expo agrega estos 4 permisos "opcionales" al manifest y
    // `permissions` solo AGREGA, nunca los quita — hay que bloquearlos explícitamente
    // (tools:node="remove") para que el APK final pida únicamente INTERNET.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    ...(config.plugins ?? []),
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
