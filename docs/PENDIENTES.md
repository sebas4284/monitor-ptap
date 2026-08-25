# Pendientes del proyecto

> **Único tracker de pendientes.** Fusiona los tres que existían por separado (`PENDIENTES_VPN.md`,
> `PENDIENTE_DESPLIEGUE.md`, `SEMANA1-4_PENDIENTES.md`) y que se contradecían entre sí.
>
> Última revisión: **2026-08-11**.
>
> Incidente abierto aparte: [`INCIDENTE_CONEXION_PLC.md`](./INCIDENTE_CONEXION_PLC.md).
> Checklist de endurecimiento: [`CHECKLIST_PRODUCCION.md`](./CHECKLIST_PRODUCCION.md).

---

## 1. Bloqueado por infraestructura (VPN + SSH a la VM)

Todo esto se ejecuta **dentro de la VM `192.168.30.50`**, alcanzable solo por la VPN `PTAP-VPN`.

### ✅ Dominio `aquora.xpertic.co` con TLS — RESUELTO el 2026-08-11

**El dominio ya sirve desde Internet con certificado válido.** Verificado desde fuera de la red:
`https://aquora.xpertic.co/` y `/api/health` → **200**, IP contactada `191.102.61.125`.

Lo destrabó un cambio de redes, no ninguno de los dos caminos que se habían planeado: se pasó de un
**DNAT por puerto** contra `191.102.61.123` a una **NAT 1:1 contra `191.102.61.125`**. Con eso el
registro A pasó a bastar por sí solo. Detalle en
[`DOMINIO_AQUORA_CLOUDFLARE.md`](./DOMINIO_AQUORA_CLOUDFLARE.md).

Aplicado el 2026-08-11:

- [x] `APP_PUBLIC_URL` = `https://aquora.xpertic.co` (antes: túnel efímero).
- [x] Origen `*.trycloudflare.com` retirado de `CORS_ORIGINS`. Quedan el dominio,
      `http://192.168.30.50` (acceso por LAN/VPN) y `http://localhost:8081` (desarrollo).
- [x] **Quick tunnel de Cloudflare apagado.** Ya no hacía falta.
- [x] Certificado válido **31-jul-2026 → 29-oct-2026**, servido por nginx en el 443.

Falta:

- [ ] 🔴 **Abrir el puerto 80 a Internet en ufw** — `sudo ufw allow 80/tcp`. Es lo único con fecha
      límite. Hoy sigue **cerrado desde fuera** (verificado el 2026-08-11), así que el desafío
      HTTP-01 no puede completarse y **la renovación del certificado fallará**. nginx ya redirige el
      80 a HTTPS y tiene el `location /.well-known/acme-challenge/`, así que abrirlo no expone
      contenido: solo habilita la renovación. Después, comprobarlo de verdad con
      `certbot renew --dry-run`.
- [x] ✅ **APK recompilado contra `https://aquora.xpertic.co`** el 2026-08-11, en la VM. Verificado:
      firma `fac61745…` **idéntica** a la del APK instalado (se instala encima sin desinstalar), la
      URL correcta horneada y `trycloudflare` ausente. Copia en `~/monitor-ptap-20260811.apk` y en
      `C:\Users\USUARIO\Downloads\`. Procedimiento completo y trampas en
      [`ANDROID_APK.md §8`](./ANDROID_APK.md).
- [x] ✅ **APK nuevo publicado** el 2026-08-11 en `/var/www/ptap-download/monitor-ptap.apk`.
      Verificado: **35 503 027 bytes, byte a byte idéntico** al de `C:\Users\USUARIO\Downloads\`.
      Se hizo **sin `host-apk.sh`** (ese script pisa la config de nginx y borraría el HTTPS; lleva
      aviso en su cabecera), con `sudo install -o www-data -g www-data -m 644`.
- [ ] 🟠 **Recompilar el APK sin el HMI.** El publicado se compiló a las **13:50** del 2026-08-11 y
      el commit que retira el HMI (`622ecaf`) es de las **17:48**: el bundle todavía contiene
      `openHmiSession` y `/api/hmi/session`, endpoint que **ya responde 404**. La pestaña la ve todo
      usuario con `view_dashboard` y falla al tocarla. No es urgente (el resto de la app funciona y
      apunta bien al dominio), pero deja la app con una función rota a la vista.
      > **Coste real:** la toolchain se limpió tras el build del 11-ago — `~/android-build`,
      > `~/.gradle` y `apps/mobile/android/` ya no existen, y `javac` tampoco. Rehacerlo son
      > **~6 GB de descarga + ~40 min**, y empieza por `sudo apt install -y openjdk-17-jdk`.
- [ ] Borrar el TXT `_acme-challenge.aquora` del cPanel (ya cumplió su función)
- [ ] Pedir a redes que retire el DNAT viejo `:5554` si aún existe
- [ ] Replicar el `.env` nuevo en la copia local durable `.env.production.local` (gitignored)

> 🔴 **La renovación NO es automática, y hay un segundo motivo además del puerto 80.** Al emitir,
> certbot informa que programó una tarea para renovar solo. Es falso para este certificado: el
> `certbot.timer` corre como root sobre `/etc/letsencrypt`, y el nuestro está en
> `~/letsencrypt/config` porque se emitió sin sudo. **Vence el 2026-10-29**; hay que resolver ambas
> cosas, no solo el puerto.

### 🔒 Nota de seguridad: la NAT 1:1 cambió el perímetro

Antes solo se publicaba un puerto concreto. Ahora **toda la VM está en Internet salvo lo que ufw
filtre**: el firewall pasó de ser la segunda barrera a ser **la única**. Verificado desde fuera el
2026-08-11:

| Puerto | Estado | |
|---|---|---|
| 443 | abierto | correcto |
| 22 | abierto | **decisión consciente**: solo-llave (contraseña deshabilitada) + fail2ban activo |
| 80 | cerrado | hay que abrirlo (ver arriba) |
| 3306 (MySQL), 4000 (API directa), 8080 | **cerrados** | ufw cumpliendo |

- [ ] *(defensa en profundidad)* La API escucha en `*:4000`. ufw la bloquea, pero atarla a
      `127.0.0.1:4000` dejaría a nginx como único camino posible, sin depender de que una regla siga
      bien puesta. Con NAT 1:1 esta recomendación pesa más que antes.

### `.env` de producción

- [x] `CORS_ORIGINS` con el dominio, la IP de LAN y localhost. El origen del túnel se retiró el
      2026-08-11 al apagarlo.
- [x] `APP_PUBLIC_URL` = `https://aquora.xpertic.co` (2026-08-11).

> Conservar `http://192.168.30.50` en `CORS_ORIGINS` para no perder el acceso por LAN/VPN si el
> dominio falla. El gateway de Socket.IO valida `Origin`: si el valor no coincide exacto, el tablero
> se queda sin datos en vivo aunque el HTTP funcione.

> 🔴 **`pm2 restart --update-env` tumba la API. No usarlo.** Con esa bandera pm2 reemplaza el entorno
> del proceso por el del shell que invoca el comando; desde una sesión SSH no interactiva ese entorno
> es mínimo y la API **arranca pero nunca llega a escuchar en el 4000** — nginx devuelve 502 y, para
> peor, `pm2 list` la sigue reportando `online`. Costó ~3 min de caída el 2026-07-31 hasta que un
> `pm2 restart ptap-api` a secas la levantó en 5 s. El script ya está corregido.

### Seguridad de red — recomendación menor abierta

- [ ] Que la API escuche en `127.0.0.1:4000` en vez de `0.0.0.0:4000`, para que nginx sea el único
      camino y no se dependa únicamente del ufw. Hoy el firewall la bloquea correctamente
      (verificado: `HTTP 000` desde otra máquina de la VPN), pero es defensa en profundidad.
- [ ] Decidir si borrar el árbol `~/ptap-fieldtest` (1.8 GB, ramas `fieldtest`…`fieldtest5`). Sus
      flags de escritura insegura ya se comentaron con respaldo, pero el árbol sigue existiendo.

---

## 2. Despliegue

> **Corregido el 2026-08-05 desplegando de verdad.** Dos cosas que este documento afirmaba y que
> resultaron falsas:
>
> 1. **La VM sigue la rama `yosh`, no `dev`.** El `git push origin yosh:dev` que aquí se pedía no
>    habría llegado al servidor. Se empuja y se despliega `yosh`.
> 2. **`deploy.sh` NO estaba corregido**: seguía usando `pm2 restart ptap-api --update-env`, la
>    bandera que causó los ~3 min de caída del 31-jul. Ya se quitó (respaldo en `~/backups/`).
>
> Además, el árbol de la VM tenía 15 archivos rastreados modificados sin commitear, resultado de
> actualizaciones hechas copiando archivos en vez de por git. Se verificó que **toda** la
> divergencia era cosmética (indentación y un comentario movido) antes de hacer `reset --hard`.
> Si se vuelve a actualizar la VM copiando archivos, esto se repite: **desplegar siempre por git**.

Procedimiento vigente:

```bash
# 1. local
git push origin yosh

# 2. en la VM. OJO: `bash ~/deploy.sh` a secas NO actualiza nada (ver aviso abajo).
cd ~/monitor-ptap
git fetch origin && git reset --hard origin/yosh
npm ci                                  # SOLO si cambió package-lock.json
npm run db:migrate -w @ptap/api         # idempotente
npm run build
pm2 restart ptap-api && pm2 save        # jamás con --update-env

# 3. si cambió el front, recompilar y publicar la web
cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear
sudo bash ~/deploy-scripts/web-publish.sh
```

> 🔴 **`bash ~/deploy.sh` NO sirve tal cual** (comprobado el 2026-08-13). El script despliega la
> rama ACTUAL del checkout, y en la VM esa rama se llama **`dev`** y trackea `origin/dev`, que va
> ~22 commits por detrás. Como el HEAD local ya está por delante, `git pull --ff-only origin dev`
> responde "Already up to date" y **no trae nada**: el script sigue, recompila el mismo código y
> reinicia — todo en verde, sin haber actualizado. El historial real de despliegues es
> `git reset --hard origin/yosh` (ver `git reflog show dev`). Que la rama local se llame `dev` y
> siga a `yosh` es la trampa.
>
> Tras `pm2 restart`, `/api/health` devuelve **000 durante ~5 s** mientras conecta el bridge OPC UA.
> No es una caída: esperar y reintentar antes de diagnosticar.

> ⚠️ Para publicar la web usar **`web-publish.sh`**, nunca `web-setup.sh`: este último termina
> pisando `/etc/nginx/sites-available/ptap` con una copia guardada, lo que **borraría los server
> blocks de HTTPS** si ya se corrió `le-nginx.sh`. El propio script lo avisa en su cabecera.

> La web se compila con `API_BASE_URL` **vacío** (mismo origen): no hay URL horneada, así que solo
> hace falta recompilar cuando cambia el código, no por el dominio.

**Último despliegue: 2026-08-13, commit `9fcd072`.** Backend COMPLETO y verificado: ámbito por
planta en la bandeja (`cd1dcd6`) y en el socket (`93a52de`), y Cascajal con caudal de entrada y
convención de estado de válvula (`286523f`). Comprobantes en verde: `/api/health`, `/health/db`,
`/health/opc` en 200; la bandeja de dos cuentas reales de Km 18 devolviendo solo `km18`; el socket
respondiendo `denied` a una planta ajena y `snapshot` a la propia.

> ⚠️ **El bundle WEB se publica aparte y se quedó atrás.** Estaba en `/var/www/ptap-web` con fecha
> **2026-08-06** mientras el backend ya iba por el 13: desplegar el API no actualiza la web. Todo
> cambio de `apps/mobile/` (la web y la APK salen del mismo código) necesita el paso 3, y el paso 3
> **necesita sudo**, que no tiene la cuenta `xpertic_app`. Si nadie lo corre, la web sigue vieja sin
> ningún síntoma visible.

El despliegue anterior fue el 2026-08-11 (`622ecaf`, retiro del HMI), y antes el 2026-08-06
(`56b9130`, bandeja de notificaciones y detector de sensores congelados).

### 🔴 Front desactualizado en producción — web compilada, APK no

Comprobado el 2026-08-13 **dentro de los propios artefactos**, no deducido. A los dos les faltan
exactamente los mismos dos commits de `apps/mobile/`:

| | web (`/var/www/ptap-web`) | APK (`/descargar/`) |
|---|---|---|
| Fecha del artefacto | 2026-08-06 | 2026-08-11 14:27 |
| `622ecaf` retiro del HMI | ❌ falta | ❌ falta (el commit es de las 17:48, posterior al build) |
| `286523f` `stateEncoding` de válvula | ❌ falta | ❌ falta |

- [ ] **Publicar la web** — el bundle YA está compilado en `~/monitor-ptap/apps/mobile/dist`
      (2026-08-13 21:40, verificado: contiene `stateEncoding`). Solo falta
      `sudo bash ~/deploy-scripts/web-publish.sh`.
- [ ] **Recompilar la APK** — cadena completa, porque el toolchain se borra tras cada build:
      `install-sdk.sh → prebuild-vm.sh → config-and-ndk.sh → apk-build.sh` (~8,6 GB, más de una
      hora; probado el 2026-08-11 que no tumba producción). Respaldo de la APK vigente en
      `~/monitor-ptap-20260811.apk`. Verificar la firma con `apksigner` antes de publicar.

**Lo que SÍ le llega ya a la APK vieja**, porque es backend: el caudal de entrada de Cascajal (el
tablero pinta las señales que manda el servidor, sin lista blanca), el ámbito por planta de las
notificaciones y el del socket. Nada de control de acceso quedó atascado detrás del front.

**El síntoma visible hoy**: la pestaña **HMI** sigue en la web y en la APK, y su endpoint
`/api/hmi/session` devuelve **404** desde el 2026-08-11. Quien la abra ve un error.

> 🔴 **Un despliegue que ELIMINA archivos exige borrar `dist/` a mano.** `tsc` compila las fuentes
> que existen pero **no borra las salidas de las que ya no están**. Al desplegar `622ecaf` quedó un
> `dist/modules/hmi/` huérfano, y el resultado fue el peor modo de fallo posible: el proceso
> arrancaba, sobrevivía y consumía 160 MB, pero **nunca llegaba a escuchar en el 4000 y no emitía
> ni una línea de log** — `pm2` lo reportaba `online` mientras todos los endpoints daban `000`.
> Es el mismo síntoma que produce `--update-env`, con otra causa; no confundirlos. La cura:
> ```bash
> pm2 stop ptap-api
> rm -rf apps/api/dist packages/shared/dist
> npm run build && pm2 start ptap-api
> ```
> Costó ~10 min de caída el 2026-08-11. `deploy.sh` **no** hace esta limpieza: hay que acordarse.

> 🔴 **El detector encontró 10 plantas con sensores congelados** en su primer barrido — cuatro más
> de las que se habían visto revisando a mano. Ver §Sensores congelados abajo.

Pendiente:

- [ ] **NTP** — para que el KPI de latencia OPC sea fiable: `sudo timedatectl set-ntp true`
- [ ] Considerar rotar el token de GitHub de **LorJosh** (token *classic* con scope `repo`; los
      fine-grained no sirven en repos de otra cuenta personal).
- [x] ✅ **APK recompilado contra el dominio** el 2026-08-11 y publicado. Con dominio propio esa fue
      la **última** recompilación por cambio de URL. (Queda una pendiente por *código*, no por URL:
      quitar el HMI del bundle — ver §1.)
- [ ] Verificar tras desplegar:
      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/health/opc   # 200
      pm2 status                                                                       # online, estable
      npm run -w @ptap/api audit:efficiency                                            # Score 🟢
      ```

---

## 2b. 🔴 Sensores congelados — ESCALAR AL INTEGRADOR

> ⚠️ **CIFRAS RE-MEDIDAS el 2026-08-15.** Las de la tabla de abajo (2026-08-06) mezclaban DOS
> causas y exageraban el problema de campo. Encima de las plantas realmente muertas había un fallo
> NUESTRO —el puente dejó de entregar frames durante 41 h, ver `CATALOGO_ERRORES.md` **SRV-09**—
> que congelaba también a las plantas sanas. Con el puente ya arreglado, la medición limpia es:
>
> | Planta | Antigüedad real (2026-08-15) |
> |---|---|
> | **KM18** | **25,0 días** — planta entera |
> | **Pichindé** | **25,0 días** — planta entera |
> | **Cascajal** | **22,6 días** — planta entera (`REAL_IN` **y** `INT_IN`) |
>
> **VIVAS y refrescando**: La Vorágine, Soledad, Montebello, Carbonero, Alto de los Mangos,
> La Sirena y Campoalegre. El `INT_IN` de Sirena (estado de válvula), que el 14-ago marcaba
> 9,8 días, **se recuperó solo**.
>
> Se mide en 30 s con `npx tsx scripts/diagnose-freshness.ts`, que lee el `SourceTimestamp` con
> `session.read` DIRECTO —sin pasar por nuestra Subscription— y por eso separa "el servidor
> entrega viejo" de "nosotros no lo leemos".

Detectado el 2026-08-06 y confirmado leyendo el `SourceTimestamp` directamente del servidor OPC UA.
**No es un fallo de la plataforma:** el servidor entrega esos valores sin refrescarlos.

| Planta | Alcance | Antigüedad medida |
|---|---|---|
| **KM18** | planta entera | **15,3 días** |
| **Carbonero** | planta entera | **15,3 días** |
| **Pichindé** | planta entera | **15,3 días** |
| **Cascajal** | planta entera | 12,9 días |
| **Montebello** | planta entera | 17 horas |
| La Sirena | 2 señales (`tank2Level`, `tank2Volume`) | — |
| Soledad, Alto de los Mangos, Campoalegre, La Vorágine | 1 señal cada una | — |

> **La pista más útil para el integrador:** KM18, Carbonero y Pichindé se detuvieron en el **mismo
> instante exacto** (367 h 28 min las tres al medirlas). Eso no es casualidad — apunta a un enlace
> de comunicación o a un grupo de instrucciones MSG que se paró de golpe, no a tres sensores
> averiándose por separado.

Contexto que refuerza el diagnóstico: la Fase 0.3 (2026-07-14) ya había medido a Vorágine, Cascajal,
KM18, Pichindé y Carbonero como "completamente estáticas". Vorágine revivió; Soledad y Montebello se
sumaron. **Es una condición que viene empeorando desde hace un mes** y que nadie vio porque la
aplicación pintaba esas plantas en azul, como "proceso quieto, todo normal" (ya corregido).

- [ ] Enviar el reporte al integrador con estas evidencias.
- [ ] Pedir de nuevo el **contador de heartbeat por sitio** (ver
      [`plc/OBSERVACIONES_FASE0.md`](./plc/OBSERVACIONES_FASE0.md)): sin él, distinguir "planta
      quieta" de "planta caída" seguirá dependiendo de que los datos se muevan.

---

## 3. Decisiones que no son código (requieren al cliente / dirección)

Vienen de la auditoría comparativa del Mes 1 y siguen **abiertas**. Son el único contenido vivo de
[`archivo/SEMANA1-4_PENDIENTES.md`](./archivo/SEMANA1-4_PENDIENTES.md); todo lo demás de ese
documento ya se cerró.

### D1. Historial en la base de datos — la más importante

**El conflicto:** el plan promete que la BD guarda *"lecturas, usuarios, alertas e historial"*
(Semana 2) y que en la Semana 5 se *"agregan filtros al historial"*. La arquitectura de este proyecto
**no persiste telemetría**: es una regla de diseño dura (caché solo en RAM; snapshot < 50 ms; sin
crecimiento de BD sin control). Hoy la BD guarda usuarios, auditoría y comandos — **no** lecturas.

No es un olvido, es una decisión consciente. Pero choca de frente con las tareas de historial y con
las gráficas de tendencia.

- **Opción A — ratificar el historial.** Diseñar la capa de persistencia de series (qué señales, a
  qué resolución, cuánta retención). Riesgo: crecimiento de BD y la complejidad que la regla
  RAM-only quería evitar.
- **Opción B — renegociar por escrito.** Acordar que el MVP es tiempo real sin historial persistido.
- **Recomendación: híbrido** — RAM para el vivo, más una persistencia **acotada y con propósito**
  (solo las señales que el cliente quiera historizar, con retención definida), no una BD de series
  genérica. La decisión de si hay historial y de qué alcance **es del cliente**.

### D2. "Aplicación Web (React)" vs. Expo web

El plan lista una *"Aplicación Web en React"* como entregable separado de la app móvil. El proyecto
usa **Expo web**: un solo código para Android, iOS y web. Es una buena decisión, pero **cambia un
entregable con nombre propio**. No requiere trabajo — requiere **formalizarlo por escrito** para que
no figure como incumplimiento en una revisión.

### D3. Motor de alertas / esquema de alarmas

El DTO ya transporta los umbrales operativos (`opMin`/`opMax`) y el front deriva alertas en vivo del
snapshot, pero **no hay motor de alarmas persistente** ni configuración de límites por usuario. El
esquema de alertas en BD depende de la misma decisión que D1: conviene resolverlos juntos.

### D4. Hot-reload del mapping — propuesta escrita, esperando OK

La Fase 3 del PROMPT MAESTRO pedía **proponer** la recarga en caliente de `opc_mapping.json`, no
implementarla. La propuesta ya existe: [`PROPUESTA_HOT_RELOAD_MAPPING.md`](./PROPUESTA_HOT_RELOAD_MAPPING.md)
(2026-08-25). Recomienda **endpoint admin, no SIGHUP**, recarga solo de la capa de dominio (nunca de
NodeIds/buffers) y **no implementarlo hasta que aparezca la necesidad operativa** — un reinicio
cuesta ~3 s medidos y hoy los cambios de mapping son poco frecuentes. Falta tu decisión.

---

## 4. Deuda técnica interna (no bloquea a nadie externo)

- [x] ~~El gate de sesión del HMI no tiene ni un test.~~ **Resuelto por eliminación el 2026-08-11:**
      la proyección del HMI de WinCC dentro de la app se retiró (decisión de producto), y con ella
      el módulo `hmi/`, su cookie `hmi_session` y el gate `auth_request`. Era la brecha de cobertura
      más seria del proyecto; deja de existir junto con el código.
      > 🔴 **Queda una exposición de red abierta, y NO es inofensiva.** El snippet
      > `/etc/nginx/snippets/ptap-hmi.conf` sigue incluido desde el server block de `:443`
      > (`sites-available/ptap`, línea 51) y **no apunta a un backend inexistente**: hace
      > `proxy_pass https://10.10.51.225/` — el WinCC Unified de la planta, vivo. Verificado el
      > 2026-08-11: `https://aquora.xpertic.co/hmi/` responde **HTTP 200 desde Internet**.
      >
      > **No hay autenticación delante de esa ruta**: ni `auth_request`, ni `auth_basic`, ni
      > restricción por IP. Ya era así antes — la app solo repartía el enlace, nunca lo protegía —
      > pero ahora que la función no existe es superficie de ataque sin ninguna contraparte, y con
      > NAT 1:1 está publicada a Internet entero.
      >
      > **Reconfirmado el 2026-08-15 desde fuera de la red**, no desde la VM:
      > `https://aquora.xpertic.co/hmi/` → **200**, mientras `/api/notifications` → 401. La app se
      > protege sola; esa ruta no.
      >
      > Retirarlo necesita sudo, y ya está preparado en un solo comando:
      > ```bash
      > ssh -t ptap "sudo bash ~/deploy-scripts/hmi-retirar.sh"
      > ```
      > El script respalda la config, **comenta** el `include` (no lo borra: deja rastro de que fue
      > deliberado y se revierte quitando la almohadilla), pasa `nginx -t`, recarga y verifica solo.
      > Probado en seco sobre una copia: toca **una línea**, deja intactos los 3 bloques `server` y
      > el `listen 443`. Después `/hmi/` debe pasar a **404**.
- [ ] **El parseo de tramas del adaptador OPC UA real está casi sin cubrir.** `DataValue →
      RawBufferSample`, `channelDataType()`, `isGoodStatus()` y el camino de escritura por
      `IndexRange` en `opcua-connectivity.adapter.ts` solo se ejercitan de refilón; el resto de la
      suite corre contra el simulador o contra el replay, que validan *aguas abajo* del parseo.
- [ ] **`test/` y `scripts/` de la API no los typechequea nadie.** El script `typecheck` usa
      `tsconfig.json`, cuyo `include` es solo `src/**/*.ts`. Existe `tsconfig.test.json` con
      `test/**/*.ts`, pero ningún script ni el CI lo invoca. `scripts/` no está en ningún tsconfig.
- [ ] **Los `test:*` de la API usan sintaxis de cmd.exe** (`set "VAR=…"&&`), que en Linux no hace
      nada. El CI lo esquiva pasando `TSX_TSCONFIG_PATH` por `env:` y corriendo los tests por glob.
- [x] **`soak-test.ts` ya tiene script npm** (2026-08-25): `npm run validate:soak-report` para el
      veredicto post-mortem y `npm run validate:coldstart` para el `kill -9`. El soak en sí se
      sigue lanzando a mano a propósito: son 24 h, no algo que quepa en un `npm test`.
      `opcua-writes-toggle.sh` sigue sin script npm (es deliberado: abrir la escritura al PLC no
      debe ser un comando cómodo).
- [ ] **~15 scripts de campo de un solo uso** en `apps/api/scripts/` sin script npm ni importador
      (`monitor-sirena-*.ts`, `read-sirena.ts`, `write-sirena-pulse.ts`, `fix-valve-state.ts`…).
      Decidir si se archivan o se borran.
- [ ] **Exports muertos en `packages/shared`**: `Sensor`, `Tank`, `Valve`, `OpcSnapshot`,
      `PlantDefinition`, `ConnectionStatus`, `ConnectionCode`, `ConnectionFault` — restos del camino
      de datos legado, sin ningún importador.
- [ ] **DTOs duplicados a mano entre front y back** (deberían vivir en `@ptap/shared`):
      `CommandResult`/`ValveCommandResult`, `RouteCheckReport`, `RouteHistorySummary`,
      `ReportStatus`/`ReportInfo`, `ConnectionEvent`.
- [ ] **`docs/plc/*.json` pesa 5.5 MB en el repo** (`01_inventory.json` solo, 4.9 MB). Es regenerable
      con `tools/plc-discovery`. Decisión consciente de dejarlo por ahora (2026-08-05).
- [ ] **Recomendaciones diferidas de la auditoría de eficiencia** (bajo valor, ver
      [`archivo/audit/EFICIENCIA_BACKEND_2026-07-28.md`](./archivo/audit/EFICIENCIA_BACKEND_2026-07-28.md)):
      D5 no auditar GET de lectura · D8 `SELECT` acotado en `findById` · D9/H14 código muerto
      `finalizeNoReserve` y métrica `UNEXPECTED_LENGTH` que nunca se registra · D1 96 señales en
      dead-letter (depende del export L5X, externo).

---

## 4b. Notificaciones — ajustes posibles

Funcionando desde el 2026-08-06. **Acotadas por planta desde el 2026-08-13** (`cd1dcd6`): antes
`listRecent`/`countUnseen`/`markAllSeen` filtraban solo por tiempo, así que un operador recibía —y
le sonaban en el celular— los avisos de las doce plantas. `view_all_plants` (Admin) sigue viéndolos
todos. Se limpiaron además 194 marcas de lectura ajenas que dejó el fallo, en dos cuentas de
operador; respaldo previo en `~/backups/notification-seen-<fecha>.sql` en la VM.

Parámetros por variable de entorno, sin recompilar:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `NOTIFY_STALE_HOURS` | `1` | A partir de cuántas horas sin refrescar se considera sensor averiado |
| `NOTIFY_SWEEP_MS` | `600000` (10 min) | Cada cuánto revisa. **No** cambia la frecuencia del aviso: eso lo fija la deduplicación diaria |
| `NOTIFY_RETENTION_DAYS` | `30` | Cuánto se conserva el historial en la base |

- [ ] **Volumen a vigilar.** Hoy son ~20 avisos diarios (10 sensores congelados + 10 señales fuera
      de rango). Con 72 h de historial la bandeja muestra unos 60. Si resulta excesivo, la opción
      más efectiva es agrupar los "fuera de rango" por planta: bajaría a ~6 al día, a cambio de
      perder el salto a la señal exacta. Decisión de uso, no técnica.
- [ ] **Notificaciones web bloqueadas por HTTPS.** El navegador exige contexto seguro y los usuarios
      entran por `http://192.168.30.50`. La salida barata es un **registro DNS interno** que
      resuelva `aquora.xpertic.co → 192.168.30.50` dentro de la VPN; no depende del DNAT ni de
      redes. En el APK de Android sí funcionan (notificación local, sin Firebase).

---

## 5. Vigilancia continua

- [ ] Vigilar el `deadLetterCount` del puente OPC (`/opc/status`, requiere RBAC `system_config`).
- [x] **Soak test de 24–72 h — SALDADO** (veredicto leído el 2026-08-25 de la corrida del
      2026-08-03): 24 h completas, crecimiento de RSS **0 %**, 0 fugas de handles, dead letter
      acotado en 107, 48 ciclos de caos, cero `Faulted`. Con esto **la Fase 6 queda cerrada**.
      La corrida SIEMPRE fue válida; lo que fallaba era el criterio del veredicto (medía dispersión
      en vez de crecimiento) y que nadie abrió el JSONL. Ver §4 de OPERATIONAL_VALIDATION.md.
      Texto anterior, conservado porque explica el error de diagnóstico:
      ~~Relanzar el soak — único entregable de la Fase 6 sin cerrar.~~
      La corrida del 2026-08-03 **no midió nada**: el arnés construía `PlantPipelineService` con 3
      argumentos cuando ya pedía 4, y moría en el primer barrido de liveness. Corregido el
      2026-08-25 (más `uncaughtException` volcado al JSONL y criterio de duración ≥ 24 h en el
      veredicto, para que un ensayo corto no vuelva a imprimir un verde que se copie como válido).
      En la VM, dentro de `apps/api`:

      ```bash
      SOAK_HOURS=24 nohup node --import tsx scripts/soak-test.ts > ~/soak.log 2>&1 &
      # al terminar (o si se corta a mitad):
      npm run validate:soak-report -- ~/soak-<inicio>.jsonl --markdown
      ```

      No toca producción: proceso aparte, sin MySQL, sin puertos, sin sudo. Con el veredicto se
      cierra §4 de [`OPERATIONAL_VALIDATION.md`](./OPERATIONAL_VALIDATION.md).
- [ ] Re-ejecutar el colector de eficiencia para tendencias:
      `EFF_SSH=ptap npm run -w @ptap/api audit:efficiency [-- --json]`.

---

## Orden sugerido

Actualizado el 2026-08-11. Los tres primeros necesitan **sudo en la VM** y son de minutos:

1. **Cerrar `/hmi/` (§4)** — es lo único que hoy expone un equipo de planta a Internet sin
   autenticación, y ya no sirve a nada. Lo más urgente de la lista.
2. **Abrir el puerto 80 (§1)** — sin él la renovación falla y el certificado **vence el 2026-10-29**.
   Es el único pendiente con fecha límite.
3. **NTP (§2)** — `sudo timedatectl set-ntp true`, para que el KPI de latencia OPC sea fiable.
4. **Escalar los sensores congelados al integrador (§2b)** — no depende de nosotros y es lo que más
   afecta al dato que ve el operador.
5. **Cerrar D1 con el cliente (§3)** — es lo único que bloquea trabajo futuro de desarrollo.
6. **Recompilar el APK sin el HMI (§1)** — cosmético; conviene agruparlo con el próximo cambio de
   front que valga una recompilación, porque cuesta ~6 GB y ~40 min rehacer la toolchain.
7. **Typecheck de `test/`+`scripts/` (§4)** — barato, cierra la brecha de cobertura que queda ahora
   que la del HMI desapareció por eliminación.
8. **Soak test (§5)**, que necesita la VM estable y desplegada.
