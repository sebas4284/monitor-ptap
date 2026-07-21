# Semanas 1–4: lo que falta por terminar, especificar o pulir

**Fecha:** 2026-07-21 · **Rama:** `yosh` · **Línea base:** cronograma oficial
`plan_plc_desarrollo.xlsx` (Mes 1 — "Fundamentos & Arquitectura", Semanas 1–4: 11 tareas, 2 hitos).

Este documento actualiza la [auditoría comparativa del Mes 1](audit/auditoria-comparativa-mes1-2026-07-15.md)
(15-jul), que sigue siendo la línea base pero tiene 6 días: varias de sus desviaciones ya se
cerraron. Aquí solo está **lo que falta al 21-jul**, agrupado en tres cubetas y con la ubicación
exacta de cada punto para que sea accionable, no una lista de buenas intenciones.

No es un informe complaciente: donde algo funciona a medias o "parece" real pero no lo es, se dice.

---

## Qué cerró desde la auditoría del 15-jul

Para no arrastrar pendientes ya resueltos:

- **Login y roles de punta a punta (era la desviación D3).** El móvil ya no usa un stub: `apiLogin`/
  `apiRegister` hablan con el backend real, el rol sale de MySQL, la sesión persiste y un 401 la
  limpia sola. Esto destraba la mayor parte de "roles funcionando" (S4-T10).
- **Auto-registro con aprobación.** Registrarse crea una cuenta `civil` **pendiente** (sin token); un
  admin la aprueba y le asigna rol desde la pantalla Usuarios, con búsqueda y filtros. Todo auditado.
- **Revocación de sesiones.** Desactivar o degradar a un usuario aplica en su siguiente petición (el
  guard relee la fila en la base), no cuando caduca su token.
- **Typecheck del móvil arreglado** (el `outOfRange` que faltaba en `TankView`) — el gate de calidad
  del monorepo vuelve a estar verde.
- **Suite de tests: 94 → 142** en `@ptap/api`. **CORS** corregido (la web de Expo ya puede llamar al
  backend). 

**Los dos hitos de control del Mes 1 siguen firmes:** Hito 1 (protocolo OPC UA definido y
documentado) ✅ y Hito 2 (dato real del PLC en pantalla) ✅ **adelantado** — 10 plantas y 96 señales
reales, no "un pequeño número".

---

## Cómo leer esto

- **TERMINAR** — está prometido en S1–4, existe a medias, y es **código** que se puede cerrar sin
  pedir permiso a nadie.
- **ESPECIFICAR** — hay un **conflicto entre el plan y la arquitectura** que necesita una decisión
  del cliente/director antes de poder ejecutarse. No es código todavía; es una definición.
- **PULIR** — funciona, pero es tosco o engañoso para una demo. Bajo riesgo, alto impacto visual.

---

## TERMINAR (código incompleto frente a lo prometido)

### 1. La vista del Civil debe ser honesta sobre "¿el sistema funciona?"

La función **número uno** del Civil en la matriz oficial es *"ver si el sistema está funcionando"*.
Hoy la pantalla del Civil ([`estado.tsx`](../apps/mobile/app/(app)/estado.tsx), líneas 44–45) muestra
**siempre** "Sistema operativo / La planta se encuentra en funcionamiento normal", sin mirar el
`bridgeStatus` ni el `liveness` reales. Si el puente está `Disconnected` o `Faulted`, el Civil sigue
viendo verde. **La pantalla miente justo en lo único que el Civil necesita saber.**

- **Qué falta:** derivar el estado de la tarjeta del `bridgeStatus`/`liveness` del snapshot (verde =
  Connected+live; amarillo = congelado/Recovering; rojo = Disconnected/Faulted). El dato ya llega en
  el snapshot; es cablearlo.
- **Esfuerzo:** bajo (una pantalla).

### 2. Restringir los datos detallados al Civil — en el backend, no solo en la UI

La matriz es tajante: el Civil ve solo estado básico ("sistema funcionando", "hay agua"); **no** ve
variables del PLC, gráficas, alarmas ni el dashboard. Hoy:

- El endpoint de datos ([`plants.controller.ts:20-21`](../apps/api/src/modules/plants/plants.controller.ts#L20-L21))
  está abierto a **todo rol autenticado** — no exige ningún permiso.
- La pantalla del Civil descarga el **snapshot completo** ([`estado.tsx:19`](../apps/mobile/app/(app)/estado.tsx#L19),
  `useSnapshot`) y solo enseña dos tarjetas. **Los datos detallados salen del servidor al dispositivo
  del Civil** aunque no se muestren — la restricción de la matriz no está aplicada donde importa.

- **Qué falta:**
  1. Un permiso `view_basic_status` que el Civil **sí** tenga (hoy `civil: []` en
     [`packages/shared/src/index.ts:86`](../packages/shared/src/index.ts#L86)).
  2. Un endpoint de **estado básico** (solo "¿opera?" + "¿hay agua?", sin señales crudas), gateado por
     ese permiso, que consuma la pantalla del Civil.
  3. Gatear el snapshot detallado con `@RequirePermission('view_dashboard')` — que el Civil no tiene
     → recibe 403. El backend deja de ser la parte laxa.
- **Esfuerzo:** medio (permiso nuevo + endpoint + repunte del móvil). El RBAC por permiso ya existe;
  esto lo usa como debía.

### 3. Válvulas reales de punta a punta (Operador)

La matriz da al Operador *"abrir y cerrar válvulas"*, y el backend ya tiene el canal de comandos
(Fase 5, con todos sus candados). Pero la pantalla de válvulas del móvil sigue en **mock**
([`useElectrovalvulas.ts`](../apps/mobile/hooks/useElectrovalvulas.ts),
[`ValveItem.tsx`](../apps/mobile/components/ValveItem.tsx)): abrir/cerrar no llega al PLC. El control
por rol —la acción que distingue al Operador del Jefe de PTAP— **no está cableado E2E**.

- **Qué falta:** conectar la pantalla al canal de comandos real (`POST /api/commands`), con el guard
  de permiso `control_valves` (que Operador y Admin tienen, Jefe no) y el feedback de confirmación/
  rollback que el backend ya devuelve.
- **Esfuerzo:** medio. **Ojo de seguridad:** hoy `OPCUA_WRITES_ENABLED=false` y el servidor OPC UA de
  la planta acepta escrituras anónimas (hallazgo P0 abierto). Cablear la UI **no** debe habilitar
  escrituras reales hasta que el P0 esté mitigado — se puede demostrar el flujo contra el simulador.

---

## ESPECIFICAR (decisión del cliente/director — todavía no es código)

### D1. Historial en la base de datos — el punto más importante

**El conflicto:** el plan promete que la BD guarda *"lecturas, usuarios, alertas e historial"*
(Semana 2) y que en la Semana 5 se *"agregan filtros al historial"*. La arquitectura de este proyecto
**no persiste telemetría**: es una regla de diseño dura (caché solo en RAM; snapshot < 50 ms; sin
crecimiento de BD sin control). Hoy la BD guarda usuarios, auditoría y comandos — **no** lecturas ni
historial.

Esto no es un olvido, es una decisión de arquitectura consciente. Pero **choca de frente con dos
tareas de la Semana 5** ("filtros al historial" no tiene historial que filtrar) y con las gráficas de
tendencia de la Semana 6. **Hay que decidirlo antes del lunes de la Semana 5**, o esa semana arranca
sobre un supuesto roto.

- **Opción A — Ratificar el historial.** Diseñar ya la capa de persistencia de series (qué señales, a
  qué resolución, cuánta retención). Es trabajo real de S2 que se hace ahora. Riesgo: crecimiento de
  BD y complejidad que la regla RAM-only quería evitar.
- **Opción B — Re-negociar por escrito.** Acordar que el MVP es tiempo real sin historial persistido,
  y mover "filtros al historial" / "gráficas de tendencia" a una fase posterior o a una ventana de
  datos acotada (p. ej. las últimas N horas en RAM, sin BD).
- **Recomendación:** **híbrido** — mantener RAM para el vivo, y añadir una persistencia **acotada y
  con propósito** (solo las señales que el cliente quiera historizar, con retención definida), no una
  BD de series genérica. Pero la decisión de si hay historial y de qué alcance **es del cliente**;
  este equipo no debería asumirla.

### D2. "Aplicación Web (React)" vs. Expo web

El plan lista una *"Aplicación Web en React"* como entregable separado de la app móvil. El proyecto
usa **Expo web**: un solo código que sirve Android, iOS y web. Es una buena decisión (menos
mantenimiento, y el propio plan pide PWA en la Semana 8), pero **cambia un entregable con nombre
propio**. No requiere trabajo — requiere **formalizarlo por escrito** con el cliente para que no
figure como incumplimiento en una revisión.

### D3. Motor de alertas / esquema de alarmas

La matriz tiene tres funciones de alarmas (ver estado, reconocer/silenciar, configurar límites). El
DTO ya transporta los umbrales operativos (`opMin`/`opMax`), pero **no hay motor de alarmas**. El plan
desarrolla las alertas en la Semana 6 — pero el **esquema de alertas en la BD** era un entregable de
la Semana 2, y depende de la misma decisión de persistencia que D1. Conviene resolverlo junto con D1.

---

## PULIR (funciona, pero es tosco o engañoso para la demo)

1. **Badges falsos en la interfaz.** El encabezado muestra un "3" de notificaciones fijo y los tabs
   llevan badges "1" y "2" hardcodeados ([`_layout.tsx`](../apps/mobile/app/(app)/_layout.tsx), zonas
   124–131 y `TabBadge count={1|2}`). En una demo al cliente parecen datos reales. Quitarlos o hacerlos
   reales.
2. **Coherencia de notificaciones.** El menú lateral marca "Notificaciones — Próximamente" (honesto,
   son la Semana 6), pero el encabezado muestra una campana con badge "3". Se contradicen: o las dos
   dicen "próximamente" o ninguna.
3. **Reportes en mock.** [`reportes.tsx`](../apps/mobile/app/(app)/reportes.tsx) usa `mock-data`. Está
   marcado en el código, pero en una demo conviene un cartel visible de "datos de ejemplo" o esconder
   la pantalla (exportar reportes es solo-Admin, Semana 7 del plan).
4. **Nombres y dimensiones provisionales.** Las plantas llevan `displayNameProvisional` y el % de
   llenado de tanques solo aparece donde el operador confirmó el nivel de lleno. Depende de la
   confirmación escrita de la planta (nombres, capacidades) — dependencia externa a gestionar.

---

## Verificar aparte (deuda del Mes 1, no son features de S1–4)

Esto no estaba entre los entregables de las semanas 1–4, pero es deuda del primer mes que conviene
cerrar antes de un piloto en planta:

- **Los 4 hallazgos críticos de la preproducción (14-jul) necesitan RE-VERIFICACIÓN**, no se dan por
  abiertos: el código de ingesta cambió desde el 15-jul (`toValueArray` ahora maneja `null → []` en
  [`opcua-connectivity.adapter.ts:386-389`](../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts#L386-L389),
  lo que sugiere que el `Number(null)→0` ya se atendió). Re-auditar hoy: `Faulted` terminal sin
  auto-recuperación, fuga de `OPCUAClient` en el `catch`, `Number(null)→0`, y `usable:true` con
  `value:null`. Un piloto no debería arrancar sin este barrido fresco.
- **Socket.IO sin autenticación** — la telemetría en vivo es legible por cualquier cliente con red al
  backend. El plan pone la revisión de seguridad en la Semana 9, pero el dato ya está fluyendo, así
  que el hueco está vivo ahora.

---

## Marcador de tareas S1–4 (al 21-jul)

| Tarea | 15-jul | 21-jul | Nota |
|---|---|---|---|
| S1 · Protocolo PLC (Hito 1) | ✅ | ✅ | Superado (ingeniería inversa, `docs/plc/`) |
| S1 · Documento de arquitectura | ✅ | ✅ | Implementado y testeado, no solo dibujado |
| S1 · Wireframes por rol | 🔄 | 🔄 | Sustituido por prototipo funcional |
| S2 · Servidor recibiendo datos del PLC | ✅ | ✅ | 10/12 plantas, 96 señales |
| S2 · BD (lecturas/usuarios/alertas/historial) | 🟡 | 🟡 | Usuarios ✅; historial/alertas → **D1** |
| S2 · Proyectos web + móvil | 🔄 | 🔄 | Expo web → **D2** |
| S3 · API tiempo real + historial | 🟡 | 🟡 | Tiempo real ✅; historial → **D1** |
| S3 · Login JWT en web y app | 🟡 | ✅ | **Cerrado**: login real E2E |
| S4 · Hito 2 (dato real en pantalla) | ✅ | ✅ | Adelantado y multiplicado |
| S4 · Roles funcionando | 🟡 | 🟡→✅ | Backend + login E2E ✅; falta solo Civil (TERMINAR 1-2) |
| S4 · Dashboard base por rol | 🟡 | 🟡 | Medidores/tablas reales ✅; gráficas → S6 |

**Hitos: 2/2.** Lo que mueve la aguja para cerrar el Mes 1 al 100% es: los dos puntos del Civil
(TERMINAR 1-2), la decisión D1, y formalizar D2 por escrito.

---

## Qué haría esta semana (recomendación priorizada)

1. **Decidir D1 con el cliente** — es lo único que bloquea a otros (Semana 5). Todo lo demás se puede
   ejecutar en paralelo; esto no.
2. **Cerrar el Civil (TERMINAR 1 y 2)** — es barato, y es lo que falta para que "roles funcionando"
   (S4-T10) quede realmente completo y no solo en el papel.
3. **Formalizar D2 por escrito** — cero código, cierra un flanco contractual.
4. **Pulir la demo (badges, coherencia de notificaciones, cartel en reportes)** — media hora, mucho
   efecto ante el cliente.
5. **Re-verificar los 4 críticos de preproducción** antes de hablar de piloto.

Las válvulas E2E (TERMINAR 3) y el motor de alertas (D3) son de mayor alcance y dependen del P0 y de
D1 respectivamente — no son para esta semana.
