# Publicar la APK validada desde staging

Preparación sin ejecución. Usar únicamente después de que el build ya iniciado
termine0 **incluida su preflight final**. No repetir build ni suites de pruebas.

Artefacto:
`/home/xpertic_app/android-build/releases/release-e2cf4d4ee164-CFMDWd/apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
El helper `build-android` ejecuta preflight antes y después de Gradle. La segunda
comprueba firma real, package y versión/código contra el binario publicado.
No produce un recibo JSON de APK/firma: su evidencia final queda en stdout.
Debe indicar certificado
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
y candidata1.4.0/código9. Conservar esa salida y el exit0; después calcular el
SHA256/tamaño del artefacto exacto y registrar ruta/hash en la evidencia privada.

Después del exit0 completo, ejecutar **como usuario ordinario**, sin sudo, el
suplemento de sólo lectura `ptap-apk-inspect.cjs`:

```sh
/home/xpertic_app/.local/node-v26.12.1/bin/node "$reviewedInspector"
```

La salida es un JSON de booleanos, SHA256, tamaño y conteos. No imprime recursos,
configuración, bundles, nombres privados ni errores de herramientas. Debe terminar0.
Comprueba permiso POST_NOTIFICATIONS, IDs Firebase compilados contra el JSON
ignorado, URL exacta del `assets/app.config` que lee `Constants.expoConfig`, ausencia
de trycloudflare en config/bundles y nombres/material JSON de credenciales privadas.
El literal Hermes se informa aparte: no se exige duplicarlo si el config empacado
resuelve exactamente `https://aquora.xpertic.co`. El inspector no invoca apksigner
ni repite la preflight de firma. Usar su SHA256 como entrada aprobada al publicador.

La preflight no demuestra recepción en un teléfono. Antes de distribuir,
comprobar en el APK final permiso de notificaciones, recursos Firebase y dominio
HTTPS horneado con el inspector anterior, reduciendo salida a booleanos/conteos;
no volcar strings/recursos completos ni claves. La prueba dirigida física sigue
pendiente incluso cuando estas comprobaciones pasan.

## Destino y permisos comprobados

El 2026-11-02 a las16:36UTC, `/var/www/ptap-download` era www-data:www-data0755,
sin escritura para `xpertic_app`. Hace falta una operación administrativa para la
publicación. El publicador web NOPASSWD tiene otro destino y no publica APKs.
No se modificó política sudo ni se adquirieron privilegios en esta preparación.

El `version.json` existente tiene sólo `version`, `versionCode` y `notes`:
1.3.0/código8. El API lo relee en cada petición; publicar no requiere reiniciar
API, recargar nginx ni cambiar configuración TLS.

APK anterior conocido: SHA256
`76beb266bd6055e5194c69db7975e5dcf44ffbf9b25e9141e9b78d7d20b075bc`.
Si cambió antes de publicar, detenerse y revisar la nueva publicación.

## Material preparado en privado

Conservar bajo un directorio nuevo0700 de `~/.config/aquora-push`:

- copia exacta del APK publicado anterior y del `version.json` anterior;
- copia del candidato final con su SHA256/tamaño y evidencia preflight;
- el metadato nuevo0600, que conserva el contrato existente:

```json
{
  "version": "1.4.0",
  "versionCode": 9,
  "notes": "Notificaciones de planta por push en Android, también con la aplicación cerrada. Configuración y prueba de avisos desde Ajustes."
}
```

Los valores1.4.0/9 se aceptan sólo cuando la preflight final los confirmó en el
binario. El recibo privado puede incluir package, certificado, SHA256, tamaño,
origen del build y fecha; no agregar credenciales ni tokens. Los respaldos no
deben quedar en el directorio público.

## Operación administrativa revisable

`tools/vm/ptap-apk-publish.cjs` implementa publicación y rollback. No se ha ejecutado.
Cuatro pruebas nuevas, íntegramente en filesystem de memoria, cubren hash erróneo,
orden de publicación y backups, restauración ante fallo del segundo rename y
rechazo de una publicación ajena al revertir. No ejercieron privilegios ni rutas
reales del servidor.
Requiere Node18+ instalado por el sistema y con propietario root. Sólo usa módulos
integrados; no ejecuta SDKs, scripts de usuario, builds ni servicios con privilegios.
El administrador instala **los bytes revisados** del helper en una ruta root,
compara allí su SHA256 y lo ejecuta desde una terminal administrativa:

```sh
sudo install -o root -g root -m 0755 "$reviewedHelper" \
  /usr/local/sbin/ptap-apk-publish.cjs
# Comparar con el SHA256 exacto entregado; no ejecutar si difiere.
sha256sum /usr/local/sbin/ptap-apk-publish.cjs
sudo env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node \
  /usr/local/sbin/ptap-apk-publish.cjs publish "$candidateSha256"
```

`candidateSha256` es el hash del APK exacto tras la preflight final0 ya ejecutada
por `build-android`. El helper no repite los validadores SDK ni reconstruye:
se apoya explícitamente en esa aceptación previa y enlaza la publicación a los
bytes aprobados. No invocarlo antes de completar esa aceptación. Las versiones
1.4.0/9 y el certificado esperado del recibo corresponden a ese contrato aprobado.

El helper exige que él mismo, Node y sus directorios sean root y no escribibles
por otros; rechaza enlaces y cambios durante lectura. Guarda APK/meta anteriores,
hashes y recibo bajo `/var/backups/aquora-apk/publication-*` root0700/archivos0600.
Exige que el destino y esa copia privada estén en el mismo filesystem. Prepara
archivos en el directorio privado root, verifica hashes y sólo entonces hace
rename al directorio público, con propietario www-data/modo0644. No deja temporales
sin verificar en rutas legibles desde Internet.

Un lock exclusivo evita publicaciones simultáneas por este helper. Comprueba que
lo anterior siga siendo el APK conocido1.3.0/8, publica **APK primero, metadato
después**, verifica ambos hashes y entrega `rollbackDirectory`. Ante fallo después
del primer cambio intenta revertir; conserva el recibo incluso si debe intervenir
el administrador. Un lock de un proceso muerto requiere revisar PID/estado antes
de retirarlo manualmente.

La pareja APK/metadato no se cambia en una única operación con el contrato actual
de dos archivos. El orden deja brevemente metadato8 con APK9; el aviso de
actualización aparece al cambiar el metadato a9.

Comprobar `/api/app/version` por HTTPS: versión1.4.0/código9/tamaño real/enlace
de descarga. Comprobar HEAD de la APK por HTTPS y headers/tamaño, y comparar
descarga controlada por hash cuando corresponda a la aceptación. No afirmar
que se instaló o recibió push sólo porque la publicación devuelve200.

## Reversión de la publicación

Conservar el `rollbackDirectory` devuelto y, si hace falta revertir:

```sh
sudo env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node \
  /usr/local/sbin/ptap-apk-publish.cjs rollback "$rollbackDirectory"
```

Valida recibo/backups root privados y hashes actuales, prepara copias dentro del
directorio privado y cambia mediante rename **metadato anterior primero y APK
anterior después**. Rechaza sobreescribir una publicación ajena posterior.
Comprobar `/api/app/version`; mantener respaldos y evidencia del candidato fallido.
No borrar el build privado.

Esta reversión cambia lo ofrecido para descargar. No desinstala ni degrada
teléfonos que ya tengan1.4.0; Android no permite una actualización normal hacia
un versionCode menor. No modificar la firma ni pedir desinstalación para
resolver una reversión del servidor.
