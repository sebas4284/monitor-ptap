# Monitor PTAP

Sistema de **monitoreo en tiempo real de 13 Plantas de Tratamiento de Agua Potable (PTAP)**,
conectadas a través de un PLC maestro Allen-Bradley expuesto por un servidor **FactoryTalk
Optix OPC UA**. El backend lee los buffers crudos del PLC, los procesa por un pipeline de
capas y los publica a la app móvil/web por REST y Socket.IO.

> **Estado real (2026-07):** el puente OPC UA está **vivo contra el PLC real**. El caudal de
> entrada de Montebello viaja de punta a punta (PLC → backend → móvil) en tiempo real. La
> telemetría vive **solo en RAM** (nunca se persiste). El resto de señales sigue sin mapear
> hasta obtener el export L5X del PLC.

---

## Índice

1. [Propósito y alcance](#propósito-y-alcance)
2. [Arquitectura](#arquitectura)
3. [Índice del repositorio](#índice-del-repositorio)
4. [Stack técnico y por qué](#stack-técnico-y-por-qué)
5. [Requisitos previos](#requisitos-previos)
6. [Instalación](#instalación)
7. [Configuración (.env)](#configuración-env)
8. [Cómo levantar el proyecto](#cómo-levantar-el-proyecto)
9. [API REST y eventos Socket.IO](#api-rest-y-eventos-socketio)
10. [Pruebas, typecheck y scripts de mapping](#pruebas-typecheck-y-scripts-de-mapping)
11. [Reglas de dominio y convenciones](#reglas-de-dominio-y-convenciones)
12. [Guía para nuevos desarrolladores](#guía-para-nuevos-desarrolladores)
13. [Documentación de referencia](#documentación-de-referencia)

---

## Propósito y alcance

El operador debe poder ver el estado real de cada PTAP **sin que el tablero mienta**: un dato
congelado debe verse como congelado, un valor inferido no debe verse igual que uno confirmado,
y una señal en la que no confiamos no se muestra como número. Ese principio de honestidad
atraviesa todo el diseño.

- **Sí hace:** leer buffers OPC UA, detectar frescura por planta, mapear señales conocidas a
  dominio, evaluar calidad, exponer DTOs por REST + push por Socket.IO.
- **No hace (por ahora):** escribir al PLC (prohibido hasta Fase 5), persistir telemetría en
  MySQL, ni inventar semántica de señales sin evidencia documental.

---

## Arquitectura

Flujo obligatorio de capas, sin saltos:

```
PLC (Allen-Bradley + FactoryTalk Optix OPC UA)
  │  opc.tcp://181.204.165.66:59100  (Anonymous + SecurityPolicy None — hallazgo P0)
  ▼
OPC UA Adapter ──────────► emite RawPlantFrame por planta (coalescido)
  │   (1 MonitoredItem por buffer; watchdog + heartbeat + máquina de estados)
  ▼
FrameCoalescer  → un frame por planta por ventana (no uno por buffer)
  ▼
Parser + Sequence  → RawSnapshot { plantId, sequence, buffers } + DeadLetter de anómalos
  ▼
Liveness (4 estados: live | idle | stale | unknown, por frescura de datos)
  ▼
Mapping Engine  → buffer+index → domainKey (desde config/opc_mapping.json)
  ▼
Quality Service → usable / reason (rango, NaN, calidad OPC, frescura)
  ▼
Snapshot Builder → PlantSnapshotDto (DTO de dominio)
  ▼
PlantCache (RAM, único escritor)
  ▼
REST  +  Socket.IO  ────────►  App móvil / web (Expo)
```

**Estado del puente** = máquina de estados explícita (`BridgeStatus`), nunca un boolean:
`Connecting | Connected | Recovering | Stale | Disconnected | Faulted`. Toda transición pasa
por una única clase (`BridgeStateMachine`) y se registra con timestamp y motivo.

Dos adaptadores implementan el mismo puerto `ConnectivityAdapter` y se eligen con
`CONNECTIVITY_PROVIDER`:
- **`opcua`** → PLC real (`OpcUaConnectivityAdapter`).
- **`simulator`** → testbed sin PLC (`SimulatorBridgeAdapter`), capaz de emular todos los
  estados del bridge (Stale, Faulted, reciclaje, heartbeat).

---

## Índice del repositorio

```txt
monitor-ptap/
├── apps/
│   ├── api/                         # Backend NestJS (bridge OPC UA + pipeline + REST + Socket.IO)
│   │   ├── config/
│   │   │   ├── opc_mapping.json          # Contrato de mapping (fuente de semántica; NO editar a mano)
│   │   │   └── opc_mapping.schema.json   # JSON Schema del mapping
│   │   ├── fixtures/plc-discovery/       # Evidencia congelada de topología (fuente del generador)
│   │   ├── scripts/
│   │   │   ├── generate-mapping.ts       # Genera opc_mapping.json (idempotente)
│   │   │   ├── validate-mapping.ts       # Valida schema + reglas semánticas
│   │   │   ├── resolve-namespaces.ts     # nsUri → índice de namespace
│   │   │   └── read-opcua-node.ts        # Lectura puntual de un nodo (debug)
│   │   ├── src/
│   │   │   ├── main.ts                    # Arranque COMPLETO (requiere MySQL)
│   │   │   ├── main.telemetry.ts          # Arranque de TELEMETRÍA (bridge+pipeline+REST+socket, sin BD)
│   │   │   ├── config/load-env.ts         # Carga .env de la raíz del monorepo
│   │   │   ├── infrastructure/
│   │   │   │   ├── database/               # Pool MySQL (solo auth/usuarios/auditoría)
│   │   │   │   └── connectivity/           # ★ El corazón del sistema
│   │   │   │       ├── adapters/opcua/     #   Adaptador OPC UA real
│   │   │   │       ├── adapters/simulator/ #   Adaptador simulado (testbed)
│   │   │   │       ├── bridge/             #   watchdog, heartbeat-monitor, frame-coalescer, state-machine
│   │   │   │       ├── pipeline/           #   parser/liveness/mapping/quality/snapshot/cache/dead-letter
│   │   │   │       ├── ports/              #   Contratos (ConnectivityAdapter + legacy deprecados)
│   │   │   │       ├── mapping/            #   Loader de opc_mapping.json
│   │   │   │       ├── connectivity.config.ts    # TODA la config OPC/liveness desde .env
│   │   │   │       ├── connectivity.module.ts    # Wiring DI
│   │   │   │       ├── connectivity.gateway.ts   # Socket.IO (opc:snapshot / opc:liveness)
│   │   │   │       ├── bridge-orchestrator.service.ts  # Ciclo de vida + retry del adaptador
│   │   │   │       └── opc.controller.ts   # /api/opc/status|info|buffers|dead-letter
│   │   │   └── modules/                    # Dominios HTTP: plants, snapshots, health, auth, users…
│   │   └── test/                          # Suite (node:test + tsx): bridge, pipeline, coalescer, heartbeat…
│   └── mobile/                       # App Expo (Android / iOS / Web)
│       ├── app/                          # Rutas (expo-router): (auth)/login, (app)/sensores…
│       ├── components/                   # LiveBadge, SignalCard, PlantSelector…
│       ├── hooks/                        # useSnapshot (REST + Socket.IO), useTanques…
│       ├── services/
│       │   ├── api.ts                     # Cliente REST REAL (cero mocks)
│       │   ├── socket.ts                  # Cliente Socket.IO
│       │   ├── mock-data.ts               # Placeholders de features sin mapear (tanques/válvulas/reportes)
│       │   └── auth.ts                    # Stub de auth (backend JWT fuera de alcance)
│       ├── context/                      # PlantContext (12 slugs canónicos), AuthContext
│       └── constants/colors.ts
├── packages/
│   └── shared/                      # @ptap/shared: roles, permisos y tipos compartidos (única fuente)
├── tools/
│   └── plc-discovery/               # Herramienta standalone de ingeniería inversa OPC UA (solo lectura)
├── docs/                            # Documentación técnica, hallazgos y evidencia (ver §13)
├── .env / .env.example             # Configuración local (el .env NO se commitea)
└── package.json                    # Workspaces + scripts del monorepo
```

---

## Stack técnico y por qué

| Área | Elección | Motivo |
|------|----------|--------|
| **Monorepo** | npm workspaces (`apps/*`, `packages/*`) | Sin herramienta extra; comparte tipos vía `@ptap/shared`. |
| **Lenguaje** | TypeScript estricto (sin `any` silencioso) | Errores tipados por capa; contrato explícito PLC↔dominio↔front. |
| **Backend** | NestJS 11 + Express | DI e inyección por módulos encajan con la arquitectura de capas. |
| **OPC UA** | `node-opcua` | Cliente OPC UA maduro (Subscriptions, MonitoredItems, PKI, reconexión). |
| **Tiempo real** | Socket.IO 4 (`@nestjs/platform-socket.io`) | Push por planta solo en cambios; el front no hace polling. |
| **Base de datos** | MySQL (`mysql2`) | **Solo** auth/usuarios/auditoría/config. **Nunca** telemetría (regla 1). |
| **Runtime dev** | `tsx` | Ejecuta TS sin build; `tsx watch` para hot-reload. |
| **Tests** | Runner nativo `node:test` + `tsx` (no Jest) | Cero config; rápido; suficiente para lógica pura y de temporizadores. |
| **Mapping** | JSON + JSON Schema (`ajv`) + generador idempotente | La semántica vive en datos versionados, no en el código (regla 2). |
| **Móvil** | Expo ~56 + React Native 0.85 + expo-router | Un solo código para Android/iOS/Web. |
| **Estado datos móvil** | TanStack React Query 5 | Cache + estados de carga; el socket parchea la cache. |
| **Estilos móvil** | NativeWind 4 (Tailwind) + estilos inline | Consistencia visual sin CSS aparte. |
| **Formato config PLC** | `opc_mapping.json` con `{ nsUri, identifier }` sin índice de ns | El índice de namespace de Optix cambia entre reinicios → se resuelve en runtime. |
| **Timestamps** | `SourceTimestamp` del PLC, nunca `Date.now()` para proceso (regla 7) | El dato lleva la hora del PLC; `receivedAt` es solo metadato de transporte. |

---

## Requisitos previos

- **Node.js ≥ 20** (probado en 24). Incluye `npm`.
- **Git Bash** o PowerShell (Windows).
- **MySQL** corriendo en `127.0.0.1:3306` — **solo** si vas a levantar el backend COMPLETO
  (`main.ts`). El arranque de **telemetría** no lo necesita.
- **Acceso de red** al PLC (`opc.tcp://181.204.165.66:59100`) para el modo `opcua`.
  Sin red al PLC, usa `CONNECTIVITY_PROVIDER=simulator`.
- Para el móvil: la app **Expo Go** en un dispositivo, un emulador, o simplemente el navegador
  (modo web).

---

## Instalación

Desde la raíz del monorepo (instala todos los workspaces):

```bash
npm install
```

---

## Configuración (.env)

El backend lee un **único `.env` en la raíz** del monorepo (`monitor-ptap/.env`). Copia el
ejemplo y ajústalo:

```bash
cp .env.example .env
```

Claves relevantes (todas documentadas en `.env.example`):

| Variable | Default | Para qué |
|----------|---------|----------|
| `CONNECTIVITY_PROVIDER` | `opcua` | `opcua` (PLC real) o `simulator` (sin PLC). |
| `OPC_ENDPOINT` | `opc.tcp://181.204.165.66:59100` | Endpoint OPC UA. |
| `OPCUA_PUBLISHING_INTERVAL_MS` | `1000` | Ritmo de publicación de la Subscription. |
| `OPCUA_SAMPLING_INTERVAL_MS` | `500` | Muestreo del servidor. |
| `OPCUA_COALESCE_WINDOW_MS` | `1000` | Ventana de coalescing (un frame por planta). |
| `OPCUA_REQUESTED_LIFETIME_COUNT` / `..._MAX_KEEPALIVE_COUNT` | `100` / `10` | Vida de la Subscription (lifetime ≥ 3×keepalive o el backend no arranca). |
| `OPCUA_HEARTBEAT_MAX_FAILURES` | `2` | Fallos consecutivos → `Recovering`. |
| `LIVENESS_LIVE_SEC` / `LIVENESS_WINDOW_SEC` | `10` / `300` | Umbrales de frescura (live / stale). |
| `DB_PASSWORD` | *(vacío)* | **Obligatorio solo para el backend COMPLETO** (`main.ts`). |

> El móvil apunta por defecto a `http://localhost:4000`. Para un **dispositivo físico**, pon la
> IP LAN del backend en `apps/mobile/app.json` → `expo.extra.apiBaseUrl`.

---

## Cómo levantar el proyecto

### Opción rápida (demo del caudal, sin MySQL)

Dos terminales:

```bash
# Terminal 1 — backend de telemetría (bridge + pipeline + REST + Socket.IO) en :4000
npm run start:telemetry -w @ptap/api

# Terminal 2 — app móvil en el navegador
npm run web -w @ptap/mobile
```

Abre la web de Expo, selecciona **Montebello** y verás los dos caudales (`inletFlow1`,
`inletFlow2`) en l/s, marcados como *inferido*, con el badge en verde (**EN VIVO**). Los sitios
congelados aparecen como `unknown`.

### Arranque independiente por parte

| Qué | Comando | Notas |
|-----|---------|-------|
| **Backend telemetría** (sin BD) | `npm run start:telemetry -w @ptap/api` | Bridge + pipeline + REST + Socket.IO en `:4000`. |
| **Backend completo** (con BD) | `npm run dev:api` *(raíz)* | `tsx watch src/main.ts`. Requiere `DB_PASSWORD` en `.env`. |
| **Móvil (Expo, todo)** | `npm run dev:mobile` *(raíz)* | `expo start` (elige Android / iOS / web). |
| **Móvil (solo web)** | `npm run web` *(raíz)* | `expo start --web`. |
| **Modo simulador** (sin PLC) | `CONNECTIVITY_PROVIDER=simulator npm run start:telemetry -w @ptap/api` | Emula frames y estados del bridge. |

> **`main.ts` vs `main.telemetry.ts`:** `main.ts` monta toda la app (auth, usuarios, reportes…)
> y por eso exige MySQL. `main.telemetry.ts` monta **solo** el slice de telemetría — todo lo que
> el móvil necesita para el caudal — y no toca la base de datos.

---

## API REST y eventos Socket.IO

Prefijo global: **`/api`**.

### REST (pipeline de dominio)

| Método · Ruta | Devuelve |
|---------------|----------|
| `GET /api/plants` | Lista de las 12 plantas con su `liveness` y `bridgeStatus`. |
| `GET /api/plants/:plantId/snapshot` | `PlantSnapshotDto` desde cache RAM (<50 ms; nunca toca el PLC). |

### REST (observabilidad del puente)

| Método · Ruta | Devuelve |
|---------------|----------|
| `GET /api/opc/status` | Diagnóstico: bridgeStatus, notificaciones, reconexiones, heartbeat, por planta. |
| `GET /api/opc/info` | Metadata del servidor OPC UA. |
| `GET /api/opc/buffers` | Salud por buffer (NodeId resuelto o faulted). |
| `GET /api/opc/dead-letter` | Señales anómalas descartadas (regla 12), con contadores. |

### Socket.IO

- Cliente emite: `opc:subscribe` `{ plantId }` → entra a la room de la planta y recibe su snapshot actual.
- Servidor emite: `opc:snapshot` (por planta, **solo en cambios**) y `opc:liveness` (broadcast, en cambios de estado).

### DTO principal (`PlantSnapshotDto`)

```jsonc
{
  "plantId": "montebello",
  "displayName": "Montebello",
  "sequence": 22,               // monótono por planta; el cliente detecta huecos
  "bridgeStatus": "Connected",
  "liveness": { "state": "live", "lastChangeAt": "…", "windowSec": 300 },
  "signals": {
    "inletFlow1": {
      "value": 14.19, "unit": "l/s", "quality": "Good",
      "usable": true, "mappingStatus": "mapped", "confidence": "inferred",
      "label": "Caudal de entrada 1", "ts": "…"   // SourceTimestamp del PLC
    }
  }
}
```

> Rutas **legacy** (deprecadas, ver `docs/DEPRECATION.md`): `GET /api/snapshots/:plantId`,
> `GET /api/health`.

---

## Pruebas, typecheck y scripts de mapping

```bash
# Typecheck de todos los workspaces
npm run typecheck                     # (raíz)

# Suite del backend (node:test + tsx) — 61 tests
npm test -w @ptap/api
#   subgrupos:
npm run test:bridge   -w @ptap/api    # watchdog, heartbeat, coalescer, state machine, config
npm run test:pipeline -w @ptap/api    # liveness, quality, mapping engine, cache/sequence
npm run test:mapping  -w @ptap/api    # contrato opc_mapping.json contra el schema

# Mapping (la semántica vive en datos, no en código)
npm run generate:mapping -w @ptap/api # regenera config/opc_mapping.json (idempotente)
npm run validate:mapping -w @ptap/api # valida schema + reglas semánticas
```

---

## Reglas de dominio y convenciones

Reglas que **nunca** se rompen (resumen):

1. **Cache solo en RAM.** El backend no persiste telemetría en MySQL (solo auth/usuarios/config).
2. **Cero números mágicos de índice** en el código: toda semántica vive en `opc_mapping.json`.
3. El OPC UA Adapter **no conoce la PTAP**: solo endpoints, NodeIds y buffers.
4. El frontend **nunca recibe arrays crudos**: solo DTOs de dominio.
5. El simulador **no se elimina**: es el testbed permanente.
6. **Un MonitoredItem por buffer** (nodo array completo), nunca uno por elemento.
7. **SourceTimestamp del PLC**, nunca `Date.now()` para datos de proceso.
8. **Toda la config OPC sale de `.env`**: cero valores quemados.
9. **Escritura al PLC prohibida** hasta Fase 5 (feature flag + sesión segura).
10. Cada dato lleva `value`, `quality`, `usable`, `mappingStatus`, `confidence` y `sourceTimestamp`.
    Un `inferred` **no** se presenta igual que un `confirmed`.
11. Estado del bridge = máquina de estados explícita, con transiciones registradas.
12. **Nada se pierde en silencio**: lo anómalo va al DeadLetter (consultable por endpoint admin).

**Identidad de planta:** el `plantId` (slug canónico) es la única identidad en todo el sistema
(los 12 slugs: `voragine, soledad, montebello, cascajal, km18, alto-los-mangos, campoalegre,
pichinde, carbonero, sirena, san-antonio, quijote`). Nada de `PTAP Norte` ni `ptap-1`.

---

## Guía para nuevos desarrolladores

- **Entender el puente:** empieza por `apps/api/src/infrastructure/connectivity/` — es el corazón.
  Los adaptadores (`adapters/`) hablan OPC UA; el `pipeline/` transforma buffers en DTOs.
- **Añadir una pantalla móvil:** crea una ruta en `apps/mobile/app/(app)/`.
- **Consumir datos en el móvil:** usa `hooks/useSnapshot.ts` (REST + Socket.IO ya integrados).
- **Mapear una señal nueva:** edítala en `apps/api/scripts/generate-mapping.ts`
  (`SIGNALS_BY_SITE`) y corre `npm run generate:mapping`. **Nunca** edites `opc_mapping.json` a mano.
- **Tipos/roles/permisos compartidos:** agrégalos en `packages/shared/src/index.ts` e impórtalos
  desde `@ptap/shared` en ambos lados.
- **Config nueva del PLC:** añádela en `connectivity.config.ts` leyéndola de `.env` (regla 8).

---

## Documentación de referencia

| Documento | Contenido |
|-----------|-----------|
| `docs/FLOW_VALIDATION.md` | Validación en vivo del caudal de Montebello contra el PLC (evidencia de la inferencia). |
| `docs/PHASE0_VERIFICATION.md` | Evidencia de solo-lectura que respalda el contrato de mapping. |
| `docs/LIVENESS_OBSERVATION.md` | Por qué el `connectionStatus` se mide por frescura de datos (4 estados). |
| `docs/MSG_BITS_OBSERVATION.md` | Por qué los bits DN/ER/TO quedan descartados como fuente de estado. |
| `docs/SECURITY_FINDING_P0.md` | Hallazgo P0: el servidor OPC UA acepta Anonymous + None. |
| `docs/DEPRECATION.md` | Símbolos legacy agendados para eliminación (Fase 3). |
| `docs/architecture/` | Métodos y estructura del backend. |
| `docs/api/openapi.yaml`, `docs/postman/` | Contrato de API. |
| `tools/plc-discovery/` | Ingeniería inversa OPC UA (10 entregables en `docs/plc/`). |
