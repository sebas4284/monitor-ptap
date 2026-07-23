# Ciberseguridad del frontend — estado y decisiones

El frontend (app **Expo/React Native**: APK nativa + build web opcional) **no es** la barrera de
seguridad — se ejecuta en un entorno que controla el usuario. Su rol es **reducir superficie de
ataque, no filtrar secretos y colaborar con el backend**, donde vive la seguridad crítica
(autenticación, RBAC, validación, rate-limit, auditoría). Este documento mapea los 20 controles
habituales contra el estado real del proyecto.

**Leyenda:** ✅ cubierto · 🔧 brecha (implementada abajo) · ⚪ N/A en RN/nuestro caso · ⚠️ riesgo aceptado.

| # | Control | Estado |
|---|---|---|
| 1 | **XSS** | ✅ RN no usa `innerHTML`; **cero** `dangerouslySetInnerHTML` en el móvil; `<Text>` escapa. Descargas usan Blob URLs (no input). |
| 2 | **CSP** | 🔧 web: CSP en nginx (`location /app/` de [DEPLOY_VPS.md](DEPLOY_VPS.md) §8). El API ya trae CSP por `helmet`. |
| 3 | **Sin secretos en el bundle** | ✅ No lleva `JWT_SECRET`/DB/pepper (son del backend). Solo la URL pública del API. |
| 4 | **Validación de entrada** | ✅ Cliente (longitud/formato) + backend Zod `.strict()` (registro reforzado, AUT-11). |
| 5 | **CSRF** | ⚪ La sesión va como **Bearer en header**, no en cookie → sin superficie CSRF. (Si se migra a cookie httpOnly → añadir `SameSite`.) |
| 6 | **HTTPS obligatorio** | ✅ APK `usesCleartextTraffic:false` (FRT-03/APK); web nginx+certbot + HSTS. |
| 7 | **SRI** | ⚪ Bundle auto-contenido; **no carga scripts de CDN externos**. |
| 8 | **Sin logs sensibles** | ✅ **Cero `console.log`** en el móvil (verificado). |
| 9 | **Source maps en prod** | 🔧 web: nginx no sirve `.map` (`location ~* \.map$ { return 404; }`). |
| 10 | **Protección de rutas** | ✅ Guardas de sesión en cliente + **RBAC real en backend** (AUT-*). El cliente solo oculta. |
| 11 | **Rate-limit visual** | ✅ Botones deshabilitados durante acciones; rate-limit real en backend (AUT-08). |
| 12 | **Sanitizar URLs / open redirect** | ✅ No hay `window.location = input`; `router.push` con rutas fijas. |
| 13 | **Gestión de dependencias** | 🔧 `npm audit --audit-level=high` en CI (informativo). Sin paquetes de CDN. |
| 14 | **Subida de archivos** | ⚪ La app no sube archivos (solo descarga CSV/informes). |
| 15 | **Clickjacking** | 🔧 web: `X-Frame-Options: DENY` + `frame-ancestors 'none'` en nginx. El API ya por helmet. |
| 16 | **Sin secretos en el código** | ✅ (ver #3). |
| 17 | **Manejo seguro de errores** | ✅ La app muestra mensajes legibles, no stack traces; el backend responde genérico (anti-enumeración). `NODE_ENV=production` (ecosystem PM2) oculta detalles internos de Nest. |
| 18 | **Ofuscación/minificación** | ✅ Release Android con R8/ProGuard + Metro minify (`app.config.js`). |
| 19 | **Web Storage** | ⚠️ **FRT-04 (riesgo aceptado):** JWT en `localStorage` (web); nativo usa **SecureStore**. Fix real = cookie httpOnly (cambio de backend), pospuesto por la persistencia de sesión de 8 h. |
| 20 | **Permisos mínimos** | ✅ APK pide **solo `INTERNET`** (`app.config.js`). Sin cámara/ubicación/etc. |

## Brechas implementadas (2026-07)
- **Cabeceras de seguridad web** (CSP, X-Frame-Options/frame-ancestors, HSTS, nosniff, Referrer-Policy)
  y **deny de `.map`** en el bloque nginx — ver [DEPLOY_VPS.md](DEPLOY_VPS.md) §8. Aplican a la build
  web servida por nginx; en la APK nativa esas cabeceras de navegador no intervienen.
- **`npm audit`** en el CI (`.github/workflows/ci.yml`), informativo (no bloquea por avisos
  transitivos de `node-opcua`/`expo`; visible en el log). Endurecer quitando `continue-on-error`.

## Lo que NO se hace en el cliente (a propósito)
- **Autorización:** el frontend solo **oculta** elementos por permiso; el backend decide y responde
  401/403. Un cliente modificado no obtiene acceso.
- **Validación de seguridad:** la del cliente es UX; la que cuenta es la del backend (Zod `.strict()`).
- **Secretos:** ninguno vive en el bundle; el JWT del usuario es de sesión (8 h, revocable).

> Referencia cruzada: dominio **FRT** en [CATALOGO_ERRORES.md](CATALOGO_ERRORES.md) (hallazgos de la
> auditoría del cliente y su estado).
