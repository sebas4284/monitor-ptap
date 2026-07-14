# Fixtures de descubrimiento del PLC

Evidencia **congelada y versionada** de la topología del PLC maestro (FactoryTalk
Optix, `opc.tcp://181.204.165.66:59100`). Es el insumo de
[`scripts/generate-mapping.ts`](../scripts/generate-mapping.ts), que produce
`config/opc_mapping.json`.

Se versionan a propósito: el generador del contrato NO puede depender de
`tools/plc-discovery/output/`, que está gitignored y no existe en un clon limpio ni
en CI. Estos fixtures son pequeños, trackeados, y su diff es exactamente lo que se
quiere revisar en un PR cuando se recapture el PLC.

## Archivos (`plc-discovery/`)

| Fixture | Contenido (podado) | Origen |
|---|---|---|
| `nodes.json` | Por nodo: `nodeId, nsUri, browseName, parentNodeId, depth, rootLabel` + `namespaces`, `capturedAt` | `output/01_nodes.json` |
| `readings.json` | Por nodo: `nodeId, dataType, arrayLength` (se descartan valores y muestras) | `output/02_readings.json` |
| `connection-verification.json` | Por sitio: `confidence` + estado de `DN/ER/TO` leídos; `verifiedAt` | `output/phase0_verification.json` |

No contienen telemetría, valores de proceso ni secretos: solo estructura del espacio
de direcciones y el resultado de la verificación de comunicación.

## Recaptura (cuando el PLC cambie)

Desde `tools/plc-discovery/` (paquete standalone con `node-opcua`):

```bash
npm run endpoints      # 00 — preflight
npm run browse         # 01 — topología → output/01_nodes.json
npm run read           # 02 — atributos → output/02_readings.json
npx tsx src/verify-phase0.ts     # DN/ER/TO → output/phase0_verification.json
npx tsx src/build-fixtures.ts    # poda output/ → apps/api/fixtures/plc-discovery/
```

Luego, desde `apps/api/`:

```bash
npm run generate:mapping   # fixtures → config/opc_mapping.json
npm run validate:mapping   # valida el resultado
```

Reemplazar un fixture es un cambio **revisable por PR**: el diff muestra qué cambió en
el PLC (buffers nuevos, NodeIds movidos, sitios con/sin comunicación).
