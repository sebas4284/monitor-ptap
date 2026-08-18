# Dominio `aquora.xpertic.co` — TLS válido

> Objetivo: servir el monitor PTAP en **`https://aquora.xpertic.co`** con TLS válido y renovación
> automática.

---

## ✅ RESUELTO — 2026-08-11

**El dominio ya sirve desde Internet con certificado válido.** Verificado desde fuera de la red:

```
https://aquora.xpertic.co/            -> 200   certificado válido
https://aquora.xpertic.co/api/health  -> 200
IP contactada: 191.102.61.125
```

**Lo que lo destrabó no fue ninguno de los dos caminos que este documento evaluaba.** Redes cambió
la publicación de la VM a **NAT 1:1 contra `191.102.61.125`** (antes: DNAT por puerto contra
`191.102.61.123`, y solo el `:5554`). Con eso desapareció de golpe la premisa sobre la que gira todo
el resto del documento — "el único puerto publicado es el 5554 y el DNS no transporta puertos" — y
el registro A pasó a bastar por sí solo.

Consecuencias, ya aplicadas:

- `APP_PUBLIC_URL` = `https://aquora.xpertic.co` (antes: túnel efímero de Cloudflare).
- El **quick tunnel de Cloudflare se apagó**; su origen se retiró de `CORS_ORIGINS`.
- El camino A (named tunnel) queda **descartado**, no pendiente: ya no aporta nada.

Lo que sigue abierto:

- 🔴 **El puerto 80 sigue cerrado desde Internet**, así que el desafío HTTP-01 no funciona y la
  renovación automática del certificado **no puede completarse**. El certificado vence el
  **2026-10-29**. Ver [`PENDIENTES.md`](./PENDIENTES.md).
- Con NAT 1:1, **ufw pasó de ser la segunda barrera a ser la única**. Verificado el 2026-08-11
  desde Internet: 3306, 4000 y 8080 **cerrados**; 22 abierto a propósito (solo-llave + fail2ban).

> **El resto del documento se conserva como registro de la investigación** (inventario de la zona,
> procedimientos de ambos caminos, emisión del certificado). Sus datos de partida —la IP `.123` y el
> DNAT `:5554`— **ya no son válidos**.

---

## Estado a 2026-07-31 — se eligió el camino B (Let's Encrypt)

Se evaluaron dos caminos. **El elegido es el B**, detallado en [§7](#7-camino-b--lets-encrypt-en-la-vm).

| | A · Cloudflare Tunnel | **B · Let's Encrypt en la VM** |
|---|---|---|
| Estado | Preparado y bloqueado | **En ejecución** |
| Bloqueante | El dominio tiene `update prohibited` en GoDaddy y no se pueden cambiar los NS sin el titular de esa cuenta | Depende de que redes publique el 443 |
| Puertos entrantes | Ninguno | Hay que abrir el **443** |
| Zona `xpertic.co` | Migrar los 33 registros | Un TXT temporal |

El camino A quedó **listo para retomarse**: los 32 registros están cargados y verificados en
Cloudflare, y `cf-tunnel-setup.sh` espera en la VM. Solo falta el cambio de nameservers. Si el
titular de GoDaddy aparece, conviene volver a A — no expone la VM a Internet.

> ⚠️ **Lo que se acepta al tomar el camino B:** la VM queda accesible desde Internet. Hoy el ufw
> solo admite tráfico de rangos privados, y esa fue una decisión deliberada. La VM tiene ruta al PLC
> (`10.10.51.225`), cuyo servidor OPC UA acepta sesiones **anónimas y sin cifrar** (hallazgo P0). El
> perímetro deja de ser la red y pasa a ser nginx + el RBAC de la aplicación.

---

## 1. Punto de partida

| Qué | Valor |
|---|---|
| Dominio elegido | `aquora.xpertic.co` (marca AQUORA sobre el dominio corporativo Xpertic) |
| IP pública de la sede | ~~`191.102.61.123`~~ → **`191.102.61.125`** desde el 2026-08-11 |
| VM del backend | `192.168.30.50` (nginx :80/:443 → pm2 `ptap-api` :4000) |
| Publicación en el router | ~~DNAT `:5554 → :80`~~ → **NAT 1:1** contra `191.102.61.125` (sin puertos) |
| Nameservers de la zona | `ns15/ns16.latinoamericahosting.com` (cPanel de LatinoaméricaHosting) |

### Por qué no bastaba con el registro A *(superado — ver la cabecera)*

> Todo este apartado describe la situación **anterior al 2026-08-11**. Con la NAT 1:1 los tres
> puntos dejaron de aplicar y el registro A pasó a ser suficiente. Se conserva porque explica por
> qué se llegó a evaluar Cloudflare Tunnel.

El registro `aquora IN A 191.102.61.123` ya está creado y resuelve bien, pero **no da acceso**:

1. El único puerto público publicado hacia la VM es el **5554**, y el DNS no transporta puertos →
   la URL quedaría `http://aquora.xpertic.co:5554`.
2. Aunque se use ese puerto, **la VM lo rechaza**: el ufw solo acepta el puerto 80 desde rangos
   privados (`10/8`, `172.16/12`, `192.168/16`). Como el router hace DNAT **sin SNAT**, conserva la
   IP de origen real, así que todo lo que viene de Internet llega con IP pública y se descarta.
   Verificado el 2026-07-30: `ERR_TIMED_OUT` desde datos móviles y desde una red externa.
   Regla en `~/deploy-scripts/ufw-restrict80.sh`.
3. Sin puerto 80 público no hay desafío HTTP-01 → Let's Encrypt directo tampoco funcionaría.

El **named tunnel de Cloudflare** resuelve los tres a la vez: es una conexión **saliente** desde la
VM, no consume ningún puerto de la IP pública, entrega TLS en el borde y permite **cerrar el 5554**.

---

## 2. Inventario de la zona `xpertic.co` (previo a migrar)

Reconsultado el 2026-07-31 contra `ns15.latinoamericahosting.com` (SOA serial `2026073000`).
**Esta tabla es la referencia de verdad**: al terminar la migración, cada fila debe existir idéntica
en Cloudflare.

> La revisión del 2026-07-31 encontró **14 registros que faltaban** en la versión anterior de esta
> tabla, marcados con ⭑: `cpcalendars`, `cpcontacts`, los 5 SRV, `_acme-challenge`, el DKIM de
> `office365`, los 4 TXT `path=/` de CalDAV/CardDAV y `_cpanel-dcv-test-record`. Los últimos 6
> aparecieron recién al cruzar contra el escaneo de Cloudflare — desde fuera no hay AXFR y no había
> forma de adivinar esos nombres. **La zona tiene 33 registros**, no 19.

### Resultado de la auditoría del escaneo de Cloudflare (2026-07-31)

El escaneo automático importó **27 de los 32** que hacen falta (los 33 menos `aquora`, que lo crea el
túnel). Dos hallazgos, ambos corregidos antes de tocar los nameservers:

1. **No importó nada del subdominio `office365`** — los 5 registros: `A`, `MX`, los 2 `TXT` y el
   `default._domainkey.office365`. El escáner no explora subdominios de segundo nivel.
2. **Puso los 12 registros `A`/`CNAME` en naranja (Proxied)**, incluidos el apex y `mail`. Ese es el
   default de Cloudflare y es exactamente el escenario que tumba el correo (ver el aviso de abajo).

| Nombre | Tipo | Valor | Proxy en Cloudflare |
|---|---|---|---|
| `xpertic.co` | A | `15.235.65.10` | 🔘 **DNS only** (es el servidor de correo) |
| `xpertic.co` | MX (0) | `xpertic.co` | — |
| `xpertic.co` | TXT | `v=spf1 ip4:15.235.65.10 include:relay.mailchannels.net +a +mx ~all` | — |
| `www` | CNAME | `xpertic.co` | 🔘 DNS only |
| `mail` | CNAME | `xpertic.co` | 🔘 DNS only |
| `ftp` | A | `15.235.65.10` | 🔘 DNS only |
| `cpanel` | A | `15.235.65.10` | 🔘 DNS only |
| `webmail` | A | `15.235.65.10` | 🔘 DNS only |
| `webdisk` | A | `15.235.65.10` | 🔘 DNS only |
| `whm` | A | `15.235.65.10` | 🔘 DNS only |
| `autodiscover` | A | `15.235.65.10` | 🔘 DNS only |
| `autoconfig` | A | `15.235.65.10` | 🔘 DNS only |
| ⭑ `cpcalendars` | A | `15.235.65.10` | 🔘 DNS only |
| ⭑ `cpcontacts` | A | `15.235.65.10` | 🔘 DNS only |
| `office365` | A | `15.235.65.10` | 🔘 DNS only |
| `office365` | MX (0) | `Office365-xpertic-co.mail.protection.outlook.com` | — |
| `office365` | TXT | `MS=ms91860500` | — |
| `office365` | TXT | `v=spf1 ip4:15.235.65.10 include:relay.mailchannels.net include:spf.protection.outlook.com -all` | — |
| ⭑ `default._domainkey.office365` | TXT | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2ASGOCMBC94YSlQE1sAf62Q+JiEKfNvuXSeVwj/jmWDJGo5SrgawZoUn5EcZaqhlaJ2jacg4sf04OE5XpjiJx0wxysyJAqg9l+SytmLM+tNoM+E/PT6IFZOnrxf/csOxpi3uqSDQ54B+WUDEaGXpCn5D086x0OvN86wWrus2RqSkGRqoJjlesFrvrEKwrbXhbLweeLWA6vbEwQbD5SJfleZuHX4/qijpI4StVAWHHdyllOYiNFkuTezTGS6RXfHO6+q6JkwJqFcJEDKan8KSMj3Ch2pAwRokEhfOEK+AhmfqaAbrX/KeONmGMJsRNsb+x2dsZ8oXhWLSBnEs1eQ1IQIDAQAB;` | — |
| `_dmarc` | TXT | `v=DMARC1;p=none;sp=none;adkim=r;aspf=r;pct=100;fo=0;rf=afrf;ri=86400` | — |
| `default._domainkey` | TXT | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2mWqQuH8B5YiEfM+NcNXOmWPjfHy7WYkPmmN+bYw5Ah2l7j5LyZ3GhaAMnYvLhq5XVdoqZiL94LYZ30/1oeONHDfxG/BbWkCcfkoo53789nQtf9WDQlpzK6E9DIxlkIzWHD3n0EiTPeMarf6I3pDYx/7jRlAYAbeO5QXFpQoubJnUXutK16UBDHei8bagcLH2quDC3KDnH57xU8OJiEQTNmDpwrdTkW49ep6AHZdqnT2nk4Oc8xEm7EwD/0gqPapdTV1iHUoUEKBVvTprJCQY72kKd7q8HmXddhxlBlhL6lxnKcl20NbSx7hWCR0+o64GvsdaCg4pDupV8UMkIfILQIDAQAB;` | — |
| ⭑ `_autodiscover._tcp` | SRV | `0 0 443 cpanelemaildiscovery.cpanel.net` | — |
| ⭑ `_caldav._tcp` | SRV | `0 0 2079 xpertic.co` | — |
| ⭑ `_caldavs._tcp` | SRV | `0 0 2080 xpertic.co` | — |
| ⭑ `_carddav._tcp` | SRV | `0 0 2079 xpertic.co` | — |
| ⭑ `_carddavs._tcp` | SRV | `0 0 2080 xpertic.co` | — |
| ⭑ `_acme-challenge` | TXT | `2szOwzvHXRKGMB5dpBsB8CfR69UYL_dJdTLVr7jFuzE` | — |
| ⭑ `_caldav._tcp` | TXT | `path=/` | — |
| ⭑ `_caldavs._tcp` | TXT | `path=/` | — |
| ⭑ `_carddav._tcp` | TXT | `path=/` | — |
| ⭑ `_carddavs._tcp` | TXT | `path=/` | — |
| ⭑ `_cpanel-dcv-test-record` | TXT | `_cpanel-dcv-test-record=sn071rTnsx9Ba0Vm21wTilQlYIhGOG5A1PQUHR7MsE2KMjEtfoWy2j_u7gpoguhe` | — |
| `aquora` | A | `191.102.61.123` | ← lo **reemplaza** el túnel (§4) |

**No existen** en la zona: `CAA`, `AAAA` en el apex, `smtp`/`pop`/`imap`, `_domainconnect`,
`selector1/2._domainkey`. La ausencia de `CAA` es buena noticia: nada bloquea la emisión del
certificado Universal SSL de Cloudflare para `aquora`.

> ⚠️ **La regla que no se puede violar:** todo lo relacionado con correo y cPanel va en **gris
> (DNS only)**. Si se deja el ícono naranja en el apex, en `mail`, `webmail`, `cpanel`, `whm`,
> `autodiscover` o `autoconfig`, se cae el correo corporativo y el acceso al panel — Cloudflare solo
> proxea HTTP/HTTPS en puertos estándar, no SMTP/IMAP ni el 2083/2087.
>
> El único registro que va en **naranja (proxied)** es `aquora`.

---

## 3. Llevar el DNS a Cloudflare

`cloudflared tunnel route dns` exige que Cloudflare sea autoritativo de la zona. Hay dos formas de
lograrlo y **la primera es la buena**.

### 3.A — Zona hija `aquora.xpertic.co` — ❌ IMPOSIBLE EN FREE (verificado 2026-07-31)

Se probó agregar **solo el subdominio** como zona (`Add a site` → `aquora.xpertic.co`). El dashboard
lo **rechaza**:

```
Please ensure you are providing the root domain and not any subdomains
(e.g., example.com, not subdomain.example.com)
```

La regla real, que la documentación enuncia de forma confusa, es esta:

| Situación | ¿Gratis? |
|---|---|
| `xpertic.co` **es** la zona en Cloudflare → cualquier subdominio dentro | ✅ Sí |
| `xpertic.co` vive en otro proveedor y se quiere **solo** `aquora.xpertic.co` como zona | ❌ **Business/Enterprise** |

Las páginas de *subdomain setup* mencionan que el padre puede estar en un proveedor externo, pero
eso describe el escenario, no lo habilita: la delegación de subdominio como zona propia arranca en
**Business**. **No hay workaround.** Queda documentado para que nadie vuelva a intentarlo.

### 3.B — Migrar `xpertic.co` completo — ÚNICO CAMINO CON CLOUDFLARE

Descartada 3.A, esta es la única forma de tener `aquora.xpertic.co` sobre Cloudflare Tunnel. Se puede
hacer con downtime cero si se respeta el orden, y el riesgo baja mucho importando el archivo de zona
en vez de confiar en el escaneo automático (que ya demostró dejar afuera los 5 registros de
`office365`).

> **Archivo listo:** [`xpertic-co-para-cloudflare.bind`](./xpertic-co-para-cloudflare.bind) — los 32
> registros verificados contra `ns15.latinoamericahosting.com`, con los TXT largos ya partidos en
> strings de ≤255 caracteres. Se carga de una con *Import DNS Records*. Aun así, **el export del
> propio cPanel es la fuente de verdad preferida**: este archivo solo cubre los nombres que se
> pudieron consultar desde fuera.

> ⚠️ **El punto de no retorno es el cambio de nameservers, y su rollback no es inmediato.** La
> delegación NS en el TLD `.co` se cachea hasta 24 h, así que volver a `ns15/ns16` puede tardar horas
> en propagar. Por eso todo — los 32 registros y los 12 en gris — se verifica **antes** de tocar los
> NS, que es el único paso irreversible en la práctica.

#### El registrador es GoDaddy, no LatinoaméricaHosting

Consultado por RDAP el 2026-07-31. Es un dato que no estaba en ningún lado y manda a la persona
equivocada si se asume mal:

| Dato | Valor |
|---|---|
| Registrador | **GoDaddy.com, LLC** (IANA 146) |
| DNS actual | LatinoaméricaHosting (`ns15`/`ns16`) — solo hospeda, no registra |
| Registrante | `Registration Private` (privacidad de GoDaddy activada) |
| Alta | 2020-09-29 · Vence 2027-09-29 · Último cambio 2025-09-30 |
| DNSSEC | `delegationSigned=false` ✅ |
| **Status** | `delete prohibited`, `transfer prohibited`, `renew prohibited`, **`update prohibited`** |

> 🔴 **`update prohibited` bloquea el cambio de nameservers.** Es el candado de *Domain Protection*
> de GoDaddy. Hay que desactivarlo en el panel del dominio antes de poder tocar los NS; con la
> privacidad activada, GoDaddy puede pedir verificación en dos pasos del titular de la cuenta.
> Averiguar quién tiene esas credenciales **antes** de agendar la ventana de cambio.

La verificación de la zona antes del cambio se automatizó en `verify-cf.ps1`: consulta directo a
`anna.ns.cloudflare.com` (que responde autoritativo aunque el TLD todavía delegue a `ns15/ns16`) y
detecta registros proxeados porque devuelven IPs de Cloudflare en vez de `15.235.65.10`.

1. **Backup.** En cPanel → *Editor de Zonas* → exportar el archivo de zona. Guardar copia fuera del
   servidor. (La tabla de §2 sirve como respaldo secundario.)
2. **Crear la zona en Cloudflare** (cuenta gratuita) → *Add a site* → `xpertic.co`. Cloudflare
   escanea e importa registros automáticamente, pero **no garantiza encontrarlos todos**.
3. **Auditar registro por registro contra la tabla de §2.** Agregar lo que falte, corregir lo que
   difiera y poner en **gris** todo menos `aquora`. Este paso es el que evita el desastre.
4. **Recién ahí, cambiar los nameservers en el registrador** a los dos que asigne Cloudflare.
   Mientras no se cambien, nada de lo hecho en Cloudflare tiene efecto: se puede preparar todo con
   calma y verificar.
5. Esperar la propagación (Cloudflare avisa por correo; suele ser < 1 h, el NS actual tiene
   TTL 86400 así que puede tardar más en resolvers con caché).
6. **Verificar el correo antes de cantar victoria**: enviar y recibir un correo de prueba, y abrir
   webmail y cPanel.

**Rollback:** volver a poner `ns15/ns16.latinoamericahosting.com` en el registrador. La zona en
cPanel queda intacta durante todo el proceso, así que el rollback es solo el cambio de NS (más su
propagación).

---

## 4. Named tunnel en la VM

Requiere SSH a la VM (`ssh ptap`, por VPN `PTAP-VPN`). `cloudflared` **ya está instalado**
(v2026.7.3, verificado el 2026-07-31) — no hay que correr `cf-install.sh`.

Son dos pasos. El primero es interactivo y va a mano:

```bash
cloudflared tunnel login   # imprime una URL: abrirla en el navegador y autorizar xpertic.co
```

> La VM es headless: el comando no abre navegador, **imprime la URL** para copiarla al navegador de
> tu equipo. Al autorizar, deja `~/.cloudflared/cert.pem`. Este paso **falla si la zona todavía no
> está en Cloudflare con los NS cambiados** (§3).

El resto lo hace un script idempotente, `~/deploy-scripts/cf-tunnel-setup.sh` (creado el
2026-07-31):

```bash
bash ~/deploy-scripts/cf-tunnel-setup.sh
```

Crea el túnel `aquora` (o reutiliza el existente), detecta su UUID, instala credenciales y
`config.yml` en `/etc/cloudflared/`, valida el ingress, publica el DNS y deja el servicio systemd
habilitado. El `config.yml` que genera:

```yaml
tunnel: <UUID-del-tunel>
credentials-file: /etc/cloudflared/<UUID-del-tunel>.json

metrics: 127.0.0.1:20241
no-autoupdate: true

ingress:
  - hostname: aquora.xpertic.co
    service: http://localhost:80
    originRequest:
      connectTimeout: 30s
      noTLSVerify: false
  - service: http_status:404
```

> ⚠️ Las credenciales van en **`/etc/cloudflared/`**, no en `/root/.cloudflared/` como decía la
> versión anterior de este doc. El `tunnel login` se hace como `xpertic_app`, así que el JSON nace en
> `/home/xpertic_app/.cloudflared/`; el servicio systemd corre como root y no lo leería desde ahí.
> El script las copia con `0600 root:root`.

El `route dns` **reemplaza** el registro A de `aquora` por un CNAME a `<UUID>.cfargotunnel.com`
(proxeado). El WebSocket de Socket.IO pasa nativo por el túnel, no requiere configuración extra.

El script **no mata** el quick tunnel efímero: lo deja corriendo como red de seguridad hasta que
valides el dominio nuevo.

### Cerrar lo que queda expuesto

Una vez validado el túnel:

- Quitar el DNAT `191.102.61.123:5554 → 192.168.30.50:80` del router.
- Dejar el ufw como está (solo rangos privados). Ya no hace falta abrir nada.
- Matar el quick tunnel efímero (`~/deploy-scripts/cf-run.sh`) y su URL `*.trycloudflare.com`.

---

## 5. Cambios en la aplicación

Con la URL estable, en el `.env` de producción de la VM (y su copia local `.env.production.local`):

```ini
APP_PUBLIC_URL=https://aquora.xpertic.co
CORS_ORIGINS=https://aquora.xpertic.co
```

> El origen **no lleva puerto** con el túnel. El gateway de Socket.IO valida el `Origin`, así que
> este valor tiene que coincidir exacto o el tablero se queda sin datos en vivo.

Después:

```bash
pm2 restart ptap-api

# Web (SPA Expo) — se compila con API_BASE_URL vacío, mismo origen, no hace falta rehornear la URL
cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear
sudo bash ~/deploy-scripts/web-setup.sh
```

**APK Android:** sí hay que recompilarla, porque la URL va horneada en el build
(`API_BASE_URL=https://aquora.xpertic.co`). Ver [`ANDROID_APK.md`](./ANDROID_APK.md) §"Build en la
VM". Esta es la **última** recompilación por cambio de URL: al ser un dominio propio, ya no cambia.

## 7. Camino B — Let's Encrypt en la VM

Sin Cloudflare y sin cuenta de terceros. Elegido el 2026-07-31 al quedar bloqueado el cambio de
nameservers en GoDaddy.

**Certificado y acceso son dos problemas separados.** El túnel resolvía los dos a la vez; acá hay
que resolverlos por separado, y el segundo depende de redes.

### 7.1 El certificado — ✅ EMITIDO el 2026-07-31

```bash
bash ~/deploy-scripts/le-cert-user.sh      # sin sudo
```

| | |
|---|---|
| Subject | `CN = aquora.xpertic.co` |
| Emisor | Let's Encrypt (`YE2`) — cadena completa, 4 certificados |
| Vigencia | 2026-07-31 → **2026-10-29** |
| Ubicación | `~/letsencrypt/config/live/aquora.xpertic.co/` |

Se validó por **DNS-01**: Let's Encrypt comprueba la propiedad leyendo un TXT
`_acme-challenge.aquora` en la zona del cPanel, **sin conectarse al servidor**. Por eso se pudo
emitir con todos los puertos cerrados.

> **Por qué corre sin `sudo`.** En esta VM `sudo` pide contraseña, así que `certbot` no puede
> escribir en `/etc/letsencrypt`. Redirigiendo `--config-dir`, `--work-dir` y `--logs-dir` al home
> del usuario, corre sin privilegios y el certificado es idéntico. `le-nginx.sh` (ese sí con sudo)
> lo copia después a `/etc/ssl/ptap/`.

El script deja el token en `/tmp/acme-token.txt` y hace *polling* contra `ns15` cada 15 s durante
30 min, así que continúa solo en cuanto el registro aparece — sin eso, `certbot --manual` se queda
esperando un Enter y no se puede desatender. Terminada la validación, el TXT se puede borrar.

### 7.2 nginx — `le-nginx.sh`

```bash
sudo bash ~/deploy-scripts/le-nginx.sh
```

Deja tres `server` blocks y **no toca el acceso que ya funciona**:

| Bloque | Para qué |
|---|---|
| `:80 default_server` | LAN, VPN y quick tunnel — **idéntico a hoy**, sin redirección a HTTPS (por IP no hay certificado válido) |
| `:80 aquora.xpertic.co` | Redirige a HTTPS, salvo `/.well-known/acme-challenge/` |
| `:443 aquora.xpertic.co` | TLS 1.2/1.3, HTTP/2, OCSP stapling, HSTS de 1 año sin preload |

Los `location` se movieron a `/etc/nginx/snippets/ptap-app.conf`, incluido desde los bloques `:80
default` y `:443`, para no mantener dos copias que se desincronizan. El script respalda el sitio
anterior con fecha y valida con `nginx -t` antes de recargar.

### 7.3 Lo que falta y depende de redes

```
191.102.61.123:443 -> 192.168.30.50:443     (imprescindible)
191.102.61.123:80  -> 192.168.30.50:80      (opcional, pero hace automática la renovación)
```

Y abrir el 443 en el ufw, que hoy solo admite rangos privados
(`~/deploy-scripts/ufw-restrict80.sh`).

> **Si el 443 público está ocupado**, alcanza con reapuntar el DNAT que ya existe: `:5554 → :443` en
> vez de `:5554 → :80`. El certificado acredita el *nombre*, no el puerto, así que
> `https://aquora.xpertic.co:5554` da candado válido sin trámite nuevo.

### 7.4 Renovación — ⚠️ NO es automática

> 🔴 **Al emitir, certbot informa que "ha programado una tarea para renovar automáticamente". Para
> este certificado es falso.** El `certbot.timer` de systemd corre como root sobre
> `/etc/letsencrypt`, y el nuestro vive en `~/letsencrypt/config` porque se emitió sin sudo. Ese
> timer no lo ve. **Si nadie hace nada, el certificado vence el 2026-10-29 sin previo aviso.**

```bash
bash ~/deploy-scripts/le-renew.sh          # sin sudo; solo actúa si faltan <30 días
sudo bash ~/deploy-scripts/le-nginx.sh     # reinstala el nuevo y recarga nginx
```

`le-renew.sh` reusa el mismo hook: imprime el TXT y espera. **El valor cambia en cada renovación**,
así que hay que crear uno nuevo en el cPanel.

Las tres formas de resolverlo, de mejor a peor:

1. **Que redes publique el puerto 80.** `certbot renew` pasa a validar por HTTP-01 contra
   `/.well-known/acme-challenge/` (ya contemplado en la config de nginx) y renueva solo, para
   siempre. Es la única que no depende de que alguien se acuerde.
2. **Automatizar el TXT** con la UAPI de cPanel de LatinoaméricaHosting mediante un token de API.
3. **Recordatorio en el calendario** para principios de octubre. Frágil, pero mejor que nada.

Conviene insistir con el puerto 80 aunque solo sirva para esto.

## 6. Verificación final

```bash
curl -sS https://aquora.xpertic.co/api/health        # 200
curl -sS https://aquora.xpertic.co/api/health/db     # 200 (MySQL)
curl -sS https://aquora.xpertic.co/api/health/opc    # 200 si el puente OPC está Connected
```

- [ ] El navegador muestra candado válido, sin advertencia de Chrome
- [ ] El tablero recibe datos en vivo (WebSocket conectado)
- [ ] `https://aquora.xpertic.co/descargar/` sirve el APK
- [ ] Correo corporativo enviando y recibiendo
- [ ] cPanel y webmail accesibles
