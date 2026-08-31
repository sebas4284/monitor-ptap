/**
 * Lector del changelog que ve el usuario dentro de la app (`docs/NOVEDADES.md`).
 *
 * **Función pura, y separada del servicio a propósito**: así se prueba sin disco ni Nest, igual que
 * `raw-buffers.ts` se separó del controlador. Lo único que hace es convertir markdown en datos.
 *
 * Por qué un `.md` versionado y no una tabla: el changelog se escribe en el mismo commit que el
 * cambio que describe, y así queda revisado en el PR junto al código. Una tabla en MySQL habría
 * necesitado una pantalla de administración para algo que ya sabemos editar.
 */

export interface Novedad {
  /** Versión de la app (semver), tal como se publicó. */
  version: string;
  /** Fecha de publicación, como texto. `''` si el encabezado no la trae. */
  fecha: string;
  /** Los puntos de la entrada, en el orden en que están escritos. */
  puntos: string[];
}

/**
 * `## 1.3.0 — 2026-08-26`
 *
 * La versión tiene que parecer una versión. Es lo que permite que el archivo lleve además
 * secciones de prosa (`## Cómo se mantiene esto`) sin que se cuelen como si fueran releases.
 */
const ENCABEZADO = /^##\s+(\d+(?:\.\d+)*)\s*(?:[—–-]\s*(.+?))?\s*$/;
const VINETA = /^\s*[-*]\s+(.+?)\s*$/;
const OTRO_ENCABEZADO = /^#{1,6}\s/;

/** Versión a números, para ordenar. Lo que no sea un número cuenta como 0. */
function tupla(version: string): number[] {
  return version.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function masReciente(a: Novedad, b: Novedad): number {
  const ta = tupla(a.version);
  const tb = tupla(b.version);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const diff = (tb[i] ?? 0) - (ta[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Devuelve las entradas **de la más reciente a la más antigua**.
 *
 * Se ORDENA por versión en vez de confiar en el orden del archivo. El archivo se mantiene a mano y
 * el error probable es añadir la entrada nueva al final; si eso dejara la novedad enterrada bajo
 * cinco versiones viejas, la pestaña mentiría sin que nadie lo notara. Ordenar aquí hace que ese
 * despiste no tenga consecuencias.
 *
 * Tolerante por construcción: un archivo vacío, sin entradas o con prosa entre medias devuelve lo
 * que se pueda leer y **nunca lanza**. Esta pestaña es informativa; si el changelog está mal
 * escrito, lo correcto es no enseñar nada, no tumbar la bandeja de avisos.
 */
export function parseNovedades(md: string): Novedad[] {
  const novedades: Novedad[] = [];
  let actual: Novedad | null = null;
  let ultimoPunto = -1;

  for (const linea of md.split(/\r?\n/)) {
    const encabezado = ENCABEZADO.exec(linea);
    if (encabezado) {
      actual = { version: encabezado[1], fecha: encabezado[2]?.trim() ?? '', puntos: [] };
      ultimoPunto = -1;
      novedades.push(actual);
      continue;
    }

    // Cualquier OTRO encabezado cierra la entrada en curso. Sin esto, los puntos de una sección de
    // prosa que viniera después se atribuirían a la última versión leída.
    if (OTRO_ENCABEZADO.test(linea)) {
      actual = null;
      ultimoPunto = -1;
      continue;
    }

    if (!actual) continue;

    const vineta = VINETA.exec(linea);
    if (vineta) {
      actual.puntos.push(vineta[1]);
      ultimoPunto = actual.puntos.length - 1;
      continue;
    }

    // Continuación de un punto partido en varias líneas: se pega al anterior. Una línea en blanco
    // lo cierra, que es como se lee el markdown a ojo.
    if (linea.trim() === '') {
      ultimoPunto = -1;
      continue;
    }
    if (ultimoPunto >= 0) actual.puntos[ultimoPunto] += ` ${linea.trim()}`;
  }

  return novedades.filter((n) => n.puntos.length > 0).sort(masReciente);
}
