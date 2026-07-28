# Runbook de Producción (as-built) — Monitor PTAP

Documento de **lo que realmente está montado** hoy (complementa los idealizados
[DEPLOY_VPS.md](DEPLOY_VPS.md) y [ANDROID_APK.md](ANDROID_APK.md)). Sirve para operar, actualizar,
recuperar o **trasladar** el sistema.

> ⚠️ **Este documento NO contiene secretos.** Contraseñas, tokens, `JWT_SECRET`, pepper y
> credenciales viven SOLO en el `.env` de la VM y en la copia local `.env.production.local`
> (gitignored). Aquí solo se referencia *dónde* están.

---

## 1. Topología

Backend + web + base de datos corren en **una VM interna** (`192.168.30.50`, Ubuntu 24.04,
2 vCPU / 2 GB RAM / 47 GB disco). El cliente **nunca** habla con MySQL: siempre pasa por la API.

```
Usuario (móvil/navegador)
   │  HTTPS  (TLS en el borde de Cloudflare)
   ▼
Cloudflare  ──►  cloudflared (túnel, en la VM)  ──►  nginx :80
                                                        │
                                    ┌───────────────────┼─────────────────────┐
                                    ▼                    ▼                     ▼
                              web SPA (estático)   /api → Node :4000     /descargar/ (APK)
                                                        │
                                                   MySQL 127.0.0.1:3306
                                                        │
                              PLC (OPC UA, IP propia) ◄─┘  (solo lectura)
```

- **Acceso de operador**: red interna `192.168.30.0/24` vía **VPN L2TP** (perfil Windows
  `PTAP-VPN`, sin PSK) + **SSH por llave** (alias `ptap`, `~/.ssh/id_ed25519`; password de SSH
  deshabilitado). Credenciales VPN/SSH/MySQL: fuera de git (las tiene el operador).
- **Acceso público**: solo por el **túnel HTTPS de Cloudflare** (ver §6). El puerto HTTP directo
  a Internet está **cerrado** (ver §5).

## 2. Servicios en la VM

| Servicio | Qué hace | Notas |
|---|---|---|
| **nginx** (:80) | Reverse proxy: web SPA en `/`, API en `/api/`, WebSocket en `/socket.io/`, APK en `/descargar/` | Config en `/etc/nginx/sites-available/ptap`. Cabeceras de seguridad + cache (index no-cache, chunks immutable) |
| **pm2 → `ptap-api`** | Backend NestJS (`node dist/main.js`) | Arranca en cada reboot (`pm2 startup` systemd), `pm2 save` |
| **MySQL 8** (`ptapapp`) | BD (users, audit_log, command_log, tokens) | Escucha **solo localhost** (`bind-address 127.0.0.1`) |
| **cloudflared** | Túnel HTTPS al backend | Quick tunnel **efímero** (ver §6). Script `~/deploy-scripts/cf-run.sh` |
| **fail2ban** | Anti fuerza-bruta SSH | Activo, jail `sshd` |

## 3. Código y configuración

- Repo en la VM: `~/monitor-ptap` (clon **público** de `github.com/sebas4284/monitor-ptap`,
  rama **`dev`**). El servidor solo hace lectura/pull.
- **`.env`** en la raíz del repo EN la VM (`chmod 600`). Copia local durable del operador:
  `.env.production.local` (gitignored) en el repo local. Variables (SIN valores aquí):
  `PORT`, `DB_HOST/PORT/USER/PASSWORD/NAME`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
  `PASSWORD_PEPPER_*`, `APP_PUBLIC_URL`, `CORS_ORIGINS`, `CONNECTIVITY_PROVIDER`, `OPC_ENDPOINT`,
  `METRICS_AUTH_TOKEN`, `EMAIL_TRANSPORT`, `REGISTER_BLOCK_DISPOSABLE`, `RATE_LIMIT_*`,
  `REQUIRE_EMAIL_VERIFICATION` (default off). Secretos de producción son **frescos** (distintos de dev).
- **Web** (SPA Expo) compilada con `API_BASE_URL=` **vacío (mismo origen)** → sirve por cualquier
  hostname (túnel o LAN) sin recompilar. Estáticos en `/var/www/ptap-web`.

## 4. Base de datos y backups

- Migrar/sembrar (paso de despliegue, no runtime):
  `npm run db:migrate -w @ptap/api` y `npm run db:seed-admin -w @ptap/api`.
- **Backups**: `mysqldump` diario por cron (`0 3 * * *`), script `~/deploy-scripts/db-backup.sh`
  (usa `~/.ptapdb.cnf`, `--no-tablespaces`, gzip, **retención 14 días**) → `~/backups/`.
  **Pendiente**: copia OFF-site (hoy los dumps viven en la misma VM).
- **Revisar la BD desde el PC** (sin abrir MySQL a la red): túnel SSH
  `ssh -L 3307:localhost:3306 ptap` y conectar un cliente a `127.0.0.1:3307` (user `ptapapp`).
- Administradores actuales: `sebas4284@gmail.com`, `loresjoshua@gmail.com`. Los admins **no** se
  degradan desde la app (regla de "intocables") → gestión por BD/seed.

## 5. Seguridad (endurecimiento aplicado)

- **Cleartext de Internet CERRADO**: `ufw` permite el **puerto 80 solo desde rangos privados**
  (10/8, 172.16/12, 192.168/16) + loopback → LAN/VPN y el túnel funcionan, pero las IPs públicas
  se dropean. (El router hace DNAT sin SNAT → preserva la IP de origen.) Regla en
  `~/deploy-scripts/ufw-restrict80.sh`. ufw solo abre 22/80/443.
- **SSH** solo-llave (`PasswordAuthentication no`, `PermitRootLogin no`) + **fail2ban**.
- **MySQL** solo localhost. **`/metrics`** protegido con `METRICS_AUTH_TOKEN`.
- **App**: RBAC por rol (`packages/shared`), guards por endpoint y por pantalla; registro anti-bot
  (allowlist de nombre, honeypot, bloqueo de correos desechables, doble campo correo/contraseña,
  celular 10 dígitos, contraseña con símbolo); `trust proxy` para rate-limit correcto tras el proxy;
  aprobación **manual** del admin como muro anti-bot (con badge de pendientes). Sin SMS/correo (sin
  proveedor); `REQUIRE_EMAIL_VERIFICATION` off por eso.
- **Sin secretos en git** ni en el APK; `.env` gitignored.

## 6. Túnel Cloudflare (exposición pública)

- Hoy es un **quick tunnel efímero**: `cloudflared tunnel --url http://localhost:80` (script
  `~/deploy-scripts/cf-run.sh`, corre con `setsid`). Da una URL `https://<algo>.trycloudflare.com`
  que **cambia en cada reinicio de cloudflared** y **no sobrevive reboot** de la VM.
- **URL vigente**: ver el log → `grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' ~/cloudflared.log | tail -1`.
- Al cambiar la URL: re-pinear en `CORS_ORIGINS` del `.env` + `pm2 restart ptap-api`, y **reconstruir
  la APK** (que la lleva horneada — ver ANDROID_APK.md).
- ⚠️ Chrome marca los dominios `trycloudflare.com` como "peligrosos" (los abusan phishers) → **no es
  apto para repartir a usuarios**. Es un **stopgap** de pruebas.

## 7. Actualizar el sistema (flujo normal)

1. Desarrollo local en `yosh` → `git push origin yosh:dev` (cuenta **LorJosh**, token classic con
   scope `repo`; el remoto apunta a `https://LorJosh@github.com/...`).
2. En la VM: `bash ~/deploy.sh` (hace `git pull` de `dev` + `npm ci` + migraciones + build + `pm2
   restart`).
3. Si cambió el **front**: recompilar la web
   `cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear` y
   `sudo bash ~/deploy-scripts/web-setup.sh`.

## 8. "Traslado" — mover a otro servidor / pasar a producción estable

**Mover a otra VM/servidor** (Linux):
1. Instalar base: Node 22, MySQL 8, pm2, nginx, git (ver [DEPLOY_VPS.md](DEPLOY_VPS.md)).
2. `git clone` (rama `dev`) + `npm ci`.
3. Copiar el `.env` (desde `.env.production.local`) a la raíz; ajustar `DB_*`, `APP_PUBLIC_URL`,
   `CORS_ORIGINS`, `OPC_ENDPOINT` al nuevo entorno.
4. Restaurar BD: crear la base + `gunzip < backup.sql.gz | mysql ...` (o `db:migrate` en limpio) y
   `db:seed-admin`.
5. `npm run build` → `pm2 start apps/api/ecosystem.config.js` → `pm2 save && pm2 startup`.
6. nginx (reverse proxy + WebSocket) → recargar. Reaplicar hardening (ufw, ssh, fail2ban, backups).

**Pasar de túnel efímero → URL fija (recomendado para producción):** montar un **named tunnel** de
Cloudflare con **dominio propio** (cuenta gratis):
```bash
cloudflared login                      # autoriza el dominio en Cloudflare
cloudflared tunnel create ptap
cloudflared tunnel route dns ptap ptap.telcobras.com
cloudflared tunnel run ptap            # URL estable: https://ptap.telcobras.com
```
Instalarlo como **servicio systemd** (`cloudflared service install`) → sobrevive reboots. Con URL
fija: se va la alerta de Chrome, se puede emitir/forzar TLS del dominio, y **la APK se compila una
sola vez** (deja de necesitar rebuild). Actualizar `APP_PUBLIC_URL`/`CORS_ORIGINS`.

## 9. Scripts operativos (en la VM, `~/deploy-scripts/`)

`deploy.sh` (actualizar backend), `db-backup.sh` (backup diario), `web-setup.sh` (publicar web +
recargar nginx), `cf-run.sh` (levantar el túnel), `ufw-restrict80.sh` (cerrar cleartext), y los de
build de APK (ver ANDROID_APK.md).

## 10. Distribución móvil

- **Android (APK)**: construido EN la VM y alojado para descarga — ver
  [ANDROID_APK.md](ANDROID_APK.md) → sección "Build en la VM". Enlace: `https://<túnel>/descargar/`.
- **iOS: FUERA DE ALCANCE por ahora.** Apple **no permite** instalar un `.ipa`/APK por descarga
  directa como Android (no hay "orígenes desconocidos"). Requeriría **Apple Developer Program
  ($99/año)** + firma de Apple + distribución por **TestFlight** (invitación por correo, lo más
  parecido a un enlace) o **Ad Hoc** (registrando el UDID de cada iPhone, máx 100), y **compilar en
  macOS/Xcode o en EAS Build (nube)** — no se puede en Windows/Linux. Es la **misma** app Expo (el
  target iOS ya está configurado: `ios.bundleIdentifier = com.ptap.monitor`), no una app nueva.
  **Alternativa inmediata para iPhone**: usar la **web en Safari** (y "Añadir a pantalla de inicio"
  como PWA), que ya funciona por el túnel HTTPS.

## 11. Pendientes conocidos

- Dominio + **named tunnel** (URL fija, quita alerta de Chrome, APK sin rebuild).
- **Backup off-site** de la BD (hoy solo en la VM).
- Rotar el **token de GitHub** de LorJosh cuando se termine el setup.
- iOS (diferido, §10).
