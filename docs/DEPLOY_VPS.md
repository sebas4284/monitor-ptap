# Montaje del backend en un VPS externo (SSH / solo CLI)

Guía para desplegar el **backend `@ptap/api`** en un hosting tipo **VPS con root** (p. ej.
LatinoamericaHosting) bajo el dominio **`ptaps.telcobras.com`**, con **MySQL provisto por el
hosting**. Todo por SSH.

> **El servicio a montar es el backend** (API REST + WebSocket + puente OPC UA). El móvil es un
> cliente aparte (se distribuye como APK — ver [ANDROID_APK.md](ANDROID_APK.md)). La versión web es
> opcional (archivos estáticos servidos por el mismo nginx).

---

## 1. Lenguaje y stack

- **TypeScript sobre Node.js.** Backend **NestJS 11** (Express + **Socket.IO**).
- Base de datos **MySQL** (driver `mysql2`, JS puro).
- Puente industrial **`node-opcua`** (conecta al PLC por OPC UA).
- **Única dependencia nativa relevante: `argon2`** (hashing de contraseñas; usa binario *prebuilt*).

---

## 2. Requisitos

### Software (VPS Linux, root)
| Componente | Requisito | Por qué |
|---|---|---|
| **OS** | Linux 64-bit **glibc** (Ubuntu 22.04/24.04 LTS o Debian 12). **No Alpine/musl** | Los binarios *prebuilt* de `argon2` son para glibc |
| **Node.js** | **22 LTS** | NestJS 11 exige `^20.11 || >=22` |
| **npm** | 9+ (viene con Node) | El repo usa workspaces |
| **git** | cualquiera | clonar el repo (o subir por scp/rsync) |
| **build-essential + python3** | por si acaso | red de seguridad si `argon2` no encuentra su *prebuilt* y compila |
| **PM2** o **systemd** | gestor de proceso | mantener vivo el backend, reiniciar en caída/reboot, logs |
| **nginx** + **certbot** | reverse proxy + TLS | HTTPS 443 → 127.0.0.1:4000 **con WebSocket** |
| **MySQL** | **NO se instala** (lo da el hosting) | solo hacen falta credenciales |

### Hardware
- **Mínimo:** 1 vCPU · **1 GB RAM** · 10 GB SSD.
- **Recomendado:** 2 vCPU · **2 GB RAM** · 20 GB SSD (`node-opcua` + `node_modules` pesan; deja aire
  para logs).

### Dependencias npm (se instalan con `npm ci` EN el VPS)
Runtime: `@nestjs/*`, `socket.io`, `mysql2`, **`argon2`**, `jsonwebtoken`, `helmet`,
`express-rate-limit`, `dotenv`, `node-opcua` + `node-opcua-crypto`, `pino`, `prom-client`,
`reflect-metadata`, `rxjs`, `zod`. Build/scripts: `typescript`, **`tsx`** (corre migraciones/seed),
`@types/*`.

> ⚠️ **No copies `node_modules` desde Windows.** `argon2` es nativo y se resuelve por plataforma:
> instala en el servidor con `npm ci`.

---

## 3. Instalar prerrequisitos (una vez)

```bash
# Node 22 vía nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22 && nvm alias default 22
node -v            # v22.x

# Herramientas de sistema (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y git build-essential python3 nginx
sudo snap install --classic certbot || sudo apt-get install -y certbot python3-certbot-nginx

# PM2 global
npm install -g pm2
```

---

## 4. Traer el código e instalar

```bash
# como usuario de despliegue (no root para correr la app)
cd ~
git clone <URL-del-repo> monitor-ptap      # o sube el código por scp/rsync
cd monitor-ptap
npm ci                                      # instala todos los workspaces (incluye devDeps: tsx)
```

---

## 5. Configurar el `.env` (en la RAÍZ del repo)

```bash
# Genera los secretos:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('PASSWORD_PEPPER_V1_BASE64=' + require('crypto').randomBytes(64).toString('base64'))"

nano .env
```

Contenido mínimo (ajusta credenciales del MySQL gestionado y el OPC_ENDPOINT):

```dotenv
PORT=4000

# ── MySQL gestionado por el hosting ──
DB_HOST=<host-mysql-del-proveedor>
DB_PORT=3306
DB_USER=<usuario>
DB_PASSWORD=<contraseña>
DB_NAME=monitor_ptap

# ── Secretos (de los comandos de arriba; el pepper debe ser 64 bytes) ──
JWT_SECRET=<...>
PASSWORD_PEPPER_CURRENT_VERSION=1
PASSWORD_PEPPER_V1_BASE64=<...>
JWT_EXPIRES_IN=8h

# ── Público / CORS ──
APP_PUBLIC_URL=https://ptaps.telcobras.com
CORS_ORIGINS=https://ptaps.telcobras.com

# ── OPC UA (ver CAVEAT de red, §9) ──
CONNECTIVITY_PROVIDER=opcua
OPC_ENDPOINT=opc.tcp://<ip-o-host-del-plc>:59100
OPC_SECURITY_MODE=None
OPC_SECURITY_POLICY=None
OPC_IDENTITY=anonymous

# ── Correo de verificación (arranca en modo consola; SMTP real cuando se defina) ──
EMAIL_TRANSPORT=console
EMAIL_FROM=Monitor PTAP <no-reply@telcobras.com>

# ── Registro / rate-limit (opcionales; valores por defecto razonables) ──
REGISTER_BLOCK_DISPOSABLE=true
```

> El `.env` NO debe subirse al repo (ya está en `.gitignore`). Cópialo a mano en el servidor.

---

## 6. Base de datos: migrar y sembrar el primer admin

```bash
npm run db:migrate -w @ptap/api        # crea las tablas (idempotente)

# primer administrador (usa tus valores)
SEED_ADMIN_EMAIL=admin@telcobras.com \
SEED_ADMIN_PASSWORD='<contraseña-fuerte>' \
SEED_ADMIN_NAME='Administrador' \
SEED_ADMIN_PLANT=voragine \
  npm run db:seed-admin -w @ptap/api
```

---

## 7. Compilar y arrancar el backend con PM2

Compila el paquete compartido y el API (produce `dist/`), luego arranca con el ecosystem de PM2:

```bash
cd ~/monitor-ptap
npm run build          # compila @ptap/shared → dist y luego el API → dist/main.js

cd apps/api
pm2 start ecosystem.config.js   # corre node dist/main.js (nombre ptap-api)
pm2 save
pm2 startup            # ejecuta la línea que imprime (para reinicio en reboot)

pm2 logs ptap-api      # ver el arranque; debe decir que MySQL conectó y el puerto 4000 escucha
pm2 status
```

> El build de producción resuelve `@ptap/shared` a su JS compilado (`packages/shared/dist`), así
> que arranca con **`node dist/main.js`** (vía el ecosystem). Para desarrollo se sigue usando
> `npm run dev:api` (tsx), que resuelve el paquete desde su source sin compilar.

Verificación local (antes de nginx):

```bash
curl -s http://127.0.0.1:4000/api/health         # {"status":"ok",...}
curl -s http://127.0.0.1:4000/api/health/db      # {"status":"ok",...}  ← confirma el MySQL gestionado
```

---

## 8. nginx + HTTPS (con WebSocket)

`/etc/nginx/sites-available/ptaps`:

```nginx
server {
    listen 80;
    server_name ptaps.telcobras.com;

    # ── Cabeceras de seguridad (ciberseguridad frontend: clickjacking, HSTS, MIME, referrer) ──
    # `always` para que se envíen también en respuestas de error. La API ya trae CSP por helmet;
    # estas cubren lo que nginx sirve (incluida la build web si se aloja aquí).
    add_header X-Frame-Options "DENY" always;                    # anti-clickjacking (#15)
    add_header X-Content-Type-Options "nosniff" always;          # no adivinar MIME
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;  # HTTPS forzado (#6)

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        # WebSocket (Socket.IO) — imprescindible para la telemetría en vivo:
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # ── (OPCIONAL) Servir la build WEB de la app (expo export -p web → dist/) ──
    # Si además del APK se sirve la versión web, descomenta y ajusta la ruta:
    #
    # location /app/ {
    #     alias /home/deploy/monitor-ptap/apps/mobile/dist/;
    #     try_files $uri $uri/ /app/index.html;
    #     # Este location define add_header → hay que REPETIR las de seguridad (nginx no las hereda):
    #     add_header X-Frame-Options "DENY" always;
    #     add_header X-Content-Type-Options "nosniff" always;
    #     add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    #     add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    #     # CSP para la web (#2). RN-web inyecta estilos inline → style-src permite 'unsafe-inline';
    #     # connect-src cubre la API y el WebSocket (mismo origen). Ajusta si el API va en otro host.
    #     add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'" always;
    #     # No servir los source maps en producción (#9): menos código legible en DevTools.
    #     location ~* \.map$ { return 404; }
    # }
}
```

> Las cabeceras `add_header` se re-declaran dentro de un `location` si ese bloque añade las suyas
> (nginx NO hereda `add_header` cuando el bloque hijo define alguno). Por eso el `location /app/`
> repite/añade su CSP.

```bash
sudo ln -s /etc/nginx/sites-available/ptaps /etc/nginx/sites-enabled/ptaps
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ptaps.telcobras.com     # emite el TLS y reescribe el server para 443
```

Verificación pública:

```bash
curl -s https://ptaps.telcobras.com/api/health   # 200
```

---

## 9. Red y puertos — CAVEAT crítico

- **Inbound (abrir en el firewall):** **443** (HTTPS) y **80** (redirección + renovación de certbot).
  El Node escucha **solo en `127.0.0.1:4000`** (nunca expuesto directo).
- **Outbound:**
  - **npm** (443) durante `npm ci`.
  - **PLC por OPC UA** (p. ej. `59100/tcp`) → **el backend en el hosting DEBE poder alcanzar el
    PLC.** Hoy el PLC está tras NAT/túnel (ver [INCIDENTE_CONEXION_PLC.md](INCIDENTE_CONEXION_PLC.md)).
    **Sin resolver esa ruta (VPN / túnel / apertura controlada), la telemetría NO llega aunque el
    hosting quede perfecto.** Es una decisión de red aparte del montaje.
  - SMTP si algún día se activa el correo real.

---

## 10. Operación

```bash
pm2 restart ptap-api        # tras cambiar el .env o actualizar código
pm2 logs ptap-api --lines 100
git pull && npm ci && npm run db:migrate -w @ptap/api && pm2 restart ptap-api   # actualizar
```

## Checklist de éxito
- [ ] `node -v` = 22.x
- [ ] `pm2 status` → `ptap-api` **online**
- [ ] `curl https://ptaps.telcobras.com/api/health` → 200
- [ ] `curl https://ptaps.telcobras.com/api/health/db` → 200
- [ ] Login por HTTPS devuelve un JWT
- [ ] La app (APK apuntando a `https://ptaps.telcobras.com`) muestra Sensores en vivo (WebSocket OK)
- [ ] El backend alcanza el PLC (§9) — si no, telemetría "sin datos" pese a todo lo demás OK
