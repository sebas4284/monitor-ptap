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
          compileSdkVersion: 35,
          targetSdkVersion: 35,
        },
      },
    ],
  ],
});
