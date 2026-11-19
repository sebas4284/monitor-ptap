import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { SignalDto, TankAutonomyDto } from '@ptap/shared';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { TankAutonomyStore } from '../../infrastructure/connectivity/pipeline/tank-autonomy.store';
import { dedupeDay } from './notification-day';
import { FlowHourlyRepository } from './flow-hourly.repository';
import { NotificationRepository, type NewNotification } from './notification.repository';
import {
  analizarAutonomia,
  actualizarCaudal,
  aplicarTendencia,
  debeRecalcular,
  humanHoras,
  AUTONOMIA_CRITICA_H,
  VENTANA_TENDENCIA_MS,
  FRESCURA_TENDENCIA_MS,
  MAX_HUECO_TENDENCIA_MS,
  type MuestraTanque,
  type AutonomiaTanque,
  type TemporizadorTanque,
} from './tank-autonomy.analyzer';

/** Estima cada tanque por su propio descenso, sin presumir conexión con caudales o válvulas. */
@Injectable()
export class TankAutonomyDetector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TankAutonomy');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepMs = Number(process.env.AUTONOMY_SWEEP_MS ?? 60_000);

  /** plantId → (tank<N> → temporizador vigente). Volátil: al reiniciar se vuelve a fijar. */
  private readonly temporizadores = new Map<string, Map<string, TemporizadorTanque>>();

  private readonly historiales = new Map<string, MuestraTanque[]>();

  constructor(
    @Inject(PlantPipelineService) private readonly pipeline: PlantPipelineService,
    @Inject(PlantCache) private readonly cache: PlantCache,
    @Inject(NotificationRepository) private readonly repo: NotificationRepository,
    @Inject(FlowHourlyRepository) _flujo: FlowHourlyRepository,
    @Inject(TankAutonomyStore) private readonly store: TankAutonomyStore,
  ) {}

  onModuleInit(): void {
    // Escalonado tras los otros dos detectores (30 s y 45 s) para no encimar barridos al arrancar.
    setTimeout(() => void this.sweep(), 60_000).unref?.();
    this.timer = setInterval(() => void this.sweep(), this.sweepMs);
    this.timer.unref?.();
    this.logger.log(`autonomía de tanques activa: barrido cada ${Math.round(this.sweepMs / 1000)} s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Un ciclo completo. Público para ejercitarlo en tests sin esperar al temporizador. */
  async sweep(now = new Date()): Promise<number> {
    let created = 0;
    try {
      for (const plant of this.pipeline.listPlants()) {
        const snapshot = this.cache.get(plant.plantId);
        if (!snapshot || snapshot.pending || snapshot.liveness.state === 'frozen' || snapshot.bridgeStatus !== 'Connected') {
          this.temporizadores.delete(plant.plantId);
          for (const key of this.historiales.keys()) if (key.startsWith(`${plant.plantId}/`)) this.historiales.delete(key);
          this.store.set(plant.plantId, []);
          continue;
        }

        const lecturas = analizarAutonomia(snapshot, null).filter((t) => {
          const ts = snapshot.signals[`${t.tankKey}Level`]?.ts;
          const ms = ts ? Date.parse(ts) : NaN;
          return Number.isFinite(ms) && ms <= now.getTime() && now.getTime() - ms <= FRESCURA_TENDENCIA_MS;
        });
        const vigentes = new Set(lecturas.map((t) => `${plant.plantId}/${t.tankKey}`));
        for (const key of this.historiales.keys()) {
          if (key.startsWith(`${plant.plantId}/`) && !vigentes.has(key)) this.historiales.delete(key);
        }
        for (const key of this.temporizadores.get(plant.plantId)?.keys() ?? []) {
          if (!vigentes.has(`${plant.plantId}/${key}`)) this.temporizadores.get(plant.plantId)?.delete(key);
        }

        const publicables: TankAutonomyDto[] = [];
        for (const lectura of lecturas) {
          const t = this.conTendencia(plant.plantId, lectura, snapshot.signals, now);
          const temporizador = this.fijarTemporizador(plant.plantId, t, now);
          publicables.push({
            tankN: t.tankN,
            tankKey: t.tankKey,
            hoursTo50: temporizador.horasHasta50,
            hoursTo0: temporizador.horasHasta0,
            flowLps: temporizador.caudalFijadoLps,
            basis: temporizador.origen,
            hoursToReserve: temporizador.horasHastaReserva ?? null,
            reserveLevelM: t.reservaM,
            reserveBasis: t.reservaOrigen,
            limitation: t.limitacion,
          });
          const aviso = this.avisoDe(plant.plantId, t, temporizador, now);
          if (aviso && (await this.repo.create(aviso))) created++;
        }
        // Se publica lo del TEMPORIZADOR, no el cálculo del instante: la tarjeta debe enseñar
        // exactamente el mismo número que el aviso, o el operario verá dos verdades distintas.
        this.store.set(plant.plantId, publicables);
      }
      if (created > 0) this.logger.warn(`${created} aviso(s) de autonomía de tanque`);
    } catch (err) {
      // Un fallo aquí no puede tumbar el backend ni la telemetría.
      this.logger.error(`barrido de autonomía falló: ${err instanceof Error ? err.message : err}`);
    }
    return created;
  }

  /** Fuente PLC, no reloj del barrido: repetir una lectura no aporta una muestra independiente. */
  private conTendencia(plantId: string, t: AutonomiaTanque, signals: Record<string, SignalDto>, now: Date): AutonomiaTanque {
    const key = `${plantId}/${t.tankKey}`;
    const ahoraMs = now.getTime();
    const level = signals[`${t.tankKey}Level`];
    const volume = signals[`${t.tankKey}Volume`];
    const fresh = (ts: string | null | undefined) => {
      const ms = ts ? Date.parse(ts) : NaN;
      return Number.isFinite(ms) && ms <= ahoraMs && ahoraMs - ms <= FRESCURA_TENDENCIA_MS ? ms : null;
    };
    const nivelTs = fresh(level?.ts);
    if (nivelTs === null) { this.historiales.delete(key); return t; }
    const volumenTs = t.volumeM3 !== null ? fresh(volume?.ts) : null;
    // Nivel y volumen son dos fuentes: no multiplicar muestras de nivel al cambiar solo volumen.
    // Si el volumen deja de ser válido/fresco, inicia una ventana de nivel independiente.
    const tsMs = nivelTs;
    let history = this.historiales.get(key) ?? [];
    const last = history[history.length - 1];
    const volumenSincrono = volumenTs !== null && volumenTs === nivelTs;
    const cambioFuente = last && (last.volumenM3 !== null) !== volumenSincrono;
    if (last && (tsMs < last.tsMs || tsMs - last.tsMs > MAX_HUECO_TENDENCIA_MS || cambioFuente)) history = [];
    if (history.length === 0 || tsMs !== history[history.length - 1].tsMs) {
      history.push({ tsMs, nivelM: t.levelM, volumenM3: volumenSincrono ? t.volumeM3 : null });
    }
    history = history.filter((m) => m.tsMs >= ahoraMs - VENTANA_TENDENCIA_MS);
    this.historiales.set(key, history);
    // Una fuente de volumen desincronizada no puede reaparecer como stock actual para extrapolar.
    return aplicarTendencia(volumenSincrono ? t : { ...t, volumeM3: null, areaM2: null }, history, ahoraMs);
  }

  /**
   * Devuelve el temporizador vigente, fijándolo de nuevo solo si toca.
   *
   * La banda muerta conserva el caudal estimado y vuelve a aplicar el stock actual.
   */
  private fijarTemporizador(plantId: string, t: AutonomiaTanque, now: Date): TemporizadorTanque {
    const porPlanta = this.temporizadores.get(plantId) ?? new Map<string, TemporizadorTanque>();
    this.temporizadores.set(plantId, porPlanta);
    const clave = t.tankKey;
    const previo = porPlanta.get(clave);

    // Pasar de vaciado real a proyección (o al revés) es un cambio de SIGNIFICADO, no de valor: el
    // número responde otra pregunta y hay que rehacerlo aunque el caudal sea idéntico.
    const cambioDeOrigen = previo !== undefined && previo.origen !== t.origen;
    const { recalcular } = debeRecalcular(previo, t.caudalLps, now.getTime(), this.sweepMs);
    // La regresión ya suaviza la tendencia: retener además una banda absoluta sesga caudales bajos.
    const tendenciaActual = t.origen === 'tendencia_volumen' || t.origen === 'tendencia_nivel';

    // El nivel/volumen vigente gobierna siempre el stock. La banda muerta solo estabiliza caudal.
    const estabilizado = previo && !recalcular && !cambioDeOrigen && !tendenciaActual && !t.limitacion && t.caudalLps > 0
      ? actualizarCaudal(t, previo.caudalFijadoLps) : t;

    const nuevo: TemporizadorTanque = {
      caudalFijadoLps: estabilizado.caudalLps,
      fijadoEnMs: previo && !recalcular && !cambioDeOrigen && !tendenciaActual ? previo.fijadoEnMs : now.getTime(),
      horasHasta50: estabilizado.horasHasta50,
      horasHasta0: estabilizado.horasHasta0,
      horasHastaReserva: estabilizado.horasHastaReserva,
      origen: t.origen,
    };
    porPlanta.set(clave, nuevo);
    return nuevo;
  }

  /**
   * Traduce la autonomía a un aviso, o a nada.
   *
   * Solo se avisa de lo que exige una decisión: estar por debajo del 50 % o quedarse sin margen de
   * tiempo. Un tanque lleno con doce horas por delante no es noticia, y avisar de él enseñaría al
   * operario a ignorar los que sí lo son.
   */
  private avisoDe(
    plantId: string,
    t: AutonomiaTanque,
    temporizador: TemporizadorTanque,
    now: Date,
  ): NewNotification | null {
    const horas = temporizador.horasHastaReserva ?? null;
    const bajo50 = t.reservaM !== null && t.levelM <= t.reservaM;
    const sinMargen = horas !== null && horas <= AUTONOMIA_CRITICA_H;
    if (!bajo50 && !sinMargen) return null;

    // Con la entrada abierta el tanque NO se está vaciando: es una proyección y no puede
    // presentarse como cuenta atrás. Ahí solo se avisa si además está por debajo del 50 %.
    if (t.origen.startsWith('proyeccion_') && !bajo50) return null;

    const tiempo = horas === null ? 'sin dato de autonomía' : `queda ${humanHoras(horas)}`;
    const reserva = t.reservaOrigen === 'op_min' ? 'mínimo operativo' : '50 % de referencia';
    const nivel = t.pct === null ? `${t.levelM.toFixed(2)} m` : `${t.pct.toFixed(0)} % (${t.levelM.toFixed(2)} m de ${t.maxM.toFixed(2)} m)`;

    return {
      kind: 'tank_autonomy',
      // Sin margen de tiempo es CRÍTICO aunque el porcentaje parezca aceptable: lo que decide es
      // cuánto falta para quedarse sin agua, no cuán lleno se ve el tanque.
      severity: sinMargen ? 'critical' : 'warning',
      plantId,
      subject: t.tankKey,
      title: sinMargen
        ? `${t.label}: reserva en ${humanHoras(horas!)}`
        : `${t.label}: por debajo del ${reserva}`,
      message:
        `El tanque está a ${nivel} y ${tiempo} hasta el ${reserva}. ` +
        (t.origen === 'tendencia_volumen' ? `Estimación por descenso del volumen propio (${temporizador.caudalFijadoLps.toFixed(1)} l/s netos). ` :
          t.origen === 'tendencia_nivel' ? 'Estimación por descenso del nivel propio. ' : 'No hay una tendencia propia suficiente para estimar el vaciado. ') +
        'La conexión del tanque con las válvulas no está declarada.',
      action: sinMargen
        ? 'Revisa el abastecimiento y el consumo del tanque antes de alcanzar la reserva.'
        : 'Verifica el nivel y el abastecimiento del tanque.',
      day: dedupeDay(now),
    };
  }
}
