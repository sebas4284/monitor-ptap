# Pendiente de despliegue — trabajo listo en `yosh`, sin desplegar a la VM

**Fecha:** 2026-07-28 · **Estado de producción:** sin cambios, estable (la VM NO se tocó).

Se hizo y commiteó una tanda de trabajo en la rama `yosh` (ya en `origin/yosh`, HEAD `54e04be`), pero
**el despliegue a la VM quedó en pausa a propósito**. Este documento deja por escrito qué está hecho,
qué falta y cómo retomarlo.

---

## 1. Qué está hecho (commiteado en `origin/yosh`)

| Commit | Contenido |
|---|---|
| `4af541c` | **Fase 6 — validación operacional.** Suite de resiliencia (`apps/api/test/operational-resilience.test.ts`, 6 escenarios de caos) + harness de carga/latencia (`apps/api/scripts/operational-validation.ts`, Socket.IO real) + [docs/OPERATIONAL_VALIDATION.md](OPERATIONAL_VALIDATION.md). Scripts npm `test:operational`, `validate:operational`, `audit:efficiency`. |
| `7a59205` | **Arreglos de frontend.** Estado *congelado* y *fuera de rango* en las tarjetas (tanque/gauge/caudal), barra sin desfase (350 ms) y % clampado, el socket marca `frozen` al caer y resincroniza al reconectar, guard del Civil antes del fetch, una sola suscripción por tablero, Reportes distingue error de red de "sin métricas", sesión revalidada al volver a primer plano, división por cero en FlowMeter, y `opc:unsubscribe` en el gateway (backend). |
| `6c9da24` | **Auditoría de eficiencia + colector.** [docs/audit/EFICIENCIA_BACKEND_2026-07-28.md](audit/EFICIENCIA_BACKEND_2026-07-28.md) (Efficiency Score por zona, **global 91/100 🟢**, KPIs reales de la VM, hallazgos priorizados, ROI) + `apps/api/scripts/efficiency-collector.ts` (lectura pasiva de `/metrics`, `/health/opc`, `pm2`, `EXPLAIN`). |
| `54e04be` | **Optimizaciones (D3/D4/D6/D7).** `loadMapping()` memoizado; diff del snapshot con firma barata (sin `JSON.stringify` por frame); migraciones **0007** `users(created_at)` y **0008** `audit_log(event_type, at)`. |

Verificado localmente: **typecheck limpio** (API + móvil) y **tests** 21/21 (pipeline), 19/19 (mapping),
6/6 (resiliencia). Nada de secretos en los docs. (Queda sin rastrear `apps/mobile/eas.json`, del camino
EAS abandonado — se dejó fuera a propósito.)

---

## 2. Qué falta (pendiente)

- **`origin/dev` NO actualizado** (sigue en `cb31c3a`). El push fue a `origin/yosh`, y la VM sigue `dev`.
- **VM sin desplegar:** el backend en producción corre el código anterior. **Sin aplicar** las migraciones
  0007/0008, **sin** recompilar la web (los arreglos de tablero no se ven aún) y **sin** NTP.

---

## 3. Cómo retomar (pasos exactos)

1. **Actualizar `dev`** (fast-forward, sin conflictos — `cb31c3a` es ancestro de `yosh`):
   ```bash
   git push origin yosh:dev
   ```
2. **En la VM** (por VPN + SSH `ptap`):
   ```bash
   bash ~/deploy.sh                       # git pull dev + npm ci + build + pm2 restart ptap-api
   npm run -w @ptap/api db:migrate        # aplica índices 0007 (users) y 0008 (audit_log)
   ```
3. **Recompilar la web** (para los arreglos del tablero):
   ```bash
   cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear
   sudo bash ~/deploy-scripts/web-setup.sh
   ```
4. **NTP** (D2 — para que el KPI de latencia OPC sea fiable):
   ```bash
   sudo timedatectl set-ntp true
   ```
5. **Verificar:**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/health/opc   # 200
   pm2 status                                                                       # ptap-api online, estable
   npm run -w @ptap/api audit:efficiency                                            # Score sigue 🟢; users sin filesort
   ```

---

## 4. Recomendaciones de la auditoría que quedaron DIFERIDAS (opcional, para otra tanda)

No se implementaron a propósito (bajo valor o requieren decisión/externos):

- **D5** — no auditar los GET de lectura de `/api/plants/*` (reduce escrituras en `audit_log`). Es
  **decisión de política/seguridad**; hoy `audit_log` tiene ~500 filas → sin urgencia.
- **D8** — `SELECT` acotado en `findById` (hoy `SELECT *`). Toca el tipo `UserRecord` compartido; valor bajo.
- **D9 / H14** — código muerto `finalizeNoReserve` (`write.service.ts:214`) y métrica `UNEXPECTED_LENGTH`
  que nunca se registra. Cosméticos.
- **D1** — 96 señales en dead-letter (mapping ↔ PLC real): depende del **export L5X** de la planta (externo).

Detalle completo, impacto y prioridad: [docs/audit/EFICIENCIA_BACKEND_2026-07-28.md](audit/EFICIENCIA_BACKEND_2026-07-28.md).

---

## 5. Notas

- Los 3 críticos de la auditoría de preproducción (**H1** Faulted terminal, **H4** fuga de OPCUAClient,
  **H26** logging ~21.600/h) están **resueltos y verificados** en el código actual.
- Re-ejecutar el colector para tendencias: `EFF_SSH=ptap npm run -w @ptap/api audit:efficiency [-- --json]`.
- Al retomar y volver a desplegar, considerar rotar el **token de GitHub** de LorJosh (pendiente operativo previo).
