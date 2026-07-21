/**
 * Generador reproducible de config/opc_mapping.json.
 *
 * Fuente de datos: FIXTURES VERSIONADOS en apps/api/fixtures/plc-discovery/
 * (NUNCA tools/plc-discovery/output/, que está gitignored). Los fixtures son
 * evidencia congelada de topología, trackeada en git; se recapturan corriendo el
 * tool de discovery + build-fixtures (ver apps/api/fixtures/README.md).
 *   - nodes.json                    topología + nsUri de cada nodo
 *   - readings.json                 dataType y arrayLength de cada buffer
 *   - connection-verification.json  confidence real de connection (DN/ER/TO leídos)
 *
 * Reglas del contrato:
 *   - Las referencias a nodos NO llevan índice de namespace: { nsUri, identifier }.
 *   - Se omiten los canales que un sitio no tiene (nunca arrays vacíos).
 *   - displayNameProvisional siempre presente.
 *   - connection.confidence proviene de la verificación por lectura, no se asume.
 *   - MANGOS y ALTO_MANGOS se fusionan; SAN_ANTONO se normaliza a san-antonio.
 *   - El adaptador de Fase 1 DEBE resolver nsUri → índice (ver scripts/resolve-namespaces.ts)
 *     en cada conexión y reconexión; un nsUri no resuelto ⇒ BridgeStatus = Faulted.
 *
 * Idempotente: dos corridas consecutivas producen el mismo archivo byte a byte.
 * Ejecutar: npm run generate:mapping
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FIX_DIR = join(__dirname, '..', 'fixtures', 'plc-discovery');
const DEST = join(__dirname, '..', 'config', 'opc_mapping.json');

interface NodeRow {
  nodeId: string;
  nsUri: string;
  browseName: string;
  parentNodeId: string;
  depth: number;
  rootLabel: string;
}
interface NodesDoc { capturedAt: string; namespaces: string[]; nodes: NodeRow[] }
interface ReadingRow { nodeId: string; dataType: string | null; arrayLength: number | null }
interface ReadingsDoc { endpointUrl: string; readings: ReadingRow[] }
interface VerifyConn { site: string; confidence: 'confirmed' | 'inferred' }
interface VerifyDoc { verifiedAt: string; connections: VerifyConn[] }

interface NodeReference { nsUri: string; identifier: string }
interface BufferDescriptor { browseName: string; node: NodeReference; arrayLength: number | null; dataType: string | null }

interface SignalDef {
  buffer: string;
  /** browseName exacto del buffer fuente. Obligatorio si el canal tiene buffers empatados en tamaño. */
  sourceBuffer?: string;
  index: number;
  domainKey: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Rango operativo/normativo (alarmas futuras). Fuera de él la lectura SIGUE siendo usable. */
  opMin?: number;
  opMax?: number;
  mappingStatus: 'mapped' | 'unmapped';
  confidence: 'confirmed' | 'inferred' | 'estimated';
  writable: boolean;
}

/**
 * Señales de proceso mapeadas. SIN export L5X, la semántica proviene del HMI de Optix
 * (NodeId exacto por sitio) verificada contra el PLC. `buffer:'realIn'` refiere al buffer
 * realIn PRIMARIO del sitio (el de arrayLength mayor), no a los de tanque TK1/TK2/TK3.
 *
 * - MONTEBELLO: caudales de entrada verificados en vivo (idx0 ≈ HMI 14.22; idx1 =
 *   totalizador; idx5 ≈ 23.2; evidencia: docs/FLOW_VALIDATION.md). Ampliado por el
 *   operador (2026-07-15): idx10 caudal de salida (l/s); idx15/idx16 presión de
 *   entrada 1/2 e idx17 presión de salida (psi, sin rango operativo). El canal realIn
 *   tiene 4 buffers (primario + TK1/TK2/TK3 de 10) → sourceBuffer explícito. TANQUES:
 *   la app original los muestra pero NO van en los 50 índices del primario — viven en
 *   REAL_IN_TK1/TK2/TK3_MONTEBELLO (cada uno con su MSG_READ); falta el índice de
 *   nivel/volumen DENTRO de cada TK para mapearlos. El operador sospecha planta hija /
 *   tanques compartidos (¿con Campoalegre?) — pendiente de rectificar.
 * - CAMPOALEGRE: confirmación del operador desde el HMI (2026-07-14): idx0 = caudal de
 *   salida 1, idx7 = caudal de salida 2 (l/s), idx12 = presión de salida 1 e idx13 =
 *   presión de salida 2 en psi con rango de instrumento 0–16 bar → max 232 psi.
 *   Tanques (misma sesión, mismo buffer): idx5/idx6 = nivel (m) / volumen (m³) del
 *   tanque 1, idx14/idx15 = tanque 2, idx16/idx17 = tanque 3. Identificador verificado
 *   contra el mapping (REAL_IN_CAMPOALEGRE = g=E1680D60-7BCD-C892-7257-C4D4AAE41E1C).
 * - SOLEDAD: confirmación del operador (2026-07-15), buffer REAL_IN_SOLEDAD
 *   (g=19181A21-F548-3D76-D6D9-EDAA324C20F7). El sitio tiene DOS buffers realIn de 50
 *   elementos (REAL_IN_SOLEDAD Float y DATOS_IN_PTAP_SOLEDAD Int16) → TODAS sus señales
 *   llevan sourceBuffer explícito; la heurística "el de más elementos" empataría.
 *   Entrada: idx0 caudal, idx2 turbiedad, idx3 oxígeno, idx4 conductividad, idx5 pH,
 *   idx6 temperatura. Tanque 1: idx7 nivel (op 0.75–2.8 m), idx8 volumen. Salida: idx9
 *   caudal, idx11 turbiedad, idx12 cloro (mg/L), idx13 pH, idx14 temperatura, idx20
 *   presión. ADEMÁS el buffer trae tanques de OTRAS plantas (Soledad parece concentrar
 *   los sitios mínimos): idx22/idx30 nivel/volumen tanque SAN ANTONIO (op 1–2.5 m) e
 *   idx23/idx31 nivel/volumen tanque EL QUIJOTE (op 1–3 m). Se mapean bajo soledad con
 *   domainKeys propios (sanAntonioTank… y quijoteTank…), NO como tank2/tank3 de soledad,
 *   PENDIENTE de rectificación con el operador; si se confirma que duplican los buffers
 *   REAL_TK_* de esos sitios, migrarán a las plantas san-antonio/quijote.
 *
 * - CASCAJAL: confirmación del operador (2026-07-15), buffer REAL_IN_CASCAJAL
 *   (g=F0C27430-68DC-74D7-BDAB-B9EDCC19F8A7, único realIn del sitio). idx0 caudal de
 *   salida 1 e idx7 caudal de salida 2 (l/s); idx5/idx6 nivel (op 1–3 m, lleno a 3 m) /
 *   volumen (m³) del tanque único; idx19 presión de entrada, idx12 presión de salida 1 e
 *   idx13 presión de salida 2 (psi, sin rango operativo entregado).
 *
 * - ALTO_MANGOS: confirmación del operador (2026-07-14, "planta Real Mangos" = buffer
 *   DATOS_REAL_IN_MANGOS, g=ECA4ABBE-2E70-B864-5B3D-B2E9D1FB7830, único realIn del sitio
 *   fusionado MANGOS/ALTO_MANGOS). idx0 caudal de entrada e idx7 caudal de salida (l/s);
 *   idx5/idx6 nivel (m, lleno a 2.5 m) / volumen (m³) del tanque único; idx12 presión de
 *   entrada e idx13 presión de salida (psi, rango operativo 1–3).
 *
 * - VORAGINE: confirmación del operador (2026-07-15), buffer REAL_IN_VORAGINE
 *   (g=93BAFF92-FF57-4877-74E4-B7CC1EFAE6B3, único realIn del sitio). idx0 caudal de
 *   entrada e idx7 caudal de salida (l/s); idx12 presión de entrada e idx13 presión de
 *   salida (psi, sin rango operativo). Tanque único con lleno confirmado a 1.97 m:
 *   idx5 nivel / idx6 volumen (op 1–1.97 m).
 *
 * - KM18: confirmación del operador (2026-07-15), buffer REAL_IN_KM18
 *   (g=1C72A21A-8F36-327C-C0AC-CA7A9AA60D96, único realIn del sitio). idx0 caudal de
 *   entrada e idx7 caudal de salida (l/s); idx12 presión de entrada e idx13 presión de
 *   salida (psi, sin rango operativo). DOS tanques con lleno confirmado a 2 m:
 *   tanque 1 = idx5/idx6, tanque 2 = idx14/idx15 (op 1–2 m c/u).
 *
 * - SIRENA: confirmación del operador (2026-07-15), buffer REAL_IN_SIRENA
 *   (g=A7B368C5-2F51-723A-8108-500CFEB52374). El canal realIn tiene además los buffers
 *   de tanque REAL_TK2/TK3_SIRENA (Float[10]) → sourceBuffer explícito por robustez.
 *   Entrada: idx0 caudal, idx2 turbiedad, idx3 oxígeno, idx4 conductividad, idx5 pH,
 *   idx6 temperatura, idx20 presión. Salida: idx9 caudal, idx11 turbiedad, idx12 cloro,
 *   idx13 pH, idx14 temperatura, idx21 presión. CUATRO tanques (niveles con lleno
 *   confirmado): tanque 1 = idx7/idx8 (1–2.8 m); tanque 2 = idx22/idx30 (1–2.5 m);
 *   tanque 3 = idx23/idx31 (1–2.5 m); tanque 4 = idx24/idx32 (1–2.5 m). OJO: en SOLEDAD
 *   los índices 22/23/30/31 son tanques de OTRAS plantas; aquí el operador confirmó que
 *   son tanques PROPIOS de Sirena — otro ejemplo de que los índices no son transferibles.
 *
 * - PICHINDE: confirmación del operador (2026-07-15), buffer REAL_IN_PICHINDE
 *   (g=C9C97734-E939-9008-A41E-9CA37BB7A2D0, único realIn del sitio). idx10 presión de
 *   entrada e idx11 presión de salida (psi, sin rango operativo entregado). El operador
 *   sospecha que el buffer trae más señales y que el sitio podría ser "anidado hijo"
 *   (como los tanques ajenos en SOLEDAD) — pendiente de revisar.
 *
 * - CARBONERO: confirmación del operador (2026-07-14), buffer REAL_IN_CARBONERO
 *   (g=A1323D1F-4114-A49D-746E-D6DDBB3C7DE3). Entrada: idx0 caudal (l/s), idx2 turbiedad
 *   (NTU), idx3 oxígeno disuelto (mg/L), idx4 conductividad (µS/cm), idx5 pH,
 *   idx6 temperatura (°C). Tanque único: idx7 nivel (m), idx8 volumen (m³). Salida:
 *   idx11 turbiedad (NTU), idx13 pH, idx14 temperatura (°C), idx20 presión (psi).
 *   Los rangos entregados por el operador (pH 5.5–9, turbiedad salida ≤1 NTU, etc.) son
 *   OPERATIVOS/normativos → van en opMin/opMax; min/max quedan como límites físicos
 *   amplios. Salirse de [min, max] NUNCA oculta el valor (QualityService solo marca
 *   `outOfRange` como aviso de futura alerta) — así una lectura anómala real
 *   (pH 5.8, tanque en 0.5 m) sigue viéndose justo cuando más importa verla.
 *
 *   OJO: los índices NO son transferibles entre plantas (realIn[5] aquí es nivel de
 *   tanque; en MONTEBELLO es caudal). Toda señal se direcciona por (plantId, domainKey).
 *
 * confidence: 'confirmed' desde 2026-07-21. El cliente confirmó que la semántica mapeada
 * corresponde a lo que hoy está registrado en cada planta, elevando las confirmaciones que
 * el operador ya había dado por HMI (2026-07-14/15). Antes se mantenían en 'inferred' a la
 * espera del L5X o de un documento oficial; esa espera queda saldada por confirmación
 * directa del cliente, que es la autoridad sobre sus propias plantas.
 *
 * SIGUEN en 'inferred' 7 señales con una duda ABIERTA y documentada — no por falta de
 * confirmación, sino porque hay evidencia que la contradice (ver el comentario junto a cada
 * una): cascajal.inletPressure1 (lee ~384 psi, fuera del máximo físico), los 4 tanques de
 * San Antonio/El Quijote retransmitidos en soledad (pendientes de migrar de planta) y las 2
 * presiones de pichinde (posible sitio anidado hijo).
 *
 * Los máximos NO cambian: siguen siendo bounds de validez FÍSICA (caudal 1000 l/s; presión
 * 232 psi = 16 bar), no capacidades de diseño — sirven para detectar lecturas imposibles.
 * Sustituirlos por las capacidades reales queda pendiente de que la planta las entregue.
 * El schema PROHÍBE writable:true sin confidence:'confirmed'; esa red sigue intacta porque
 * TODAS las señales son writable:false (habilitar escritura exige un write spec explícito).
 *
 * Presiones: min de validez -15 psi (no 0). Los transmisores manométricos derivan bajo
 * cero y el vacío pleno es ≈ -14.7 psi: una lectura de -0.7 psi (Campoalegre, 2026-07-15)
 * es REAL y el operador debe verla. Por debajo de -15 sí es imposible físico (sensor o
 * escala rotos) y se descarta como OUT_OF_RANGE — p. ej. Carbonero salida leyendo -57.
 */
const SIGNALS_BY_SITE: Record<string, SignalDef[]> = {
  MONTEBELLO: [
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 5, domainKey: 'inletFlow2', label: 'Caudal de entrada 2', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 10, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 15, domainKey: 'inletPressure1', label: 'Presión de entrada 1', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 16, domainKey: 'inletPressure2', label: 'Presión de entrada 2', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_MONTEBELLO', index: 17, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
  CAMPOALEGRE: [
    { buffer: 'realIn', index: 0, domainKey: 'outletFlow1', label: 'Caudal de salida 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow2', label: 'Caudal de salida 2', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'outletPressure1', label: 'Presión de salida 1', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure2', label: 'Presión de salida 2', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 14, domainKey: 'tank2Level', label: 'Nivel tanque 2', unit: 'm', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 15, domainKey: 'tank2Volume', label: 'Volumen tanque 2', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 16, domainKey: 'tank3Level', label: 'Nivel tanque 3', unit: 'm', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 17, domainKey: 'tank3Volume', label: 'Volumen tanque 3', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
  SOLEDAD: [
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 2, domainKey: 'inletTurbidity', label: 'Turbiedad de entrada', unit: 'NTU', min: 0, max: 1000, opMin: 0.1, opMax: 5, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 3, domainKey: 'inletOxygen', label: 'Oxígeno de entrada', unit: 'mg/L', min: 0, max: 20, opMin: 4, opMax: 15, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 4, domainKey: 'conductivity', label: 'Conductividad de entrada', unit: 'µS/cm', min: 0, max: 10000, opMin: 0.1, opMax: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 5, domainKey: 'inletPh', label: 'pH de entrada', unit: 'pH', min: 0, max: 14, opMin: 5.5, opMax: 9, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 6, domainKey: 'inletTemperature', label: 'Temperatura de entrada', unit: '°C', min: 0, max: 50, opMin: 10, opMax: 30, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 7, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 0.75, opMax: 2.8, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 8, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 9, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 11, domainKey: 'outletTurbidity', label: 'Turbiedad de salida', unit: 'NTU', min: 0, max: 1000, opMin: 0.1, opMax: 1, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 12, domainKey: 'outletChlorine', label: 'Cloro de salida', unit: 'mg/L', min: 0, max: 10, opMin: 0.3, opMax: 2, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 13, domainKey: 'outletPh', label: 'pH de salida', unit: 'pH', min: 0, max: 14, opMin: 6, opMax: 8, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 14, domainKey: 'outletTemperature', label: 'Temperatura de salida', unit: '°C', min: 0, max: 50, opMin: 10, opMax: 30, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 20, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    // Estas 4 siguen INFERRED aunque el cliente confirmó el resto (2026-07-21): la duda no es
    // qué miden, sino A QUÉ PLANTA pertenecen — son tanques de San Antonio y El Quijote que
    // llegan retransmitidos en el buffer de Soledad. Si se confirma que duplican
    // REAL_TK_SAN_ANTONO/REAL_TK_QUIJOTE, migran a esas plantas y ahí sí se confirman.
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 22, domainKey: 'sanAntonioTankLevel', label: 'Nivel tanque San Antonio', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.5, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 23, domainKey: 'quijoteTankLevel', label: 'Nivel tanque El Quijote', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 30, domainKey: 'sanAntonioTankVolume', label: 'Volumen tanque San Antonio', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SOLEDAD', index: 31, domainKey: 'quijoteTankVolume', label: 'Volumen tanque El Quijote', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
  CASCAJAL: [
    { buffer: 'realIn', index: 0, domainKey: 'outletFlow1', label: 'Caudal de salida 1', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow2', label: 'Caudal de salida 2', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'outletPressure1', label: 'Presión de salida 1', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure2', label: 'Presión de salida 2', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    // Sigue INFERRED pese a la confirmación del cliente (2026-07-21): esta señal lee ~384 psi,
    // por encima del máximo de validez física (232 psi = 16 bar). Una lectura imposible apunta
    // a índice, unidad o escala equivocados, así que confirmarla sería avalar un dato que el
    // propio mapping declara fuera de rango. Se confirma cuando se contraste contra el HMI.
    { buffer: 'realIn', index: 19, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
  ALTO_MANGOS: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMax: 2.5, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: -15, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
  VORAGINE: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 1.97, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
  KM18: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 12, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 14, domainKey: 'tank2Level', label: 'Nivel tanque 2', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 15, domainKey: 'tank2Volume', label: 'Volumen tanque 2', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
  SIRENA: [
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 2, domainKey: 'inletTurbidity', label: 'Turbiedad de entrada', unit: 'NTU', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 3, domainKey: 'inletOxygen', label: 'Oxígeno de entrada', unit: 'mg/L', min: 0, max: 20, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 4, domainKey: 'conductivity', label: 'Conductividad de entrada', unit: 'µS/cm', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 5, domainKey: 'inletPh', label: 'pH de entrada', unit: 'pH', min: 0, max: 14, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 6, domainKey: 'inletTemperature', label: 'Temperatura de entrada', unit: '°C', min: 0, max: 50, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 7, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.8, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 8, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 9, domainKey: 'outletFlow1', label: 'Caudal de salida', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 11, domainKey: 'outletTurbidity', label: 'Turbiedad de salida', unit: 'NTU', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 12, domainKey: 'outletChlorine', label: 'Cloro de salida', unit: 'mg/L', min: 0, max: 10, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 13, domainKey: 'outletPh', label: 'pH de salida', unit: 'pH', min: 0, max: 14, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 14, domainKey: 'outletTemperature', label: 'Temperatura de salida', unit: '°C', min: 0, max: 50, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 20, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 21, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 22, domainKey: 'tank2Level', label: 'Nivel tanque 2', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.5, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 23, domainKey: 'tank3Level', label: 'Nivel tanque 3', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.5, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 24, domainKey: 'tank4Level', label: 'Nivel tanque 4', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.5, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 30, domainKey: 'tank2Volume', label: 'Volumen tanque 2', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 31, domainKey: 'tank3Volume', label: 'Volumen tanque 3', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', sourceBuffer: 'REAL_IN_SIRENA', index: 32, domainKey: 'tank4Volume', label: 'Volumen tanque 4', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
  PICHINDE: [
    // Siguen INFERRED pese a la confirmación del cliente (2026-07-21): el operador sospecha que
    // el sitio es "anidado hijo" y que el buffer trae más señales. Mientras la identidad del
    // sitio esté en duda, no se puede afirmar de qué planta son estas presiones.
    { buffer: 'realIn', index: 10, domainKey: 'inletPressure1', label: 'Presión de entrada', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
    { buffer: 'realIn', index: 11, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, mappingStatus: 'mapped', confidence: 'inferred', writable: false },
  ],
  CARBONERO: [
    { buffer: 'realIn', index: 0, domainKey: 'inletFlow1', label: 'Caudal de entrada', unit: 'l/s', min: 0, max: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 2, domainKey: 'inletTurbidity', label: 'Turbiedad de entrada', unit: 'NTU', min: 0, max: 1000, opMin: 0, opMax: 5, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 3, domainKey: 'inletOxygen', label: 'Oxígeno de entrada', unit: 'mg/L', min: 0, max: 20, opMin: 4, opMax: 15, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 4, domainKey: 'conductivity', label: 'Conductividad', unit: 'µS/cm', min: 0, max: 10000, opMin: 0.1, opMax: 1000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 5, domainKey: 'inletPh', label: 'pH de entrada', unit: 'pH', min: 0, max: 14, opMin: 5.5, opMax: 9, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 6, domainKey: 'inletTemperature', label: 'Temperatura de entrada', unit: '°C', min: 0, max: 50, opMin: 10, opMax: 30, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 7, domainKey: 'tank1Level', label: 'Nivel tanque 1', unit: 'm', min: 0, max: 5, opMin: 1, opMax: 2.8, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 8, domainKey: 'tank1Volume', label: 'Volumen tanque 1', unit: 'm³', min: 0, max: 10000, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 11, domainKey: 'outletTurbidity', label: 'Turbiedad de salida', unit: 'NTU', min: 0, max: 1000, opMin: 0, opMax: 1, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 13, domainKey: 'outletPh', label: 'pH de salida', unit: 'pH', min: 0, max: 14, opMin: 6, opMax: 8, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 14, domainKey: 'outletTemperature', label: 'Temperatura de salida', unit: '°C', min: 0, max: 50, opMin: 10, opMax: 30, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
    { buffer: 'realIn', index: 20, domainKey: 'outletPressure1', label: 'Presión de salida', unit: 'psi', min: -15, max: 232, opMin: 1, opMax: 3, mappingStatus: 'mapped', confidence: 'confirmed', writable: false },
  ],
};

const CHANNELS = ['realIn', 'realOut', 'intIn', 'intOut', 'bitIn', 'bitOut', 'msgRead', 'msgWrite'] as const;
type Channel = (typeof CHANNELS)[number];

const SITES = ['ALTO_MANGOS','CAMPOALEGRE','CARBONERO','CASCAJAL','KM18','MANGOS','MONTEBELLO','PICHINDE','QUIJOTE','SAN_ANTONO','SAN_ANTONIO','SIRENA','SOLEDAD','VORAGINE'];
const ORDER = ['VORAGINE','SOLEDAD','MONTEBELLO','CASCAJAL','KM18','ALTO_MANGOS','CAMPOALEGRE','PICHINDE','CARBONERO','SIRENA','SAN_ANTONIO','QUIJOTE'];
const SLUG: Record<string, string> = {
  VORAGINE: 'voragine', SOLEDAD: 'soledad', MONTEBELLO: 'montebello', CASCAJAL: 'cascajal',
  KM18: 'km18', ALTO_MANGOS: 'alto-los-mangos', CAMPOALEGRE: 'campoalegre', PICHINDE: 'pichinde',
  CARBONERO: 'carbonero', SIRENA: 'sirena', SAN_ANTONIO: 'san-antonio', QUIJOTE: 'quijote',
};
const DISPLAY: Record<string, string> = {
  VORAGINE: 'La Vorágine', SOLEDAD: 'Soledad', MONTEBELLO: 'Montebello', CASCAJAL: 'Cascajal',
  KM18: 'Km 18', ALTO_MANGOS: 'Alto de los Mangos', CAMPOALEGRE: 'Campoalegre', PICHINDE: 'Pichindé',
  CARBONERO: 'Carbonero', SIRENA: 'La Sirena', SAN_ANTONIO: 'San Antonio', QUIJOTE: 'El Quijote',
};
// Sitios cuya topología mínima fue verificada por browse (H3).
const TOPOLOGY_VERIFIED = new Set(['SAN_ANTONIO', 'QUIJOTE']);

function siteOf(bn: string): string | null {
  const u = bn.toUpperCase();
  const m = SITES.filter((s) => u.includes(s)).sort((a, b) => b.length - a.length)[0];
  if (!m) return null;
  if (m === 'SAN_ANTONO') return 'SAN_ANTONIO';
  if (m === 'MANGOS') return 'ALTO_MANGOS';
  return m;
}
function channelOf(bn: string): Channel | 'localIO' | null {
  const n = bn.toUpperCase();
  if (/^LOCAL:\d+:[CIO]$/.test(n)) return 'localIO';
  if (n.startsWith('MSG_READ')) return 'msgRead';
  if (n.startsWith('MSG_WRITE')) return 'msgWrite';
  if (n.includes('PRUEBA') || n.includes('TEST')) return null;
  if (n.startsWith('BIT')) return 'bitIn';
  if (/_OUT_|_OUT$/.test(n)) return n.includes('REAL') || n.startsWith('DATOS') ? 'realOut' : 'intOut';
  if (/_IN_|_IN$|^REAL_|^DATOS_/.test(n)) return n.startsWith('INT') || n.includes('_INT') || n.includes('ENTEROS') ? 'intIn' : 'realIn';
  return null;
}

/** "ns=9;g=ABC..." → { nsUri, identifier: "g=ABC..." }, sin índice de namespace. */
function toNodeReference(nodeId: string, nsUri: string): NodeReference {
  const identifier = nodeId.replace(/^ns=\d+;/, '');
  if (/^ns=/.test(identifier)) {
    throw new Error(`identifier con ns= residual: ${nodeId}`);
  }
  return { nsUri, identifier };
}

function main(): void {
  const nodesDoc = JSON.parse(readFileSync(join(FIX_DIR, 'nodes.json'), 'utf8')) as NodesDoc;
  const readingsDoc = JSON.parse(readFileSync(join(FIX_DIR, 'readings.json'), 'utf8')) as ReadingsDoc;
  const verifyDoc = JSON.parse(readFileSync(join(FIX_DIR, 'connection-verification.json'), 'utf8')) as VerifyDoc;

  const readingByNodeId: Record<string, ReadingRow> = {};
  for (const r of readingsDoc.readings) readingByNodeId[r.nodeId] = r;
  const confidenceBySite: Record<string, 'confirmed' | 'inferred'> = {};
  for (const c of verifyDoc.connections) confidenceBySite[c.site] = c.confidence;

  function bufferDescriptor(node: NodeRow): BufferDescriptor {
    const rd = readingByNodeId[node.nodeId];
    return {
      browseName: node.browseName,
      node: toNodeReference(node.nodeId, node.nsUri),
      arrayLength: rd ? rd.arrayLength : null,
      dataType: rd ? rd.dataType : null,
    };
  }

  // Agrupar buffers de nivel superior por sitio y canal.
  const bySite: Record<string, Partial<Record<Channel, NodeRow[]>>> = {};
  const topLevel = nodesDoc.nodes.filter((n) => n.depth === 1 && n.rootLabel === 'ControllerTags');
  for (const t of topLevel) {
    const ch = channelOf(t.browseName);
    if (!ch || ch === 'localIO') continue;
    const s = siteOf(t.browseName);
    if (!s) continue;
    (bySite[s] ||= {});
    ((bySite[s][ch] ||= []) as NodeRow[]).push(t);
  }

  function connectionFor(site: string, msgReadNodes: NodeRow[] | undefined): Record<string, unknown> {
    const confidence = confidenceBySite[site] ?? 'inferred';
    if (!msgReadNodes || !msgReadNodes.length) {
      return { done: null, error: null, timeout: null, mappingStatus: 'unmapped', confidence: 'inferred' };
    }
    const primary = msgReadNodes.find((n) => !/_INT_/i.test(n.browseName)) ?? msgReadNodes[0];
    const kids = nodesDoc.nodes.filter((n) => n.parentNodeId === primary.nodeId);
    const memberRef = (name: string): NodeReference | null => {
      const k = kids.find((n) => n.browseName.toUpperCase() === name);
      return k ? toNodeReference(k.nodeId, k.nsUri) : null;
    };
    const done = memberRef('DN'), error = memberRef('ER'), timeout = memberRef('TO');
    const mapped = Boolean(done && error && timeout);
    return {
      sourceBuffer: primary.browseName,
      done,
      error,
      timeout,
      mappingStatus: mapped ? 'mapped' : 'unmapped',
      confidence,
    };
  }

  const plants = ORDER.map((site) => {
    const chans = bySite[site] ?? {};
    const opcBuffers: Record<string, BufferDescriptor[]> = {};
    for (const ch of CHANNELS) {
      const list = chans[ch];
      if (list && list.length) opcBuffers[ch] = list.map(bufferDescriptor); // omitir canales ausentes
    }
    const plant: Record<string, unknown> = {
      plantId: SLUG[site],
      displayName: DISPLAY[site],
      displayNameProvisional: true,
    };
    if (TOPOLOGY_VERIFIED.has(site)) plant.topologyVerified = true;
    plant.opcBuffers = opcBuffers;
    plant.connection = connectionFor(site, chans.msgRead);
    plant.signals = SIGNALS_BY_SITE[site] ?? [];
    return plant;
  });

  const doc = {
    $schema: './opc_mapping.schema.json',
    version: '0.14.0',
    protocolVersion: 'v2',
    dtoVersion: 'v1',
    generatedFrom: {
      source: 'apps/api/fixtures/plc-discovery/ (nodes.json, readings.json, connection-verification.json)',
      recaptureTool: 'tools/plc-discovery (etapas 00-02 + verify-phase0 + build-fixtures)',
      capturedAt: nodesDoc.capturedAt,
      verifiedAt: verifyDoc.verifiedAt,
      server: readingsDoc.endpointUrl,
      namespaces: nodesDoc.namespaces,
      connectionEvidence: `connection.confidence proviene de leer DN/ER/TO con StatusCode Good el ${verifyDoc.verifiedAt} (sesión Anonymous/None de solo lectura). Ver docs/PHASE0_VERIFICATION.md.`,
    },
    notes: [
      'Identidad canónica = plantId (slug). No usar nombres del frontend ni ptap-N.',
      'CONFIRMACIÓN DE SEMÁNTICA (2026-07-21): el cliente confirmó que la semántica mapeada corresponde a lo que hoy está registrado en cada planta, elevando a confidence:confirmed las confirmaciones que el operador ya había dado por HMI (2026-07-14/15). Antes se mantenían en inferred a la espera del L5X o de un documento oficial. 89 de 96 señales quedan confirmed.',
      'EXCEPCIONES que siguen en confidence:inferred (7 señales), no por falta de confirmación sino porque hay evidencia abierta que la contradice: (1) cascajal.inletPressure1 lee ~384 psi, por encima del máximo de validez física (232 psi) — índice/unidad/escala a contrastar contra el HMI; (2) los 4 tanques sanAntonioTank*/quijoteTank* mapeados bajo soledad, pendientes de migrar a sus plantas; (3) las 2 presiones de pichinde, mientras el sitio siga bajo sospecha de ser anidado hijo. Se confirmarán al cerrar cada duda.',
      'Los min/max NO son capacidades de diseño: siguen siendo bounds de validez FÍSICA (caudal 1000 l/s; presión 232 psi = 16 bar; nivel 20 m; volumen 10000 m³) para detectar lecturas imposibles. Sustituirlos por las capacidades reales queda pendiente de que la planta las entregue; confirmar la semántica no las convierte en dimensiones reales.',
      'Las referencias a nodos usan { nsUri, identifier } SIN índice de namespace. El adaptador de Fase 1 DEBE resolver nsUri → índice vía ReadNamespaceArray en CADA conexión y reconexión (el índice de Optix puede cambiar entre reinicios), usando scripts/resolve-namespaces.ts.',
      'Si un nsUri del mapping NO está en el NamespaceArray del servidor: NamespaceNotFoundError ⇒ BridgeStatus = Faulted (NO Recovering: no se arregla reintentando). Prohibido fallback a ns=0 o a un índice previo.',
      'MANGOS y ALTO_MANGOS fusionados en alto-los-mangos (confirmado). SAN_ANTONO normalizado a san-antonio.',
      'Sin export L5X: casi TODA señal de proceso sigue unmapped (signals: []). Única semántica confirmada por lectura: connection (DN/ER/TO de MSG_READ). Ver docs/PHASE0_VERIFICATION.md y docs/MSG_BITS_OBSERVATION.md.',
      'Excepción: montebello.signals mapea 6 señales, TODAS con sourceBuffer REAL_IN_MONTEBELLO (g=EBA8E3EB-53A2-0CCD-3912-501C0F7E4C8F; el canal realIn también tiene TK1/TK2/TK3 de 10 elementos): caudal de entrada 1[0] y 2[5] (verificados en vivo, docs/FLOW_VALIDATION.md), caudal de salida[10] l/s; presión de entrada 1[15], de entrada 2[16] y de salida[17] psi (sin rango operativo entregado; confirmación del operador 2026-07-15). confidence: CONFIRMED (cliente, 2026-07-21). El máximo de caudal (1000 l/s) es un bound físico plausible, no la capacidad de diseño.',
      'PENDIENTE DE RECTIFICAR (montebello): sus tanques NO van en los 50 índices del buffer primario — la app original los muestra y en el maestro existen REAL_IN_TK1/TK2/TK3_MONTEBELLO (Float[10], cada uno con su MSG_READ), pero falta la semántica de índices DENTRO de cada TK (¿cuál es nivel, cuál volumen?). El operador sospecha planta hija / tanques compartidos (¿con Campoalegre?). Cuando se confirme, se mapean con sourceBuffer REAL_IN_TK<N>_MONTEBELLO.',
      'Excepción: campoalegre.signals mapea outletFlow1 (realIn[0]), outletFlow2 (realIn[7]) en l/s; outletPressure1 (realIn[12]) y outletPressure2 (realIn[13]) en psi; y tanques 1/2/3: nivel en m y volumen en m³ en realIn[5]/[6], realIn[14]/[15] y realIn[16]/[17]. confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador desde el HMI de Optix (2026-07-14; identificador verificado: REAL_IN_CAMPOALEGRE = g=E1680D60-7BCD-C892-7257-C4D4AAE41E1C), NO del L5X ni de documento oficial. Rango de presión: instrumento 0–16 bar → max 232 psi. Máximos de nivel (20 m) y volumen (10000 m³) son bounds plausibles, no dimensiones reales del tanque.',
      'Los índices de array NO son transferibles entre plantas (realIn[5] es nivel de tanque en campoalegre y caudal en montebello). El código debe direccionar señales SIEMPRE por (plantId, domainKey), nunca por índice global.',
      'Excepción: soledad.signals mapea 18 señales, TODAS con sourceBuffer REAL_IN_SOLEDAD (g=19181A21-F548-3D76-D6D9-EDAA324C20F7) porque el sitio tiene dos buffers realIn de 50 elementos y la heurística de primario empataría. Entrada: caudal[0] l/s, turbiedad[2] NTU, oxígeno[3] mg/L, conductividad[4] µS/cm, pH[5], temperatura[6] °C; tanque 1: nivel[7] m (op 0.75–2.8) y volumen[8] m³; salida: caudal[9] l/s, turbiedad[11] NTU, cloro[12] mg/L, pH[13], temperatura[14] °C, presión[20] psi. confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-15).',
      'PENDIENTE DE RECTIFICAR (soledad): REAL_IN_SOLEDAD trae además tanques de otras plantas — nivel[22]/volumen[30] de SAN ANTONIO (op 1–2.5 m) y nivel[23]/volumen[31] de EL QUIJOTE (op 1–3 m). Se mapearon bajo soledad con domainKeys sanAntonioTank*/quijoteTank* (NO tank2/tank3) para no presentarlos como tanques propios. Si el operador confirma que duplican los buffers REAL_TK_SAN_ANTONO/REAL_TK_QUIJOTE, estas señales migrarán a las plantas san-antonio y quijote.',
      'Excepción: cascajal.signals mapea 7 señales de REAL_IN_CASCAJAL (g=F0C27430-68DC-74D7-BDAB-B9EDCC19F8A7, único realIn del sitio): caudal de salida 1[0] y 2[7] l/s; tanque 1 nivel[5] m (op 1–3, lleno a 3 m confirmado por operador) y volumen[6] m³; presión de salida 1[12], de salida 2[13] y de entrada[19] psi (sin rango operativo entregado). confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-15).',
      'Excepción: alto-los-mangos.signals mapea 6 señales de DATOS_REAL_IN_MANGOS (g=ECA4ABBE-2E70-B864-5B3D-B2E9D1FB7830, único buffer realIn del sitio fusionado): caudal de entrada[0] y salida[7] l/s; tanque 1 nivel[5] m (lleno a 2.5 m, confirmado por operador) y volumen[6] m³; presión de entrada[12] y salida[13] psi (op 1–3). confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-14), NO del L5X ni de documento oficial en el repo.',
      'Excepción: voragine.signals mapea 6 señales de REAL_IN_VORAGINE (g=93BAFF92-FF57-4877-74E4-B7CC1EFAE6B3, único realIn del sitio): caudal de entrada[0] y salida[7] l/s; presión de entrada[12] y salida[13] psi (sin rango operativo entregado); tanque único = nivel[5]/volumen[6], rango operativo 1–1.97 m y lleno confirmado a 1.97 m. confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-15).',
      'Excepción: km18.signals mapea 8 señales de REAL_IN_KM18 (g=1C72A21A-8F36-327C-C0AC-CA7A9AA60D96, único realIn del sitio): caudal de entrada[0] y salida[7] l/s; presión de entrada[12] y salida[13] psi (sin rango operativo entregado); tanque 1 = nivel[5]/volumen[6] y tanque 2 = nivel[14]/volumen[15], ambos con rango operativo 1–2 m y lleno confirmado a 2 m. confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-15).',
      'Excepción: sirena.signals mapea 21 señales, TODAS con sourceBuffer REAL_IN_SIRENA (g=A7B368C5-2F51-723A-8108-500CFEB52374; el canal realIn también tiene los buffers de tanque REAL_TK2/TK3_SIRENA de 10 elementos). Entrada: caudal[0], turbiedad[2], oxígeno[3], conductividad[4], pH[5], temperatura[6], presión[20]. Salida: caudal[9], turbiedad[11], cloro[12], pH[13], temperatura[14], presión[21]. Tanques PROPIOS con lleno confirmado: 1 = nivel[7]/volumen[8] (op 1–2.8 m); 2 = nivel[22]/volumen[30], 3 = nivel[23]/volumen[31], 4 = nivel[24]/volumen[32] (op 1–2.5 m c/u). OJO: en soledad los índices 22/23/30/31 son tanques de OTRAS plantas — los índices no son transferibles. confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-15).',
      'Excepción: pichinde.signals mapea 2 señales de REAL_IN_PICHINDE (g=C9C97734-E939-9008-A41E-9CA37BB7A2D0, único realIn del sitio): presión de entrada[10] y presión de salida[11] psi (sin rango operativo entregado). confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-15). El operador sospecha que el buffer trae más señales y que el sitio podría ser anidado hijo — pendiente de revisar.',
      'Excepción: carbonero.signals mapea 12 señales de REAL_IN_CARBONERO (g=A1323D1F-4114-A49D-746E-D6DDBB3C7DE3): entrada = caudal[0] l/s, turbiedad[2] NTU, oxígeno[3] mg/L, conductividad[4] µS/cm, pH[5], temperatura[6] °C; tanque 1 = nivel[7] m, volumen[8] m³; salida = turbiedad[11] NTU, pH[13], temperatura[14] °C, presión[20] psi. confidence: CONFIRMED (cliente, 2026-07-21) — confirmación del operador (2026-07-14), NO del L5X ni de documento oficial en el repo.',
      'Validez de presiones: [-15, 232] psi. El min NO es 0: los transmisores manométricos derivan bajo cero (Campoalegre salida 1 leyó -0.74 psi real el 2026-07-15) y el vacío físico llega a ≈ -14.7 psi. Bajo -15 psi es imposible físico ⇒ OUT_OF_RANGE (sensor/escala dañados; p. ej. Carbonero salida -57 psi). PENDIENTE verificar contra HMI: Cascajal presión de entrada lee 384 psi (¿unidad/índice/escala?).',
      'opMin/opMax = rango OPERATIVO/normativo entregado por el operador (insumo de alarmas futuras). NO confundir con min/max, que son límites de validez física: una lectura fuera de [opMin,opMax] pero dentro de [min,max] es un dato REAL y usable (p. ej. pH de salida 5.8 o tanque en 0.5 m) que la UI debe mostrar, no descartar.',
      'Topología de san-antonio y quijote verificada por browse: son sitios mínimos reales (solo un buffer de tanque + MSG_READ). topologyVerified: true.',
      'displayName es provisional (displayNameProvisional: true) hasta confirmación escrita de la planta.',
      'generatedFrom.namespaces es referencia histórica de la captura, NO fuente de verdad para el runtime.',
    ],
    plants,
  };

  mkdirSync(dirname(DEST), { recursive: true });
  writeFileSync(DEST, JSON.stringify(doc, null, 2) + '\n', 'utf8');

  const confirmed = plants.filter((p) => (p.connection as { confidence: string }).confidence === 'confirmed').length;
  console.log(`Generado ${DEST}`);
  console.log(`  plantas: ${plants.length} | connection confirmed: ${confirmed}/${plants.length}`);
}

main();
