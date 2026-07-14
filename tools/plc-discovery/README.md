# @ptap/plc-discovery

Herramienta de ingeniería inversa de **SOLO LECTURA** del PLC CompactLogix 1769-L27ERM-QBFC1B expuesto por FactoryTalk Optix (`opc.tcp://181.204.165.66:59100`). Genera la documentación de integración en `docs/plc/`.

## Reglas de seguridad (no negociables)

- **Nunca** ejecuta Write ni Call de Methods.
- **Nunca** crea Subscriptions ni MonitoredItems.
- Solo usa los servicios OPC UA: `GetEndpoints`, `Browse`, `BrowseNext`, `Read`.
- La garantía es estructural: todos los pasos reciben la fachada `ReadOnlySession`
  ([src/lib/readonly-session.ts](src/lib/readonly-session.ts)), cuyo tipo **no expone** write/call/createSubscription.
- Una sola sesión por ejecución, `maxRetry: 2` (sin tormentas de reconexión contra el HMI de producción),
  throttling entre lotes y lotes acotados por los `OperationLimits` del servidor.

## Peculiaridad NAT

El servidor anuncia internamente `10.10.51.225`; el acceso real es `181.204.165.66`.
El cliente usa `endpointMustExist: false` (workaround canónico de node-opcua) y mantiene el socket
hacia la dirección externa.

## Instalación

Este paquete es **standalone** (NO es workspace del monorepo, a propósito: no toca el lockfile root ni `apps/api`).

```bash
cd tools/plc-discovery
npm install
```

Si el preflight indica que el servidor no acepta Anonymous, copiar `.env.example` a `.env` y poner `OPC_USERNAME`/`OPC_PASSWORD` (nunca se commitean). Si el servidor solo expone endpoints firmados/cifrados, el certificado autogenerado en `pki/` debe ser confiado en el almacén de certificados de FactoryTalk Optix por el administrador de la planta.

## Ejecución por etapas

| Etapa | Comando | Red | Salida |
|---|---|---|---|
| 00 preflight (GATE) | `npm run endpoints` | sí | `output/00_endpoints.json` |
| 01 browse recursivo | `npm run browse` | sí | `output/01_nodes.json` |
| 02 atributos + muestras | `npm run read` | sí | `output/02_readings.json` |
| 03 análisis heurístico | `npm run analyze` | **no** | `output/03_analysis.json` |
| 04 entregables | `npm run generate` | **no** | `docs/plc/*.json` + `10_integration_report.md` |
| todo en orden | `npm run discover` | sí | todo lo anterior |

Las etapas 03/04 son offline y re-ejecutables sin tocar el servidor: se puede iterar el análisis libremente sobre los artefactos capturados.

## Advertencia

Todo ítem cuya función no pueda determinarse con certeza queda marcado
`"REQUIERE VALIDACIÓN EN PLANTA"` con el procedimiento UAExpert exacto para confirmarlo.
Ningún comando se considera confirmado sin esa validación; la herramienta jamás escribe para "probar".
