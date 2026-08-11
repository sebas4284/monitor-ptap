# Pendientes del proyecto

> **Único tracker de pendientes.** Fusiona los tres que existían por separado (`PENDIENTES_VPN.md`,
> `PENDIENTE_DESPLIEGUE.md`, `SEMANA1-4_PENDIENTES.md`) y que se contradecían entre sí.
>
> Última revisión: **2026-08-05**.
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
- [ ] 🔴 **Recompilar el APK contra `https://aquora.xpertic.co`.** El APK distribuido lleva horneada
      la URL del túnel, que ya está apagado, así que **no conecta y no hay vuelta atrás**: un quick
      tunnel nuevo recibe una URL distinta, de modo que reencenderlo tampoco lo arreglaría. La
      recompilación es el único camino. Con dominio estable debería ser la última por cambio de URL.

      **Requisitos comprobados el 2026-08-11 (el entorno NO está listo):**
      - El build es **local en Windows** (`npm run build:android` → `expo prebuild` + `gradlew.bat
        assembleRelease`), no en la VM: allí no hay SDK de Android ni keystore.
      - El **keystore de release existe** en `C:\keys\monitor-ptap-release.keystore`. Es
        imprescindible usar **ese mismo**: Android rechaza instalar sobre una app existente un APK
        firmado con otra llave, y obligaría a desinstalar antes.
      - Falta `ANDROID_HOME` (el SDK sí está en `%LOCALAPPDATA%\Android\Sdk`).
      - **No hay configuración de firma** en `android/gradle.properties` ni en
        `~/.gradle/gradle.properties`: hay que añadir ruta del keystore, alias y contraseñas.
      - ⚠️ El JDK instalado es el **26**; React Native/AGP suele exigir **JDK 17**. Muy probable que
        haya que instalar el 17 y apuntar `JAVA_HOME` a él.
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

# 2. en la VM (por VPN + SSH `ptap`)
bash ~/deploy.sh          # fetch + pull + npm ci + migraciones + build + pm2 restart

# 3. si cambió el front, recompilar y publicar la web
cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear
sudo bash ~/deploy-scripts/web-publish.sh
```

> ⚠️ Para publicar la web usar **`web-publish.sh`**, nunca `web-setup.sh`: este último termina
> pisando `/etc/nginx/sites-available/ptap` con una copia guardada, lo que **borraría los server
> blocks de HTTPS** si ya se corrió `le-nginx.sh`. El propio script lo avisa en su cabecera.

> La web se compila con `API_BASE_URL` **vacío** (mismo origen): no hay URL horneada, así que solo
> hace falta recompilar cuando cambia el código, no por el dominio.

**Último despliegue: 2026-08-06, commit `56b9130`. COMPLETO y verificado.** Backend y web en la VM,
con la bandeja de notificaciones y el detector de sensores congelados ya activos. Comprobantes en
verde: API `/health`, `/health/db`, `/health/opc`, la web por HTTP y por HTTPS, y
`/api/notifications` respondiendo 401 sin token. Puente OPC `Connected`, 41 buffers, 0 en fallo.

> 🔴 **El detector encontró 10 plantas con sensores congelados** en su primer barrido — cuatro más
> de las que se habían visto revisando a mano. Ver §Sensores congelados abajo.

Pendiente:

- [ ] **NTP** — para que el KPI de latencia OPC sea fiable: `sudo timedatectl set-ntp true`
- [ ] Considerar rotar el token de GitHub de **LorJosh** (token *classic* con scope `repo`; los
      fine-grained no sirven en repos de otra cuenta personal).
- [ ] **APK:** sí hay que recompilarla, la URL va horneada (`API_BASE_URL=https://aquora.xpertic.co`).
      Procedimiento en [`ANDROID_APK.md`](./ANDROID_APK.md) §"Build en la VM". Con dominio propio esta
      debería ser la **última** recompilación por cambio de URL.
- [ ] Verificar tras desplegar:
      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/health/opc   # 200
      pm2 status                                                                       # online, estable
      npm run -w @ptap/api audit:efficiency                                            # Score 🟢
      ```

---

## 2b. 🔴 Sensores congelados — ESCALAR AL INTEGRADOR

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

---

## 4. Deuda técnica interna (no bloquea a nadie externo)

- [ ] **El gate de sesión del HMI no tiene ni un test.** `apps/api/src/modules/hmi/hmi.controller.ts`
      es la puerta (`auth_request` de nginx, cookie `hmi_session`) que protege el HMI de WinCC de
      Internet, y ningún archivo de `test/` lo menciona. Es la brecha de cobertura más seria.
- [ ] **El parseo de tramas del adaptador OPC UA real está casi sin cubrir.** `DataValue →
      RawBufferSample`, `channelDataType()`, `isGoodStatus()` y el camino de escritura por
      `IndexRange` en `opcua-connectivity.adapter.ts` solo se ejercitan de refilón; el resto de la
      suite corre contra el simulador o contra el replay, que validan *aguas abajo* del parseo.
- [ ] **`test/` y `scripts/` de la API no los typechequea nadie.** El script `typecheck` usa
      `tsconfig.json`, cuyo `include` es solo `src/**/*.ts`. Existe `tsconfig.test.json` con
      `test/**/*.ts`, pero ningún script ni el CI lo invoca. `scripts/` no está en ningún tsconfig.
- [ ] **Los `test:*` de la API usan sintaxis de cmd.exe** (`set "VAR=…"&&`), que en Linux no hace
      nada. El CI lo esquiva pasando `TSX_TSCONFIG_PATH` por `env:` y corriendo los tests por glob.
- [ ] **`soak-test.ts` y `opcua-writes-toggle.sh` no tienen script npm** — se invocan a mano.
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

Funcionando desde el 2026-08-06. Parámetros por variable de entorno, sin recompilar:

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
- [ ] Ejecutar el **soak test de 24–72 h** (`scripts/soak-test.ts`) — es el último entregable de la
      Fase 6 sin correr. Ver [`OPERATIONAL_VALIDATION.md`](./OPERATIONAL_VALIDATION.md).
- [ ] Re-ejecutar el colector de eficiencia para tendencias:
      `EFF_SSH=ptap npm run -w @ptap/api audit:efficiency [-- --json]`.

---

## Orden sugerido

1. Publicar el 443 y el 80 (§1) — destraba el dominio y la renovación automática.
2. `git push origin yosh:dev` + desplegar (§2) — el código ya está probado y verde.
3. Cerrar D1 con el cliente (§3) — es lo único que bloquea trabajo futuro.
4. Test del gate del HMI y typecheck de `test/`+`scripts/` (§4) — barato y cierra las dos brechas
   de cobertura más serias.
5. Soak test (§5), que necesita la VM estable y desplegada.
