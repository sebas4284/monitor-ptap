import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { SignalDto, TankAutonomyDto } from '@ptap/shared';
import { PlantCache } from '../../infrastructure/connectivity/pipeline/plant-cache';
import { PlantPipelineService } from '../../infrastructure/connectivity/pipeline/plant-pipeline.service';
import { TankAutonomyStore } from '../../infrastructure/connectivity/pipeline/tank-autonomy.store';
import { dedupeDay } from './notification-day';
import { FlowHourlyRepository } from './flow-hourly.repository';
import { NotificationRepository, type NewNotification } from './notification.repository';
import {
  analizarAutonomia,
  debeRecalcular,
  humanHoras,
  outletFlow,
  AUTONOMIA_CRITICA_H,
  FRACCION_CRITICA,
  type AutonomiaTanque,
  type TemporizadorTanque,
} from './tank-autonomy.analyzer';

/**
 * Autonomía del tanque: cuánto aguanta antes de llegar al 50 % y de vaciarse.
 *
 * El cliente lo pidió como «vida útil de la planta» (2026-08-20), y su propósito operativo es que
 * alguien pueda decidir ANTES de cerrar la entrada, no enterarse cuando ya no hay agua.
 *
 * Dos cosas lo separan de los otros detectores:
 *
 *  1. **Barre cada minuto**, no cada diez. La autonomía es un temporizador, y a diez minutos daría
 *     saltos de diez minutos.
 *  2. **Mantiene un temporizador por tanque** y NO lo recalcula en cada barrido. Con el caudal
 *     instantáneo el número saltaba de 5 h a 3 h y volvía, y así no sirve para decidir nada. Las
 *     reglas de cuándo sí se recalcula están en `debeRecalcular`, con los umbrales que dio el
 *     cliente: banda muerta de 0,2 l/s y salto de régimen de 0,6 l/s.
 *
 * También alimenta el promedio horario del caudal de salida, que es lo que permite proyectar la
 * autonomía cuando la entrada está abierta y el tanque no se está vaciando.
 */
@Injectable()
export class TankAutonomyDetector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TankAutonomy');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepMs = Number(process.env.AUTONOMY_SWEEP_MS ?? 60_000);

  /** plantId → (tank<N> → temporizador vigente). Volátil: al reiniciar se vuelve a fijar. */
  private readonly temporizadores = new Map<string, Map<string, TemporizadorTanque>>();

  /** Acumulador de la hora en curso por planta; se vuelca a la base al cambiar de hora. */
  private readonly horaEnCurso = new Map<string, { horaMs: number; suma: number; muestras: number }>();

  constructor(
    private readonly pipeline: PlantPipelineService,
    private readonly cache: PlantCache,
    private readonly repo: NotificationRepository,
    private readonly flujo: FlowHourlyRepository,
    private readonly store: TankAutonomyStore,
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
        if (!snapshot || snapshot.pending) continue;

        await this.acumularCaudal(plant.plantId, snapshot.signals, now);

        // El promedio de 24 h solo se usa con la entrada abierta. Si aún no hay historia se pasa
        // null y el analizador no proyecta nada, en vez de inventar un consumo con dos muestras.
        const promedio = await this.flujo.promedio(plant.plantId, 'outletFlow1', 24);
        const lecturas = analizarAutonomia(snapshot, promedio?.avgLps ?? null);

        const publicables: TankAutonomyDto[] = [];
        for (const t of lecturas) {
          const temporizador = this.fijarTemporizador(plant.plantId, t, now);
          publicables.push({
            tankN: t.tankN,
            hoursTo50: temporizador.horasHasta50,
            hoursTo0: temporizador.horasHasta0,
            flowLps: temporizador.caudalFijadoLps,
            basis: temporizador.origen,
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

  /**
   * Acumula el caudal de salida en la hora en curso y lo vuelca a la base al cambiar de hora.
   *
   * Se escribe una vez por hora y no una por minuto: son 24 filas por planta al día en vez de 1.440,
   * y el promedio sale igual. La hora parcial se pierde si el proceso se reinicia — aceptable para
   * un promedio de 24 h, y escribir cada minuto sería castigar la base para ganar una precisión que
   * nadie va a notar.
   */
  private async acumularCaudal(plantId: string, signals: Record<string, SignalDto>, now: Date): Promise<void> {
    const caudal = outletFlow(signals);
    if (caudal === null || caudal < 0) return;

    const horaMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
    const actual = this.horaEnCurso.get(plantId);

    if (!actual) {
      this.horaEnCurso.set(plantId, { horaMs, suma: caudal, muestras: 1 });
      return;
    }
    if (actual.horaMs !== horaMs) {
      await this.flujo.upsert(
        plantId,
        'outletFlow1',
        new Date(actual.horaMs),
        actual.suma / actual.muestras,
        actual.muestras,
      );
      this.horaEnCurso.set(plantId, { horaMs, suma: caudal, muestras: 1 });
      return;
    }
    actual.suma += caudal;
    actual.muestras += 1;
  }

  /**
   * Devuelve el temporizador vigente, fijándolo de nuevo solo si toca.
   *
   * Cuando NO toca recalcular se devuelve el anterior tal cual, y eso es justo lo que hace que el
   * número corra como un reloj en vez de recalcularse —y bailar— en cada barrido.
   */
  private fijarTemporizador(plantId: string, t: AutonomiaTanque, now: Date): TemporizadorTanque {
    const porPlanta = this.temporizadores.get(plantId) ?? new Map<string, TemporizadorTanque>();
    this.temporizadores.set(plantId, porPlanta);
    const clave = `tank${t.tankN}`;
    const previo = porPlanta.get(clave);

    // Pasar de vaciado real a proyección (o al revés) es un cambio de SIGNIFICADO, no de valor: el
    // número responde otra pregunta y hay que rehacerlo aunque el caudal sea idéntico.
    const cambioDeOrigen = previo !== undefined && previo.origen !== t.origen;
    const { recalcular } = debeRecalcular(previo, t.caudalLps, now.getTime(), this.sweepMs);

    if (previo && !recalcular && !cambioDeOrigen) return previo;

    const nuevo: TemporizadorTanque = {
      caudalFijadoLps: t.caudalLps,
      fijadoEnMs: now.getTime(),
      horasHasta50: t.horasHasta50,
      horasHasta0: t.horasHasta0,
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
    const horas = temporizador.horasHasta0;
    const bajo50 = t.pct < FRACCION_CRITICA * 100;
    const sinMargen = horas !== null && horas <= AUTONOMIA_CRITICA_H;
    if (!bajo50 && !sinMargen) return null;

    // Con la entrada abierta el tanque NO se está vaciando: es una proyección y no puede
    // presentarse como cuenta atrás. Ahí solo se avisa si además está por debajo del 50 %.
    if (t.origen === 'proyeccion_24h' && !bajo50) return null;

    const tiempo = horas === null ? 'sin dato de autonomía' : `queda ${humanHoras(horas)}`;
    const hasta50 = temporizador.horasHasta50;

    return {
      kind: 'tank_autonomy',
      // Sin margen de tiempo es CRÍTICO aunque el porcentaje parezca aceptable: lo que decide es
      // cuánto falta para quedarse sin agua, no cuán lleno se ve el tanque.
      severity: sinMargen ? 'critical' : 'warning',
      plantId,
      subject: `tank${t.tankN}`,
      title: sinMargen
        ? `${t.label}: menos de ${AUTONOMIA_CRITICA_H} h de autonomía`
        : `${t.label}: por debajo del 50 %`,
      message:
        `El tanque está al ${t.pct.toFixed(0)} % (${t.levelM.toFixed(2)} m de ${t.maxM.toFixed(2)} m) y ${tiempo} ` +
        `hasta vaciarse${hasta50 !== null && hasta50 > 0 ? `, ${humanHoras(hasta50)} hasta el 50 %` : ''}. ` +
        (t.origen === 'vaciado_real'
          ? `La entrada está cerrada, así que se vacía de verdad a ${t.caudalLps.toFixed(1)} l/s.`
          : `La entrada está abierta: es una proyección con el consumo medio del día (${t.caudalLps.toFixed(1)} l/s), no una cuenta atrás.`),
      action: sinMargen
        ? 'Abre la entrada al tanque o reduce la salida ahora: por debajo del 50 % la presión ya da problemas en la red.'
        : 'Revisa la entrada al tanque. Por debajo del 50 % empiezan los fallos de presión en las tuberías.',
      day: dedupeDay(now),
    };
  }
}
