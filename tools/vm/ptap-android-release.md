# Preparar la actualización Android en la VM

Observado el 2026-10-31: `/var/www/ptap-download/monitor-ptap.apk` es
`com.ptap.monitor`, versión 1.3.0, código 8, ABI arm64-v8a, 35 587 387 bytes.
SHA256 del archivo: `76beb266bd6055e5194c69db7975e5dcf44ffbf9b25e9141e9b78d7d20b075bc`.
La firma real verificada coincide con el `android/app/debug.keystore` existente:
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
Conservar esa clave y exigir coincidencia antes de publicar; esta huella es pública.

Expo instalado: 58.0.20; React Native instalado en la VM: 0.88.1. Su catálogo exige
compileSDK37, build-tools37.0.0, NDK27.1.12297006 y AGP9.2.1. JDK17.0.20 y ese NDK
ya estaban disponibles. AGP9.2 requiere Gradle9.4.1: el wrapper nativo antiguo9.3.1
no sirve. Google identifica la plataforma como `platforms;android-37.0`.

Gradle9.4.1 se instaló en `/home/xpertic_app/android-build/gradle-9.4.1`, tras
comparar el ZIP con la suma del distribuidor:
`2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb`.
Su LICENSE Apache2 permanece junto a la distribución. SDK `platforms;android-37.0`
revisión2 y `build-tools;37.0.0` se instalaron correctamente; `sdkmanager` terminó0 sin
pedir aceptación nueva. Las descargas oficiales SDK
usan el `sdkmanager` existente y sus verificaciones de repositorio, con entrada `n`
para rechazar cualquier licencia nueva. No ejecutar `yes | sdkmanager --licenses`.

La preflight es de lectura: no instala, compila, firma, publica, consulta Firebase ni
reinicia servicios. Requiere `PTAP_FIREBASE_PROJECT_ID` confirmado por el responsable
y valida `google-services.json` contra ese proyecto y `com.ptap.monitor`, sin mostrar
API keys. El JSON Android no sustituye las credenciales de servicio del backend;
ninguna clave privada de servicio debe entrar en la APK.

```sh
export JAVA_HOME=/home/xpertic_app/android-build/jdk
export ANDROID_HOME=/home/xpertic_app/android-build/sdk
export PATH=/home/xpertic_app/.local/node-v26.12.1/bin:$JAVA_HOME/bin:$PATH
# PTAP_FIREBASE_PROJECT_ID debe estar definido con el proyecto real confirmado.
node tools/vm/ptap-android-release-preflight.cjs
```

Faltaban al evaluar: JSON Firebase en ambos destinos, configuración compileSDK37,
wrapper compatible y proyecto nativo regenerado. La carpeta nativa antigua aún tenía
versión1.3.0/código8 frente al app.json1.4.0/código9. La preflight falla ante estas
condiciones y no permite presentar una APK sin FCM como entrega completa.

Secuencia para el responsable, después de integrar y revisar el commit y el lockfile:

1. Crear un directorio privado nuevo en `~/android-build/releases/<commit>` y extraer
   allí `git archive <commit>`. No reutilizar una carpeta ni borrar `apps/mobile/android`
   de producción. Mantener el APK publicado, clave y repositorio de producción intactos.
2. Instalar las dependencias del lockfile revisado en esa copia con `npm ci`, nunca en
   el repositorio de producción mientras sirve la API. Conservar avisos de terceros.
   La precarga independiente de dependencias terminó1: su configuración Java pedía
   JARs y rechazó las variantes AAR Android. Esto no fue un build de la app y no demuestra
   incompatibilidad de las dependencias. La caché completa no está verificada; conservar
   `~/android-build/dependency-prefetch-rn0881.log`. Hermes real usa el grupo y versión
   de las propiedades RN instaladas: `com.facebook.hermes:hermes-android:260318099.0.5`.
   No iniciar más adquisiciones/builds hasta verificar el proyecto Firebase existente,
   según la última instrucción del usuario.
3. Copiar el `google-services.json` Android del proyecto confirmado a
   `apps/mobile/google-services.json` en la copia privada. Antes de cualquier prebuild,
   ejecutar `firebaseMatches` exportado por la preflight con el proyecto confirmado;
   si falta o no coincide, detenerse. No usar credenciales EAS ni subir el proyecto.
4. Con `API_BASE_URL=https://aquora.xpertic.co`, `PTAP_REQUIRE_FCM=1`,
   `GOOGLE_SERVICES_JSON` apuntando al archivo Android autorizado y `CI=1`, ejecutar desde la copia:
   `node "$releaseDir/node_modules/expo/bin/cli" prebuild --platform android --no-install`
   **desde `"$releaseDir/apps/mobile"`**, con `releaseDir` apuntando a la copia privada.
   No usar el
   viejo script `prebuild-vm.sh`, que hace `--clean` sobre producción.
5. Copiar la clave existente preservada a `apps/mobile/android/app/debug.keystore`
   de la copia. Verificar el certificado público antes/después. En el wrapper generado,
   fijar Gradle9.4.1 y su `distributionSha256Sum` anterior, sin cambiar el lockfile.
6. Ejecutar la preflight desde la raíz de la copia. Sólo si termina0, compilar desde
   `apps/mobile/android` con el Gradle oficial instalado:

```sh
GRADLE_USER_HOME=/home/xpertic_app/android-build/gradle-home \
  /home/xpertic_app/android-build/gradle-9.4.1/bin/gradle \
  assembleRelease --no-daemon --max-workers=1 --console=plain \
  '-Dorg.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m' \
  -Pkotlin.compiler.execution.strategy=in-process
```

7. El artefacto esperado está en
   `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` de esa copia.
   Ejecutar desde su raíz `node tools/vm/ptap-android-release-preflight.cjs <ruta-APK>`.
   Exige firma real igual a la publicada, package idéntico, versión del árbol y código
   superior al publicado. Revisar también recursos Firebase y permiso de notificaciones
   del binario final con herramientas SDK antes de la prueba física.
8. Publicar únicamente el APK validado y `version.json` obtenido de ese binario,
   conservando respaldo del anterior. El script antiguo `apk-publicar.sh` apunta al
   APK del repositorio de producción, por lo que **no** publica esta copia privada:
   el responsable debe usar la ruta exacta del artefacto aprobado y publicación atómica.
9. La entrega exige una prueba autorizada en un teléfono con Google Play Services:
   actualizar sobre la versión anterior, conceder notificaciones y comprobar una alerta
   de prueba con la app en segundo plano/cerrada. No equivale a forzar detención Android;
   `force-stop` tiene restricciones propias del sistema. No manipular teléfonos sin
   autorización ni enviar alertas de planta falsas a usuarios reales.

Capacidad observada:2CPU,2.2GiB RAM,2.2GiB swap y28GiB libres. Usar1worker y heap
acotado. El runbook histórico advierte builds superiores a una hora; reservar60–120min
para un build frío y varios GB, como estimación sin benchmark de esta versión. No
prometer duración ni entrega de notificaciones hasta terminar la prueba real.

Referencias: [Expo58](https://docs.expo.dev/versions/v58.0.0/),
[notificaciones Expo58](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/),
[AGP9.2/9.2.1](https://developer.android.com/build/releases/agp-9-2-0-release-notes),
[Gradle9.4.1](https://docs.gradle.org/9.4.1/release-notes.html).
