# Staging privado de API, web y APK — 2026-11-02

La preparación no modifica el repositorio de producción, sus dependencias, PM2,
la base de datos ni los directorios publicados. Cada operación usa una release
nueva privada bajo `/home/xpertic_app/android-build/releases`.

## Estado observado por SSH de sólo lectura

Acceso con hostkey existente y comprobación estricta:

```sh
ssh -p 7498 -i ~/.ssh/id_ed25519_centro_gestion \
  -o BatchMode=yes -o StrictHostKeyChecking=yes \
  xpertic_app@181.204.165.66
```

El 2026-11-02 a las 16:06 UTC, producción estaba en `yosh`, commit
`a7a3222bff2a75305ed97dbc020409b21db57106`, sin modificaciones rastreadas
ni archivos nuevos no ignorados. No se inspeccionaron archivos privados ajenos.

Node26.12.1, JDK17.0.20, SDK37.0, build-tools37.0.0, NDK27.1.12297006 y
Gradle9.4.1 están presentes. El wrapper del árbol nativo antiguo sigue en9.3.1;
el helper regenera Android en la release y fija9.4.1 con el checksum oficial ya
verificado. Hay unos25.9GiB libres y1.4GiB de RAM disponible, más swap; usar un
worker. La caché completa de dependencias Android sigue sin comprobarse.

APK publicado: `com.ptap.monitor`,1.3.0/código8, SHA256
`76beb266bd6055e5194c69db7975e5dcf44ffbf9b25e9141e9b78d7d20b075bc`.
Certificado SHA256 comprobado con apksigner37:
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
La preflight admite las etiquetas de apksigner antiguo y las de37 (`V2 Signer:`),
exigiendo un único certificado aunque aparezca para varias versiones de firma.

## Preparar el material autorizado

El coordinador genera `source.tar` desde `git archive HEAD` más un overlay
explícito de los cambios de esta tarea. No empaquetar todo el working tree:
excluir cambios preexistentes de layout/login/componentes visuales, `+html`,
robots/herramientas web y `cotizacion-aquora-local`. Conservar licencias y avisos
del baseline. Incluir los nuevos helpers/preflight y fuentes push autorizadas.
El helper no crea commits ni cambia el índice local.

Calcular SHA256 del tar y del `google-services.json` local autorizado. Transferir
por ese SSH a un directorio privado nuevo creado con `umask077` y `mktemp -d`
bajo `~/android-build`. Transferir también `ptap-stage-release.cjs` y
`ptap-android-release-preflight.cjs`, verificando sus hashes en destino. No usar
`StrictHostKeyChecking=no` ni pegar credenciales en comandos o chat.

La configuración Android pertenece al proyecto confirmado `desarrollo-1b2ba`
y al paquete `com.ptap.monitor`; es independiente de la cuenta de servicio FCM.
La clave de servicio nunca entra en el tar, el directorio móvil ni la APK.

En la VM, con rutas y hashes exactos ya comprobados:

```sh
NODE=/home/xpertic_app/.local/node-v26.12.1/bin/node
# incoming apunta al directorio privado recién creado, sin reutilizar producción.
"$NODE" "$incoming/ptap-stage-release.cjs" prepare \
  "$incoming/source.tar" "$sourceSha256" \
  "$incoming/google-services.json" "$googleSha256"
```

Guardar `stage` de la salida JSON. Se comprueban hashes, tamaño, proyecto,
paquete y listado del tar; se rechazan rutas privadas, traversal, enlaces y
objetos especiales. Se extrae en una release nueva0700, se conserva Firebase600
y se escribe un recibo600. `git init` sólo crea metadatos locales de esa copia,
necesarios para el `git check-ignore` de la preflight; no se agrega configuración
Firebase al índice.

## Dependencias y builds separados

Sólo ejecutar estos pasos cuando el coordinador avance a esa fase:

```sh
"$NODE" "$stage/tools/vm/ptap-stage-release.cjs" install "$stage"
"$NODE" "$stage/tools/vm/ptap-stage-release.cjs" build-web-api "$stage"
"$NODE" "$stage/tools/vm/ptap-stage-release.cjs" build-android "$stage"
```

`install` usa `npm ci --ignore-scripts --no-audit --no-fund` en la copia. No
enlaza `node_modules` de producción, que no tiene las nuevas dependencias Web
Push. Prueba argon2, esbuild y web-push sin red. Si una dependencia necesita un
script de instalación, falla: revisar ese script concreto antes de una ejecución
acotada; no habilitar todos los lifecycle scripts para resolverlo.

`build-web-api` compila shared/API y exporta web con `API_BASE_URL=` para mismo
origen. No carga `.env` ni arranca la API. `build-android` usa el dominio HTTPS
real, FCM obligatorio y configuración validada, ejecuta prebuild sólo en la
release, copia la firma existente sin mostrar su contenido y comprueba la
preflight antes y después del Gradle con un worker/heap acotado. Mantener la
release y la evidencia de un fallo; el helper no borra ni intenta reparar
producción. No instala SDKs ni acepta licencias nuevas.

El primer intento terminó con `OutOfMemoryError: Metaspace` en
`lintVitalAnalyzeRelease` con límite384MiB; el cliente/daemon quedaron colgados
aunque la tarea había fallado. El coordinador confirmó y terminó exclusivamente
ese árbol fallido. La reanudación conserva árbol nativo, firma, wrapper y cachés:

```sh
nice -n 10 ionice -c 2 -n 7 "$NODE" \
  "$stage/tools/vm/ptap-stage-release.cjs" resume-android "$stage"
```

Antes, actualizar ese helper con su hash revisado y confirmar que el build fallido
ya no está activo. `resume-android` valida la misma release/configuración FCM,
ejecuta preflight, `assembleRelease` y preflight final si Gradle termina0. No hace
prebuild, copia de clave ni regeneración. Tanto build nuevo como resume usan
`-Xmx1536m -XX:MaxMetaspaceSize=768m -XX:+ExitOnOutOfMemoryError`, un worker y Kotlin
en proceso. Lint sigue habilitado. nice/ionice desde el arranque alcanzan también
a los hilos/hijos nuevos sin cambiar procesos API.

Salidas: `$stage/apps/api/dist`, `$stage/packages/shared/dist`,
`$stage/apps/mobile/dist` y
`$stage/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.

## Activación posterior, separada del staging

Todavía requiere coordinación: instalación privada de la cuenta de servicio
autorizada, comparación de proyecto, configuración FCM/VAPID del API, backup
previo a la migración Web Push y cambio de proceso. El backend busca `.env` en
la raíz de la release por ubicación del build; preparar esa referencia privada
sólo después de los builds. No iniciar una segunda API contra OPC/producción
para probar esta copia.

El publicador root existente `/usr/local/sbin/ptap-web-publish` tiene origen fijo
`/home/xpertic_app/monitor-ptap/apps/mobile/dist`: no acepta la ruta de staging.
La publicación posterior debe respaldar y preparar ese origen con el bundle
validado o usar una operación root revisada para la ruta exacta. La web pública
vive en `/var/www/ptap-web`; el APK y `version.json`, en `/var/www/ptap-download`.
No invocar el `ptap-deploy.sh` antiguo: hace `reset --hard`, migración y reinicio.
El helper nuevo no publica, migra ni reinicia servicios.

La entrega completa exige prueba dirigida en teléfono autorizado y comprobación
de Web Push con la pestaña cerrada. Un build o aceptación de FCM no demuestra
recepción real.
