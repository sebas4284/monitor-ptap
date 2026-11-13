import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLogin } from './login-validation';

test('login: datos válidos no dan errores (el correo se recorta)', () => {
  assert.deepEqual(validateLogin('  ana@planta.co ', 'secreta'), {});
});

test('login: campos vacíos marcan cada campo por separado', () => {
  assert.deepEqual(Object.keys(validateLogin('', '')).sort(), ['email', 'password']);
  assert.deepEqual(Object.keys(validateLogin('ana@planta.co', '   ')), ['password']);
});

test('login: correo sin formato válido da error en el correo, no en la contraseña', () => {
  for (const bad of ['ana', 'ana@planta', 'ana @planta.co', '@planta.co']) {
    const errors = validateLogin(bad, 'secreta');
    assert.match(errors.email ?? '', /correo válido/, bad);
    assert.equal(errors.password, undefined);
  }
});
