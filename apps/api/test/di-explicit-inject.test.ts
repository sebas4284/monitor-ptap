import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppModule } from '../src/modules/app.module';

/**
 * tsx (esbuild) no emite `design:paramtypes`. Sin `@Inject` explícito, Nest arranca sin quejarse y
 * llama al constructor SIN argumentos: el fallo aparece después, como «Cannot read properties of
 * undefined». Los tests que hacen `new Clase(...)` no pueden verlo; este recorre lo que Nest resuelve.
 */
type Clase = { name: string; length: number };

function clasesDelModulo(raiz: unknown): Set<Clase> {
  const clases = new Set<Clase>();
  const vistos = new Set<unknown>();
  const visitar = (entrada: any): void => {
    const modulo = entrada?.forwardRef ? entrada.forwardRef() : entrada;
    if (!modulo || vistos.has(modulo)) return;
    vistos.add(modulo);
    // Módulo dinámico: { module, imports, providers, controllers }.
    const clase = modulo.module ?? modulo;
    const leer = (clave: string): any[] => [
      ...(Reflect.getMetadata(clave, clase) ?? []),
      ...(modulo.module ? (modulo[clave] ?? []) : []),
    ];
    leer('imports').forEach(visitar);
    for (const c of leer('controllers')) clases.add(c);
    for (const p of leer('providers')) {
      const provista = typeof p === 'function' ? p : p.useClass;
      if (provista) clases.add(provista);
    }
  };
  visitar(raiz);
  return clases;
}

test('todo controller y provider declara con @Inject cada parámetro de su constructor', () => {
  const clases = clasesDelModulo(AppModule);
  assert.ok(clases.size > 20, `el recorrido encontró solo ${clases.size} clases`);

  const sinToken: string[] = [];
  for (const clase of clases) {
    const declarados = new Set(
      (Reflect.getMetadata('self:paramtypes', clase) ?? []).map((p: { index: number }) => p.index),
    );
    // `length` no cuenta los parámetros con valor por defecto, que Nest tampoco está obligado a dar.
    for (let i = 0; i < clase.length; i++) {
      if (!declarados.has(i)) sinToken.push(`${clase.name}[${i}]`);
    }
  }
  assert.deepEqual(sinToken, []);
});
