/**
 * SRV-04 — autenticación del handshake de Socket.IO. La garantía: sin un JWT válido en el
 * handshake, la conexión se corta ANTES de que el cliente pueda suscribirse a una planta, así
 * que la telemetría en vivo deja de ser legible por cualquiera con red al backend. Con
 * `SOCKET_AUTH_REQUIRED=false` (solo el demo de telemetría) no se exige.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectivityGateway } from '../src/infrastructure/connectivity/connectivity.gateway';
import { JwtService } from '../src/modules/auth/jwt.service';
import type { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import type { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { Socket } from 'socket.io';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-gateway-auth';

function gateway(): ConnectivityGateway {
  // handleConnection no usa pipeline/cache: dobles vacíos bastan.
  return new ConnectivityGateway({} as unknown as PlantPipelineService, {} as unknown as PlantCache);
}

/** Socket doble: registra si se llamó disconnect(). */
function fakeSocket(token?: string): { socket: Socket; disconnected: () => boolean } {
  let disconnected = false;
  const socket = {
    id: 'sock-1',
    handshake: { auth: token === undefined ? {} : { token } },
    disconnect: () => { disconnected = true; return socket; },
  } as unknown as Socket;
  return { socket, disconnected: () => disconnected };
}

const validToken = (): string =>
  new JwtService().sign({ sub: 'u1', email: 'a@b.com', name: 'A', role: 'operador', plant: 'montebello' });

test('SRV-04: token válido → NO se desconecta', () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, disconnected } = fakeSocket(validToken());
  gateway().handleConnection(socket);
  assert.equal(disconnected(), false);
});

test('SRV-04: sin token → se desconecta', () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, disconnected } = fakeSocket(undefined);
  gateway().handleConnection(socket);
  assert.equal(disconnected(), true);
});

test('SRV-04: token inválido → se desconecta', () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, disconnected } = fakeSocket('no-es-un-jwt');
  gateway().handleConnection(socket);
  assert.equal(disconnected(), true);
});

test('SRV-04: SOCKET_AUTH_REQUIRED=false (demo) → no exige token', () => {
  process.env.SOCKET_AUTH_REQUIRED = 'false';
  try {
    const { socket, disconnected } = fakeSocket(undefined);
    gateway().handleConnection(socket);
    assert.equal(disconnected(), false);
  } finally {
    delete process.env.SOCKET_AUTH_REQUIRED;
  }
});
