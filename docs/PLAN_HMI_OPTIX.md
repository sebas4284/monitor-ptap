# Plan — Proyectar el HMI de FactoryTalk Optix en la plataforma web

**Objetivo:** mostrar en nuestra plataforma la pantalla real del HMI Optix por planta, reutilizando la
app actual (auth, RBAC, selector de planta, túnel). Dos caminos, **A recomendado**, **B de respaldo**;
ambos aterrizados en nuestra infra real (VM `192.168.30.50`, nginx→Node `127.0.0.1:4000`, túnel
Cloudflare, front Expo web+APK).

> **Regla de oro de auth para el iframe:** nuestra sesión usa **JWT en header `Authorization`** (fetch
> del SPA). Un `<iframe>` es una **navegación del navegador** que NO manda ese header (solo cookies).
> Por eso el gate de JWT protege *la pantalla* que contiene el HMI; el contenido embebido se autentica
> por su propio mecanismo (login de Optix, o Basic-Auth inyectado por el proxy en el servidor). En el
> Camino B (noVNC) sí podemos validar nuestro JWT, porque la conexión la abre el JS del SPA por WebSocket.

---

## ⚡ Resultados PoC Nivel 1 (2026-07-29) — PIVOTE IMPORTANTE

Sondeo pasivo desde la VM al host del HMI (`10.10.51.225` interno / `181.204.165.66` público). **Dato
que cambia el plan:** el HMI web que responde **NO es FactoryTalk Optix (Rockwell) — es Siemens
`WinCC Unified`** (`<title>WinCC Unified</title>` en `https://10.10.51.225/`, SPA HTML5 con `starter.js`).
El nombre "Optix" en la documentación previa era **incorrecto para la capa de visualización**.
**Confirmado por el equipo (2026-07-29):** el **PLC es Allen-Bradley (Rockwell)** y encima corre una
capa **SCADA/HMI Siemens WinCC Unified** que lo lee y expone el OPC UA en 59100 (montaje brownfield
mixto: PLC Rockwell + HMI Siemens). La pantalla web a embeber es la de **WinCC Unified**.

**Lo bueno:** WinCC Unified es **web-nativo (cliente HTML5)** y **ya está sirviendo en 443** → el
**Camino A es viable en principio** (no hace falta capturar vídeo). 

### Matriz de capacidades (3 bloques) — parcialmente resuelta con datos reales

**A. Controlado por nosotros** — CSP SPA ⚙️configurable · X-Frame-Options ⚙️configurable · reverse proxy
⚙️configurable · JWT/RBAC/Auditoría ✅ ya implementados.

**B. Dependiente del HMI (WinCC Unified, no Optix):**
| Elemento | Estado (Nivel 1) |
|---|---|
| Cliente Web / HTML5 | ✅ **SÍ** (WinCC Unified responde 200 en `:443`) |
| HTTPS | ✅ pero **cert self-signed VENCIDO** (`CN=iot_rural`, expiró May-2025) → proxear con NUESTRO TLS válido |
| `X-Frame-Options` en la raíz | ✅ **ausente** → indicio de que **podría** embeberse (confirmar en páginas de app, Nivel 2) |
| Login / cookies / UMC / anti-CSRF | ❓ **Nivel 2** (requiere credenciales) |
| Licencia de clientes web | ❓ (WinCC Unified licencia las sesiones web) |

**C. Dependiente del hardware (`10.10.51.225`, Windows):**
| Puerto | Estado | Nota |
|---|---|---|
| 443 (web WinCC Unified) | ✅ ABIERTO | cliente HTML5 |
| 3389 (RDP) | ✅ **ABIERTO** | host Windows → habilita **Camino C (RDP vía Guacamole)** |
| 5900/5901 (VNC) | ❌ cerrado | Camino B (noVNC) NO disponible salvo habilitar VNC |
| 59100 (OPC UA) | ✅ ABIERTO | lo que ya consumimos |
| público `181.204.165.66` | solo 59100 | ✅ buena postura (lo demás cerrado a Internet) |

### Recomendación revisada (con evidencia)
- **Camino A → embeber el cliente web de WinCC Unified** (existe y responde). **Viable**; pendiente
  **Nivel 2** (embebibilidad real de las páginas de app + login tras proxy) — **necesita credenciales**.
- **Camino B (VNC/noVNC): descartado hoy** (5900 cerrado).
- **Camino C (NUEVO): RDP → HTML5 con Apache Guacamole** (3389 abierto) como respaldo si A no se deja
  embeber/autenticar tras el proxy.
- **Seam del código:** `WinCCUnifiedProvider` (no `OptixProvider`). YAGNI: una sola implementación.

### Qué falta para cerrar la decisión (Nivel 2/3)
1. **Confirmar proveedor** con el equipo: ¿es WinCC Unified en todas las plantas, o hay Optix/Rockwell en otras?
2. **Credenciales** del cliente web de WinCC Unified (login) → Nivel 2: ¿se embebe en iframe?, ¿el login
   sobrevive al reverse-proxy same-origin?, ¿usa cookies/UMC/anti-CSRF que rompan el proxy?
3. **Nivel 3:** tiempo de carga, CPU/RAM (colector), ancho de banda del cliente web.

---

---

## ✅ IMPLEMENTADO (2026-08-03) — Camino A, pendiente de credenciales

### Descubrimiento actualizado desde la VM

| Host | 443 | 3389 | Veredicto |
|---|---|---|---|
| `10.10.51.225` | ✅ ABIERTO | ✅ ABIERTO | **El único HMI web alcanzable** |
| `10.10.51.26` (HMI Sirena) | ❌ | ❌ | No responde desde la VM |
| `10.10.51.27` (PLC Sirena) | ❌ | ❌ | No responde desde la VM |

> 🔑 **No hay un HMI por planta**: es un **runtime central único**. El mapping `planta → URL` que
> planteaba este documento **no aplica** — todas las plantas proyectan el mismo runtime, y la
> navegación entre pantallas la hace el operador dentro de WinCC. El `plantId` igual viaja como
> parámetro en la URL del iframe, listo para el día que se confirme si WinCC admite enlace directo
> por pantalla.

Cabeceras reales de `https://10.10.51.225/` (2026-08-03):

```
HTTP/2 200 · server: none · <title>WinCC Unified</title>
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff · x-xss-protection: 1; mode=block
X-Frame-Options: AUSENTE          ← se deja embeber ✅
Content-Security-Policy: AUSENTE  ← sin frame-ancestors que lo impida ✅
certificado: CN=iot_rural, self-signed, VENCIDO el 2025-05-16
```

### Lo que quedó construido

| Pieza | Estado |
|---|---|
| `apps/mobile/app/(app)/hmi.tsx` | ✅ Pantalla con iframe, recarga, pantalla completa y guard `view_dashboard` |
| Pestaña **HMI** en `(app)/_layout.tsx` | ✅ Oculta para roles sin `view_dashboard` |
| `~/deploy-scripts/hmi-proxy.sh` | ✅ Configura `location /hmi/` en nginx (**requiere sudo**) |
| Fallback en APK | ✅ Aviso explícito: no hay `react-native-webview`, no se finge una pantalla vacía |

El proxy resuelve tres problemas de una vez: el **certificado vencido** (el TLS que ve el usuario es
el nuestro), la **red OT no enrutable** (el navegador nunca la toca) y el **mismo origen** (sin CORS,
sin contenido mixto, y basta `frame-src 'self'`).

`hmi-proxy.sh` también baja `X-Frame-Options` de `DENY` a `SAMEORIGIN` en la SPA — sin eso el
navegador bloquea incluso nuestro propio iframe. Se conserva la protección contra sitios ajenos.

### ⚠️ Decisión de seguridad tomada: NO se inyectan credenciales

El documento proponía inyectarlas en el proxy para que el operador no las viera. **Se descartó.**

`/hmi/` **no puede exigir nuestro JWT**: un iframe es una navegación del navegador y no envía la
cabecera `Authorization`. Con las credenciales inyectadas, la URL sería un **pase libre al HMI de una
planta de agua potable** para cualquiera que la adivine, sin sesión en nuestra plataforma. Hoy el
operador ve el login de WinCC, que es lo correcto mientras no exista un gate propio.

**Siguiente paso si se quiere acceso transparente:** `auth_request` en nginx contra un endpoint del
backend que valide una cookie de sesión corta emitida al abrir la pantalla. Recién con ese gate tiene
sentido inyectar credenciales.

### ¿Ese HMI contiene las demás plantas?

**Todo apunta a que sí, pero es inferencia, no verificación.** Lo que sí está comprobado:

`https://10.10.51.225/config.json` declara **un único runtime**, no uno por planta:

```jsonc
{ "elements": [
    { "href": "/WebRH", "main": "WinCC Unified RT", "visible": true  },
    { "href": "/UMC",   "main": "User management",  "visible": true  },
    { "href": "/WebES", "main": "WinCC Unified Configuration", "visible": false }
  ],
  "dnsname": "IOT_RURAL" }
```

Y **ese mismo host expone por OPC UA los buffers de las 12 plantas** (capturado el 2026-08-03 en
`test/fixtures/plc-frames-2026-08-03.json`): `INT_IN_VORAGINE`, `REAL_IN_CAMPOALEGRE`,
`DATOS_IN_PTAP_SOLEDAD`, `REAL_TK_QUIJOTE`… las 12, cada una con sus buffers propios.

O sea: **un solo servidor consolida los datos de las 12 plantas y corre un solo proyecto WinCC.**
Sería muy extraño que consolide la telemetría de todas y no tenga pantallas para ellas.

**Lo que no se puede afirmar sin entrar:** cuántas pantallas hay, cómo se llaman y si están todas.
El runtime es una SPA Angular/SWAC (`v401.0.3613.1`) que resuelve las pantallas **después** del
login; el HTML inicial no las lista. Requiere credenciales.

**Implicación de diseño:** si es un proyecto único con pantallas de todas las plantas, el
**enlace directo por pantalla** deja de ser un lujo y pasa a ser lo que hace útil la pestaña — sin
él, el operador tiene que navegar a mano hasta su planta cada vez, aunque la plataforma ya sepa cuál
tiene seleccionada.

Cabeceras del runtime (`/WebRH`), que son las que deciden el iframe:

```
HTTP/2 200 · <title>WinCC Unified RT</title> · set-cookie: iisnode.session.cookie=1
content-security-policy: script-src 'self' 'unsafe-eval'; media-src https:; block-all-mixed-content;
                         ↑ SIN frame-ancestors → no bloquea el iframe ✅
X-Frame-Options: AUSENTE ✅
```

### Lo que falta (necesita credenciales del HMI)

1. **Login de WinCC Unified** → confirmar que las páginas *tras* el login siguen sin
   `X-Frame-Options` (la raíz no lo trae; las de aplicación pueden diferir).
2. **Enlace directo por pantalla** → si WinCC admite `?screen=` o similar, cada planta abre la suya.
3. **Licencia de clientes web** → WinCC licencia las sesiones web concurrentes; conviene saber el tope.
4. **Modo solo lectura** → si el runtime permite publicar una sesión sin control, es lo deseable.

---

## FASE 0 — Descubrimiento (obligatoria, sin código, decide A vs B)

Antes de construir nada, confirmar qué expone el Optix. **Lo puedo correr yo** desde la VM (lectura pura,
como abrir un navegador contra el host):

- **Sondeo de puertos** contra el host Optix (mismo del OPC UA, `181.204.165.66` / interno `10.10.51.225`):
  `443, 8443, 80, 8080` (cliente web), `5900/5901` (VNC), `3389` (RDP), `59100` (OPC UA, ya sabido).
  Con `bash -c "</dev/tcp/host/puerto"` + `curl -skI https://host:puerto/`.
- **Inventario:** ¿HMI físico por planta (OptixPanel) o un único Runtime central? **Modelo exacto**
  del panel (`OptixPanel Standard/Compact`, serie `2715P-…` / `6300P-…`, o Runtime en PC) → define qué
  soporta de fábrica.
- **Credenciales:** confirmar qué credenciales tenemos exactamente (login del **cliente web de Optix** /
  usuario de **VNC** / Windows) — hoy el OPC UA es anónimo.

**Salida de Fase 0 → decisión:**
- Responde web (443/8443 con cliente Optix) → **Camino A**.
- No hay web pero sí VNC (5900) → **Camino B**.
- Ninguno → quedaría captura de vídeo (descartada salvo imposibilidad; fuera de este plan).

---

## CAMINO A (recomendado) — Embeber el Runtime web de Optix vía reverse-proxy

### Qué se define / crea
1. **Config nueva** (no existe hoy; solo hay el endpoint OPC UA): `OPTIX_WEB_BASE_URL` + un **mapping
   planta→URL** por slug. Vive en `.env` (VM) y en un `optix-web.config.ts`. Los 12 slugs ya existen:
   `voragine, soledad, montebello, cascajal, km18, alto-los-mangos, campoalegre, pichinde, carbonero,
   sirena, san-antonio, quijote`.
2. **`location /hmi/` en nginx** (VM, `/etc/nginx/sites-available/ptap`) → `proxy_pass` al Runtime Optix
   (interno `10.10.51.225:<puerto-web>`), con `proxy_http_version 1.1` + headers de Upgrade (por si el
   cliente Optix usa WebSocket). **Servir bajo el MISMO origen** (`/hmi/`) evita CORS/mixed-content y la
   restricción `frame-src` (queda bajo `'self'`).
   - **Ajuste de cabeceras (bloqueador real):** hoy la config pone `X-Frame-Options: DENY` y CSP
     `frame-ancestors 'none'` (RUNBOOK_PRODUCCION.md §11.5) → **prohíben todo iframe**. Hay que: (a) en el
     `location /` de la SPA, cambiar a `X-Frame-Options: SAMEORIGIN` y CSP `frame-src 'self'`; (b) en
     `location /hmi/`, NO reenviar `X-Frame-Options: DENY` del upstream (y repetir las demás cabeceras de
     seguridad, porque nginx no las hereda si el location define `add_header`).
   - **helmet** (backend, `main.ts:20`, default) pone `X-Frame-Options: SAMEORIGIN` + CSP
     `default-src 'self'`; el `/hmi/` no pasa por Node (va directo al Optix), así que helmet no lo toca,
     pero la **página contenedora** (SPA, servida estáticamente) sí necesita el CSP relajado a `frame-src 'self'`.
3. **(Opcional) `HmiController('hmi')` en el backend** — solo si queremos un "ticket" de acceso o auditar
   la apertura. Patrón exacto de `plants.controller.ts`: `@UseGuards(JwtAuthGuard, PermissionGuard,
   PlantScopeGuard)` + `@Get(':plantId/ticket') @RequirePermission('view_dashboard')`, `:plantId`
   validado con `plantIdParamSchema`. Devuelve la URL del HMI (o un ticket firmado corto). El scope por
   planta sale gratis por el nombre del param.
4. **Front — vista "Pantalla HMI"**: `apps/mobile/app/(app)/hmi.tsx` + `Tabs.Screen name="hmi"` en
   `(app)/_layout.tsx`, con guard `hasPermission('view_dashboard')` (patrón de `tablero.tsx:63`).
   - **Web:** `Platform.OS === 'web'` → renderiza `React.createElement('iframe', { src: '/hmi/'+plantId })`.
   - **Mosaico** configurable (varios HMI a la vez) + pantalla completa (Fullscreen API) — solo web.
   - **APK Android:** NO hay `react-native-webview` (ausente en `apps/mobile/package.json`) → o se añade
     esa dependencia + recompila APK, o el APK muestra un fallback ("disponible en la versión web").
     Decisión de alcance (ver "Qué necesito de ti").

### Credenciales necesarias (Camino A)
- **Login del cliente web de Optix** (el que dices que tenemos). Dos modos:
  - *Simple:* el usuario ve el login de Optix DENTRO del iframe y entra a mano.
  - *Transparente (recomendado):* el `location /hmi/` de nginx **inyecta** las credenciales
    (`proxy_set_header Authorization "Basic …"` o el mecanismo que Optix acepte) para que el operador no
    las vea ni las conozca. Las credenciales viven **solo en la VM** (`.env`/config de nginx), nunca en el
    front ni en git.
- **Nuestro JWT** (ya lo tenemos) → gatea la *pantalla* (solo operador/jefe/admin ven la pestaña).
- **Red:** la VM debe alcanzar el puerto web del Runtime (mismo caveat de red que el PLC).

### Por dónde pasa la información (Camino A)
```
Navegador (SPA, JWT ya validado para ver la pestaña)
   │  GET /hmi/<planta>/  (navegación del iframe, MISMO origen)
   ▼
Cloudflare (HTTPS) → nginx :80 (VM)
   │  location /hmi/  → proxy_pass (+ inyecta credenciales Optix)
   ▼
FactoryTalk Optix Runtime web  (10.10.51.225:<puerto>)  ← red OT
   │  HTML5 del HMI
   ▼  (vuelve por el mismo camino, se pinta en el <iframe>)
```
### Dónde se muestra
Pestaña **"Pantalla HMI"** en `(app)`: iframe del HMI por planta (con el selector de planta actual), en
mosaico y con botón de pantalla completa. Junto a los tableros de datos existentes.

---

## CAMINO B (respaldo) — noVNC (VNC → WebSocket), sin WebRTC

Solo si Fase 0 dice que NO hay cliente web pero SÍ VNC. Elijo **noVNC sobre WebSocket** (no WebRTC)
porque encaja con la VM de 2 GB y el túnel efímero (WebRTC necesitaría media server + TURN + IP estable).

### Qué se define / crea
1. **`websockify`** (proxy VNC↔WebSocket) por panel — corre en la VM (o en el propio panel si lo permite),
   traduce el TCP de VNC a WebSocket binario.
2. **Relay WS con auth propia** — Socket.IO NO sirve para VNC (tiene su framing); hay que levantar un
   **`ws.Server`** aparte (nueva dep `ws`) enganchado al `httpServer` de Nest en un path dedicado (p. ej.
   `/hmi-vnc`), que **valide NUESTRO JWT en el `upgrade`** (por query-param o subprotocolo, patrón análogo
   al `handshake.auth.token` del gateway Socket.IO, `connectivity.gateway.ts:56`) y luego haga bridge a
   websockify→VNC. Aquí SÍ usamos nuestro JWT porque la conexión la abre el JS del SPA.
3. **`location /hmi-vnc/` en nginx** con Upgrade de WebSocket → al `ws.Server` (o directo a websockify).
4. **Front:** componente **noVNC** (`@novnc/novnc`, nueva dep) renderizando en un `<canvas>` dentro de
   `hmi.tsx` (solo web; APK igual necesitaría WebView). Mosaico igual que en A.

### Credenciales necesarias (Camino B)
- **Contraseña VNC** de cada panel + **VNC habilitado** en el panel. La contraseña la usa el **relay en el
  servidor** (nunca llega al navegador).
- **Nuestro JWT** (valida el `upgrade` del WebSocket → control real de acceso por rol/planta).
- **Red:** VM debe alcanzar `panel:5900/5901`.

### Por dónde pasa la información (Camino B)
```
Navegador (noVNC canvas)  ── WS (con nuestro JWT en query) ──►
Cloudflare (HTTPS/WSS) → nginx :80 (location /hmi-vnc, upgrade) →
ws.Server (VM, valida JWT + planta) → websockify (VNC↔WS) → Panel HMI :5900 (VNC)  ← red OT
```
### Dónde se muestra
Misma pestaña **"Pantalla HMI"**, pero el panel es un `<canvas>` de noVNC en vez de un `<iframe>`.

---

## Seguridad (ambos caminos)
- **Gate de pantalla:** JWT + `hasPermission('view_dashboard')` + scope de planta (guards ya existentes).
- **View-only por defecto** (coherente con "escrituras al PLC deshabilitadas"): en A, publicar el HMI en
  modo lectura si Optix lo permite; en B, VNC en `ViewOnly`. Interacción/control = decisión aparte.
- **Credenciales de Optix/VNC solo en la VM** (`.env`/config nginx), nunca en el front ni en git.
- **CSP/X-Frame-Options** ajustados solo lo mínimo (`frame-src 'self'`, `SAMEORIGIN`) — documentar en
  `docs/` porque el nginx real NO está en git.
- Auditar la apertura de HMI vía el `AuditMiddleware` si se añade el `HmiController`.

## Frontend común
- Nueva ruta `(app)/hmi.tsx` + `Tabs.Screen`, guard de rol, usa `usePlant().selectedPlant.id` (slug) para
  la URL/canvas. Mosaico con `react-grid-layout` (web) + Fullscreen API. Rama `Platform.OS === 'web'`
  (patrón ya usado en `AuthContext.tsx:30`); en APK, fallback o `react-native-webview` (nueva dep + rebuild).

---

## Fases de ejecución
0. **Descubrimiento** (yo, desde la VM): sondeo de puertos + modelo de panel + tipo de credencial → decide A/B.
1. **Backend/config:** `OPTIX_WEB_BASE_URL` + mapping por slug (A) **o** `ws.Server` de relay VNC + `ws`/
   `websockify` (B); `HmiController` opcional.
2. **nginx (VM):** `location /hmi/` (A) o `/hmi-vnc/` (B) + ajuste de cabeceras/CSP; documentarlo en `docs/`.
3. **Front:** vista `hmi.tsx` (iframe A / noVNC B) + mosaico + guard + pestaña.
4. **Despliegue:** `deploy.sh` + recompilar web + recargar nginx (dentro del flujo ya conocido).
5. **Verificación** (abajo).

## Qué necesito de ti (para arrancar)
1. **Que corra la Fase 0** contra el host Optix (autorización para el sondeo de puertos desde la VM).
2. **Qué credenciales tenemos** exactamente (login web de Optix / usuario VNC / Windows).
3. **Modelo del panel** (o si es Runtime central en PC).
4. **Alcance móvil:** ¿la vista HMI es **solo web**, o también en la **APK** (implica añadir
   `react-native-webview` + recompilar)?
5. **Interacción:** ¿**solo ver** (recomendado) o permitir operar el HMI desde la web?

## Verificación
- Fase 0: el sondeo lista puertos web/VNC abiertos del host Optix.
- A: abrir la pestaña "Pantalla HMI" y ver el HMI real de una planta en el iframe (same-origin, sin errores
  CSP en consola); probar el mosaico y pantalla completa; confirmar que un rol sin `view_dashboard` no entra.
- B: el `<canvas>` noVNC pinta la pantalla del panel; el `upgrade` WS se rechaza sin JWT válido.
- En ambos: verificar que ninguna credencial de Optix/VNC viaja al navegador (solo en la VM).
