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

### El `debug.keystore` de Expo es FIJO, no aleatorio

> Corregido el 2026-08-11 tras comprobarlo. Una versión anterior de este documento advertía de que
> `expo prebuild --clean` generaría una llave nueva y rompería las actualizaciones. **No es así.**

Se verificó compilando en una máquina distinta (la VM, sin ningún keystore previo): el
`debug.keystore` que generó el prebuild tenía **exactamente la misma huella** `fac61745…` que el de
la máquina Windows. Expo trae una llave de depuración fija en su plantilla, igual en todas partes.

En la práctica: **un `prebuild --clean` en cualquier máquina produce un APK compatible** con el
instalado. Copiar la llave a mano es innecesario — aunque tampoco estorba como red de seguridad.
Hay un respaldo en `C:\keys\respaldo-debug-keystore\`.

Lo que sí sigue siendo obligatorio: **verificar el APK antes de publicarlo**, porque es lo único
que confirma que se podrá instalar encima del anterior.

```bash
apksigner verify --print-certs app-release.apk
# debe dar: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
```

> `apksigner` necesita `JAVA_HOME` apuntando a un JDK. Sin él **no imprime nada y no falla**, lo que
> se confunde fácilmente con "el APK no está firmado".

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

Desde `apps/mobile`, horneando la URL del backend en el build. **Es el dominio, no un túnel**: el
quick tunnel de Cloudflare se apagó el 2026-08-11 al publicarse `aquora.xpertic.co` tras la NAT 1:1
(`ceffdc8`). Una APK compilada con la URL del túnel no conecta con nada.

```bash
# Windows PowerShell
$env:API_BASE_URL = "https://aquora.xpertic.co"
npx expo prebuild -p android      # genera apps/mobile/android/ (ignorado por git)
```

> En la VM esto ya está resuelto: `~/deploy-scripts/apk-build.sh` exporta esa misma URL. Y los
> perfiles de `eas.json` también la traen — aunque hoy la APK NO se construye con EAS, sino con
> gradlew en la VM (ver "Build en la VM").

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

- **Ya migrado a dominio propio** (2026-08-11): `https://aquora.xpertic.co`, con TLS de Let's
  Encrypt. El túnel de Cloudflare está apagado y no debe volver a usarse en builds nuevos.
- **Si algún día cambia el dominio** → misma receta, cambiando `API_BASE_URL` en TRES sitios:
  `~/deploy-scripts/apk-build.sh` (la build real), `apps/mobile/eas.json` (por si se usa EAS) y §3
  de este documento. No hay nada más que tocar en el código: la URL no está hardcodeada, se inyecta
  en el build.

> ⚠️ **La URL viaja HORNEADA en la APK.** Quien tenga una APK vieja seguirá apuntando a donde se
> compiló, y no existe actualización automática: no hay `expo-updates` ni canal de EAS Update
> configurado (verificado el 2026-08-13). Cambiar de dominio obliga a recompilar y a que **cada
> persona reinstale**.

---

## 8. Build EN LA VM (lo que hicimos) — toolchain desechable

El PC Windows **no** pudo compilar: choca con un bug de ninja/CMake propio de Windows
(`ninja: error: manifest 'build.ninja' still dirty after 100 tries`, en el compile nativo de
`expo-modules-core`), reproducible en varios intentos. **Linux no tiene ese bug**, así que la APK se
construye **en la VM** con un toolchain **temporal que se borra al terminar** (deja la VM liviana).

> 🧠 **La VM tiene memoria DINÁMICA de Hyper-V (`hv_balloon`).** En reposo `free` reporta ~2,2 GB,
> pero bajo carga el hipervisor le concede hasta ~7 GB. Los dos valores son ciertos, cada uno en su
> momento — no es un error de lectura. Por eso el build cabe aunque el baseline parezca insuficiente.
> Aun así conviene acotarlo: el API y MySQL comparten la máquina. Verificado el 2026-08-11: durante
> todo el build `/api/health`, `/api/health/db`, `/api/health/opc` y nginx respondieron **200**, y
> `pm2` conservó su uptime.

### El ORDEN importa (y no es el que parece)

`config-and-ndk.sh` escribe en `android/gradle.properties`, que **no existe hasta después del
prebuild**. Ejecutarlo antes falla con `No such file or directory`. El orden correcto es:

```
install-sdk.sh  →  prebuild-vm.sh  →  config-and-ndk.sh  →  apk-build.sh
```

### Receta

1. **JDK sin `sudo`.** Los scripts esperaban `/usr/lib/jvm/java-17-openjdk-amd64`, pero en la VM
   solo está el **JRE** (`java: command not found`). En vez de pedir `sudo apt install openjdk-17-jdk`,
   se baja un **JDK portátil dentro del propio toolchain desechable**, así se va con la limpieza:
   ```bash
   mkdir -p ~/android-build && cd ~/android-build
   curl -fsSL -o jdk.tar.gz "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
   mkdir -p jdk && tar xzf jdk.tar.gz -C jdk --strip-components=1 && rm jdk.tar.gz
   ```
   Los scripts usan `export JAVA_HOME="${JAVA_HOME:-$HOME/android-build/jdk}"`, así que respetan un
   JDK del sistema si algún día se instala.
2. **`install-sdk.sh`** — SDK en `~/android-build/sdk`: `platform-tools`, `platforms;android-35` y
   `android-36`, `build-tools;35.0.0` y `36.0.0`, `cmake;3.22.1`.
   > El proyecto pide **compileSdk/targetSdk 36** (`app.config.js`); el script instalaba solo el 35.
3. **`prebuild-vm.sh`** — hornea `API_BASE_URL` y hace `expo prebuild -p android --clean`.
4. **`config-and-ndk.sh`** — instala el NDK `27.1.12297006` y acota Gradle:
   ```
   org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m
   org.gradle.daemon=false
   org.gradle.workers.max=2
   org.gradle.parallel=false
   kotlin.compiler.execution.strategy=in-process
   reactNativeArchitectures=arm64-v8a
   ```
   > Con el heap en 1024m el build es mucho más lento sin necesidad: el balloon concede memoria de
   > sobra. 3 GB funcionó bien y dejó el servicio intacto.
5. **`apk-build.sh`** — compila cediendo prioridad al API (`nice -n 19 ionice -c3`). Tarda ~30 min.
   Salida: `android/app/build/outputs/apk/release/app-release.apk` (~35 MB).

### Lanzarlo sin que muera con la sesión SSH

El build dura más que una sesión SSH estable sobre la IP pública. **Hay que desacoplarlo de verdad**
—`setsid` + `nohup` + `disown`— y esperar por el archivo centinela, no por la conexión:

```bash
setsid nohup bash ~/deploy-scripts/apk-build.sh >/dev/null 2>&1 </dev/null & disown
# esperar con conexiones CORTAS, no una larga:
until ssh ptap 'test -f ~/apk-build.done'; do sleep 45; done
```

> ⚠️ **Nunca uses `pkill -f` / `pgrep -f` con un patrón que aparezca en tu propio comando SSH**: el
> patrón coincide con tu sesión y la mata. Pasó tres veces el 2026-08-11. Si hay que detener el
> build, pon la lógica en un script en la VM (su línea de comando no contiene el patrón) o filtra
> por PID excluyendo el árbol propio.

> ⚠️ **Comprueba que el build no sigue vivo antes de relanzarlo.** El proceso real es
> `~/android-build/jdk/bin/java --add-opens=...`, que **no** contiene `GradleWrapperMain` ni
> `GradleDaemon`: buscar esos nombres da falso negativo. Dos Gradle sobre el mismo directorio
> comparten cachés y salidas — hay que matar ambos y empezar de cero.

### Alojar la APK (queda en línea, descargable)

La carpeta `/var/www/ptap-download` es **aparte** de la web, así que sobrevive a los re-despliegues.
nginx ya tiene su `location /descargar/` con el tipo MIME de APK, de modo que el navegador lo
descarga en vez de abrirlo. Enlace: **`https://aquora.xpertic.co/descargar/`**.

> 🔴 **NO uses `host-apk.sh`.** Tras copiar el APK hace
> `cp ~/ptap-web.nginx /etc/nginx/sites-available/ptap`, es decir **pisa la configuración de nginx**
> y borra los server blocks de HTTPS. Es el mismo defecto de `web-setup.sh`. El script lleva un
> aviso en su cabecera desde el 2026-08-11.

Publicar solo el archivo, sin tocar nginx:

```bash
sudo install -o www-data -g www-data -m 644 \
  ~/monitor-ptap/apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
  /var/www/ptap-download/monitor-ptap.apk
```

### Verificación del APK — antes de publicarlo

Las tres que importan:

```bash
export JAVA_HOME=~/android-build/jdk          # sin esto apksigner calla y no falla
apksigner verify --print-certs app-release.apk # firma: debe ser fac61745…
unzip -p app-release.apk 'assets/*' | grep -c aquora.xpertic.co   # URL correcta horneada
unzip -p app-release.apk 'assets/*' | grep -c trycloudflare       # debe ser 0
aapt2 dump permissions app-release.apk                            # permisos esperados
```

Permisos esperados: `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE`, más los que aportan
`expo-notifications` y `expo-background-task` (`RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`,
`FOREGROUND_SERVICE`, badges de fabricantes). **No** deben aparecer `SYSTEM_ALERT_WINDOW` ni
`READ/WRITE_EXTERNAL_STORAGE`.

### Limpieza (dejar la VM liviana)

Con el JDK portátil todo cabe en un solo borrado, **sin `sudo`**:

```bash
rm -rf ~/android-build ~/.gradle ~/monitor-ptap/apps/mobile/android
rm -f ~/apk-build.log ~/apk-build.done
npm cache clean --force
```

Verificar con `df -h /` antes y después. El 2026-08-11 esto recuperó **~8,6 GB** (de 17 G usados a
8,4 G), sumando también `ptap-fieldtest/node_modules`.

> Conserva una copia del APK fuera del árbol de build (p. ej. `~/monitor-ptap-<fecha>.apk`) antes de
> borrar, por si hace falta republicarlo sin recompilar.

## 9. iOS — fuera de alcance por ahora

iOS **no permite** instalar el `.apk`/`.ipa` por descarga directa como Android. Requiere **Apple
Developer Program ($99/año)** + firma de Apple + **TestFlight** o **Ad Hoc** (UDIDs), y compilar en
**macOS/Xcode o EAS Build (nube)**. Es la MISMA app Expo (target iOS ya configurado), no una nueva.
Alternativa inmediata en iPhone: la **web en Safari** ("Añadir a pantalla de inicio"). Diferido.
