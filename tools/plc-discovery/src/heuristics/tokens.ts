/**
 * Diccionarios y patrones de nomenclatura observados en el PLC maestro AQUATECH.
 *
 * IMPORTANTE: este PLC es un CONCENTRADOR. No expone tags por dispositivo
 * (no hay "TK01_Nivel" ni "EV01_Cmd"); expone BUFFERS DE ARRAY por sitio remoto,
 * intercambiados con los PLC locales mediante instrucciones MSG de Rockwell.
 * Por eso la taxonomía se construye sobre el nombre del buffer, no sobre nombres
 * de instrumento.
 */

/** Sitios remotos detectados en los nombres de los buffers. */
export const SITES = [
  'ALTO_MANGOS',
  'CAMPOALEGRE',
  'CARBONERO',
  'CASCAJAL',
  'KM18',
  'MANGOS',
  'MONTEBELLO',
  'PICHINDE',
  'QUIJOTE',
  'SAN_ANTONIO',
  'SAN_ANTONO', // erratipo real presente en el PLC (REAL_TK_SAN_ANTONO)
  'SIRENA',
  'SOLEDAD',
  'VORAGINE',
] as const;

/** Canaliza el nombre del buffer a un sitio (el más largo gana: ALTO_MANGOS antes que MANGOS). */
export function extractSite(browseName: string): string | null {
  const upper = browseName.toUpperCase();
  const matches = SITES.filter((s) => upper.includes(s)).sort((a, b) => b.length - a.length);
  if (matches.length === 0) return null;
  const site = matches[0];
  // Normaliza el erratipo del PLC para el modelo de dominio.
  return site === 'SAN_ANTONO' ? 'SAN_ANTONIO' : site;
}

export type ChannelKind =
  | 'DATA_IN_REAL'
  | 'DATA_IN_INT'
  | 'DATA_IN_BIT'
  | 'DATA_OUT_REAL'
  | 'DATA_OUT_INT'
  | 'MSG_CONTROL'
  | 'LOCAL_IO'
  | 'TEST'
  | 'UNKNOWN';

export interface ChannelClassification {
  kind: ChannelKind;
  direction: 'plc_local→maestro' | 'maestro→plc_local' | 'chasis_local' | 'diagnóstico' | 'desconocida';
  evidence: string[];
}

/**
 * Clasifica un tag de nivel superior de Controller Tags.
 * La dirección IN/OUT es relativa al PLC maestro: IN = datos que llegan del sitio
 * remoto; OUT = datos que el maestro envía al sitio remoto (comandos/consignas).
 */
export function classifyChannel(browseName: string): ChannelClassification {
  const n = browseName.toUpperCase();
  const evidence: string[] = [];

  if (/^LOCAL:\d+:[CIO]$/.test(n)) {
    evidence.push('patrón Local:<slot>:<C|I|O> = módulo de E/S del chasis CompactLogix');
    return { kind: 'LOCAL_IO', direction: 'chasis_local', evidence };
  }
  if (n.startsWith('MSG_')) {
    evidence.push('prefijo MSG_ = estructura MESSAGE de Rockwell (control de la instrucción MSG)');
    return { kind: 'MSG_CONTROL', direction: 'diagnóstico', evidence };
  }
  if (n.includes('PRUEBA') || n.includes('TEST')) {
    evidence.push('nombre contiene PRUEBA/TEST');
    return { kind: 'TEST', direction: 'desconocida', evidence };
  }

  const isOut = /_OUT_|_OUT$/.test(n);
  const isIn = /_IN_|_IN$/.test(n);
  const isReal = n.startsWith('REAL') || n.includes('_REAL') || n.startsWith('DATOS_');
  const isInt = n.startsWith('INT') || n.includes('_INT') || n.includes('ENTEROS');
  const isBit = n.startsWith('BIT');

  if (isBit) {
    evidence.push('prefijo BIT_ = palabra de bits empaquetados (estados discretos)');
    return { kind: 'DATA_IN_BIT', direction: 'plc_local→maestro', evidence };
  }
  if (isOut) {
    evidence.push('token _OUT_ = buffer que el maestro ESCRIBE hacia el PLC local (comandos/consignas)');
    return {
      kind: isReal ? 'DATA_OUT_REAL' : 'DATA_OUT_INT',
      direction: 'maestro→plc_local',
      evidence,
    };
  }
  if (isIn || /^REAL_TK/.test(n) || /^REAL_/.test(n)) {
    evidence.push('token _IN_ / prefijo REAL_ = buffer que el maestro LEE del PLC local (datos de proceso)');
    return {
      kind: isInt ? 'DATA_IN_INT' : 'DATA_IN_REAL',
      direction: 'plc_local→maestro',
      evidence,
    };
  }
  if (isInt) {
    evidence.push('tipo entero sin dirección explícita en el nombre');
    return { kind: 'DATA_IN_INT', direction: 'desconocida', evidence };
  }

  evidence.push('no coincide con ningún patrón conocido del PLC maestro');
  return { kind: 'UNKNOWN', direction: 'desconocida', evidence };
}

/** ¿El buffer parece dedicado a un tanque? (REAL_TK1_MONTEBELLO, REAL_TK_QUIJOTE…) */
export function tankHint(browseName: string): string | null {
  const m = /\bTK(\d*)_?/i.exec(browseName);
  if (!m) return null;
  return m[1] ? `TK${m[1]}` : 'TK';
}

/** Miembros de la estructura MESSAGE de Rockwell y su significado. */
export const MSG_MEMBERS: Record<string, string> = {
  EN: 'Enable — la instrucción MSG está habilitada',
  EW: 'Enable Waiting — esperando ventana de transmisión',
  ST: 'Start — mensaje en ejecución',
  DN: 'Done — última transacción completada con éxito',
  ER: 'Error — última transacción falló',
  TO: 'Timeout — la transacción excedió el tiempo',
  ERR: 'Código de error de la instrucción MSG',
  EXERR: 'Código de error extendido',
  ERR_SRC: 'Origen del error',
  DN_LEN: 'Longitud de datos transferidos en la última transacción',
  FLAGS: 'Palabra de banderas de estado de la MSG',
  EN_CC: 'Enable Cache Connection',
};

/** Unidades candidatas por rango de valor (SOLO hipótesis — nunca aserción). */
export interface MagnitudeHypothesis {
  magnitud: string;
  unidadProbable: string;
  razon: string;
}
