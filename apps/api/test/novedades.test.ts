/**
 * El changelog que ve el usuario (`docs/NOVEDADES.md`).
 *
 * La regla que fija este test: **el listado sale de la más reciente a la más antigua, pase lo que
 * pase con el orden del archivo.** El archivo se mantiene a mano y el despiste probable es añadir la
 * entrada nueva al final; si eso dejara la novedad enterrada, la pestaña mentiría en silencio.
 *
 * Y la otra mitad: un changelog mal escrito **no puede tumbar la bandeja de avisos**. Todos los
 * casos raros devuelven algo, ninguno lanza.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNovedades } from '../src/modules/app-release/novedades.parser';
import { NovedadesService } from '../src/modules/app-release/novedades.service';

test('novedades: lee versión, fecha y puntos', () => {
  const n = parseNovedades(`# Novedades

## 1.3.0 — 2026-08-26

- Vuelve el mando de las electroválvulas.
- La barra superior pasa a ser Aquora.
`);
  assert.equal(n.length, 1);
  assert.equal(n[0].version, '1.3.0');
  assert.equal(n[0].fecha, '2026-08-26');
  assert.deepEqual(n[0].puntos, ['Vuelve el mando de las electroválvulas.', 'La barra superior pasa a ser Aquora.']);
});

test('novedades: SIEMPRE la más reciente primero, aunque el archivo esté al revés', () => {
  // El caso que de verdad importa: alguien añade la entrada nueva al final del archivo.
  const n = parseNovedades(`
## 1.2.4 — 2026-08-22
- Lo viejo.

## 1.10.0 — 2026-09-01
- Lo nuevo.

## 1.9.0 — 2026-08-30
- Lo de en medio.
`);
  assert.deepEqual(
    n.map((x) => x.version),
    ['1.10.0', '1.9.0', '1.2.4'],
    '1.10.0 va por delante de 1.9.0: se compara por número, no como texto',
  );
});

test('novedades: un punto partido en varias líneas se lee como uno solo', () => {
  const n = parseNovedades(`## 1.3.0 — 2026-08-26
- Vuelve el mando de las electroválvulas, pero solo donde la planta
  puede obedecer de verdad.
- Otro punto.
`);
  assert.deepEqual(n[0].puntos, [
    'Vuelve el mando de las electroválvulas, pero solo donde la planta puede obedecer de verdad.',
    'Otro punto.',
  ]);
});

test('novedades: la prosa entre entradas no se cuela como puntos de la versión anterior', () => {
  // Es lo que permite que el archivo tenga instrucciones de mantenimiento arriba sin ensuciar nada.
  const n = parseNovedades(`## Cómo se mantiene esto

- Una entrada por versión publicada.

## 1.3.0 — 2026-08-26
- Lo de la versión.

## Notas internas
- Esto no debe salir en la app.
`);
  assert.equal(n.length, 1, 'solo los encabezados que parecen una versión abren entrada');
  assert.deepEqual(n[0].puntos, ['Lo de la versión.']);
});

test('novedades: un encabezado sin fecha no rompe nada', () => {
  const n = parseNovedades('## 1.4.0\n- Sin fecha.\n');
  assert.equal(n[0].version, '1.4.0');
  assert.equal(n[0].fecha, '');
});

test('novedades: una entrada sin puntos no se lista', () => {
  // Un encabezado suelto es un borrador a medias, no una novedad que anunciar.
  const n = parseNovedades('## 1.4.0 — 2026-09-01\n\n## 1.3.0 — 2026-08-26\n- Algo.\n');
  assert.deepEqual(n.map((x) => x.version), ['1.3.0']);
});

test('novedades: archivo vacío o sin entradas devuelve lista vacía y NO lanza', () => {
  assert.deepEqual(parseNovedades(''), []);
  assert.deepEqual(parseNovedades('# Novedades\n\nTodavía nada que contar.\n'), []);
  assert.deepEqual(parseNovedades('- una viñeta huérfana\n'), []);
});

test('novedades: el servicio lee el archivo en CADA llamada, sin cachear', () => {
  // Publicar un despliegue no reinicia el proceso: si esto cacheara, la app seguiría mostrando el
  // changelog anterior hasta el siguiente reinicio.
  const dir = mkdtempSync(join(tmpdir(), 'ptap-novedades-'));
  const archivo = join(dir, 'NOVEDADES.md');
  process.env.NOVEDADES_FILE = archivo;
  try {
    writeFileSync(archivo, '## 1.3.0 — 2026-08-26\n- Primera.\n');
    const svc = new NovedadesService();
    assert.deepEqual(svc.get().map((n) => n.version), ['1.3.0']);

    writeFileSync(archivo, '## 1.4.0 — 2026-09-01\n- Segunda.\n## 1.3.0 — 2026-08-26\n- Primera.\n');
    assert.deepEqual(
      svc.get().map((n) => n.version),
      ['1.4.0', '1.3.0'],
      'la misma instancia tiene que ver el archivo nuevo',
    );
  } finally {
    delete process.env.NOVEDADES_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('novedades: sin archivo, la pestaña sale vacía en vez de reventar', () => {
  process.env.NOVEDADES_FILE = join(tmpdir(), 'no-existe-ptap', 'NOVEDADES.md');
  try {
    assert.deepEqual(new NovedadesService().get(), []);
  } finally {
    delete process.env.NOVEDADES_FILE;
  }
});

test('novedades: el archivo REAL del repo se puede leer y está ordenado', () => {
  // Un test contra el archivo de verdad: si alguien lo edita y rompe el formato, salta aquí y no en
  // el teléfono de un operador.
  delete process.env.NOVEDADES_FILE;
  const n = new NovedadesService().get();
  assert.ok(n.length > 0, 'docs/NOVEDADES.md tiene que tener al menos una entrada legible');
  for (const entrada of n) {
    assert.match(entrada.version, /^\d+(\.\d+)*$/);
    assert.ok(entrada.puntos.length > 0, `${entrada.version} sin puntos`);
  }
});
