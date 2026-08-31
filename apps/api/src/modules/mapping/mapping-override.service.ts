import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import {
  aplicarSobreRaw,
  bufferDeLaSenal,
  soloCambios,
  validarParche,
  valoresActuales,
  type MappingOverride,
  type MappingPatch,
} from '../../infrastructure/connectivity/mapping/mapping-overrides';
import type { LoadedMapping, SignalMapping } from '../../infrastructure/connectivity/mapping/opc-mapping.loader';
import { MappingOverrideRepository } from './mapping-override.repository';

/**
 * Editar el mapeo desde la app: valida, guarda y **aplica en caliente**.
 *
 * El orden de los pasos es el contenido de esta clase, y no es negociable:
 *
 *   1. forma del parche (zod, en el controlador)
 *   2. semántica contra el mapeo que rige — señal existe, no es escribible, el índice cabe en el
 *      buffer, los rangos no están invertidos
 *   3. **el documento completo resultante contra `config/opc_mapping.schema.json`**
 *   4. se guarda
 *   5. se aplica en caliente
 *
 * El paso 3 es el que parece redundante y no lo es: lo que se acepta tiene que seguir siendo un
 * mapping legal, porque es el mismo documento que la fase siguiente llevará a git. Validar solo el
 * parche dejaría pasar combinaciones que el schema prohíbe.
 *
 * Y el orden importa en el otro sentido: **nada se guarda si algo falla**, así que un rechazo deja
 * el sistema exactamente como estaba. La única escritura ocurre cuando ya se sabe que el resultado
 * es válido.
 */

/** Una señal como la ve el editor: lo que rige, de dónde sale, y qué se le cambió. */
export interface SenalEditableDto {
  /** El nombre en inglés asignado a la señal. Es la clave con la que viaja en el DTO y en el tablero. */
  domainKey: string;
  label: string | null;
  /** Canal declarado (realIn, intIn…). */
  buffer: string;
  sourceBuffer: string | null;
  /** El buffer que de VERDAD la alimenta, ya resuelto. */
  browseName: string | null;
  nsUri: string | null;
  identifier: string | null;
  dataType: string | null;
  declaredLength: number | null;
  index: number;
  unit: string | null;
  min: number | null;
  max: number | null;
  opMin: number | null;
  opMax: number | null;
  mappingStatus: string;
  confidence: string;
  writable: boolean;
  /** Por qué no se puede editar, si no se puede. `null` = editable. */
  bloqueada: string | null;
  /** Corrección en vigor, con lo que decía el repositorio antes. */
  override: {
    patch: MappingPatch;
    base: MappingPatch;
    by: string | null;
    at: string | null;
  } | null;
}

export interface PlantaEditableDto {
  plantId: string;
  displayName: string;
  senales: SenalEditableDto[];
}

const SCHEMA_FILE = 'opc_mapping.schema.json';

function rutaSchema(): string | null {
  const candidatas = [
    process.env.OPC_MAPPING_SCHEMA_PATH,
    join(process.cwd(), 'config', SCHEMA_FILE),
    join(process.cwd(), 'apps', 'api', 'config', SCHEMA_FILE),
    join(__dirname, '..', '..', '..', 'config', SCHEMA_FILE),
    join(__dirname, '..', '..', '..', '..', 'config', SCHEMA_FILE),
  ].filter((c): c is string => !!c);
  return candidatas.find((c) => existsSync(c)) ?? null;
}

@Injectable()
export class MappingOverrideService implements OnModuleInit {
  private readonly logger = new Logger('MappingOverride');
  /** Se compila una vez: el schema es grande y validar es lo que se hace en cada edición. */
  private validador: ((doc: unknown) => boolean) | null = null;
  private erroresDelValidador: (() => string) | null = null;

  constructor(
    @Inject(MappingOverrideRepository) private readonly repo: MappingOverrideRepository,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
  ) {}

  /**
   * Al arrancar, las correcciones guardadas se empujan al pipeline.
   *
   * Este servicio vive en un módulo CON base de datos y el pipeline en uno SIN ella (lo importa
   * también `main.telemetry.ts`, que arranca sin MySQL). De ahí que los overrides se empujen desde
   * aquí en vez de leerse desde allí: la dirección de la dependencia es lo que mantiene esa
   * separación viva.
   *
   * Si la base no responde, se registra y se sigue: el backend tiene que arrancar con el mapeo del
   * repositorio antes que no arrancar.
   */
  async onModuleInit(): Promise<void> {
    try {
      const overrides = await this.repo.listarEfectivos();
      if (overrides.length > 0) this.pipeline.setOverrides(overrides);
      this.logger.log(`${overrides.length} corrección(es) de mapeo en vigor al arrancar`);
    } catch (err) {
      this.logger.error(
        `no se pudieron cargar las correcciones de mapeo: ${err instanceof Error ? err.message : err}. Se arranca con el mapeo del repositorio.`,
      );
    }
  }

  /** Todas las señales de una planta, como las ve el editor. */
  async planta(plantId: string): Promise<PlantaEditableDto> {
    const efectivo = this.pipeline.getMapping();
    const planta = efectivo.plants.find((p) => p.plantId === plantId);
    if (!planta) throw new NotFoundException(`planta desconocida: ${plantId}`);

    const base = this.pipeline.getBaseMapping();
    const overrides = await this.repo.listarEfectivos();
    const porSenal = new Map(overrides.map((o) => [`${o.plantId} ${o.domainKey}`, o]));

    const senales = efectivo.signals
      .filter((s) => s.plantId === plantId)
      .map((s) => this.aDto(efectivo, base, s, porSenal.get(`${plantId} ${s.domainKey}`)));

    return { plantId, displayName: planta.displayName, senales };
  }

  /** Las correcciones en vigor, para pintar el aviso de «este mapeo lleva cambios a mano». */
  async listar(): Promise<MappingOverride[]> {
    return this.repo.listarEfectivos();
  }

  async historial(plantId: string, domainKey: string) {
    return this.repo.historial(plantId, domainKey);
  }

  /**
   * Aplica una corrección. Devuelve la señal como queda.
   *
   * `previous` se guarda con lo que regía JUSTO ANTES —no con lo que dice el repositorio— para que
   * deshacer un paso devuelva al estado anterior y no salte por encima de una corrección intermedia.
   */
  async aplicar(
    plantId: string,
    domainKey: string,
    patch: MappingPatch,
    usuario: { id?: string; email?: string; name?: string } | undefined,
  ): Promise<SenalEditableDto> {
    const efectivo = this.pipeline.getMapping();
    const senal = efectivo.signals.find((s) => s.plantId === plantId && s.domainKey === domainKey);
    if (!senal) throw new NotFoundException(`${plantId} no tiene una señal llamada ${domainKey}`);

    const veredicto = validarParche(efectivo, plantId, domainKey, patch);
    if (!veredicto.ok) throw new BadRequestException({ motivo: veredicto.motivo, message: veredicto.detalle });

    // El parche que se guarda es el ACUMULADO de la señal, no el delta de esta pulsación: así leer
    // el efectivo es una fila por señal y no replegar su historia entera en cada arranque.
    const anterior = (await this.repo.listarEfectivos()).find(
      (o) => o.plantId === plantId && o.domainKey === domainKey,
    );
    const acumulado: MappingPatch = { ...(anterior?.patch ?? {}), ...soloCambios(senal, patch) };

    const overrides = (await this.repo.listarEfectivos()).filter(
      (o) => !(o.plantId === plantId && o.domainKey === domainKey),
    );
    overrides.push({ plantId, domainKey, patch: acumulado, by: null, at: null });

    this.validarContraSchema(overrides);

    await this.repo.registrar({
      plantId,
      domainKey,
      patch: acumulado,
      previous: anterior?.patch ?? {},
      reverted: false,
      userId: usuario?.id ?? null,
      userEmail: usuario?.email ?? null,
      userName: usuario?.name ?? null,
    });

    await this.recargar();
    return this.senalActual(plantId, domainKey);
  }

  /** Vuelve al mapeo del repositorio para esa señal. No borra nada: inserta la reversión. */
  async revertir(
    plantId: string,
    domainKey: string,
    usuario: { id?: string; email?: string; name?: string } | undefined,
  ): Promise<SenalEditableDto> {
    const anterior = (await this.repo.listarEfectivos()).find(
      (o) => o.plantId === plantId && o.domainKey === domainKey,
    );
    if (!anterior) {
      throw new BadRequestException({
        motivo: 'SIN_OVERRIDE',
        message: `${plantId}.${domainKey} ya está como dice el repositorio: no hay nada que revertir.`,
      });
    }

    await this.repo.registrar({
      plantId,
      domainKey,
      patch: {},
      previous: anterior.patch,
      reverted: true,
      userId: usuario?.id ?? null,
      userEmail: usuario?.email ?? null,
      userName: usuario?.name ?? null,
    });

    await this.recargar();
    return this.senalActual(plantId, domainKey);
  }

  // ── Interno ───────────────────────────────────────────────────────────────────

  private async recargar(): Promise<void> {
    this.pipeline.setOverrides(await this.repo.listarEfectivos());
  }

  private async senalActual(plantId: string, domainKey: string): Promise<SenalEditableDto> {
    const efectivo = this.pipeline.getMapping();
    const senal = efectivo.signals.find((s) => s.plantId === plantId && s.domainKey === domainKey);
    if (!senal) throw new NotFoundException(`${plantId}.${domainKey} desapareció del mapeo`);
    const override = (await this.repo.listarEfectivos()).find(
      (o) => o.plantId === plantId && o.domainKey === domainKey,
    );
    return this.aDto(efectivo, this.pipeline.getBaseMapping(), senal, override);
  }

  private aDto(
    efectivo: LoadedMapping,
    base: LoadedMapping,
    s: SignalMapping,
    override: MappingOverride | undefined,
  ): SenalEditableDto {
    const buffer = bufferDeLaSenal(efectivo, s.plantId, s.buffer, s.sourceBuffer);
    const original = base.signals.find((b) => b.plantId === s.plantId && b.domainKey === s.domainKey);

    return {
      domainKey: s.domainKey,
      label: s.label,
      buffer: s.buffer,
      sourceBuffer: s.sourceBuffer ?? null,
      browseName: buffer?.browseName ?? null,
      nsUri: buffer?.node.nsUri ?? null,
      identifier: buffer?.node.identifier ?? null,
      dataType: buffer?.dataType ?? null,
      declaredLength: buffer?.arrayLength ?? null,
      index: s.index,
      unit: s.unit,
      min: s.min,
      max: s.max,
      opMin: s.opMin ?? null,
      opMax: s.opMax ?? null,
      mappingStatus: s.mappingStatus,
      confidence: s.confidence,
      writable: s.writable,
      bloqueada: s.writable
        ? 'Es una señal de válvula: el mapeo de lo escribible exige documento oficial de la planta.'
        : null,
      override: override
        ? {
            patch: override.patch,
            base: original ? valoresActuales(original) : {},
            by: override.by,
            at: override.at,
          }
        : null,
    };
  }

  /**
   * El documento resultante contra el schema del mapeo. Lanza si no valida.
   *
   * Sin el schema en disco **se rechaza el cambio**, en vez de aplicarlo a ciegas. Es la decisión
   * incómoda pero correcta: la alternativa —seguir adelante avisando en el log— convertiría un
   * despliegue mal copiado en una puerta abierta a guardar mapeos ilegales, y nadie leería ese log.
   */
  private validarContraSchema(overrides: MappingOverride[]): void {
    const validar = this.compilar();
    const doc = aplicarSobreRaw(this.pipeline.getBaseMapping().raw, overrides);
    if (!validar(doc)) {
      const detalle = this.erroresDelValidador?.() ?? 'el documento no cumple el schema';
      this.logger.warn(`corrección rechazada por el schema: ${detalle}`);
      throw new BadRequestException({
        motivo: 'SCHEMA_INVALIDO',
        message: `El mapeo resultante no cumple el contrato: ${detalle}`,
      });
    }
  }

  private compilar(): (doc: unknown) => boolean {
    if (this.validador) return this.validador;

    const ruta = rutaSchema();
    if (!ruta) {
      throw new BadRequestException({
        motivo: 'SCHEMA_AUSENTE',
        message:
          'No se encontró config/opc_mapping.schema.json en el servidor, así que no se puede comprobar que el cambio sea válido. No se aplica nada.',
      });
    }

    const schema: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
    // `strict: false` y draft 2020-12, igual que scripts/validate-mapping.ts: tiene que ser el MISMO
    // criterio que el gate de CI, o algo pasaría aquí y fallaría allí (o al contrario).
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const fn = ajv.compile(schema as object);
    this.validador = (doc: unknown) => fn(doc) === true;
    this.erroresDelValidador = () =>
      (fn.errors ?? [])
        .slice(0, 3)
        .map((e) => `${e.instancePath || '(raíz)'} ${e.message ?? ''}`.trim())
        .join('; ');
    this.logger.log(`schema del mapeo compilado desde ${ruta}`);
    return this.validador;
  }
}
