# Activación reversible desde la release privada

Operación preparada para
`/home/xpertic_app/android-build/releases/release-e2cf4d4ee164-CFMDWd`,
bundle `e2cf4d4ee164f0660bbb8f61ce82a29d1f026d264a738c0c5b0fd656425b1907`.
El helper no se ejecutó contra producción al prepararlo.

```sh
NODE=/home/xpertic_app/.local/node-v26.12.1/bin/node
STAGE=/home/xpertic_app/android-build/releases/release-e2cf4d4ee164-CFMDWd
# HELPER apunta al archivo revisado y transferido con su SHA256 exacto comprobado.
"$NODE" "$HELPER" plan "$STAGE"
"$NODE" "$HELPER" activate "$STAGE"
# Reversión explícita, si fuera necesaria:
"$NODE" "$HELPER" rollback "$STAGE"
```

`plan` sólo lee: valida la release y sus artefactos, entorno privado, cuenta FCM
del proyecto autorizado, par VAPID, PM2, privilegio sobre el publicador existente,
historial de migraciones en transacción de lectura y hashes web. No imprime claves,
tokens, contraseñas ni contenido del entorno. `activate` y `rollback` cambian el
servicio; ejecutarlos sólo durante la fase de activación coordinada.

El wrapper se crea fuera de la release en
`~/.config/aquora-push/activation-release-e2cf4d4ee164-CFMDWd/runtime.cjs`.
Carga el dotenv instalado en stage, lee `~/monitor-ptap/.env` con prioridad sobre
el entorno inicial y luego las cuatro claves de `~/.config/aquora-push/push.env`:
`FIREBASE_SERVICE_ACCOUNT_PATH`, `WEB_PUSH_VAPID_PUBLIC_KEY`,
`WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`. Rechaza otras claves.
La cuenta FCM debe permanecer como JSON privado0600 en ese directorio y pertenecer
a `desarrollo-1b2ba`. Los errores de JSON/crypto se sustituyen por mensajes genéricos
antes de llegar al log de PM2.

PM2 arranca el wrapper y conserva **cwd de producción**
`/home/xpertic_app/monitor-ptap/apps/api`: OPC usa `cwd/pki`, los informes
`cwd/reports` y el mapping se busca en `cwd/config`. El código y dependencias se
cargan desde stage. No se crea stage/.env, por lo que puede continuar el build APK.
Las claves push se cargan dentro del proceso después de arrancarlo; no se incluyen
en `next.config.json` ni en el entorno guardado por PM2. Los snapshots/configs son
0600 dentro de un directorio0700; `pm2 save` termina dejando dump/backup0600.

Antes de cambiar el proceso, el helper guarda la descripción PM2 completa,
una configuración restaurable y una copia verificada de la web pública. Ejecuta
exclusivamente `0016_web_push_subscription.sql`, con hash fijado y lock MySQL;
exige que0001–0015 estén registradas. No usa el runner general ni modifica tablas
históricas. Una tabla0016 existente sin marcador requiere revisión, porque DDL
MySQL hace autocommit. La reversión de la aplicación conserva0016 y los datos de
suscripciones; no hace DROP ni restaura datos sobre actividad reciente.

Antes de tocar el servicio, el precheck de salud permite60s con reintentos y10s
por petición; si falla sólo expone los estados HTTP de las tres rutas o
`timeout-or-network`. La fase permite distinguirlo de validación privada/PM2.
El cambio API hace `pm2 delete` antes de `pm2 start`, evitando dos conexiones OPC
de aplicaciones distintas simultáneamente. Hay una breve parada. Espera hasta
180s por HTTP200 en health, DB y OPC; ante fallo intenta restaurar el proceso previo.

La publicación usa el publicador root existente, cuyo hash está fijado. Su origen
es `~/monitor-ptap/apps/mobile/dist`; el helper mueve temporalmente **sólo ese
directorio generado**, coloca una copia de la web construida, publica y restaura
el origen original incluso ante error. No cambia fuentes ni dependencias
productivas. Compara todo el árbol público con el bundle; comprueba HTTPS y bytes
del service worker. El publicador existente copia archivos con una ventana breve
de actualización; no ofrece atomicidad. Ante fallo, se intenta publicar la copia
anterior y restaurar la API. Si el rollback falla, queda `rollback-failed` con fase
acotada en el estado privado; conservar las evidencias y revisar antes de reintentar.

El estado queda en
`~/.config/aquora-push/activation-release-e2cf4d4ee164-CFMDWd/state.json`.
Un lock exclusivo evita activaciones simultáneas. Si el proceso muere, no se borra
automáticamente un lock viejo: comprobar su PID y el estado primero. No eliminar
la carpeta privada de activación mientras PM2 dependa del wrapper.

La salud y los hashes no prueban entrega de push. Después de activar corresponde
la prueba dirigida del usuario autenticado y observación con web/app cerrada.
Una reversión no retira mensajes que el proveedor ya haya aceptado.
