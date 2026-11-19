import { Inject, Injectable, Logger } from '@nestjs/common';
import { hasPermission, type Role } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { CONNECTIVITY_ADAPTER, CONNECTIVITY_CONFIG } from '../../infrastructure/connectivity/connectivity.tokens';
import type { ConnectivityConfig } from '../../infrastructure/connectivity/connectivity.config';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import type { BufferElementTarget, ConnectivityAdapter } from '../../infrastructure/connectivity/ports/connectivity-adapter.port';
import type { CommandActor } from './command.dto';
import { WriteService } from './write.service';
import {
  cambiosEntre,
  validarProbe,
  valvulasAfectadas,
  type CambioObservado,
  type FotoBuffers,
  type ProbeRequest,
} from './channel-probe';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cuánto se espera tras escribir antes de fotografiar los buffers.
 *
 * Los valores llegan por la Subscription OPC UA, no bajo demanda: hasta que el servidor publique el
 * siguiente cambio, la foto sería la de antes. 400 ms cubre con holgura el intervalo de publicación
 * configurado, y de todos modos el resultado dice cuántas fotos se pudieron tomar — nunca se afirma
 * «no cambió nada» cuando lo que pasó es que no llegó ninguna muestra.
 */
const ESPERA_MUESTRA_MS = 400;

/** Intentos de devolver la salida a su valor anterior. Es el paso que NO puede quedarse a medias. */
const INTENTOS_LIBERACION = 3;

export interface ProbeResult {
  plantId: string;
  channel: string;
  sourceBuffer: string;
  index: number;
  requestedValue: number | boolean;
  holdMs: number;
  /** Lo que había en esa posición antes de tocar nada. Es el valor al que se vuelve. */
  previousValue: number | boolean | null;
  /** Lo que se leyó justo después de escribir: prueba que el valor entró. */
  writeEcho: number | boolean | null;
  writeVerified: boolean | null;
  /** ¿Se devolvió la salida a su valor anterior? **Si es `false`, hay que atenderlo ya.** */
  released: boolean;
  releasedValue: number | boolean | null;
  /** Qué MÁS se movió mientras la salida estaba puesta. La mitad útil de la prueba. */
  observed: CambioObservado[];
  /**
   * ¿Llegó alguna muestra que mirar? Con un sostenido más corto que el intervalo de publicación
   * puede no llegar ninguna, y entonces `observed` vacío significa «no se vio nada», no «no cambió
   * nada». Sin esta distinción, una prueba ciega parecería una prueba negativa.
   */
  sampled: boolean;
  /** Y qué volvió a moverse al soltarla: confirma que lo observado venía de esta escritura. */
  observedAfterRelease: CambioObservado[];
  /** Válvulas cuyo canal de mando toca este elemento; quedaron bloqueadas durante la prueba. */
  valvesLocked: string[];
  status: 'done' | 'rejected' | 'failed';
  reason?: string;
  at: string;
}

/**
 * Escribe en un canal del PLC para averiguar qué hace, y **suelta siempre**.
 *
 * Conserva las tres precondiciones duras del canal de comandos, porque son las que impiden que esto
 * sea un agujero: `OPCUA_WRITES_ENABLED`, sesión autenticada y cifrada, y permiso. Lo que NO exige
 * —y es la diferencia con `WriteService`— es que el elemento esté declarado `writable` en el mapeo:
 * el sentido de la herramienta es sondear justo lo que el mapeo todavía no sabe.
 *
 * Tres garantías, en orden de importancia:
 *
 *  1. **La salida vuelve a su valor anterior SIEMPRE**, en un `finally`, con reintentos, haya ido
 *     bien o mal lo demás. Es el único punto de este archivo que no admite discusión: una bobina
 *     energizada sin que nadie se entere quema el actuador o deja la válvula donde nadie sabe.
 *  2. **Bloquea las válvulas que mandan por ese mismo elemento** mientras dura la prueba (y una orden
 *     en curso bloquea la prueba). Sin eso, una orden en máscara podría solaparse con una escritura
 *     absoluta y dejar las dos direcciones energizadas: el estado que el protocolo declara ERROR.
 *  3. **Queda auditado con nombre y valor**, siempre, también cuando se rechaza. En estas plantas no
 *     hay confirmación eléctrica: el registro es la única evidencia de lo que se hizo.
 */
@Injectable()
export class ChannelProbeService {
  private readonly logger = new Logger('ChannelProbe');

  constructor(
    @Inject(CONNECTIVITY_ADAPTER) private readonly adapter: ConnectivityAdapter,
    @Inject(CONNECTIVITY_CONFIG) private readonly config: ConnectivityConfig,
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(WriteService) private readonly writes: WriteService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  async probar(plantId: string, req: ProbeRequest, actor: CommandActor): Promise<ProbeResult> {
    const base: ProbeResult = {
      plantId,
      channel: req.channel,
      sourceBuffer: req.sourceBuffer,
      index: req.index,
      requestedValue: req.value,
      holdMs: req.holdMs,
      previousValue: null,
      writeEcho: null,
      writeVerified: null,
      released: true, // nada escrito ⇒ nada que soltar
      releasedValue: null,
      observed: [],
      observedAfterRelease: [],
      sampled: false,
      valvesLocked: [],
      status: 'rejected',
      at: new Date().toISOString(),
    };
    const rechazar = async (reason: string): Promise<ProbeResult> =>
      this.auditar(actor, { ...base, status: 'rejected', reason });

    // 1) Forma y coherencia con el mapeo (canal de salida, buffer existe, índice cabe, hold acotado).
    const mapping = this.pipeline.getMapping();
    const veredicto = validarProbe(mapping, plantId, req);
    if (!veredicto.ok) return rechazar(`${veredicto.motivo}: ${veredicto.detalle}`);

    // 2) Precondición DURA, la misma del canal de comandos y por el mismo motivo (regla 9).
    const security = this.adapter.getWriteSecurity();
    if (!this.config.opcua.writesEnabled || !security.secure) {
      return rechazar(
        'WRITES_DISABLED_INSECURE_SESSION: la escritura está deshabilitada o la sesión OPC UA no es autenticada y cifrada.',
      );
    }

    // 3) Permiso. Se exigen LOS DOS: quien sondea un canal está haciendo algo más peligroso que
    //    accionar una válvula ya mapeada —puede mover equipo que nadie ha declarado— así que hace
    //    falta el permiso de accionar Y el de configurar el sistema.
    // `role` viaja como string en el actor (viene del token); se estrecha igual que en WriteService.
    const rol = actor.role as Role | null;
    if (!rol || !hasPermission(rol, 'control_valves') || !hasPermission(rol, 'system_config')) {
      return rechazar('FORBIDDEN: sondear un canal exige los permisos de accionar válvulas y de configurar el sistema.');
    }

    // 4) Cerrojos: este elemento y las válvulas que mandan por él.
    const valvulas = valvulasAfectadas(mapping, plantId, req);
    const claves = [
      `${plantId}/probe:${req.sourceBuffer}[${req.index}]`,
      ...valvulas.map((domainKey) => `${plantId}/${domainKey}`),
    ];
    const reservadas = this.writes.reservar(claves);
    if (!reservadas) {
      return rechazar('IN_PROGRESS: hay una orden o una prueba en curso sobre ese mismo canal. Espera a que termine.');
    }
    base.valvesLocked = valvulas;

    const el: BufferElementTarget = {
      plantId,
      channel: req.channel,
      sourceBuffer: req.sourceBuffer,
      index: req.index,
    };
    let escrito = false;
    /** Última foto tomada con la salida puesta. Se compara con la de después de soltar. */
    let fotoDurante: FotoBuffers = new Map();

    try {
      // 5) Valor previo. Sin esto no hay a dónde volver, así que un fallo aquí aborta ANTES de
      //    escribir: es la diferencia entre una prueba y un cambio permanente a ciegas.
      try {
        const prev = await this.adapter.readBufferElement(el);
        base.previousValue = prev.value;
      } catch (err) {
        return rechazar(
          `SIN_VALOR_PREVIO: no se pudo leer qué hay en ${req.sourceBuffer}[${req.index}], así que no habría a dónde volver. ${err instanceof Error ? err.message : ''}`.trim(),
        );
      }

      const antes = this.foto(plantId);

      // 6) La escritura. En ABSOLUTO: el probador pone exactamente lo que se le pide, o no sirve
      //    para averiguar nada.
      try {
        await this.adapter.writeBufferElement(el, req.value);
        escrito = true;
      } catch (err) {
        this.logger.error(
          `sondeo de ${plantId} ${req.sourceBuffer}[${req.index}] = ${String(req.value)} RECHAZADO por el servidor: ${err instanceof Error ? err.message : err}`,
        );
        return this.auditar(actor, {
          ...base,
          status: 'failed',
          reason: `WRITE_REJECTED: el servidor OPC UA rechazó la escritura. ${err instanceof Error ? err.message : ''}`.trim(),
        });
      }

      // 7) Eco: prueba en el momento que el valor quedó puesto, sin depender de que la planta
      //    reaccione. Que falle no invalida la prueba, pero no se afirma nada que no se haya leído.
      try {
        const echo = await this.adapter.readBufferElement(el);
        base.writeEcho = echo.value;
        base.writeVerified = echo.value === req.value;
      } catch {
        base.writeEcho = null;
        base.writeVerified = null;
      }

      // 8) Sostener exactamente lo pedido y mirar qué se movió.
      //
      // Se sostiene `holdMs` y ni un milisegundo más: alargarlo para «alcanzar a ver algo» sería
      // romper el contrato de la herramienta. Si el sostenido es más corto que el intervalo de
      // publicación de la Subscription, puede que no llegue ninguna muestra nueva — y entonces la
      // lista sale vacía porque no se vio nada, que NO es lo mismo que «no cambió nada». El
      // resultado lo dice con `sampled`.
      await sleep(req.holdMs);
      fotoDurante = this.foto(plantId);
      base.sampled = fotoDurante.size > 0;
      base.observed = cambiosEntre(antes, fotoDurante, mapping, plantId, req);

      base.status = 'done';
      return base;
    } finally {
      // 9) LA GARANTÍA. Se suelta siempre: haya salido bien, haya fallado el eco, o haya reventado
      //    cualquier cosa por encima. Va en `finally` y con reintentos porque es el único paso cuyo
      //    fallo deja algo físico puesto en la planta.
      if (escrito) {
        const soltado = await this.soltar(el, base.previousValue);
        base.released = soltado.ok;
        base.releasedValue = soltado.valor;
        if (!soltado.ok) {
          base.status = 'failed';
          base.reason = `NO_SE_PUDO_SOLTAR: ${req.sourceBuffer}[${req.index}] se quedó con un valor distinto del original (${String(base.previousValue)}). ATIENDE LA PLANTA.`;
          this.logger.error(`⚠️ ${base.reason}`);
        } else {
          // Tras soltar, una segunda mirada: si lo que se movió durante el sostenido vuelve a su
          // sitio, queda demostrado que venía de ESTA escritura y no de la planta operando por su
          // cuenta. Es la diferencia entre una correlación y un hallazgo.
          await sleep(ESPERA_MUESTRA_MS);
          base.observedAfterRelease = cambiosEntre(fotoDurante, this.foto(plantId), mapping, plantId, req);
        }
      }
      this.writes.liberar(claves);
      await this.auditar(actor, base);
    }
  }

  /** Devuelve la salida a su valor anterior. Reintenta: es el paso que no puede quedarse a medias. */
  private async soltar(
    el: BufferElementTarget,
    previo: number | boolean | null,
  ): Promise<{ ok: boolean; valor: number | boolean | null }> {
    // Sin valor previo se aborta ANTES de escribir, así que esto no debería darse; si se diera,
    // dejar un 0 es preferible a dejar puesto un valor de mando.
    const destino: number | boolean = previo ?? 0;

    for (let intento = 1; intento <= INTENTOS_LIBERACION; intento++) {
      try {
        await this.adapter.writeBufferElement(el, destino);
        const leido = await this.adapter.readBufferElement(el);
        if (leido.value === destino) return { ok: true, valor: leido.value };
        this.logger.warn(
          `liberación ${intento}/${INTENTOS_LIBERACION}: se escribió ${String(previo)} y se leyó ${String(leido.value)}`,
        );
      } catch (err) {
        this.logger.warn(
          `liberación ${intento}/${INTENTOS_LIBERACION} falló: ${err instanceof Error ? err.message : err}`,
        );
      }
      if (intento < INTENTOS_LIBERACION) await sleep(150);
    }
    return { ok: false, valor: null };
  }

  /** Copia de los valores de todos los buffers de la planta. Copia, no referencia: se compara después. */
  private foto(plantId: string): FotoBuffers {
    const foto: FotoBuffers = new Map();
    const buffers = this.pipeline.getLatestBuffers(plantId);
    if (!buffers) return foto;
    for (const [browseName, muestra] of buffers) foto.set(browseName, [...muestra.values]);
    return foto;
  }

  private async auditar(actor: CommandActor, result: ProbeResult): Promise<ProbeResult> {
    await this.auditLog.record({
      eventType: 'channel.probe',
      userId: actor.userId,
      userEmail: actor.userEmail,
      role: actor.role,
      ip: actor.ip,
      method: 'POST',
      path: `/api/plants/${result.plantId}/channel-probe`,
      statusCode: result.status === 'done' ? 200 : result.status === 'rejected' ? 409 : 502,
      detail: {
        sourceBuffer: result.sourceBuffer,
        index: result.index,
        channel: result.channel,
        requestedValue: result.requestedValue,
        previousValue: result.previousValue,
        holdMs: result.holdMs,
        writeVerified: result.writeVerified,
        released: result.released,
        valvesLocked: result.valvesLocked,
        observedCount: result.observed.length,
        status: result.status,
        reason: result.reason ?? null,
      },
    });
    return result;
  }
}
