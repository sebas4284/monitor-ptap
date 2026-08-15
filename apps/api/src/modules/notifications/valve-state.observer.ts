import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { SignalDto } from '@ptap/shared';
import { AuditLogService } from '../../infrastructure/audit/audit-log.service';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';

/**
 * Acumula EVIDENCIA sobre la palabra de estado de las válvulas, que es el conocimiento que le falta
 * al proyecto.
 *
 * El problema de fondo: nadie sabe qué significan los bits de `INT_IN[0]`. Lo que hay es una
 * inferencia del protocolo de Vorágine (bit14 = válido, bit0 = abierta) que **no la cumple ni la
 * propia Vorágine** — su palabra hoy es 7176, sin bit14. Cada vez que aparecía un valor nuevo había
 * que investigarlo a mano: así se descubrió el 2026-08-15 que Sirena había pasado de 16384 a 17408
 * con 23,33 l/s entrando, y que la app llevaba quién sabe cuánto diciendo CERRADA.
 *
 * Este observador convierte ese hallazgo casual en un registro sistemático. Cada vez que una planta
 * reporta un valor que NUNCA habíamos visto, se anota junto a las dos cosas que permiten
 * interpretarlo:
 *
 *  - **el caudal de la válvula** en ese instante (evidencia física de si está abierta o cerrada), y
 *  - **la última orden que mandamos**, para saber si el cambio lo provocamos nosotros o fue manual.
 *
 * Con suficientes muestras, la convención se DEDUCE en vez de suponerse: un valor visto siempre con
 * caudal es "abierta", uno visto siempre sin caudal es "cerrada", y uno visto con ambos no indica
 * el estado de la válvula.
 *
 * También registra el caso inverso, que es el que delata los movimientos MANUALES: el caudal cruza
 * el umbral y la palabra NO se mueve. Eso prueba que ese registro no sigue a la válvula.
 *
 * Va a `audit_log` (mismo patrón que `opc.route_probe`), no a la bandeja: es material de
 * diagnóstico para quien investiga, no un aviso para el operario de turno.
 */

export const VALVE_STATE_EVENT = 'opc.valve_state_sample';
/** Umbral de caudal que separa "hay paso" de "no hay paso". El mismo que usa el front. */
const CAUDAL_ABIERTA_LPS = 0.1;

interface Observacion {
  /** Valores de la palabra ya vistos, para no repetir el registro en cada barrido. */
  vistos: Set<number>;
  /** Última palabra y último caudal, para detectar el movimiento manual. */
  ultimaPalabra: number | null;
  ultimoCaudalAbierto: boolean | null;
}

@Injectable()
export class ValveStateObserver implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ValveState');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepMs = Number(process.env.NOTIFY_SWEEP_MS ?? 10 * 60_000);
  /** `${plantId}/${valveKey}` → lo observado hasta ahora. */
  private readonly estado = new Map<string, Observacion>();

  constructor(
    private readonly pipeline: PlantPipelineService,
    private readonly cache: PlantCache,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Se siembra con lo YA registrado: sin esto, cada reinicio volvería a reportar como "nuevo"
    // todo lo que ya sabemos, y el registro se llenaría de ruido en vez de hallazgos.
    await this.seedFromAudit();
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref?.();
    this.logger.log(`observando palabras de estado de válvula cada ${Math.round(this.sweepMs / 60000)} min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async seedFromAudit(): Promise<void> {
    try {
      const previos = await this.auditLog.listByEventType(VALVE_STATE_EVENT, 500);
      for (const ev of previos) {
        const d = ev.detail ?? {};
        const clave = typeof d.clave === 'string' ? d.clave : null;
        const palabra = typeof d.palabra === 'number' ? d.palabra : null;
        if (clave && palabra !== null) this.ensure(clave).vistos.add(palabra);
      }
      const total = [...this.estado.values()].reduce((n, o) => n + o.vistos.size, 0);
      if (total > 0) this.logger.log(`sembrado con ${total} valor(es) ya observados`);
    } catch (err) {
      // No poder sembrar no puede impedir arrancar: a lo sumo se re-registra lo ya conocido.
      this.logger.warn(`no se pudo sembrar desde la auditoría: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Un ciclo. Público para ejercitarlo en tests sin esperar al temporizador. */
  async sweep(): Promise<number> {
    let registrados = 0;
    try {
      for (const plant of this.pipeline.listPlants()) {
        const snapshot = this.cache.get(plant.plantId);
        if (!snapshot || snapshot.pending) continue;

        for (const [key, signal] of Object.entries(snapshot.signals)) {
          const m = /^valve(\d+)State$/.exec(key);
          if (!m) continue;
          const palabra = typeof signal.value === 'number' && Number.isFinite(signal.value) ? signal.value : null;
          if (palabra === null) continue;

          const valveKey = `valve${m[1]}`;
          const clave = `${plant.plantId}/${valveKey}`;
          const obs = this.ensure(clave);
          const caudal = this.caudalDe(snapshot.signals, valveKey);
          const abierto = caudal === null ? null : caudal > CAUDAL_ABIERTA_LPS;

          if (!obs.vistos.has(palabra)) {
            obs.vistos.add(palabra);
            await this.registrar('valor_nuevo', clave, plant.displayName, palabra, caudal, abierto, signal);
            registrados++;
          } else if (
            // El caudal cambió de lado y la palabra NO se movió: prueba de que ese registro no
            // sigue a la válvula. Es la huella de un movimiento MANUAL desde el tablero.
            obs.ultimoCaudalAbierto !== null &&
            abierto !== null &&
            abierto !== obs.ultimoCaudalAbierto &&
            obs.ultimaPalabra === palabra
          ) {
            await this.registrar('caudal_cambio_palabra_no', clave, plant.displayName, palabra, caudal, abierto, signal);
            registrados++;
          }

          obs.ultimaPalabra = palabra;
          if (abierto !== null) obs.ultimoCaudalAbierto = abierto;
        }
      }
    } catch (err) {
      this.logger.error(`barrido fallido: ${err instanceof Error ? err.message : err}`);
    }
    return registrados;
  }

  /** El caudal que corresponde a ESA válvula: el declarado en el mapping, o la preferencia por defecto. */
  private caudalDe(signals: Record<string, SignalDto>, valveKey: string): number | null {
    const declarado = signals[valveKey]?.flowDomainKey;
    const orden = declarado ? [declarado] : ['outletFlow1', 'outletFlow2', 'inletFlow1', 'inletFlow2'];
    for (const k of orden) {
      const v = signals[k]?.value;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return null;
  }

  private async registrar(
    motivo: 'valor_nuevo' | 'caudal_cambio_palabra_no',
    clave: string,
    displayName: string,
    palabra: number,
    caudal: number | null,
    abierto: boolean | null,
    signal: SignalDto,
  ): Promise<void> {
    const bits: number[] = [];
    for (let i = 0; i < 16; i++) if (palabra & (1 << i)) bits.push(i);

    await this.auditLog.record({
      eventType: VALVE_STATE_EVENT,
      userId: null,
      userEmail: null,
      role: null,
      ip: null,
      method: null,
      path: null,
      statusCode: null,
      detail: {
        motivo,
        clave,
        planta: displayName,
        palabra,
        bits,
        caudal,
        // La lectura que de verdad importa: con caudal la válvula deja pasar agua, sin él no.
        // Cruzando esto entre muestras se deduce qué significa cada valor.
        estadoPorCaudal: abierto === null ? 'sin caudal mapeado' : abierto ? 'abierta' : 'cerrada',
        palabraFiable: signal.stateTrusted !== false,
        ts: signal.ts,
      },
    });

    const que =
      motivo === 'valor_nuevo'
        ? `valor NUEVO ${palabra} {${bits.join(',')}}`
        : `el caudal cambió de lado y la palabra siguió en ${palabra}`;
    this.logger.warn(`${clave}: ${que} · caudal ${caudal ?? '—'} l/s`);
  }

  private ensure(clave: string): Observacion {
    let o = this.estado.get(clave);
    if (!o) {
      o = { vistos: new Set<number>(), ultimaPalabra: null, ultimoCaudalAbierto: null };
      this.estado.set(clave, o);
    }
    return o;
  }
}
