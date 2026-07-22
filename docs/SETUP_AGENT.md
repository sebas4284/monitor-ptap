# Runbook de montaje (para un agente de IA)

> **Para quién:** un asistente de IA que debe dejar Monitor PTAP corriendo en una máquina nueva.
> **Guía equivalente para humanos:** [`docs/SETUP.md`](./SETUP.md) (misma secuencia, con más contexto).
>
> Sigue los pasos **en orden**. Cada uno trae su **verificación**: si falla, detente y resuelve
> antes de avanzar — no encadenes pasos sobre una base rota.

---

## 0. Contexto mínimo (léelo antes de ejecutar)

- Monorepo npm workspaces: `apps/api` (backend NestJS), `apps/mobile` (Expo), `packages/shared`.
- **Hay DOS arranques distintos y confundirlos es la causa #1 de problemas:**

| Arranque | Comando | ¿MySQL? | ¿Login? |
|---|---|---|---|
| Telemetría (demo) | `npm run start:telemetry -w @ptap/api` | **No** | **No** — no monta `/api/auth/login` ni guards |
| App completa | `npm run dev:api` | **Sí** | **Sí** — auth, roles, usuarios, comandos |

- **El `.env` NO viaja por git** (está en `.gitignore`, y así debe quedarse). Por eso un clon limpio
  no arranca hasta que lo crees. Es el paso que más se olvida.
- **La telemetría no se persiste**: MySQL solo guarda usuarios, auditoría y comandos. No busques
  tablas de sensores: no existen ni deben existir.

### Reglas duras (no las rompas)

1. **Genera secretos NUEVOS para esta máquina.** No reutilices los de otro equipo ni los pongas en
   ningún archivo versionado. Cada desarrollador tiene los suyos.
2. **Nunca hagas commit de** `.env`, `apps/api/pki/` (llaves privadas OPC UA) ni `node_modules/`.
   Si `git status` muestra decenas de miles de archivos, el `.gitignore` está roto → **para y
   arréglalo** antes de tocar git (ver §8).
3. **No inventes datos de planta.** Si algo no está mapeado, se queda `unmapped`.

---

## 1. Requisitos previos

Verifica antes de instalar:

```bash
node --version     # debe ser >= 20
npm --version
git --version
```

**MySQL** es necesario solo para la app completa. Comprueba que corre y **anota en qué puerto**:

```bash
# Windows
Get-Service | Where-Object { $_.Name -like "*mysql*" }
netstat -ano | findstr "LISTENING" | findstr ":3306 :3307"
# Linux/macOS
systemctl status mysql   # o:  brew services list
```

> ⚠️ Puede haber **más de una instancia** de MySQL en la máquina (p. ej. 3306 y 3300) con
> contraseñas distintas. Confirma cuál usarás **y en qué puerto** antes de seguir. Este error costó
> horas en el equipo original.

**Verificación:** Node ≥ 20 y un servicio MySQL activo con puerto conocido.

---

## 2. Dependencias

```bash
npm install      # desde la RAÍZ del monorepo (instala los 3 workspaces)
```

**Verificación:** `npm run typecheck` termina sin errores en `@ptap/api`, `@ptap/mobile` y
`@ptap/shared`. Si falla por módulos faltantes, `npm install` no terminó bien.

---

## 3. Crear la base de datos y un usuario de aplicación

La app **no debe correr como `root`**. Crea una base y un usuario dedicado.

**Genera una contraseña para el usuario de la app** (no reutilices ninguna):

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

Ejecuta este SQL **como administrador de MySQL** (Workbench, `mysql -u root -p`, o el cliente que
tengas). Sustituye `<PASSWORD_APP>` por la contraseña que acabas de generar:

```sql
CREATE DATABASE IF NOT EXISTS monitor_ptap
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'ptap_app'@'localhost'   IDENTIFIED BY '<PASSWORD_APP>';
CREATE USER IF NOT EXISTS 'ptap_app'@'127.0.0.1'   IDENTIFIED BY '<PASSWORD_APP>';

GRANT ALL PRIVILEGES ON monitor_ptap.* TO 'ptap_app'@'localhost';
GRANT ALL PRIVILEGES ON monitor_ptap.* TO 'ptap_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

> **Si no tienes la contraseña de root**, NO intentes adivinarla ni saltarte la autenticación:
> pide al humano que ejecute ese SQL, o que resetee root con el procedimiento oficial de MySQL
> (`--init-file`), que requiere permisos de administrador del sistema.

**Verificación:** conectar con el usuario nuevo debe funcionar:
```bash
node -e "require('mysql2/promise').createConnection({host:'127.0.0.1',port:3306,user:'ptap_app',password:'<PASSWORD_APP>',database:'monitor_ptap'}).then(()=>console.log('CONEXION OK')).catch(e=>console.log('FALLO:',e.code))"
```

---

## 4. Crear el `.env` (raíz del monorepo)

Genera **secretos propios de esta máquina**:

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('PASSWORD_PEPPER_V1_BASE64=' + require('crypto').randomBytes(64).toString('base64'))"
```

Crea `.env` en la raíz (junto a `package.json`) partiendo de `.env.example`. Mínimo funcional:

```dotenv
PORT=4000

# ── MySQL (del paso 3) ──
DB_HOST=127.0.0.1
DB_PORT=3306                      # ajusta si tu MySQL usa otro puerto
DB_USER=ptap_app
DB_PASSWORD=<PASSWORD_APP>
DB_NAME=monitor_ptap

# ── Puente OPC UA: simulador (sin PLC real) ──
CONNECTIVITY_PROVIDER=simulator

# ── Seguridad (GENERADOS ARRIBA, propios de esta máquina) ──
PASSWORD_PEPPER_CURRENT_VERSION=1
PASSWORD_PEPPER_V1_BASE64=<pepper generado>
JWT_SECRET=<jwt secret generado>
JWT_EXPIRES_IN=8h

# ── CORS: OBLIGATORIO para la app web (NO lo omitas) ──
CORS_ORIGINS=http://localhost:8081

# ── Usuarios de prueba (paso 5) ──
# OBLIGATORIA para sembrar (ya no hay default). Este valor es de ejemplo y SOLO para un entorno
# local: antes de exponer el backend, las cuentas demo se cortan con
# `npm run db:disable-demo-users -w @ptap/api`.
SEED_USERS_PASSWORD=Demo1234!
```

Reglas de este archivo:
- `PASSWORD_PEPPER_V1_BASE64` debe decodificar a **exactamente 64 bytes** (el comando de arriba lo
  garantiza). Si no, el login truena.
- **No cambies el pepper después de sembrar usuarios**: sus contraseñas dejarían de validar.
- Sin comillas raras ni espacios sueltos tras el `=`.
- `CONNECTIVITY_PROVIDER=simulator` salvo que la máquina tenga red al PLC real
  (`opc.tcp://181.204.165.66:59100`); con `opcua` sin red, el puente quedará reintentando.
- **`CORS_ORIGINS` no es opcional si vas a usar la web.** La app de Expo corre en `:8081` y llama al
  backend en `:4000`: es cross-origin, y sin esta variable el **navegador** bloquea el login. El
  síntoma engaña — `curl` funciona perfecto (curl no aplica CORS), así que parece que el backend
  está bien y que las credenciales están mal. Si el backend arranca sin ella, deja este aviso en el
  log: `CORS deshabilitado (CORS_ORIGINS vacío)`.

**Verificación:**
```bash
node -e "require('dotenv').config({path:'.env'});const p=process.env.PASSWORD_PEPPER_V1_BASE64||'';console.log('pepper bytes:',Buffer.from(p,'base64').length,'(debe ser 64) | JWT_SECRET:',(process.env.JWT_SECRET||'').length>0)"
```

---

## 5. Tablas y usuarios

```bash
npm run db:migrate    -w @ptap/api    # crea users, audit_log, command_log (idempotente)
npm run db:seed-users -w @ptap/api    # un usuario por rol (idempotente)
```

Crea estas cuentas, todas con la contraseña de `SEED_USERS_PASSWORD` (obligatoria — sin ella el
script aborta; ya no existe el default público):

| Email | Rol | Acceso |
|---|---|---|
| `civil@ptap.co` | civil | Vista básica (solo consulta) |
| `operador@ptap.co` | operador | Datos + control de válvulas |
| `jefe@ptap.co` | jefe | Todo menos válvulas |
| `admin@ptap.co` | admin | Control total + pantalla Usuarios |

**Verificación:** `db:migrate` imprime las migraciones aplicadas y `db:seed-users` los 4 usuarios.
Si `db:migrate` da `Access denied`, la credencial del `.env` no coincide con la del paso 3.

---

## 6. Arrancar

Dos procesos, en terminales distintas:

```bash
npm run dev:api                  # backend COMPLETO (MySQL + auth). Esperar "Nest application successfully started"
npm run web -w @ptap/mobile      # app web (Expo) en http://localhost:8081
```

> Si solo levantas la app y no el backend, **el login fallará siempre**. Es el error más común.

**Verificación (por API, antes de abrir el navegador):**
```bash
curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:4000/api/health
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ptap.co","password":"Demo1234!"}'
```
Debe devolver `{ token, user: { role: "admin", ... } }`. Si devuelve 401 con esas credenciales,
revisa el pepper (§4) y que `db:seed-users` haya corrido.

---

## 7. Verificación final (criterios de aceptación)

El montaje está bien **solo si estos 5 pasan**:

```bash
npm run typecheck                      # 1. limpio en los 3 workspaces
npm test -w @ptap/api                  # 2. 140/140 tests en verde
npm run validate:mapping -w @ptap/api  # 3. "opc_mapping.json válido (12 plantas)"
```
4. `POST /api/auth/login` con `admin@ptap.co` / `Demo1234!` devuelve un JWT (§6).
5. En `http://localhost:8081`: entrar como `civil@ptap.co` cae en *Estado*; como `admin@ptap.co`
   aparece **Usuarios** en el menú ☰. Recargar la página mantiene la sesión.

> El paso 5 hay que hacerlo **en el navegador**, no con `curl`: es el único que detecta que falta
> `CORS_ORIGINS`. Con curl todo parece correcto aunque la web esté rota.

Prueba opcional de que el RBAC es real (no cosmético):
```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"civil@ptap.co","password":"Demo1234!"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
curl -s -o /dev/null -w "civil -> /api/opc/info: %{http_code} (debe ser 403)\n" -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/opc/info
curl -s -o /dev/null -w "sin token -> /api/plants: %{http_code} (debe ser 401)\n" http://localhost:4000/api/plants
```

---

## 8. Errores típicos (todos vistos en el equipo original)

| Síntoma | Causa real | Solución |
|---|---|---|
| `Falta la variable de entorno DB_PASSWORD` | No hay `.env` | §4 |
| `Access denied for user ...` | Credencial/puerto del `.env` ≠ MySQL real. **Ojo con dos instancias** | §1 y §3 |
| Arranca pero el login da error de tabla | No se corrió `db:migrate` | §5 |
| Login dice "Credenciales inválidas" | **Casi siempre el backend no está corriendo**, no la contraseña | Levanta `npm run dev:api` |
| **El login falla SOLO en el navegador, pero `curl` funciona** | **Falta `CORS_ORIGINS`** → el navegador bloquea la petición (curl no aplica CORS, por eso engaña). Mira la consola del navegador: dirá `blocked by CORS policy` | `CORS_ORIGINS=http://localhost:8081` en el `.env` y reinicia la API (§4) |
| Login dice "pendiente de aprobación" (403) | No es un fallo: **toda cuenta registrada desde la app nace pendiente**. La contraseña era correcta | Entra como `admin@ptap.co` → **Usuarios** → pestaña **Pendientes** → **Aprobar** |
| `EADDRINUSE :4000` / `:8081` | Quedó un proceso node vivo de antes | Mata el proceso que ocupa el puerto y reintenta |
| `Cannot find module ...` | `node_modules` viejo o incompleto | `npm install` en la raíz |
| El puente queda `Disconnected` reintentando | `CONNECTIVITY_PROVIDER=opcua` sin red al PLC | Pon `simulator` |
| TS se queja de una ruta de `expo-router` | Los tipos de rutas se autogeneran | Arranca `npm run web` una vez (regenera `.expo/types`) |
| **`git status` muestra ~56.000 archivos** | **`.gitignore` vacío/roto → `node_modules` sin ignorar** | Restaura: `git checkout HEAD -- .gitignore`. **Verifica que `.env` y `pki/` estén ignorados ANTES de cualquier commit** |

Comprobación de seguridad antes de tocar git (debe decir que están ignorados):
```bash
git check-ignore -v .env node_modules apps/api/pki
```

---

## 9. Qué NO es un fallo (no lo "arregles")

- **Todas las señales salen `confidence: inferred`.** Es correcto: falta el export L5X del PLC.
  Solo se marca `confirmed` con documentación oficial.
- **`san-antonio` y `quijote` sin señales propias.** Sus tanques llegan retransmitidos vía Soledad;
  está pendiente de rectificar con el operador.
- **Los comandos responden `TARGET_NOT_WRITABLE`.** A propósito: el mapping de producción no tiene
  señales `writable` y `OPCUA_WRITES_ENABLED=false`. La escritura al PLC está cerrada por diseño.
- **Válvulas y reportes usan datos mock** (`apps/mobile/services/mock-data.ts`): el backend aún no
  mapea esas features. Sensores y tanques **sí** son reales.
- **El registro solo crea cuentas `civil`.** El rol lo fija el servidor; mandar `role` en el body
  devuelve 400. Elevar a operador/jefe/admin es potestad de un admin (pantalla Usuarios).

---

## 10. Dónde seguir leyendo

| Documento | Para qué |
|---|---|
| [`docs/SETUP.md`](./SETUP.md) | La misma puesta en marcha, explicada para humanos |
| [`README.md`](../README.md) | Estado de fases, arquitectura, endpoints, reglas de dominio |
| [`docs/architecture/`](./architecture/) | Diseño del backend y contratos internos |
| [`docs/api/openapi.yaml`](./api/openapi.yaml) | Contrato HTTP completo, con el permiso de cada ruta |
| [`docs/DATA_CATALOG.md`](./DATA_CATALOG.md) | Qué señal existe en cada planta y cómo tratarla |
| [`docs/SECURITY_FINDING_P0.md`](./SECURITY_FINDING_P0.md) | Hallazgo de seguridad abierto del servidor de la planta |
