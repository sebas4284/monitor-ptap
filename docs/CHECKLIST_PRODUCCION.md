# Checklist de producción — traslado al servidor real

Qué revisar/ajustar para pasar el backend del entorno de desarrollo (simulador, cuentas demo) al
**servidor real** con el **PLC real**. La receta de instalación en el VPS está en
[DEPLOY_VPS.md](DEPLOY_VPS.md); esto es el **endurecimiento** de configuración y datos.

---

## 1. Datos simulados: qué se queda y qué se marca

| Elemento | Estado | Acción |
|---|---|---|
| **Simulador del backend** (`SimulatorBridgeAdapter`) | **Se QUEDA** | Es el arnés de pruebas + modo dev sin PLC (lo usan ~6 tests y `connectivity.module` lo importa en compilación). En prod **no se elige** (`CONNECTIVITY_PROVIDER=opcua`) y ni se instancia. Borrarlo rompe el build y los tests. |
| **Mock del móvil** (`services/mock-data.ts`: solo **válvulas**) | **Se QUEDA, marcado** | La pantalla Válvulas muestra un banner **"Datos de ejemplo"** ([ExampleDataBanner](../apps/mobile/components/ExampleDataBanner.tsx)) hasta cablear el canal real. **Reportes ya es REAL** (informes por métrica, CSV — módulo `reports/`), su mock fue eliminado. |
| **Cuentas demo** (`civil@/operador@/jefe@/admin@ptap.co`, `Demo1234!`) | **Se CORTAN** | `npm run db:disable-demo-users -w @ptap/api` antes de exponer. Sembrar un admin real con `db:seed-admin`. |

> El simulador no es "dato falso que estorba": es infraestructura de test. Producción elige el
> adaptador OPC UA; el simulador queda inerte. Es el patrón correcto (dos adaptadores, un puerto).

---

## 2. Variables de entorno para producción (`.env`)

| Variable | Valor en producción | Por qué |
|---|---|---|
| `CONNECTIVITY_PROVIDER` | **`opcua`** | Usar el PLC real, no el simulador |
| `OPC_ENDPOINT` | `opc.tcp://<host-real-del-PLC>:59100` | Endpoint del PLC (o la IP interna si es por VPN) |
| `OPCUA_WRITES_ENABLED` | **`false`** (dejar) | Escritura al PLC bloqueada — válvulas seguras hasta confirmar el protocolo |
| `SOCKET_AUTH_REQUIRED` | **sin definir / ≠ false** | El gateway exige JWT. **Nunca** `false` en prod |
| `LOG_LEVEL` | `info` | El log por snapshot ya está en `debug`; en `info` no aparece |
| `CORS_ORIGINS` | `https://ptaps.telcobras.com` | Solo el origen real (aplica también al WebSocket) |
| `APP_PUBLIC_URL` | `https://ptaps.telcobras.com` | Base de los enlaces de verificación de correo |
| `METRICS_AUTH_TOKEN` | **un token** | Protege `/metrics` (abierto por defecto). Ver §3 |
| `JWT_SECRET`, `PASSWORD_PEPPER_V1_BASE64` | secretos nuevos (64 bytes el pepper) | Nunca los de ejemplo del repo |
| `DB_*` | credenciales del MySQL real | — |
| `EMAIL_TRANSPORT` | `console` (o `smtp` con `SMTP_*`) | Verificación de correo; SMTP real cuando se defina |

---

## 3. Endurecimiento de seguridad

- [ ] **`/metrics` protegido:** define `METRICS_AUTH_TOKEN`. Sin él, el endpoint Prometheus queda
      **abierto** (expone métricas operativas). El guard ya existe (`metrics-auth.guard.ts`, SRV-05);
      solo hay que darle el token.
- [ ] **Cuentas demo desactivadas** (`db:disable-demo-users`) y admin real sembrado.
- [ ] **Arranque solo por `main.ts`** (nunca `start:telemetry` en prod: ese entrypoint desactiva la
      auth del socket y no tiene BD/RBAC).
- [ ] **HTTPS de punta a punta** (nginx + certbot); el Node solo en `127.0.0.1:4000`.
- [ ] **Handshake del socket** exige JWT (SRV-04) — verificado por el default de `SOCKET_AUTH_REQUIRED`.
- [ ] **Rate-limit** activo (login/registro/reenvío) — por defecto ya lo está.
- [ ] **Escritura al PLC** cerrada (`OPCUA_WRITES_ENABLED=false`) hasta cablear válvulas con
      confirmación del operador (ver [PROTOCOLO_VALVULAS_VORAGINE.md](PROTOCOLO_VALVULAS_VORAGINE.md)).

---

## 4. Arranque y base de datos

- [ ] `npm ci` **en el servidor** (no copiar `node_modules`; `argon2` es nativo).
- [ ] `npm run build` (compila `@ptap/shared` → dist y el API → `dist/main.js`).
- [ ] `npm run db:migrate -w @ptap/api` (crea/actualiza tablas; idempotente).
- [ ] `db:seed-admin` con credenciales reales; `db:disable-demo-users`.
- [ ] **Arrancar con PM2**: `cd apps/api && pm2 start ecosystem.config.js` (corre `node dist/main.js`).
      `pm2 save && pm2 startup` para reinicio en reboot.

---

## 5. Red (el punto que decide si hay datos)

- [ ] **La VM alcanza el PLC** por OPC UA (`nc -vz <host-PLC> 59100`). Hoy el PLC está tras NAT/túnel
      (ver [INCIDENTE_CONEXION_PLC.md](INCIDENTE_CONEXION_PLC.md)); resolver la ruta (VPN/túnel) es
      requisito de red. Sin ella, la telemetría sale "sin datos" aunque todo lo demás esté OK.
- [ ] Puertos entrantes 80/443; salientes a GitHub/npm/PLC.

---

## 6. Verificación post-despliegue

- [ ] `curl https://ptaps.telcobras.com/api/health` → 200
- [ ] `curl https://ptaps.telcobras.com/api/health/db` → 200 (MySQL conectado)
- [ ] `curl https://ptaps.telcobras.com/api/health/opc` → 200 si el puente está `Connected`; 503 si
      no alcanza el PLC (señal correcta para el monitoreo)
- [ ] Login por HTTPS devuelve JWT; el WebSocket conecta (Sensores en vivo con datos del PLC real)
- [ ] `/metrics` responde 401 sin el token y 200 con él
- [ ] Las pantallas Válvulas/Reportes muestran el banner "Datos de ejemplo"

---

## 7. Deuda conocida (no bloquea el despliegue, sí conviene)

- Cablear el canal real de **válvulas** (requiere confirmación del operador del protocolo de bits) →
  retirar el último mock del móvil.
- **Correo:** para envío real, `EMAIL_TRANSPORT=smtp` + `SMTP_*` en el `.env` (ya implementado con
  nodemailer; sin credenciales cae a `console`).
- **Informes:** el directorio `REPORTS_DIR` debe ser escribible y con espacio; opcional
  `REPORTS_AUTO_PLANT` para sembrar el ciclo de 7 días de una planta al arrancar.
- **Retención de auditoría:** `AUDIT_RETENTION_DAYS` (90) y `ROUTE_PROBE_RETENTION_DAYS` (2) — limpieza
  diaria automática para que `audit_log` no crezca sin fin.

> **Ya resuelto:** el build de producción (`npm run build`) compila `@ptap/shared` a JS, así que se
> arranca con `node dist/main.js` bajo PM2 (ecosystem.config.js) — sin el workaround de `tsx`.
