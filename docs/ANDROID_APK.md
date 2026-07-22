# Generar la APK de Monitor PTAP (Android)

Empaqueta la app móvil (`apps/mobile` + `packages/shared`) como un `.apk` instalable en un celular.
El backend (`apps/api`) **no** entra en la APK: la app es solo el cliente y habla con tu backend por
HTTPS.

- **Transporte:** HTTPS vía **Cloudflare Tunnel** hacia el backend que corre en tu computador.
- **Build:** **local** con Gradle (sin nube/EAS). El keystore de firma se genera y se guarda local.
- **Arquitectura:** APK → (HTTPS/WSS) → `cloudflared` → `http://localhost:4000` (backend + MySQL en
  tu PC).

---

## Estado de la ruta (verificado 2026-07-22)

La ruta HTTPS APK→backend quedó **probada de punta a punta** desde este PC, a través de un túnel
Cloudflare efímero, con el backend completo + MySQL corriendo en local:

| Prueba (vía `https://<túnel>`) | Resultado |
|---|---|
| `GET /api/health` | ✅ 200 |
| `POST /api/auth/login` (`civil@ptap.co`) | ✅ 201 + JWT |
| `GET /api/plants` · `/…/status` (con JWT) | ✅ 200 (`bridge=Connected`) |
| Socket.IO **WSS** con JWT → `opc:subscribe` | ✅ conecta y recibe `opc:snapshot` |
| Socket.IO **sin token** | ✅ rechazado por el gateway (SRV-04) |

> **Este PC no tiene toolchain Android** (no hay JDK/Android SDK, `ANDROID_HOME` vacío), así que el
> `.apk` físico se construye en una máquina con el SDK instalado (§0–§3). Lo que sí quedó
> garantizado aquí es la **ruta** que la APK usará: si el build hornea esa URL en `API_BASE_URL`, la
> app conecta.

> **URL efímera vs. estable:** `cloudflared tunnel --url …` da una URL `trycloudflare.com` que
> **cambia cada reinicio**. Para probar en un **celular más adelante** conviene una URL fija con un
> **named tunnel** (cuenta Cloudflare gratis):
> ```bash
> cloudflared login                     # abre el navegador, autoriza un dominio
> cloudflared tunnel create ptap        # crea el túnel con nombre
> cloudflared tunnel route dns ptap ptap.tudominio.com
> cloudflared tunnel run ptap           # URL estable: https://ptap.tudominio.com
> ```
> Con URL estable, la APK construida una vez sigue funcionando entre reinicios.

---

## 0. Prerrequisitos (una sola vez)

| Herramienta | Para qué | Verificar |
|---|---|---|
| **JDK 17** | Compilar Android | `java -version` → 17 |
| **Android SDK** (Android Studio o command-line tools) | `gradle`, `adb` | `adb --version`; `echo %ANDROID_HOME%` |
| **cloudflared** | Túnel HTTPS al backend local | `cloudflared --version` |
| **Node + deps del repo** | Bundle JS | `npm install` en la raíz |

`ANDROID_HOME` debe apuntar al SDK (p. ej. `C:\Users\<tú>\AppData\Local\Android\Sdk`) y
`platform-tools` estar en el `PATH`.

---

## 1. Backend arriba + túnel HTTPS

En una terminal, con MySQL corriendo:

```bash
npm run dev:api          # backend completo en http://localhost:4000 (requiere BD, auth, etc.)
```

En otra terminal:

```bash
cloudflared tunnel --url http://localhost:4000
```

Copia la URL que imprime, del tipo `https://algo-al-azar.trycloudflare.com`. **Esa es tu
`API_BASE_URL`.**

> **Nota:** la URL gratuita `trycloudflare.com` **cambia cada vez que reinicias `cloudflared`**. Si
> cambia, hay que reconstruir la APK (§3) con la URL nueva. Para una URL FIJA: crea una cuenta
> Cloudflare gratis, registra un tunnel con nombre (`cloudflared tunnel create`) y un dominio; el
> procedimiento es el mismo cambiando el comando del túnel.

Comprueba el túnel abriendo `https://<tu-tunel>.trycloudflare.com/api/health` en el navegador del PC:
debe responder `{"status":"ok",...}`.

Si además vas a usar la versión **web** por el túnel, añade esa URL a `CORS_ORIGINS` en el `.env` del
backend (la APK nativa no lo necesita — no manda `Origin`). Ver `.env.example`.

---

## 2. Generar el keystore de firma (una sola vez)

El release Android debe ir firmado. Genera un keystore y **guárdalo fuera del repo** (ya está en
`.gitignore`; si se pierde, no podrás actualizar la app con la misma identidad):

```bash
keytool -genkeypair -v -keystore monitor-ptap-release.keystore \
  -alias monitor-ptap -keyalg RSA -keysize 2048 -validity 10000
```

Anota la contraseña del store y de la clave. Colócalo en un lugar seguro (p. ej.
`C:\keys\monitor-ptap-release.keystore`), **no** dentro del proyecto.

---

## 3. Construir la APK

Desde `apps/mobile`, horneando la URL del túnel en el build:

```bash
# Windows PowerShell
$env:API_BASE_URL = "https://<tu-tunel>.trycloudflare.com"
npx expo prebuild -p android      # genera apps/mobile/android/ (ignorado por git)
```

`expo prebuild` aplica `app.config.js`: inyecta `extra.apiBaseUrl`, `usesCleartextTraffic=false`,
ProGuard/R8, y el permiso único `INTERNET`.

### Firmar el release

Edita `apps/mobile/android/gradle.properties` y añade (con tus valores del §2):

```
MONITORPTAP_UPLOAD_STORE_FILE=C:/keys/monitor-ptap-release.keystore
MONITORPTAP_UPLOAD_KEY_ALIAS=monitor-ptap
MONITORPTAP_UPLOAD_STORE_PASSWORD=********
MONITORPTAP_UPLOAD_KEY_PASSWORD=********
```

En `apps/mobile/android/app/build.gradle`, dentro de `android { ... }`, define el `signingConfig` de
release apuntando a esas propiedades (patrón estándar de React Native; si el bloque `release` ya usa
`signingConfigs.debug`, reemplázalo por el de tu keystore).

### Compilar

```bash
cd android
./gradlew assembleRelease        # en Windows: .\gradlew.bat assembleRelease
```

APK firmado en:

```
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

> Atajo: `npm run build:android -w @ptap/mobile` corre prebuild + assembleRelease (necesita
> `API_BASE_URL` exportada y el signingConfig ya configurado).

---

## 4. Instalar en el celular

- **Por USB** (depuración USB activada en el teléfono):
  ```bash
  adb install apps/mobile/android/app/build/outputs/apk/release/app-release.apk
  ```
- **Sin cable:** copia el `.apk` al teléfono (correo, USB, nube) y ábrelo; acepta "instalar de
  orígenes desconocidos".

**Prueba desde DATOS MÓVILES** (no la WiFi del PC) para confirmar que el túnel funciona desde fuera
de tu red: inicia sesión → Sensores muestra telemetría en vivo → cerrar sesión corta el stream.

---

## 5. Checklist de seguridad (verificar antes de repartir la APK)

- [ ] **HTTPS only:** `usesCleartextTraffic=false` en el manifest generado
      (`android/app/src/main/AndroidManifest.xml`). Todo el tráfico va cifrado.
- [ ] **Permisos mínimos:** el manifest solo pide `INTERNET`. Sin ubicación, cámara, contactos, etc.
- [ ] **Sin secretos en el bundle:** el APK no contiene `JWT_SECRET`, credenciales de MySQL ni
      peppers — eso vive solo en el backend. Lo único horneado es la URL pública del túnel.
      Verifícalo: `unzip -l app-release.apk` no debe listar ningún `.env`; y el código de `apps/api`
      no está dentro (solo `apps/mobile` + `packages/shared`).
- [ ] **JWT del usuario en almacenamiento seguro:** en nativo el token va a **SecureStore** (cifrado
      por el sistema), no a texto plano. La sesión expira a las 8 h y se puede revocar desde el
      backend (se corta en la siguiente petición).
- [ ] **Keystore fuera del repo:** `git status` no muestra `.keystore` ni `android/`. Copia de
      respaldo del keystore en lugar seguro.
- [ ] **Handshake del socket autenticado:** `SOCKET_AUTH_REQUIRED` NO está en `false` en el backend
      (el gateway exige JWT — SRV-04).

---

## 6. Optimizaciones aplicadas (rendimiento)

- **Hermes** (motor JS por defecto con la nueva arquitectura, ya activa en `app.json`
  `newArchEnabled:true`): bytecode precompilado → arranque más rápido y menos RAM.
- **R8 / ProGuard + shrinkResources:** minifica el código y elimina recursos sin usar → APK más
  pequeño.
- **React Query** ya cachea los snapshots (`staleTime: Infinity`, refresco por push de Socket.IO, sin
  polling) y guarda la **última lectura por dispositivo** para no dejar pantallas vacías en un corte.
- **Bundle de release** minificado automáticamente por Metro.

---

## 7. Cuando cambie la URL del backend

- **Túnel gratuito reiniciado** → nueva URL → repetir §3 con la `API_BASE_URL` nueva y redistribuir
  la APK.
- **Migración futura a dominio propio/HTTPS permanente** → misma receta, cambiando solo
  `API_BASE_URL` al dominio definitivo. No hay nada más que tocar en el código (la URL no está
  hardcodeada: se inyecta en el build).
