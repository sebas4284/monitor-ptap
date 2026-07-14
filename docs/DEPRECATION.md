# Deprecaciones agendadas

Este documento existe para que no queden **dos caminos de datos vivos** sin que nadie
sepa cuál es el bueno. Todo lo listado aquí está marcado para eliminación en una fase
concreta. **Prohibido añadir consumidores nuevos** a estos símbolos.

## Camino de datos legado (pre-puente crudo)

Antes del puente `ConnectivityAdapter` (Fase 1) existía un camino de dominio provisional
que sintetiza `OpcSnapshot`/`PlantDefinition` para las rutas móviles existentes. Convive
hoy con el puente crudo, pero desaparece cuando el **Mapping Engine (Fase 3)** produzca
los DTOs de dominio de verdad.

| Símbolo | Archivo | Reemplazo |
|---|---|---|
| `IndustrialReaderPort` | `apps/api/src/infrastructure/connectivity/ports/industrial-reader.port.ts` | Snapshot Builder + PlantCache (Fase 3) |
| `IndustrialWriterPort` | `apps/api/src/infrastructure/connectivity/ports/industrial-writer.port.ts` | Write Service tras feature flag (Fase 5) |
| `ProtocolAdapterPort` | `apps/api/src/infrastructure/connectivity/ports/protocol-adapter.port.ts` | `ConnectivityAdapter` (ya existe) |
| `SimulatorConnectivityAdapter` | `apps/api/src/infrastructure/connectivity/adapters/simulator/simulator-connectivity.adapter.ts` | `SimulatorBridgeAdapter` (ya existe; implementa `ConnectivityAdapter`) |
| `ConnectivityService` (poller + `snapshot$`) | `apps/api/src/infrastructure/connectivity/connectivity.service.ts` | Snapshot Builder + Socket.IO sobre el puente crudo (Fase 2/3) |
| Tokens `INDUSTRIAL_READER`, `INDUSTRIAL_WRITER`, `PROTOCOL_ADAPTER` | `connectivity.tokens.ts` / `connectivity.module.ts` | `CONNECTIVITY_ADAPTER` (ya existe) |

### Qué alimentan hoy (no romper hasta migrar)

- `GET /api/plants` y `GET /api/snapshots/:plantId` → `ConnectivityService` → `IndustrialReaderPort`.
- `ConnectivityGateway` emite `opc:snapshot` desde `ConnectivityService.snapshot$` (poller legado),
  **no** desde el puente crudo `RawPlantFrame`.

### Condición de eliminación

Cuando la Fase 3 tenga el Mapping Engine + Snapshot Builder y el frontend consuma los DTOs
nuevos (`GET /api/plants/:plantId/snapshot` + `opc:snapshot` sobre el puente crudo), se
eliminan los símbolos de la tabla en el mismo PR y se actualiza este documento.

> **Nota (regla 5):** el *simulador* NO se elimina — `SimulatorBridgeAdapter` es el testbed
> permanente sin PLC. Lo que se depreca es el `SimulatorConnectivityAdapter` legado, que
> implementa los ports viejos, no el puente simulado.
