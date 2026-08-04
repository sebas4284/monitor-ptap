# Pendientes que requieren VPN + SSH a la VM

> Todo lo de esta lista se ejecuta **dentro de la VM `192.168.30.50`**, a la que solo se llega por la
> VPN `PTAP-VPN`. Mientras la VPN no conecte, nada de esto avanza.
>
> Última revisión: 2026-07-30.

---

## 0. ~~Bloqueo actual: la VPN no autentica~~ RESUELTO 2026-07-31

```
rasdial PTAP-VPN
→ Error de Acceso remoto 691 — usuario/contraseña no reconocidos
```

**Causa real** (diagnosticada el 2026-07-31): no era una credencial *vencida* — **no había ninguna
credencial guardada**. Verificado por dos vías:

- `rasphone.pbk` tenía la entrada `[PTAP-VPN]` **sin línea `UserName=`**.
- `cmdkey /list` no devolvía ninguna entrada para `PTAP-VPN` ni para `191.102.61.122`.

Es decir, `RememberCredential: True` solo declara la *intención* de recordar; nunca se había guardado
nada. `rasdial` autenticaba con usuario vacío, y de ahí el 691 sistemático. La versión anterior de
este doc atribuía el fallo a una credencial vencida — era incorrecto.

**Desbloqueo aplicado:** `rasphone -d PTAP-VPN` abre el diálogo nativo; se escribe usuario `PTAP_APP`
+ contraseña, **dominio vacío**, y se marca *Guardar este nombre de usuario y contraseña*. A partir
de ahí `rasdial PTAP-VPN` reconecta solo. Acceso posterior por `ssh ptap` (llave `~/.ssh/id_ed25519`).

> Si el 691 reaparece, revisar primero si la credencial sigue guardada (`cmdkey /list`) antes de
> sospechar del servidor. Si en cambio aparece un **789**, eso sí es IPsec: el perfil tiene
> `L2tpIPsecAuth = Certificate` y haría falta el PSK.

### Estado de la VM verificado el 2026-07-31 (con la VPN ya arriba)

| Componente | Estado |
|---|---|
| `pm2 ptap-api` | `online`, 4 h de uptime, 149 MB, 7 reinicios acumulados |
| `nginx` | `active` |
| `/api/health`, `/api/health/db`, `/api/health/opc` | **200** los tres |
| `/descargar/` | **200** |
| `cloudflared` | instalado, **2026.7.3** |
| Servicio `cloudflared` (systemd) | `inactive` — todavía no existe |
| `~/.cloudflared/` | **no existe** → sin `cert.pem`, sin túneles nombrados |
| Quick tunnel efímero | **corriendo**, PID 30985 (`--url http://localhost:80`) |

O sea: la VM está lista para el `tunnel login` en cuanto la zona esté en Cloudflare. No falta
instalar nada.

---

## 1. El ajuste de escritura (OPC UA) — el más delicado

Hoy el backend **no puede escribirle al PLC**: solo lee. Abrir o cerrar una válvula desde la web es
rechazado con `WRITES_DISABLED_INSECURE_SESSION`.

### Estado actual

Según la copia local `.env.production.local` (⚠️ **confirmar contra el `.env` real de la VM**, puede
haber divergido):

| Variable | Valor efectivo | Origen |
|---|---|---|
| `OPCUA_WRITES_ENABLED` | `false` | ausente → default |
| `OPCUA_ALLOW_INSECURE_WRITES` | `false` | ausente → default |
| `OPC_SECURITY_MODE` | `None` | explícito |
| `OPC_SECURITY_POLICY` | `None` | explícito |
| `OPC_IDENTITY` | `anonymous` | explícito |
| `OPC_ENDPOINT` | `opc.tcp://10.10.51.225:59100` | PLC real |

### Por qué no basta con poner una variable en `true`

La precondición es doble y es dura
([`write.service.ts:73`](../apps/api/src/modules/commands/write.service.ts#L73)):

```ts
if (!this.config.opcua.writesEnabled || !security.secure) → reject(WRITES_DISABLED_INSECURE_SESSION)
```

Y `security.secure`
([`opcua-connectivity.adapter.ts:605-608`](../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts#L605-L608))
solo es `true` si:

```
(securityMode === 'SignAndEncrypt' && identity !== 'anonymous')  ||  allowInsecureWrites
```

**Ahí está el nudo:** el servidor OPC UA del PLC hoy *solo acepta* `Anonymous` + `None` (hallazgo P0
documentado). Con esa configuración la primera condición es imposible de cumplir. Quedan dos caminos
y hay que elegir explícitamente.

### Camino A — el correcto (requiere intervención sobre el PLC)

Que el integrador habilite en el servidor OPC UA un endpoint `SignAndEncrypt` con identidad de
usuario o certificado. Después, en el `.env` de la VM:

```ini
OPC_SECURITY_MODE=SignAndEncrypt
OPC_SECURITY_POLICY=Basic256Sha256
OPC_IDENTITY=username
OPC_USERNAME=<usuario del PLC>
OPC_PASSWORD=<contraseña del PLC>
OPCUA_WRITES_ENABLED=true
# OPCUA_ALLOW_INSECURE_WRITES queda ausente/false PARA SIEMPRE
```

Es el único camino que deja las escrituras habilitadas de forma permanente sin deuda de seguridad.
Depende de terceros, así que conviene pedirlo ya.

### Camino B — excepción temporal y auditada

```ini
OPCUA_WRITES_ENABLED=true
OPCUA_ALLOW_INSECURE_WRITES=true
```

Es exactamente lo que se usó en la prueba de campo de la **válvula de Sirena del 2026-07-29**. El
código lo marca como *excepción deliberada y temporal a la regla 9*, con la instrucción explícita de
volver a `false` al terminar
([`connectivity.config.ts:46-53`](../apps/api/src/infrastructure/connectivity/connectivity.config.ts#L46-L53)).

**Lo que se está aceptando al activarlo:** la sesión OPC UA va sin cifrar y sin autenticar. Cualquiera
que alcance el PLC por red puede escribirle. La protección real pasa a ser perimetral (la red) más el
RBAC y el interlock de la aplicación, no el protocolo.

Solo con ventana de tiempo acotada, alguien mirando la planta, y reversión al cerrar.

### ✅ Verificación de seguridad — hecha el 2026-08-03

Se confirmó que la prueba del 29-30 de julio **no dejó los flags encendidos en producción** (se hizo
en el árbol aislado `~/ptap-fieldtest`, con su propio `.env`). Estado hallado:

| Flag | Estado |
|---|---|
| `OPCUA_WRITES_ENABLED` | ausente → `false` |
| `OPCUA_ALLOW_INSECURE_WRITES` | ausente → `false` |
| `COMMAND_REQUIRE_LIVE` | no forzado → el interlock sigue exigiendo dato vivo |

**Riesgo latente encontrado y neutralizado:** el árbol `~/ptap-fieldtest` seguía existiendo con
`OPCUA_ALLOW_INSECURE_WRITES=true` en su `.env`. Sin proceso corriendo (4001 libre), pero cualquiera
que lo arrancara habría tenido escritura insegura al PLC. Los flags se comentaron con respaldo. Queda
pendiente decidir si borrar el árbol entero (1.8 GB, ramas `fieldtest`…`fieldtest5`).

**Superficie de red verificada:** MySQL (3306) solo en loopback; la API escucha en `0.0.0.0:4000`
pero el ufw la bloquea (comprobado: `HTTP 000` desde otra máquina de la VPN); solo el 80 responde, y
solo a rangos privados. *Recomendación menor:* que la API escuche en `127.0.0.1:4000`, para que nginx
sea el único camino y no se dependa únicamente del firewall.

### 🔓 Escritura HABILITADA — autorizada el 2026-08-03

Operación autorizó activar el canal de escritura. Se aplica con
[`opcua-writes-toggle.sh`](../apps/api/scripts/opcua-writes-toggle.sh) (idempotente, con respaldo y
reversión en un comando):

```bash
bash ~/deploy-scripts/opcua-writes-toggle.sh              # habilita
bash ~/deploy-scripts/opcua-writes-toggle.sh --revertir   # cierra el canal
```

**Lo que se acepta:** `OPCUA_ALLOW_INSECURE_WRITES=true` hace que la sesión al PLC se dé por válida
aunque vaya **sin cifrar y sin autenticar** — obligado, porque el equipo solo admite Anonymous+None
(hallazgo P0). La protección real pasa a ser la red, más el RBAC, el interlock y la doble
confirmación de la app.

> Con el canal abierto, **el alcance real hoy sigue siendo acotado**: no existe el verbo `close` en
> ninguna planta (`UNKNOWN_COMMAND`), así que solo se puede enviar `open`; y falta el actuador
> físico, así que el pulso no mueve ninguna válvula. El read-back reportará
> `READBACK_UNCONFIRMED` — que es lo correcto, no un fallo del canal.

### Lo que ya está resuelto y no hay que tocar

El camino de escritura completo ya existe y fue probado en campo: `writeBufferElement` con
**read-back de confirmación**, RBAC, interlock autorizable (commit `47bef47`) y auditoría. No falta
código — falta la decisión de configuración.

---

## 2. Dominio `aquora.xpertic.co` con TLS — camino B (Let's Encrypt)

Detalle completo en [`DOMINIO_AQUORA_CLOUDFLARE.md §7`](./DOMINIO_AQUORA_CLOUDFLARE.md). El camino de
Cloudflare Tunnel quedó **bloqueado**: el dominio tiene `update prohibited` en GoDaddy y no se pueden
cambiar los nameservers sin el titular de esa cuenta.

Hecho el 2026-07-31:

- [x] Certificado emitido para `aquora.xpertic.co` (Let's Encrypt, vence **2026-10-29**)
- [x] `le-cert-user.sh`, `le-nginx.sh` y `le-renew.sh` desplegados en `~/deploy-scripts/`

Falta:

- [ ] `sudo bash ~/deploy-scripts/le-nginx.sh` — instala el cert en `/etc/ssl/ptap/` y prende HTTPS.
      **Requiere contraseña de sudo**, por eso no quedó hecho.
- [ ] Borrar el TXT `_acme-challenge.aquora` del cPanel (ya cumplió su función)
- [ ] Pedir a redes: `191.102.61.123:443 → 192.168.30.50:443`. Sin esto el certificado está bien
      pero nadie llega desde afuera.
- [ ] Pedir también el **80** → hace la renovación automática (ver el aviso de abajo)
- [ ] Abrir el 443 en ufw (hoy solo admite rangos privados, `ufw-restrict80.sh`)

> 🔴 **La renovación NO es automática.** Al emitir, certbot informa que programó una tarea para
> renovar solo. Es falso para este certificado: el `certbot.timer` corre como root sobre
> `/etc/letsencrypt`, y el nuestro está en `~/letsencrypt/config` porque se emitió sin sudo. Si nadie
> hace nada, **vence el 2026-10-29 en silencio**. Se arregla de raíz publicando el puerto 80.

> El quick tunnel efímero (PID 30985) **sigue corriendo a propósito**, como red de seguridad. Matarlo
> recién cuando el dominio esté validado desde Internet.

---

## 3. `.env` de producción y reinicio

**Verificado funcionalmente el 2026-07-31** (probando el CORS contra la API en vivo, sin leer el
archivo):

| Origin probado | Resultado |
|---|---|
| `https://aquora.xpertic.co` | 🔴 **RECHAZADO** — sin cabecera `Access-Control-Allow-Origin` |
| `http://192.168.30.50` | ✅ Permitido |

O sea: aunque nginx ya sirva HTTPS, **el tablero se quedaría sin datos en vivo** hasta corregir esto.
El gateway de Socket.IO valida el `Origin` y tiene que coincidir exacto.

```ini
# destino
APP_PUBLIC_URL=https://aquora.xpertic.co
CORS_ORIGINS=https://aquora.xpertic.co,http://192.168.30.50,http://localhost:8081
```

- [x] **Hecho el 2026-07-31:** `~/deploy-scripts/env-dominio.sh` agregó `https://aquora.xpertic.co`
      a `CORS_ORIGINS` conservando los 3 orígenes previos. Los 4 verificados como PERMITIDO, y un
      origen inventado sigue dando RECHAZADO (el CORS no quedó abierto).
- [ ] `APP_PUBLIC_URL` sigue apuntando al túnel efímero. Moverlo con
      `bash ~/deploy-scripts/env-dominio.sh --publicar` **recién cuando el dominio responda desde
      Internet** — de ahí salen los enlaces absolutos.
- [ ] Replicar el cambio en la copia local durable `.env.production.local` (gitignored)

> Conservar `http://192.168.30.50` para no perder el acceso por LAN/VPN si el dominio falla.

> 🔴 **`pm2 restart --update-env` tumba la API. No usarlo.** Con esa bandera pm2 reemplaza el
> entorno del proceso por el del shell que invoca el comando; desde una sesión SSH no interactiva ese
> entorno es mínimo y la API **arranca pero nunca llega a escuchar en el 4000** — nginx devuelve 502
> y, para peor, `pm2 list` la sigue reportando `online`. Costó ~3 min de caída el 2026-07-31 hasta
> que un `pm2 restart ptap-api` a secas la levantó en 5 s. El script ya está corregido.

> Conservar `http://192.168.30.50` en `CORS_ORIGINS` para no perder el acceso por LAN/VPN si el túnel
> se cae. El gateway de Socket.IO valida `Origin`: si el valor no coincide exacto, el tablero se
> queda sin datos en vivo aunque el HTTP funcione.

---

## 4. Recompilar web y APK

- [ ] **Web:** `cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear`
      seguido de `sudo bash ~/deploy-scripts/web-setup.sh`.
      Se compila con `API_BASE_URL` **vacío** (mismo origen) — no hay URL horneada, así que en
      rigor solo hace falta si cambia el código, no por el dominio.
- [ ] **APK:** sí hay que recompilarla, la URL va horneada
      (`API_BASE_URL=https://aquora.xpertic.co`). Procedimiento en
      [`ANDROID_APK.md`](./ANDROID_APK.md) §"Build en la VM": instalar el toolchain desechable,
      compilar, publicar en `/var/www/ptap-download/`, y **borrar el toolchain** al terminar para
      dejar la VM liviana. Con dominio propio esta debería ser la **última** recompilación por
      cambio de URL.

---

## 5. Deuda menor pendiente

- [ ] `git push origin yosh:dev` — la VM sigue la rama `dev`; hoy va por detrás. Requiere la cuenta
      **LorJosh** con token *classic* con scope `repo` (los fine-grained no sirven en repos de otra
      cuenta personal).
- [ ] Vigilar el `deadLetterCount` del puente OPC (`/opc/status`, requiere RBAC `system_config`).
- [ ] Actualizar los docs que todavía dicen `ptaps.telcobras.com` → `aquora.xpertic.co`:
      `CHECKLIST_PRODUCCION.md`, `DEPLOY_VPS.md`, `REQUISITOS_SERVIDOR.md`, `RUNBOOK_PRODUCCION.md`,
      `ANDROID_APK.md`.
- [ ] Una vez validado el túnel: pedir a redes que **quite el DNAT** `191.102.61.123:5554 → :80`.

---

## Orden de ejecución sugerido

1. Destrabar la VPN (§0) — bloquea todo lo demás.
2. Verificar el estado real de los flags de escritura (§1) — es una revisión de seguridad, no un
   cambio; conviene hacerla apenas haya SSH.
3. Migración de la zona a Cloudflare (fuera de la VM) y luego el túnel (§2).
4. `.env` + `pm2 restart` (§3) y verificar que el tablero recibe datos en vivo.
5. APK (§4), que es lo más largo y conviene hacerlo cuando la URL ya no vaya a cambiar.
6. Decidir el camino del ajuste de escritura (§1) — A o B. Si es B, con ventana acotada.
7. Deuda menor (§5).
