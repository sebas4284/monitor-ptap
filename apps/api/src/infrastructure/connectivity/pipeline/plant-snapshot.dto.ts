/**
 * DTO por planta — contrato hacia REST + Socket.IO + frontend.
 *
 * DEF-08: los tipos VIVEN en @ptap/shared (fuente única backend↔móvil); este archivo los
 * re-exporta para que el pipeline siga importando de su módulo. Añadir un campo o un estado
 * se declara UNA vez en shared y ambos lados lo ven tipado.
 *
 * Recordatorios de dominio (la doc completa acompaña a los tipos en shared):
 *  - Liveness de TRES estados: `stable` = sesión sana con valores quietos (operación NORMAL,
 *    datos VÁLIDOS — un tanque a nivel constante no es una avería); `frozen` = perdimos la
 *    fuente (puente caído/reconectando) y los datos dejan de ser fiables. El heartbeat del
 *    puente es lo que permite distinguir "no se mueve" de "no llega".
 *  - El frontend NUNCA recibe arrays crudos (regla 4): solo señales de dominio (SignalDto).
 *  - `ts` es el SourceTimestamp del PLC (regla 7), nunca Date.now().
 */
export type {
  BridgeStatus,
  OpcQuality,
  LivenessState,
  UnusableReason,
  Confidence,
  SignalDto,
  LivenessDto,
  PlantSnapshotDto,
  LivenessChange,
} from '@ptap/shared';
