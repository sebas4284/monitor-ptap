import type { CommandOutcome } from './command.dto';

/**
 * Cómo se cuenta una maniobra de válvula en la bandeja.
 *
 * Parte pura y probada aparte, porque este texto es **el registro operativo**: en estas plantas no
 * hay confirmación eléctrica de que la válvula se moviera, así que lo que queda escrito aquí es
 * toda la evidencia que habrá de quién hizo qué. Si el texto miente —o se calla el matiz de que la
 * orden salió pero nadie pudo confirmarla— el registro deja de valer.
 *
 * Antes esto vivía como un aviso efímero DENTRO de la pantalla de electroválvulas: se descartaba
 * con un toque, no lo veía nadie más y desaparecía al recargar. Una maniobra la tiene que ver todo
 * el equipo de la planta, y tiene que seguir ahí mañana.
 */

export interface ManiobraNotice {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  action: string | null;
}

/** Verbo en pasado, para contar lo que pasó y no lo que se pidió. */
function enPasado(command: string): string {
  const c = command.toLowerCase();
  if (c === 'open' || c === 'abrir') return 'abrió';
  if (c === 'close' || c === 'cerrar') return 'cerró';
  return `ejecutó «${command}» en`;
}

function enInfinitivo(command: string): string {
  const c = command.toLowerCase();
  if (c === 'open' || c === 'abrir') return 'abrir';
  if (c === 'close' || c === 'cerrar') return 'cerrar';
  return `ejecutar «${command}» en`;
}

/** `HH:MM` local, que es como la gente dice la hora. La fecha ya la pone la bandeja. */
function hora(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface ManiobraInput {
  /** Nombre de quien la ordenó, tal y como se llamaba ese día. */
  userName: string | null;
  userEmail: string | null;
  /** Nombre legible de la válvula («Válvula de entrada»), no su clave técnica. */
  valveName: string;
  command: string;
  status: CommandOutcome;
  at: string;
  /** Firma corta del registro sellado. `null` si la maniobra no llegó a firmarse. */
  firma: string | null;
  /**
   * `false` cuando el sitio no publica un estado de válvula fiable. En ese caso NO se puede afirmar
   * que la válvula se movió, por muy bien que respondiera el canal de comando.
   */
  estadoVerificado: boolean;
}

export function avisoDeManiobra(m: ManiobraInput): ManiobraNotice {
  const quien = m.userName?.trim() || m.userEmail?.trim() || 'Un usuario';
  const cuando = hora(m.at);
  const sello = m.firma ? ` · firma ${m.firma}` : '';

  if (m.status === 'rejected') {
    return {
      severity: 'info',
      title: `Orden rechazada: ${enInfinitivo(m.command)} ${m.valveName}`,
      // Que se rechace también es información: dice que alguien lo intentó y que el sistema no
      // dejó. Sin esto, el intento solo quedaba en la auditoría, que no mira nadie a diario.
      message: `${quien} intentó ${enInfinitivo(m.command)} ${m.valveName} a las ${cuando}. El sistema no dejó salir la orden, así que el equipo NO se tocó${sello}.`,
      action: null,
    };
  }

  if (m.status === 'failed') {
    return {
      severity: 'warning',
      title: `Maniobra sin completar: ${m.valveName}`,
      message: `${quien} ordenó ${enInfinitivo(m.command)} ${m.valveName} a las ${cuando}, pero el equipo no devolvió la confirmación esperada. Puede haberse movido o no${sello}.`,
      action: `Verificar en sitio cómo quedó ${m.valveName} antes de dar la maniobra por hecha.`,
    };
  }

  if (m.status === 'sent' || !m.estadoVerificado) {
    return {
      severity: 'warning',
      title: `${quien} ${enPasado(m.command)} ${m.valveName}`,
      // El matiz que no se puede perder: esta planta no informa del estado eléctrico de la válvula.
      // Decir «confirmado» aquí sería afirmar algo que nadie ha comprobado.
      message: `Orden enviada y aceptada por el equipo a las ${cuando}. Esta planta no reporta el estado eléctrico de la válvula, así que la maniobra no se puede confirmar desde aquí${sello}.`,
      action: `Verificar en sitio que ${m.valveName} quedó como se pidió.`,
    };
  }

  return {
    severity: 'info',
    title: `${quien} ${enPasado(m.command)} ${m.valveName}`,
    message: `Maniobra confirmada por el equipo a las ${cuando}${sello}.`,
    action: null,
  };
}
