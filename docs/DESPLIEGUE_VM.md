# Despliegue en la VM desde una release

> **Procedimiento de 2026-11-13, revisado contra la VM y todavía sin ejecutar.** Despliega `yosh` en `2851123`: integración de
> Cabuyo, consigna de su válvula de salida (autorizada por Operación el 2026-11-13), `82ed232` y `72f46d4`.
>
> **No usar `ptap-deploy.sh`.** Hace `reset --hard`, migra y recrea `ptap-api` desde `ecosystem.config.js`.
> Eso quitaría el wrapper que carga las claves de push.
>
> **Las maniobras están habilitadas en producción.** En el `.env` están `OPCUA_WRITES_ENABLED=true`,
> `OPCUA_TRUSTED_NETWORK_WRITES=true`, `OPCUA_TRUSTED_NETWORK_APPROVAL`, `COMMAND_SIGNING_SECRET` y
> `COMMAND_CHECKPOINT_PATH`. Al terminar,
> la consigna de Cabuyo queda **operable** desde la app.

## Quién hace cada paso

| Paso | Quién |
|---|---|
| 0. Aviso a Operación | Coordinador, con Operación |
| 1. Comprobaciones previas | `xpertic_app` |
| 2. Respaldo | `xpertic_app` |
| 3. Release nueva | `xpertic_app` |
| 4. Mapping | `xpertic_app` |
| 5. Cambio de PM2 | `xpertic_app` |
| 6. Web | `xpertic_app` prepara; **Pedro** ejecuta `sudo` (pide contraseña) |
| 7. Verificación | `xpertic_app`; la web, cualquiera con usuario de la app |
| 8. Vuelta atrás | `xpertic_app`; la web, **Pedro** (`sudo`) |
| Primera maniobra | Operación presente, en un paso aparte |

## Estado actual de la VM (leído el 2026-11-13)

| Qué | Dónde |
|---|---|
| Wrapper en uso (lo arranca PM2) | `~/.config/aquora-push/autonomy-FK0Hh6rg/runtime.cjs` |
| Lo que hace | `require(".../activation-release-e2cf4d4ee164-CFMDWd/runtime-helper.cjs").boot("~/android-build/releases/autonomy-EPGLRa")` |
| Helper | `runtime-helper.cjs`, SHA-256 `40ee0823…786d4` = `tools/vm/ptap-activate-release.cjs` de `2851123` (**coincide**) |
| Release en uso | `~/android-build/releases/autonomy-EPGLRa` (`apps/api/dist/main.js` del 2026-11-02 14:00); existe también `release-e2cf4d4ee164-CFMDWd` |
| Activación actual | `autonomy-FK0Hh6rg/`: `before.config.json`, `next.config.json`, `receipt.json`, `runtime.cjs`, `manifest.json`, `overlay/`, `overlay.tar`, `ptap-autonomy-release.cjs`, `ptap-autonomy-inspect.cjs`, `copy-activate/`, `web-before/` |
| Activación de `e2cf4d4` | `next.config.json`, `previous.config.json`, `previous.pm2.json`, `publisher-copy-activate/`, `runtime.cjs`, `runtime-helper.cjs`, `state.json`, `web-before/` |
| Web publicada | 2026-11-02 18:29 (23:29 UTC), activación `css-js-L7gvFYCH`. Cadena del 2026-11-02: `mobile-hotfix-jlVMB0` (solo APK) → `autonomy-FK0Hh6rg` (API + web, 19:04 UTC) → `valve-ui-ijrmlcUZ` (web, 20:06 UTC) → `css-js-L7gvFYCH` (web, 23:29 UTC) |
| Respaldos del publicador | `/var/www/ptap-web.bak-20261031-124155`, `-20261102-114126`, `-20261102-140424`, `-20261102-150630`, `-20261102-182921` (ya hay 5: la próxima publicación borra el más antiguo) |
| PM2 | `status online`, `script` = `autonomy-FK0Hh6rg/runtime.cjs`, `exec cwd` = `~/monitor-ptap/apps/api`, `interpreter` = Node 26.12.1; **coincide** con `autonomy-FK0Hh6rg/next.config.json` |
| Firebase (Android, público) | `autonomy-EPGLRa/apps/mobile/google-services.json`, SHA-256 `b4dcaa6f96b4fafaaf286c426bd64f9ba3d1d4c60e92282bc2bd7f027d20545c` |
| Publicador | `/usr/local/sbin/ptap-web-publish` (root, **sudo con contraseña**). Copia `SRC=/home/xpertic_app/monitor-ptap/apps/mobile/dist` en `DST=/var/www/ptap-web`, respalda antes en `/var/www/ptap-web.bak-<fecha>` (conserva 5) y recarga nginx |
| Maniobras | habilitadas: `OPCUA_WRITES_ENABLED`, `OPCUA_TRUSTED_NETWORK_WRITES`, `OPCUA_TRUSTED_NETWORK_APPROVAL`, `COMMAND_SIGNING_SECRET`, `COMMAND_CHECKPOINT_PATH` |
| Migraciones | `0016_web_push_subscription.sql` aplicada; esta versión no trae migraciones nuevas |
| Disco | 8,1 GB libres (82 % de 47 GB). Releases: `autonomy-EPGLRa` 2,1 GB, `release-e2cf4d4ee164-CFMDWd` 2,8 GB |

**La release actual no salió de un commit, pero `yosh` la contiene entera (revisado el 2026-11-13).**
Producción es una release base más tres *overlays* hechos con helpers que no están en el repo
(`ptap-autonomy-release.cjs`, `ptap-css-js-release.cjs`, `ptap-valve-ui-release.cjs`; están en `.gitignore`
desde `82ed232`). Se comparó cada archivo de los overlays con la historia de git
(`entrega/revision-release-actual.txt`):

| Overlay | Archivos | Resultado |
|---|---|---|
| `autonomy-FK0Hh6rg` | 12 (autonomía de tanques: `plant-pipeline.service`, `tank-autonomy.*`, `tanks*`, `memo-compare`, `TankGaugeCard`, `shared/index.ts`, 2 tests) | 10 idénticos a `82ed232` (8 con finales de línea CRLF). `TankGaugeCard.tsx` (`f1eeb039`) ya no corre: `css-js` lo sustituyó. `packages/shared/src/index.ts` (`8ea59ff6`): su diff respecto a `f0abbd8`, revisado en la VM, solo cambia el bloque `TankAutonomyDto`, idéntico al de `2851123` |
| `css-js-L7gvFYCH` | 12 + el borrado de `useWebEscape.ts` | 12 idénticos a `82ed232` (con CRLF salvo `useReducedMotion.ts`); `useWebEscape.ts` tampoco existe en `yosh` |
| `valve-ui-ijrmlcUZ` | `ValveItem.tsx` (`aae1e7db`) | idéntico a `82ed232` (CRLF) |
| `mobile-hotfix-jlVMB0` | solo APK (`app.json`/`app.config.js`) | sin API ni web |

`82ed232` es ancestro de `2851123`. Después, `yosh` solo cambió de esos archivos lo de la consigna
(`memo-compare.ts`, `ValveConfirmDialog.tsx`, `ValveItem.tsx`, `shared/index.ts`: `SignalDto.setpoint`).
**Conclusión: 25/25 archivos de producción están cubiertos por `yosh`; desplegar `2851123` no quita nada.**
El hash `8ea59ff6` de `shared/index.ts` no se reprodujo en local (no se trajo el archivo): la conclusión
de ese archivo se apoya en el diff revisado en la VM.

Lo que hace `boot(stage)` (`tools/vm/ptap-activate-release.cjs`):
1. Carga `~/monitor-ptap/.env` y las 4 claves de `~/.config/aquora-push/push.env`.
2. Arranca `stage/apps/api/dist/main.js`.

No comprueba el nombre de la release, así que vale para una release nueva sin cambiar el helper. El
proceso corre con `cwd` `~/monitor-ptap/apps/api`, y de ahí lee `config/opc_mapping.json` y `pki/`.

Al reiniciar, el backend **no escribe en el PLC**. La limpieza de bits huérfanos no está conectada en
esta versión: `mandosParaLimpieza` no tiene llamadores. Los bits sostenidos (por ejemplo, la entrada de
Cabuyo) quedan como estén en el PLC.

## Material

Se prepara fuera de la VM, en `C:\monitor-ptap-ramas\entrega\`. Pasarlo a la VM por el acceso SSH
habitual, a un directorio privado nuevo.

| Archivo | SHA-256 |
|---|---|
| `yosh-2851123.tar` (`git archive 2851123`, 713 entradas, sin enlaces) | `426c28842093343f2ae7051d22704b229da4d081ac36b1a729527721fc10437b` |
| `opc_mapping.yosh-2851123.json` (mapping nuevo, LF) | `89143b14d9097650ded955b66baf37990052a16ff01ea4e0223d541450e1b04b` |
| `opc_mapping.json` (el que corre hoy) | `7b178720b42f3508c840c241a03eb1a0a9038cfffdccf51441bcfc30575c1f86` |

El mapping nuevo solo cambia:
- `cabuyo/valve1`: señal nueva, la consigna en `INT_OUT_CABUYO[1]`, con `writable: true`. También cambian
  dos textos que la mencionan: la `_nota` de `valve1Position` y la nota de plantas en integración.
- `cascajal/valve1.flowDomainKey`: pasa de `outletFlow1` a `outletFlow2` (`72f46d4`).

## Variables (en cada sesión de `xpertic_app`)

```sh
umask 077
NODE=/home/xpertic_app/.local/node-v26.12.1/bin/node
PROD=/home/xpertic_app/monitor-ptap
RELEASES=/home/xpertic_app/android-build/releases
PRIVADO=/home/xpertic_app/.config/aquora-push
ACT_ACTUAL=$PRIVADO/autonomy-FK0Hh6rg
HELPER=$PRIVADO/activation-release-e2cf4d4ee164-CFMDWd/runtime-helper.cjs
STAGE_ACTUAL=$RELEASES/autonomy-EPGLRa
INCOMING=...                      # directorio privado (mktemp -d) donde llegó el material
RESPALDO=$HOME/respaldos/despliegue-20261113   # fijo: la vuelta atrás lo usa
```

---

## 0. Aviso a Operación (antes de empezar)

Mensaje a Operación:

> «Vamos a actualizar Aquora. Habrá unos minutos sin datos y la web se recargará. **Las maniobras están
> habilitadas en producción.** Durante el despliegue, por favor, que nadie accione válvulas desde
> Aquora. Al terminar, la consigna de la válvula de salida de Cabuyo queda **operable** desde la app.
> La primera consigna real la haremos con ustedes presentes. Les avisamos al terminar.»

Esperar la confirmación de Operación antes del paso 1, y anotar quién confirma y a qué hora.

## 1. Comprobaciones previas (`xpertic_app`, solo lectura)

```sh
pm2 describe ptap-api | grep -E 'status|script path|exec cwd|interpreter'
#   status online · script path $ACT_ACTUAL/runtime.cjs · exec cwd $PROD/apps/api
cat "$ACT_ACTUAL/runtime.cjs"                        # require(<HELPER>).boot(<STAGE_ACTUAL>)
sha256sum "$HELPER"                                  # ver «Helper» abajo
sha256sum /usr/local/sbin/ptap-web-publish           # 852871a61b3303563d076d8cf120e4f430a8544fe42a7feb2cd96508408dbc78
sha256sum "$PROD/apps/api/config/opc_mapping.json"   # 7b178720…
sha256sum "$INCOMING"/yosh-2851123.tar "$INCOMING"/opc_mapping.yosh-2851123.json   # 426c2884… y 89143b14…
ls -l "$STAGE_ACTUAL/apps/mobile/google-services.json" && sha256sum "$STAGE_ACTUAL/apps/mobile/google-services.json"
for r in health health/db health/opc; do curl -s -o /dev/null -w "$r %{http_code}\n" http://127.0.0.1:4000/api/$r; done
df -h /home; free -m
```

**Que la release actual sigue siendo la revisada** (solo lectura):

```sh
ls -1d ~/.config/aquora-push/*/
#   exactamente: activation-release-e2cf4d4ee164-CFMDWd/ autonomy-FK0Hh6rg/ css-js-L7gvFYCH/
#                mobile-hotfix-jlVMB0/ valve-ui-ijrmlcUZ/
ls -ld /var/www/ptap-web /var/www/ptap-web.bak-*      # ptap-web del 2 nov 18:29 y los 5 respaldos de la tabla
sha256sum "$ACT_ACTUAL/manifest.json" "$PRIVADO/css-js-L7gvFYCH/manifest.json"   # anotar; no deben cambiar
grep -E '"script"|"cwd"|"interpreter"' "$ACT_ACTUAL/next.config.json"
du -sh ~/android-build/releases/*; df -h /
```

La revisión archivo por archivo se hizo el 2026-11-13 (sección «Estado actual»). Si aparece **otra
activación** en `~/.config/aquora-push/`, o `/var/www/ptap-web` tiene otra fecha, alguien desplegó después:
**parar** y revisar esa activación igual (su `manifest.json`/`overlay/` contra `2851123`).

**Nadie acciona válvulas.** Mirar el log de los últimos minutos:

```sh
pm2 logs ptap-api --lines 400 --nostream --no-color | grep -iE 'comando|setpoint|open|close|v[aá]lvula|sustained' | tail -20
```

Si aparece una orden en curso, o Operación no ha confirmado, **no seguir**.

**Parar si:**
- el mapping no da `7b178720…`;
- `script path` no es `$ACT_ACTUAL/runtime.cjs`;
- `runtime.cjs` no tiene la forma de la tabla;
- el publicador no da `852871a6…`;
- hay una activación nueva en `~/.config/aquora-push/` o la web publicada cambió;
- `google-services.json` no da `b4dcaa6f…`;
- quedan menos de 5 GB libres en `/`;
- la salud no está en 200.

**Helper:** el SHA-256 de `$HELPER` debe ser `40ee0823de5f09b92f9390b626222b3c308bab1fcfd78ddae958d494aef786d4`,
el mismo que el de `tools/vm/ptap-activate-release.cjs` de `2851123`. Se comprobó el 2026-11-13 y coincide.
Si cambiara, **no seguir**.

## 2. Respaldo (`xpertic_app`)

```sh
mkdir -m 700 -p "$RESPALDO"
pm2 jlist > "$RESPALDO/pm2-jlist.json"
cp -a ~/.pm2/dump.pm2 "$RESPALDO/"
cp -a "$ACT_ACTUAL" "$RESPALDO/activacion-actual"
cp -a "$HELPER" "$RESPALDO/runtime-helper.cjs"
cp -a "$PROD/apps/api/config/opc_mapping.json" "$RESPALDO/opc_mapping.antes.json"
chmod -R go-rwx "$RESPALDO"
sha256sum "$RESPALDO/opc_mapping.antes.json"           # 7b178720…
```

Configuración de PM2 para volver atrás, generada a partir del proceso que corre ahora. Lleva el mismo
`script`, `cwd`, `interpreter` y `env`, sin las claves de push, igual que hace `appConfig()` en el helper:

```sh
"$NODE" -e '
const f=require("fs"),[,jl,out,script]=process.argv;
const a=JSON.parse(f.readFileSync(jl,"utf8")).filter(x=>x.name==="ptap-api");
if(a.length!==1) throw new Error("ptap-api no es único");
const p=a[0].pm2_env, env={...(p.env||{})};
for(const k of ["FIREBASE_SERVICE_ACCOUNT_PATH","WEB_PUSH_VAPID_PUBLIC_KEY","WEB_PUSH_VAPID_PRIVATE_KEY","WEB_PUSH_VAPID_SUBJECT"]) delete env[k];
f.writeFileSync(out,JSON.stringify({apps:[{name:"ptap-api",script:script||p.pm_exec_path,cwd:p.pm_cwd,interpreter:p.exec_interpreter,
 exec_mode:"fork",instances:1,autorestart:p.autorestart??true,max_restarts:p.max_restarts??10,
 max_memory_restart:p.max_memory_restart??"600M",kill_timeout:p.kill_timeout??10000,time:true,env}]},null,2),{mode:0o600});
' "$RESPALDO/pm2-jlist.json" "$RESPALDO/anterior.config.json"
grep -E '"script"|"cwd"|"interpreter"' "$RESPALDO/anterior.config.json"
grep -ciE 'VAPID|FIREBASE_SERVICE' "$RESPALDO/anterior.config.json"   # debe dar 0
```

`script` debe ser `$ACT_ACTUAL/runtime.cjs` y `cwd` debe ser `$PROD/apps/api`. Compararlo con el de la
activación actual: `diff <(grep -vE '^\s*$' "$ACT_ACTUAL/next.config.json") "$RESPALDO/anterior.config.json"`.
Deben coincidir en `script`, `cwd`, `interpreter` y `env`; el orden y el formato pueden variar.

La web publicada no se copia aquí. Su respaldo lo hace el propio publicador en el paso 6
(`/var/www/ptap-web.bak-<fecha>`), y es el que usa la vuelta atrás.

## 3. Release nueva (`xpertic_app`)

Se usa el helper de staging que viene **dentro del propio tar** (`tools/vm/ptap-stage-release.cjs`). Acepta
las 713 entradas del tar (comprobado con su `sourcePath`). `prepare` pide además el `google-services.json`
público de Android: se usa el de la release en uso.

```sh
mkdir -m 700 "$INCOMING/helper"
tar -xf "$INCOMING/yosh-2851123.tar" -C "$INCOMING/helper" tools/vm
GOOGLE=$STAGE_ACTUAL/apps/mobile/google-services.json
"$NODE" "$INCOMING/helper/tools/vm/ptap-stage-release.cjs" prepare \
  "$INCOMING/yosh-2851123.tar" 426c28842093343f2ae7051d22704b229da4d081ac36b1a729527721fc10437b \
  "$GOOGLE" b4dcaa6f96b4fafaaf286c426bd64f9ba3d1d4c60e92282bc2bd7f027d20545c
STAGE=...          # el "stage" de la salida JSON: $RELEASES/release-426c28842093-XXXXXX
"$NODE" "$STAGE/tools/vm/ptap-stage-release.cjs" install "$STAGE"         # npm ci --ignore-scripts
"$NODE" "$STAGE/tools/vm/ptap-stage-release.cjs" build-web-api "$STAGE"   # shared, API y web
ls -l "$STAGE/apps/api/dist/main.js" "$STAGE/packages/shared/dist/index.js" \
      "$STAGE/apps/mobile/dist/index.html" "$STAGE/apps/mobile/dist/aquora-push-sw.js"
```

- No correr `build-android`: la APK no forma parte de este despliegue.
- Nada de esto toca producción. La release queda aparte y sin `.env`.
- Si `install` falla por un script de instalación, parar y revisar ese paquete concreto. No habilitar los
  scripts en bloque.

## 4. Mapping (`xpertic_app`)

```sh
install -m 644 "$INCOMING/opc_mapping.yosh-2851123.json" "$PROD/apps/api/config/opc_mapping.json"
sha256sum "$PROD/apps/api/config/opc_mapping.json"     # 89143b14…
"$NODE" -e "JSON.parse(require('fs').readFileSync('$PROD/apps/api/config/opc_mapping.json','utf8'))" && echo "JSON ok"
```

El proceso en marcha **no** lo lee hasta reiniciarse en el paso 5. El mapping se carga al arrancar
(«no hay hot-reload», `opc-mapping.loader.ts`), y las correcciones (`setOverrides`) parten del mapping ya
cargado, no del archivo. **No guardar correcciones de mapeo desde la consola admin entre los pasos 4 y 5.**

## 5. Cambio de PM2 al wrapper nuevo (`xpertic_app`)

`ptap-activate-release.cjs activate` no sirve tal cual por tres motivos:
- está fijado a `e2cf4d4` (`ARCHIVE` y el prefijo de la carpeta);
- exige que el proceso de partida sea `dist/main.js`;
- llama a `sudo -n`, que aquí falla porque sudo pide contraseña.

Se hace lo mismo que la activación actual (`autonomy-FK0Hh6rg`): un `runtime.cjs` que llama al **mismo
helper** con la release nueva.

```sh
ACT_NUEVA=$PRIVADO/deploy-$(basename "$STAGE")
mkdir -m 700 "$ACT_NUEVA"
printf "'use strict';\nrequire(%s).boot(%s);\n" "\"$HELPER\"" "\"$STAGE\"" > "$ACT_NUEVA/runtime.cjs"
chmod 600 "$ACT_NUEVA/runtime.cjs"; cat "$ACT_NUEVA/runtime.cjs"
"$NODE" -e '
const f=require("fs"),[,src,out,script]=process.argv,c=JSON.parse(f.readFileSync(src,"utf8"));
c.apps[0].script=script; f.writeFileSync(out,JSON.stringify(c,null,2),{mode:0o600});
' "$RESPALDO/anterior.config.json" "$ACT_NUEVA/next.config.json" "$ACT_NUEVA/runtime.cjs"
diff "$RESPALDO/anterior.config.json" "$ACT_NUEVA/next.config.json"   # solo debe cambiar "script"
```

Comprobar justo antes que nadie está accionando válvulas (mismo `grep` del paso 1). Después:

```sh
pm2 delete ptap-api
pm2 start "$ACT_NUEVA/next.config.json" --only ptap-api
for i in $(seq 1 36); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/health); [ "$c" = 200 ] && break; sleep 5; done; echo "health $c"
for r in health health/db health/opc; do curl -s -o /dev/null -w "$r %{http_code}\n" http://127.0.0.1:4000/api/$r; done
pm2 describe ptap-api | grep -E 'status|script path|exec cwd'
```

- Se hace `delete` antes de `start` para que nunca haya dos procesos conectados al OPC a la vez. Hay una
  parada breve, y que `/api/health` dé `000` los primeros segundos es normal.
- Si no llega a 200 en 3 minutos, ir a la **vuelta atrás** (paso 8, API y mapping).
- Si llega a 200, ejecutar `pm2 save`.

## 6. Publicación de la web (`xpertic_app` prepara, **Pedro** ejecuta `sudo`)

`ptap-web-publish` toma la web **siempre** de `/home/xpertic_app/monitor-ptap/apps/mobile/dist`.
- Exige `index.html` y que no haya enlaces simbólicos.
- No acepta argumentos.
- Respalda `/var/www/ptap-web` en `/var/www/ptap-web.bak-<fecha>` (conserva los 5 últimos), vacía
  `/var/www/ptap-web`, copia, aplica `chown www-data` y hace `nginx -t` + `systemctl reload nginx`.

`xpertic_app` coloca la web de la release como origen:

```sh
mv "$PROD/apps/mobile/dist" "$RESPALDO/mobile-dist-origen"
cp -a "$STAGE/apps/mobile/dist" "$PROD/apps/mobile/dist"
chmod -R go+rX "$PROD/apps/mobile/dist"
ls "$PROD/apps/mobile/dist/index.html" && [ -z "$(find "$PROD/apps/mobile/dist" -type l)" ] && echo "origen listo"
```

**Pedro**, con su contraseña de sudo:

```sh
sudo /usr/local/sbin/ptap-web-publish
```

**Anotar la línea `respaldo: /var/www/ptap-web.bak-AAAAMMDD-HHMMSS`** que imprime el publicador: es la
web anterior (`css-js-L7gvFYCH`) y la vuelta atrás. En `xpertic_app`: `WEB_BAK=/var/www/ptap-web.bak-…`.
El publicador conserva solo los 5 últimos respaldos y ya hay 5: esta publicación borra
`ptap-web.bak-20261031-124155` y crea el nuevo. **No volver a publicar** antes de cerrar la verificación,
o el respaldo nuevo puede acabar borrado (por eso la vuelta atrás lo copia también a `$RESPALDO`).

`xpertic_app` restaura el origen **siempre**, haya funcionado o no, y verifica:

```sh
rm -rf "$PROD/apps/mobile/dist" && mv "$RESPALDO/mobile-dist-origen" "$PROD/apps/mobile/dist"
diff -rq "$STAGE/apps/mobile/dist" /var/www/ptap-web && echo "web publicada = release"
curl -s https://aquora.xpertic.co/aquora-push-sw.js | sha256sum; sha256sum "$STAGE/apps/mobile/dist/aquora-push-sw.js"
curl -s -o /dev/null -w 'web %{http_code}\n' https://aquora.xpertic.co/
```

## 7. Verificación final (**sin accionar válvulas**)

1. **Salud.** `health`, `health/db` y `health/opc` en 200, en local y en `https://aquora.xpertic.co/api/health`.
2. **Log:** `pm2 logs ptap-api --lines 300 --nostream --no-color`
   - debe salir «NodeIds resueltos: 44/44 (faulted: 0)» y «Subscription lista: 44 MonitoredItems»;
   - debe salir `BridgeStatus … → Connected`;
   - no debe salir ningún `BadNodeIdUnknown` ni buffer `faulted` de CABUYO (`REAL_IN_CABUYO`, `INT_IN_CABUYO`, `INT_OUT_CABUYO`);
   - no debe salir «push apagado» ni «Web Push apagado», ni ningún error de configuración privada.
3. **Web** (`https://aquora.xpertic.co`, recarga forzada). **Solo mirar, no pulsar botones de mando:**
   - **Cabuyo:** caudal de entrada, caudal de salida, presión de entrada y apertura de la válvula de salida
     con datos, y el indicador «EN VIVO».
   - **Válvulas de Cabuyo:** la de salida muestra la apertura y el botón «Ajustar apertura» (solo con
     `control_valves`). La de entrada muestra Abrir y Cerrar. **No pulsarlos.**
   - **Cascajal:** la válvula de salida muestra su caudal con `outletFlow2`. Comprobar que el caudal que
     enseña junto a la válvula es el que corresponde.
   - La Luisa, La Leonera y Gloria siguen en «EN INTEGRACIÓN». El resto de plantas, igual que antes.
4. **Ninguna orden durante la verificación:** repetir el `grep` del paso 1. No debe aparecer ninguna orden
   nueva.
5. **Avisar a Operación:** «Despliegue terminado. La consigna de Cabuyo está operable; la primera, con
   ustedes presentes.»
6. **Anotar al final de este documento:**
   - fecha y hora;
   - `STAGE` y `ACT_NUEVA`;
   - hashes;
   - el resultado de cada punto;
   - quién de Operación confirmó.

No borrar `$STAGE_ACTUAL`, `$ACT_ACTUAL`, `release-e2cf4d4ee164-CFMDWd` ni `$RESPALDO`. Son la vuelta
atrás, y `$HELPER` vive dentro de la activación de `e2cf4d4`.

## 8. Vuelta atrás

**API y mapping (`xpertic_app`).** Hacerlo en este orden, comprobando la salud al final:

```sh
install -m 644 "$RESPALDO/opc_mapping.antes.json" "$PROD/apps/api/config/opc_mapping.json"
sha256sum "$PROD/apps/api/config/opc_mapping.json"     # 7b178720…
pm2 delete ptap-api
pm2 start "$RESPALDO/anterior.config.json" --only ptap-api
for i in $(seq 1 36); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/health); [ "$c" = 200 ] && break; sleep 5; done; echo "health $c"
pm2 describe ptap-api | grep -E 'status|script path'   # $ACT_ACTUAL/runtime.cjs
pm2 save
```

Si `pm2 start` del archivo generado fallara, queda `$RESPALDO/dump.pm2`, el volcado de PM2 de antes. Para
restaurarlo: `cp "$RESPALDO/dump.pm2" ~/.pm2/dump.pm2 && pm2 resurrect`.

**Web (`xpertic_app` prepara, Pedro ejecuta `sudo`).** Se usa el respaldo que hizo el publicador en el
paso 6 (`$WEB_BAK`) como origen, con el mismo mecanismo. Los archivos son de `www-data`, con permisos
644/755, así que `xpertic_app` los puede leer.

```sh
ls "$WEB_BAK/index.html"                                   # la web anterior (css-js-L7gvFYCH)
WEB_ANTES=$RESPALDO/web-antes; cp -a "$WEB_BAK" "$WEB_ANTES"   # copia propia, por si el publicador rota sus respaldos
mv "$PROD/apps/mobile/dist" "$RESPALDO/mobile-dist-origen"
cp -a "$WEB_ANTES" "$PROD/apps/mobile/dist"; chmod -R go+rX "$PROD/apps/mobile/dist"
#   Pedro: sudo /usr/local/sbin/ptap-web-publish
rm -rf "$PROD/apps/mobile/dist" && mv "$RESPALDO/mobile-dist-origen" "$PROD/apps/mobile/dist"
diff -rq "$WEB_ANTES" /var/www/ptap-web && echo "web restaurada"
```

Si `xpertic_app` no pudiera leer `$WEB_BAK`, Pedro restaura directamente como root:
`sudo rm -rf /var/www/ptap-web/* && sudo cp -a "$WEB_BAK"/. /var/www/ptap-web/ && sudo chown -R www-data:www-data /var/www/ptap-web && sudo nginx -t && sudo systemctl reload nginx`.

- No hay migraciones que deshacer.
- La consigna deja de estar operable con el mapping anterior. Avisar a Operación.

---

## Primera maniobra con Operación presente

Es un paso aparte, después del despliegue y en otro momento si hace falta. Se hace solo con Operación en
la planta o en comunicación directa.

1. **Antes.** Revisar con Operación los riesgos abiertos de `docs/RIESGOS_CABUYO.md`:
   - **1:** `INT_OUT_CABUYO[1]` es solo de la consigna;
   - **3:** la tolerancia (±2 %) y el tiempo de recorrido son provisionales.

   Acordar un valor pequeño y seguro, cercano a la apertura actual.
2. **Ordenar.** Lo hace una persona con `control_valves`: Válvulas → Cabuyo → «Ajustar apertura» → valor
   acordado → confirmar.
3. **Observar:**
   - en la app, «Apertura alcanzada» (verde) o «Consigna enviada; la apertura aún no llega» (ámbar);
   - en planta, que el actuador se mueve hacia el valor;
   - en el log, la orden firmada y su resultado.

   Que quede en ámbar no es un fallo: no hay vuelta atrás automática.
4. **Si algo no cuadra** (se mueve otra cosa, la palabra trae valores raros o sale `409 SETPOINT_WORD_IN_USE`):
   no repetir y apagar la consigna (`writable: false`, según `docs/CONSIGNA_VALVULA_PROPORCIONAL.md`).
5. **Anotar** el resultado en `docs/RIESGOS_CABUYO.md`: cerrar o actualizar los riesgos 1 y 3, con el tiempo
   de recorrido y la tolerancia observados.

La **entrada** de Cabuyo (Abrir/Cerrar, sostenida, `stateVerified: false`) también se prueba con Operación
presente, por separado.

---

## Preguntas (estado al 2026-11-13)

Resueltas con la revisión de la VM:

1. **Helper:** `runtime-helper.cjs` = `40ee0823…`, igual al revisado.
2. **Web vigente:** `css-js-L7gvFYCH` (2026-11-02 23:29 UTC), sobre `valve-ui-ijrmlcUZ` y `autonomy-FK0Hh6rg`;
   todo lo que cambiaron está en `yosh` (ver «Estado actual»). La web de `2851123` la sustituye sin perder nada.
3. **Firebase:** `autonomy-EPGLRa/apps/mobile/google-services.json`, SHA-256 `b4dcaa6f…`; lo usa `prepare`.
4. **PM2:** `script`, `cwd` e `interpreter` coinciden con `autonomy-FK0Hh6rg/next.config.json`.
5. **Disco:** 8,1 GB libres; la release nueva (≈2–2,5 GB, como `autonomy-EPGLRa`) deja ≈5,5 GB. No hace
   falta borrar ninguna release; `autonomy-EPGLRa` y `release-e2cf4d4ee164-CFMDWd` (su activación tiene el
   helper) **no se borran**.

Abierta, para el día del despliegue:

6. **Sudo:** Pedro pone su contraseña en el paso 6 (y en la vuelta atrás de la web). Confirmar que estará
   disponible durante la ventana.
