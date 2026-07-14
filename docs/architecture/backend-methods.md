# Backend methods and current structure

## Estado actual

Esta actualizacion crea solo la infraestructura inicial del backend. No implementa autenticacion real, JWT, MySQL, PLC real, OPC-UA real, alarmas, reportes reales ni control de electroválvulas.

El bridge industrial queda dentro de NestJS, bajo `apps/api/src/infrastructure/connectivity`. El antiguo `PlcModule` no se elimina, pero deja de estar conectado al `AppModule`.

## Flujo implementado

```txt
apps/api/opc-config.json
  -> OpcConfigService
  -> SimulatorConnectivityAdapter
  -> ConnectivityService
  -> polling cada 5 segundos
  -> snapshot normalizado en memoria
  -> REST: GET /api/snapshots/:plantId
  -> Socket.io: evento opc:snapshot
```

`opc-config.json` es una fuente temporal de configuracion. Representa 8 PTAPs, sus endpoints OPC-UA previstos, NodeIds, indices de sensores e indices de tanques. MySQL debe reemplazarlo en una fase posterior.

## REST

### `GET /api/health`

Metodo existente para validar que el API levanta.

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "ptap-api",
  "sharedRoles": 4
}
```

### `GET /api/snapshots/:plantId`

Devuelve el ultimo snapshot normalizado de una PTAP.

Ejemplo:

```txt
GET /api/snapshots/ptap-1
```

Respuesta conceptual:

```json
{
  "plantId": "ptap-1",
  "timestamp": "2026-07-08T00:00:00.000Z",
  "connectionStatus": "mock",
  "sensors": [],
  "tanks": []
}
```

`valves` queda omitido mientras no exista el mapa real de bits para electroválvulas empaquetadas en arrays INT.

## Socket.io

### Evento de suscripcion

```txt
client -> server: opc:subscribe
```

Payload:

```json
{
  "plantId": "ptap-1"
}
```

El gateway agrega el socket a una sala con el id de la PTAP. Si el cliente cambia de PTAP, se sale de salas `ptap-*` anteriores antes de unirse a la nueva.

### Evento de snapshot

```txt
server -> client: opc:snapshot
```

Payload:

```json
{
  "plantId": "ptap-1",
  "timestamp": "2026-07-08T00:00:00.000Z",
  "connectionStatus": "mock",
  "sensors": [],
  "tanks": []
}
```

El servidor emite snapshots solo a la sala de la PTAP correspondiente.

## Servicios y puertos backend

### `ConnectivityService`

Responsabilidades:

- iniciar el adapter de conectividad al levantar el modulo;
- leer snapshots de todas las PTAPs configuradas cada 5 segundos;
- guardar el ultimo snapshot por PTAP en memoria;
- exponer `getSnapshot(plantId)`;
- emitir cada snapshot mediante `snapshot$` para el gateway WebSocket.

### `IndustrialReaderPort`

Contrato para lectura industrial:

```txt
listPlants()
readSnapshot(plantId)
```

Los modulos de negocio deben depender de este puerto o de servicios que lo encapsulen, no de librerias OPC-UA directamente.

### `IndustrialWriterPort`

Contrato reservado para comandos industriales futuros.

En Fase 1 no se habilita escritura real porque las electroválvulas tienen bits empaquetados sin mapeo confirmado.

### `ProtocolAdapterPort`

Contrato para ciclo de vida del protocolo:

```txt
connect()
disconnect()
getStatus()
```

### `SimulatorConnectivityAdapter`

Adapter temporal para Fase 1.

Genera sensores y tanques simulados a partir de `opc-config.json`. Su `connectionStatus` es `mock`, para dejar claro que no hay PLC real conectado.

## Seguridad preparada

### `PasswordHashingService`

Servicio preparado para una fase futura de autenticacion real.

No registra usuarios ni valida sesiones. Solo deja listo el mecanismo de hashing:

```txt
password plano
  -> HMAC-SHA256 con pepper secreto
  -> Argon2id con salt automatico
  -> password_hash + password_pepper_version
```

Variables esperadas:

```env
PASSWORD_PEPPER_CURRENT_VERSION=1
PASSWORD_PEPPER_V1_BASE64=
```

Reglas:

- el pepper debe decodificar exactamente 64 bytes;
- el pepper no se guarda en MySQL;
- el pepper no se expone al frontend;
- el hash final de Argon2id incluye su salt;
- MySQL futuro solo debe guardar `password_hash` y `password_pepper_version`.

## Pendientes explicitos

- Reemplazar `opc-config.json` por MySQL cuando se apruebe persistencia.
- Implementar adapter OPC-UA real con `node-opcua`.
- Mapear bits reales de electroválvulas antes de exponer control.
- Conectar `telemetry`, `commands`, `alarms` y `reports` de forma progresiva.
- Implementar autenticacion real, JWT y permisos en una fase posterior.
