# Informe de Integración OPC UA — PTAP AQUATECH

> El CompactLogix no controla directamente los equipos: intercambia BUFFERS DE ARRAY con los PLC locales de cada sitio mediante instrucciones MSG de Rockwell. Los datos de proceso llegan en arrays REAL/INT sin nombre por elemento; los comandos salen por arrays INT_OUT/REAL_OUT.

**Generado:** 2026-07-12 · **Método:** ingeniería inversa de SOLO LECTURA (Browse/Read)
**Servidor:** opc.tcp://181.204.165.66:59100 (FactoryTalkOptix HMI FTOptixApplication, estado Running)
**PLC:** CompactLogix 1769-L27ERM-QBFC1B, fw 33.16, vía `RAEtherNet_IPDriver1`

---

## 0. Advertencia de uso

Este informe documenta lo que el servidor OPC UA **realmente expone hoy**. Durante todo el proceso:

- ✅ Solo se usaron los servicios `GetEndpoints`, `Browse`, `BrowseNext` y `Read`.
- ❌ No se escribió ninguna variable. No se invocó ningún método. No se creó ninguna subscription.
- La garantía es estructural: el código accede al servidor a través de la fachada `ReadOnlySession`, cuyo tipo no expone `write`/`call`/`createSubscription`.

Todo lo marcado **REQUIERE VALIDACIÓN EN PLANTA** es una hipótesis, no un hecho. No debe usarse para control ni para poblar el frontend sin validarse antes.

---

## 1. Naturaleza del sistema

El proyecto es una **aplicación web de supervisión y operación remota de PTAP** (cliente HMI web sobre un Backend Gateway OPC UA). No es un visualizador puro: además de leer, ejecutará **comandos operativos autorizados** (abrir/cerrar válvulas, arrancar/parar bombas, reset de alarmas). Por eso el backend se diseña en dos dominios:

```
Operador → Frontend Web → Backend NestJS (Gateway OPC UA) → PLC Maestro → (MSG) → PLC locales
```

- **READ DOMAIN** — lee del PLC en tiempo real y devuelve datos. Sin telemetría histórica.
- **WRITE DOMAIN** — valida permiso → valida estado del proceso → escribe en OPC UA → confirma por feedback → **registra en bitácora de auditoría**.

---

## 2. Hallazgo arquitectónico principal

**El CompactLogix es un CONCENTRADOR (gateway), no un controlador de proceso directo.** No expone tags por equipo; intercambia **buffers de array por sitio remoto** con los PLC locales mediante instrucciones **MSG** de Rockwell.

Evidencia:

- Se detectaron 13 sitios remotos en los nombres de los buffers: ALTO_MANGOS, CAMPOALEGRE, CARBONERO, CASCAJAL, KM18, MANGOS, MONTEBELLO, PICHINDE, QUIJOTE, SAN_ANTONIO, SIRENA, SOLEDAD, VORAGINE
- Existen estructuras MESSAGE (MSG_READ_* / MSG_WRITE_*) de Rockwell, una por sitio y por tipo de dato, con sus bits DN/ER/TO
- Los buffers de datos son Variables únicas con valor de tipo array (ValueRank≥1), no colecciones de nodos hijos
- Los tags Local:N:C/I/O corresponden a los módulos de E/S del propio chasis CompactLogix

Ejemplo real capturado — `REAL_IN_VORAGINE` es un `Float[50]`:

```
[7.599, 395811.125, 0, 639.559, 0, 1.977, 85.428, 2.211, 123208.859, 0, 166.755, ...]
   ↑         ↑                ↑                    ↑
 ¿pH?   ¿totalizador?      ¿caudal?          ¿totalizador?     ← NINGÚN nombre confirma qué es cada índice
```

### Sitios remotos detectados (13)

| Sitio | Buffers | Buffers de salida | Comunicación |
|---|---|---|---|
| ALTO_MANGOS | 2 | 1 | SIN_DATO |
| CAMPOALEGRE | 3 | 1 | OK |
| CARBONERO | 3 | 1 | SIN_DATO |
| CASCAJAL | 3 | 1 | SIN_DATO |
| KM18 | 3 | 1 | SIN_DATO |
| MANGOS | 1 | 0 | SIN_DATO |
| MONTEBELLO | 7 | 2 | SIN_DATO |
| PICHINDE | 3 | 1 | SIN_DATO |
| QUIJOTE | 1 | 0 | SIN_DATO |
| SAN_ANTONIO | 1 | 0 | SIN_DATO |
| SIRENA | 6 | 1 | SIN_DATO |
| SOLEDAD | 5 | 2 | SIN_DATO |
| VORAGINE | 3 | 1 | SIN_DATO |

> **Cómo leer la columna Comunicación:** proviene de los bits `DN`/`ER`/`TO` de la instrucción `MSG_READ` de cada sitio. `DN` (Done) es un **pulso momentáneo** tras cada transacción exitosa, por lo que `SIN_DATO` **no** significa "sin datos": significa que en el instante exacto de la captura no se observó `DN=true` ni un error. Prueba de ello: `REAL_IN_VORAGINE` traía valores vivos (`[7.599, 395811.125, 639.559, …]`) aunque su fila figure como `SIN_DATO`. En el backend, este estado debe derivarse por **subscription** sobre los bits MSG (no por una lectura puntual) para reflejar correctamente la vigencia por sitio.
>
> **Nota de nomenclatura (requiere validación):** `MANGOS` (buffer `DATOS_REAL_IN_MANGOS`) es, con alta probabilidad, el mismo sitio que `ALTO_MANGOS`; se mantienen separados aquí por rigor (no se fusionan nombres sin confirmar). Igualmente, `REAL_TK_SAN_ANTONO` (sin la "i") se normalizó a `SAN_ANTONIO`.

---

## 3. La limitación que condiciona todo el proyecto

**El servidor OPC UA no expone la semántica del proceso.** Medido sobre 3402 variables:

| Metadato | Tags que lo declaran |
|---|---|
| EngineeringUnits | 0 |
| EURange | 0 |
| InstrumentRange | 0 |
| Description | 0 |

Además, el modelo de datos del propio HMI Optix está **vacío**: `AQUATECH/Model`, `AQUATECH/Alarms`, `AQUATECH/Converters` y `AQUATECH/Loggers` no tienen hijos. El proyecto Optix es una cáscara (solo contiene un `Label1` por defecto en la UI).

**Consecuencia:** el significado de cada índice de cada array **no es descubrible por OPC UA** y **no puede inferirse con certeza**. La herramienta produce hipótesis (a partir del valor, su rango y su dinámica) pero ninguna sustituye la fuente de verdad.

### 3.1 Fiabilidad del muestreo (hallazgo operativo)

De 34 buffers de array, 32 devolvieron BadInternalError al re-leerse (muestras 2 y 3). El driver RAEtherNet_IP de Optix hace fetch bajo demanda y no sostiene re-lecturas completas y frecuentes de todos los arrays a la vez. IMPLICACIÓN: la detección de movimiento/totalizadores por lectura puntual es NO CONCLUYENTE (solo la muestra 1 es fiable en muchos buffers); en producción, la evolución temporal DEBE observarse mediante una Subscription con MonitoredItems, no por polling agresivo de Read.

Es decir: se capturaron 3 muestras espaciadas 45 s, pero de 34 buffers de array, 32 devolvieron `BadInternalError` en la 2.ª y 3.ª lectura. Esto **no** es un fallo de la herramienta: es el driver `RAEtherNet_IP` de Optix, que sirve los tags bajo demanda y no sostiene re-lecturas masivas. **Refuerza directamente la decisión de arquitectura**: el refresco de datos en el backend debe hacerse por **Subscription** (el servidor empuja los cambios a su ritmo), nunca por polling agresivo de `Read`.

### 🔴 Requisito bloqueante

Para poblar el modelo de dominio con datos reales se necesita **una** de estas fuentes:

1. El **export L5X/ACD** del programa del PLC maestro (contiene la lógica que llena cada índice de cada buffer y las instrucciones MSG con sus tags de origen/destino).
2. La **tabla de mapeo del integrador** (índice → equipo → magnitud → unidad → escala) por sitio.

Sin una de ellas, el frontend debe seguir con datos simulados.

---

## 4. READ DOMAIN — diseño del adaptador OPC UA

Ubicación: `apps/api/src/infrastructure/connectivity/adapters/opcua/`. Implementa `ProtocolAdapterPort` + `IndustrialReaderPort` (puertos ya existentes; el HTTP/contrato no cambia).

### 4.1 Conexión (mismatch NAT confirmado)

El servidor anuncia `10.10.51.225:59100` pero se accede por `181.204.165.66:59100`. El adaptador **debe** crear el cliente con `endpointMustExist: false` para mantener el socket hacia la IP pública:

```ts
OPCUAClient.create({
  endpointMustExist: false,          // ← imprescindible por el NAT
  securityMode: MessageSecurityMode.None,     // el servidor acepta None + Anonymous
  securityPolicy: SecurityPolicy.None,
  connectionStrategy: { maxRetry: 3, initialDelay: 2000, maxDelay: 10000 },
  keepSessionAlive: true,
});
```

El servidor ofrece también endpoints `Basic256Sha256` y `Aes*` (Sign / SignAndEncrypt). Si en producción se exige seguridad, el certificado del cliente debe ser confiado en el almacén de Optix.

### 4.2 Resolución de NodeIds por URI de namespace (no por índice)

Los NodeIds de los tags son GUIDs bajo `ns=9` (`urn:...:FTOptixApplication`... en realidad `AQUATECH`). **El índice de namespace puede cambiar entre reinicios del servidor.** El adaptador debe, al conectar:

1. `readNamespaceArray()` → construir el mapa `uri → índice`.
2. Reconstruir los NodeIds de trabajo con el índice vigente.

Namespaces observados en esta captura:

- `ns=0` → `http://opcfoundation.org/UA/`
- `ns=1` → `urn:IOT_RURAL:FactoryTalkOptixHMI:FTOptixApplication`
- `ns=2` → `urn:FTOptix:Core`
- `ns=3` → `Temporary`
- `ns=4` → `urn:FTOptix:OPCUAServer`
- `ns=5` → `urn:FTOptix:RAEtherNetIP`
- `ns=6` → `urn:FTOptix:CommunicationDriver`
- `ns=7` → `urn:FTOptix:CoreBase`
- `ns=8` → `urn:FTOptix:UI`
- `ns=9` → `AQUATECH`
- `ns=10` → `urn:FTOptix:HMIProject`
- `ns=11` → `urn:FTOptix:Retentivity`
- `ns=12` → `urn:FTOptix:WebUI`
- `ns=13` → `urn:FTOptix:Alarm`
- `ns=14` → `urn:FTOptix:OPCUACommon`
- `ns=15` → `urn:FTOptix:OPCUAClient`

### 4.3 Lectura por array completo + subscription única

- Los buffers son **Variables con valor de tipo array**. Se lee/suscribe **el buffer entero** (un MonitoredItem por buffer) y el backend descompone el array en memoria. Suscribir índice por índice multiplicaría la carga por ~50 sin ganancia.
- **Una sola Subscription** para todo el sistema (ver `09_polling_strategy.json`).
- El backend traduce `buffer[índice]` → propiedad de dominio usando la **tabla de mapeo** (pendiente del requisito bloqueante).

### 4.4 Estado de conexión por sitio

`OpcSnapshot.connectionStatus` (y un estado por sitio) se deriva de los bits MSG: `connected = DN && !ER && !TO`. Es la **única** señal con semántica confirmada hoy, y debería usarse para marcar en el frontend los sitios cuyos datos no son vigentes.

---

## 5. WRITE DOMAIN — pipeline de comando

> ⚠️ **BLOQUEADO hasta validación en planta.** Todos los tags del servidor figuran como escribibles (`AccessLevel=3`), porque el driver de Optix expone todo con lectura+escritura por defecto. **La escritura NO distingue un comando**: hay que usar la dirección del buffer (`*_OUT_*` = maestro→PLC local) y, sobre todo, el mapa de índices. Escribir en el índice equivocado de un buffer OUT puede accionar un equipo real.

Buffers de salida (canal de comando) detectados: `DATOS_OUT_PTAP_SOLEDAD`, `INT_OUT_ALTO_MANGOS`, `INT_OUT_CAMPOALEGRE`, `INT_OUT_CARBONERO`, `INT_OUT_CASCAJAL`, `INT_OUT_KM18`, `INT_OUT_MONTEBELLO`, `INT_OUT_PICHINDE`, `INT_OUT_SIRENA`, `INT_OUT_SOLEDAD`, `INT_OUT_VORAGINE`, `REAL_OUT_MONTEBELLO`.

### Flujo propuesto (`IndustrialWriterPort.writeCommand`)

```
1. Validar permiso        → Role/Permission de @ptap/shared (control_valves, adjust_setpoints, acknowledge_alarms)
2. Validar estado         → leer interlocks/permissives del PLC (¿qué índices? → validación en planta)
3. Escribir en OPC UA     → buffer *_OUT_<SITIO>[índice] (índice → validación en planta)
4. Confirmar por feedback → releer el índice de estado que refleja el efecto (con timeout)
5. Registrar en bitácora  → control_audit_log (SIEMPRE, incluso si falla)
```

### Tabla de auditoría propuesta (MySQL)

No se almacena telemetría, pero **sí** toda acción de control — es liviana y aporta trazabilidad, seguridad y diagnóstico ("el usuario X abrió la válvula Y a las 14:32").

```sql
CREATE TABLE control_audit_log (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  user_id         VARCHAR(64)  NOT NULL,
  user_role       VARCHAR(16)  NOT NULL,   -- Role de @ptap/shared
  permission      VARCHAR(32)  NOT NULL,   -- Permission verificado
  site            VARCHAR(32)  NOT NULL,   -- sitio remoto (VORAGINE, ...)
  device_id       VARCHAR(64)  NOT NULL,   -- id de dominio del equipo
  command         VARCHAR(16)  NOT NULL,   -- open|close|start|stop|reset|setpoint
  node_id         VARCHAR(128) NOT NULL,   -- buffer OPC UA escrito
  array_index     INT          NULL,       -- índice dentro del buffer
  previous_value  DOUBLE       NULL,
  requested_value DOUBLE       NULL,
  confirmed       TINYINT(1)   NOT NULL DEFAULT 0,  -- eco de feedback dentro del timeout
  feedback_node   VARCHAR(128) NULL,
  result          VARCHAR(16)  NOT NULL,   -- ok|rejected|timeout|error
  error_detail    VARCHAR(255) NULL,
  INDEX idx_site_created (site, created_at),
  INDEX idx_user_created (user_id, created_at)
);
```

---

## 6. Configuración obsoleta a reemplazar

`apps/api/opc-config.json` declara 8 plantas ficticias (`ptap-1`…`ptap-8`) con endpoints `opc.tcp://plc-ptap-N:4840` y NodeIds `ns=2;s=PTAPN.Sensors` que **no existen**. La realidad es:

- **Un solo** endpoint: `opc.tcp://181.204.165.66:59100`.
- Los sitios reales son: ALTO_MANGOS, CAMPOALEGRE, CARBONERO, CASCAJAL, KM18, MANGOS, MONTEBELLO, PICHINDE, QUIJOTE, SAN_ANTONIO, SIRENA, SOLEDAD, VORAGINE.
- Los NodeIds reales son GUIDs bajo `ns=9`, resolubles por URI de namespace.

Debe reemplazarse por: un endpoint único + catálogo de sitios reales + la tabla de mapeo índice→equipo (cuando exista).

---

## 7. Estado del contrato con el frontend (`@ptap/shared`)

| Campo del frontend | ¿Fuente real hoy? |
|---|---|
| `OpcSnapshot.connectionStatus` | ✅ Sí — bits MSG (DN/ER/TO) |
| `PlantDefinition.id/name` | 🟡 Parcial — nombres de sitio ciertos, correspondencia con PTAP del negocio a confirmar |
| `Tank.levelM/percentage/volumeM3` | ❌ Índice desconocido |
| `Tank.maxLevelM/maxVolumeM3` | ❌ No está en el PLC (dato de ingeniería civil → configuración del backend) |
| `Sensor.value` | ❌ Índice desconocido |
| `Sensor.unit/min/max/name/icon` | ❌ No está en el PLC (metadatos de presentación → configuración del backend) |
| `Valve.isOpen` | ❌ Bit desconocido dentro de una palabra INT empaquetada |
| Acción abrir/cerrar válvula | ❌ BLOQUEADO — índice de comando desconocido |

Detalle campo por campo en `06_frontend_mapping.json`.

---

## 8. Lista de validaciones en planta (UAExpert / operador)

Cada señal con dato no nulo trae su procedimiento en `03_sensor_map.json`; cada comando candidato, en `04_commands.json`. Procedimiento general:

1. **Instrumentación de proceso** — En UAExpert, suscribir el buffer de entrada del sitio y, con un operador en campo, contrastar cada índice con la lectura física del instrumento (nivel real del tanque, caudalímetro, manómetro, analizador). Anotar índice → magnitud → unidad.
2. **Estados/válvulas (bits)** — Accionar el equipo localmente y observar qué bit de qué palabra `INT_IN_*`/`BIT_*` cambia. Anotar palabra + posición de bit.
3. **Comandos (buffers OUT)** — **Nunca** escribir desde el cliente para "probar". Determinar el índice de comando desde el export L5X y validarlo en ventana de mantenimiento con el equipo aislado, verificando el feedback.
4. **Escalas/unidades** — Tomar del L5X las instrucciones de escalamiento (SCL/CPT) de cada índice, o la hoja de instrumentación de la planta.

---

## 9. Recomendación de secuencia

1. **Conseguir el export L5X/ACD** del PLC maestro (y de al menos un PLC local) — desbloquea todo.
2. Construir la **tabla de mapeo** (`sitio, buffer, índice → equipo, magnitud, unidad, escala, límites`) como configuración del backend.
3. Implementar el **adaptador OPC UA de lectura** (sección 4) — el READ DOMAIN puede funcionar en cuanto exista el mapa.
4. Implementar el **WRITE DOMAIN con auditoría** (sección 5) — solo tras validar el mapa de comandos en planta.
5. Migrar el frontend de datos simulados a la API real, campo por campo, según `06_frontend_mapping.json`.

---

*Artefactos de respaldo (crudos, reproducibles): `tools/plc-discovery/output/00_endpoints.json`, `01_nodes.json`, `02_readings.json`, `03_analysis.json`. Documentos derivados: `01`–`09` `.json` en esta carpeta.*
