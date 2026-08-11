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

## 2. La firma — leer antes de recompilar

> 🔴 **Lo que se está usando realmente NO es el keystore de release.** Verificado el 2026-08-11: el
> APK publicado está firmado con el **keystore de depuración**, y hay que seguir usando ESE.

`android/app/build.gradle` (generado por `expo prebuild`) trae el default de Expo:

```gradle
release {
    // Caution! In production, you need to generate your own keystore file.
    signingConfig signingConfigs.debug     // ← firma el release con la llave de DEPURACIÓN
}
```

Huella del APK publicado y del `debug.keystore` local — **idénticas**:

```
fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
```

**Por qué importa:** Android **rechaza instalar** sobre una app existente un APK firmado con otra
llave. Si se recompila con el keystore de release (o con un `debug.keystore` regenerado), nadie
podrá actualizar: habría que desinstalar y perder la sesión guardada.

### Reglas para no romperlo

1. 🔴 **`apps/mobile/android/` está gitignored por completo**, así que `debug.keystore` **existe solo
   en la máquina que compila** y no hay copia en el repositorio. Si se pierde, se acabó la
   posibilidad de actualizar la app instalada.
   **Hay un respaldo en `C:\keys\respaldo-debug-keystore\`.** Consérvalo.
2. **`expo prebuild --clean` borra `android/` entero**, incluido el keystore. Si se usa —y a veces
   hay que usarlo, ver abajo— **restaurar el `debug.keystore` desde el respaldo antes de compilar**,
   y comprobar la huella:
   ```bash
   keytool -list -v -keystore android/app/debug.keystore -storepass android -alias androiddebugkey
   ```
3. **Verificar SIEMPRE el APK resultante antes de publicarlo**, y compararlo con el que está en
   producción:
   ```bash
   apksigner verify --print-certs app-release.apk
   ```

> **Cuándo hace falta `--clean`:** un `prebuild` normal fusiona sobre el manifest anterior y **no
> retira** los `tools:node="remove"` de permisos que se hayan desbloqueado. Ocurrió el 2026-08-11 al
> habilitar `VIBRATE` para las notificaciones: seguía marcado para eliminarse. Si se cambian
> permisos en `app.config.js`, usar `--clean` y restaurar la llave.

### Migrar al keystore de release (pendiente, con coste)

Existe `C:\keys\monitor-ptap-release.keystore` pero **no se está usando**. Cambiar a él es lo
correcto a futuro, y tiene un precio inevitable: **todos los usuarios tendrían que desinstalar y
reinstalar**. Conviene hacerlo solo si se va a distribuir por una tienda o si el parque de
instalaciones es pequeño. Se generó así:

```bash
keytool -genkeypair -v -keystore monitor-ptap-release.keystore \
  -alias monitor-ptap -keyalg RSA -keysize 2048 -validity 10000
```

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

---

## 8. Build EN LA VM (lo que hicimos) — toolchain desechable

El PC Windows **no** pudo compilar: choca con un bug de ninja/CMake propio de Windows
(`ninja: error: manifest 'build.ninja' still dirty after 100 tries`, en el compile nativo de
`expo-modules-core`), reproducible en varios intentos. **Linux no tiene ese bug**, así que la APK se
construye **en la VM** con un toolchain **temporal que se borra al terminar** (deja la VM liviana).

> La VM es un servidor de 2 GB de RAM en producción. El build es pesado; se hace **acotado** para no
> tumbar el API/MySQL: heap topado, 1 sola ABI, `nice/ionice`, y sin R8. La swap (2 GB) absorbe
> picos. Durante el build el API sigue respondiendo (verificado: `health=200` todo el tiempo).

### Receta

1. **Instalar toolchain temporal** (autocontenido en `~/android-build` para borrarlo fácil):
   - `sudo apt-get install -y openjdk-17-jdk-headless unzip`.
   - Android SDK vía `cmdline-tools` + `sdkmanager` en `~/android-build/sdk`:
     `platform-tools`, `platforms;android-35`, `build-tools;35.0.0`, `cmake;3.22.1`,
     `ndk;27.1.12297006`.
   - `export ANDROID_HOME=~/android-build/sdk`, `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`.
2. **Prebuild** con la URL horneada:
   `cd ~/monitor-ptap/apps/mobile && API_BASE_URL=<URL del túnel> npx expo prebuild -p android --clean`.
3. **Acotar Gradle** (`apps/mobile/android/gradle.properties`):
   ```
   org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m
   org.gradle.daemon=false
   org.gradle.workers.max=1
   org.gradle.parallel=false
   kotlin.compiler.execution.strategy=in-process
   reactNativeArchitectures=arm64-v8a
   ```
   Y **desactivar R8** (en `android/app/build.gradle`, release): `minifyEnabled false` +
   `shrinkResources false` — con 2 GB de RAM, R8 dispara `OutOfMemoryError`. El APK queda un poco
   más grande (~42 MB) pero funcional. (Con más RAM se puede dejar R8 activo.)
4. **Compilar** cediendo prioridad al API:
   `cd android && nice -n 19 ionice -c3 ./gradlew assembleRelease --no-daemon`.
   Salida: `android/app/build/outputs/apk/release/app-release.apk` (firmado con la debug key del
   template Expo — suficiente para una APK de prueba).

### Alojar la APK (queda en línea, descargable)

- `sudo mkdir -p /var/www/ptap-download` (carpeta **aparte** de la web → sobrevive re-despliegues).
- Copiar el `.apk` → `/var/www/ptap-download/monitor-ptap.apk` + una página `index.html` de
  descarga con instrucciones; `chown www-data`.
- nginx: `location /descargar/` con `alias /var/www/ptap-download/` y `types { application/vnd.android.package-archive apk; }`
  (para que el navegador lo **descargue**). Enlace: **`https://<túnel>/descargar/`**.

### Limpieza (dejar la VM liviana)

`rm -rf ~/android-build ~/.gradle ~/monitor-ptap/apps/mobile/android` + `sudo apt-get purge -y
openjdk-17-jdk-headless && sudo apt-get autoremove -y && apt-get clean` + `swapoff -a && swapon -a`.
Verificar: `free -m` en baseline, sin procesos `java`/`gradle`, disco reclamado.

### Verificación del APK

`aapt2 dump badging/permissions` → `com.ptap.monitor`, `usesCleartextTraffic=false`, permisos
`INTERNET` + biometría de `expo-secure-store` (para el JWT cifrado). `unzip -l` no lista `.env`.

> **Límite**: la APK lleva horneada la **URL del túnel efímero** → si el túnel cambia hay que
> reconstruir. Para repartir de forma estable: **dominio + named tunnel** (ver
> [RUNBOOK_PRODUCCION.md](RUNBOOK_PRODUCCION.md) §8) y construir una sola vez.

## 9. iOS — fuera de alcance por ahora

iOS **no permite** instalar el `.apk`/`.ipa` por descarga directa como Android. Requiere **Apple
Developer Program ($99/año)** + firma de Apple + **TestFlight** o **Ad Hoc** (UDIDs), y compilar en
**macOS/Xcode o EAS Build (nube)**. Es la MISMA app Expo (target iOS ya configurado), no una nueva.
Alternativa inmediata en iPhone: la **web en Safari** ("Añadir a pantalla de inicio"). Diferido.
