# Puesta en marcha local — Monitor PTAP

Guía para levantar el proyecto desde cero tras clonar. Cubre los dos modos de arranque
(con y sin base de datos) y por qué un clon recién bajado NO arranca sin estos pasos.

> **Por qué no funciona “solo con clonar”:** el archivo `.env` **no se sube a git** (está en
> `.gitignore`, y así debe ser: lleva contraseñas). El clon llega sin él, y la app completa
> (`main.ts`) exige `DB_PASSWORD`, `JWT_SECRET` y un pepper para arrancar → muere en el primer
> arranque. Además, la base de datos se **crea sola** pero las **tablas no**: hay que migrarlas.

---

## 0. Requisitos

- **Node.js ≥ 20** (probado en 24) con `npm`.
- **MySQL** corriendo en local (por defecto `127.0.0.1:3306`) — **solo** para el arranque
  completo. Para la demo de telemetría no hace falta.
- Git.

---

## 1. Dependencias (siempre)

Desde la raíz del monorepo:

```bash
npm install
```

Instala los tres workspaces (`apps/api`, `apps/mobile`, `packages/shared`).

---

## 2. Elegir modo de arranque

### Opción A — Demo rápida SIN base de datos (lo más fácil)

No necesita MySQL ni casi configuración. Levanta el puente (simulado) + pipeline + REST +
Socket.IO, que es todo lo que el móvil necesita para ver datos.

```bash
# 1. Crear el .env desde la plantilla
cp .env.example .env
# 2. Asegurarse de que en .env esté:  CONNECTIVITY_PROVIDER=simulator
# 3. Backend de telemetría (sin BD) en :4000
npm run start:telemetry -w @ptap/api
# 4. En otra terminal, la app en el navegador
npm run web -w @ptap/mobile
```

> Sin `CONNECTIVITY_PROVIDER=simulator`, el backend intenta conectarse al PLC real
> (`opc.tcp://181.204.165.66:59100`), que probablemente no sea alcanzable desde su red →
> el puente quedará reintentando. El proceso igual arranca, pero no verá datos.

### Opción B — App completa CON base de datos (auth, usuarios, auditoría, comandos)

Requiere MySQL. Sigue los pasos 3–5. **Esta es la única opción con login real y RBAC**:
`start:telemetry` (Opción A) NO monta `/api/auth/login` ni los guards, así que la pantalla de
login no funciona contra él.

---

## 3. Configurar el `.env` (solo Opción B)

```bash
cp .env.example .env
```

Editar `.env` y rellenar lo **obligatorio** (viene vacío en la plantilla):

| Variable | Qué poner |
|---|---|
| `DB_PASSWORD` | La contraseña de **tu** MySQL local (la del usuario `root`, o el que uses). Entre comillas dobles si contiene `@` o `#`. |
| `DB_PORT` | El puerto de **tu** MySQL. Por defecto `3306`; cámbialo si tu instancia usa otro. |
| `DB_USER` / `DB_HOST` / `DB_NAME` | Defaults `root` / `127.0.0.1` / `monitor_ptap`. Ajusta si tu MySQL difiere. |
| `JWT_SECRET` | Un string largo aleatorio. Genéralo (ver abajo). |
| `PASSWORD_PEPPER_V1_BASE64` | **Exactamente 64 bytes** en base64. Genéralo (ver abajo). |
| `PASSWORD_PEPPER_CURRENT_VERSION` | `1` (ya viene así en la plantilla). |
| `SEED_ADMIN_EMAIL` / `_PASSWORD` / `_NAME` / `_PLANT` | Datos del primer usuario admin que se creará (para poder loguearte). `_PLANT` debe ser un slug válido, p. ej. `montebello`. |
| `CONNECTIVITY_PROVIDER` | `simulator` para trabajar sin PLC real. |

**Generar los secretos** (cópialos al `.env`):

```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# PASSWORD_PEPPER_V1_BASE64  (64 bytes exactos)
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

> Cada quien puede tener sus propios secretos en su máquina; no hace falta que coincidan
> entre desarrolladores. Lo único que importa es que el pepper con el que se **siembra** el
> admin sea el mismo con el que luego se **verifica** el login (o sea: no cambies el pepper
> después de sembrar, o el login de ese usuario dejará de validar).

---

## 4. Crear las tablas y los usuarios (solo Opción B)

Con MySQL corriendo y el `.env` listo:

```bash
# Crea las tablas (users, audit_log, command_log). Idempotente.
npm run db:migrate -w @ptap/api

# Crea UN usuario por rol para probar RBAC (recomendado). Idempotente.
npm run db:seed-users -w @ptap/api

# (alternativa) Solo el primer admin, desde SEED_ADMIN_* del .env.
npm run db:seed-admin -w @ptap/api
```

`db:seed-users` crea estas cuentas (contraseña común desde `SEED_USERS_PASSWORD`, default `Demo1234!`):

| Email | Rol | Qué puede hacer |
|---|---|---|
| `civil@ptap.co` | civil | Vista básica |
| `operador@ptap.co` | operador | Datos + control (incl. válvulas) |
| `jefe@ptap.co` | jefe | Todo lo del operador **salvo** abrir/cerrar válvulas |
| `admin@ptap.co` | admin | Control total |

## Alta de usuarios y asignación de roles

Según la **matriz oficial de permisos**, *"Crear, editar y eliminar usuarios"* y *"Asignar roles a
los usuarios"* son atribuciones **exclusivas del Administrador**. El flujo implementado:

1. **Cualquiera se registra** desde la app (`POST /api/auth/register`) y entra de inmediato…
2. …**siempre con rol `civil`** (solo consulta: si el sistema opera y si hay agua). El rol lo fija
   el **servidor**: la pantalla no tiene selector de rol y el schema es `.strict()`, así que mandar
   `role` en el body devuelve **400**. Nadie puede auto-asignarse un rol.
3. **Un administrador verifica a la persona** (para eso el registro pide teléfono) y le asigna el
   rol que corresponda desde la pantalla **Usuarios** (menú ☰, visible solo para admin) o por API.
4. **Cada cambio queda auditado** en `audit_log` (`user.role_changed`) con quién lo hizo, a quién,
   y de qué rol a cuál.

| Método · Ruta | Permiso | Para qué |
|---|---|---|
| `POST /api/auth/register` | público | Alta propia → siempre `civil` |
| `GET /api/users` | `manage_users` (admin) | Listar usuarios |
| `PATCH /api/users/:id/role` | `assign_roles` (admin) | Asignar rol |
| `PATCH /api/users/:id/active` | `manage_users` (admin) | Activar/desactivar cuenta |

> **Nota:** el rol viaja dentro del JWT (vive 8 h), así que un cambio de rol **se aplica cuando el
> usuario vuelve a iniciar sesión**. Además, un admin **no puede** cambiar su propio rol ni
> desactivarse (evita quedarse fuera del sistema).

> `db:migrate` crea la base de datos `monitor_ptap` si no existe y aplica las migraciones
> pendientes. Sin este paso, la BD existe pero **vacía** → el login y cualquier ruta que
> toque `users` fallan con “table doesn't exist”.

---

## 5. Arrancar la app completa (solo Opción B)

```bash
npm run dev:api            # tsx watch src/main.ts  (requiere MySQL arriba)
# y el móvil:
npm run dev:mobile         # o  npm run web -w @ptap/mobile
```

Evidencia esperada en consola: `Conexión MySQL establecida (127.0.0.1:3306/monitor_ptap)` y
`Nest application successfully started`.

---

## 6. Verificar que quedó bien

```bash
npm run typecheck          # limpio en los 3 workspaces
npm test -w @ptap/api      # suite del backend en verde
npm run validate:mapping -w @ptap/api
```

---

## Errores típicos y su causa

| Síntoma | Causa | Solución |
|---|---|---|
| `Falta la variable de entorno DB_PASSWORD` | No hay `.env` o `DB_PASSWORD` vacío | Crear `.env` (paso 3) |
| `JWT_SECRET` / pepper undefined al arrancar o loguear | Faltan esos secretos en `.env` | Generarlos (paso 3) |
| Arranca pero el login da error de tabla | No se corrió `db:migrate` | Paso 4 |
| `ECONNREFUSED` / no conecta a MySQL | MySQL apagado, puerto o credenciales distintos | Encender MySQL; alinear `DB_PORT`/`DB_PASSWORD` con tu instancia |
| Módulos que faltan (`Cannot find module …`) | `node_modules` viejo o sin instalar | `npm install` en la raíz |
| El puente queda `Disconnected`/reintentando | `CONNECTIVITY_PROVIDER` no es `simulator` y no hay red al PLC | Poner `CONNECTIVITY_PROVIDER=simulator` |

## Qué es real y qué está simulado (contexto)

- La **base de datos es MySQL real**; solo guarda `users`, `audit_log` y `command_log`
  (auth/auditoría/comandos). La **telemetría nunca se persiste** — vive en RAM por diseño.
- El **puente OPC UA** puede ser real (`CONNECTIVITY_PROVIDER=opcua`) o **simulado**
  (`simulator`, datos sintéticos para trabajar sin PLC).
- En el **móvil**, el **login ya es real** (JWT contra el backend; el rol sale de la base, no del
  email) y el token viaja en cada petición REST. La sesión persiste entre reinicios
  (secure-store / localStorage) y un 401 la limpia sola. Siguen con datos mock **solo** las
  válvulas y los reportes (features que el backend aún no mapea); sensores y tanques son reales.

## Probar roles y seguridad (Opción B)

Con `npm run dev:api` + `npm run web -w @ptap/mobile`, entra con cada usuario y observa que el
rol cambia lo que ve la app. Para comprobar el RBAC del backend directamente:

```bash
# token de un rol
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"civil@ptap.co","password":"Demo1234!"}' | jq -r .token)

curl -i http://localhost:4000/api/opc/info                          # 401 sin token
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/opc/info   # 403 (civil no es admin)
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/plants     # 200
```
