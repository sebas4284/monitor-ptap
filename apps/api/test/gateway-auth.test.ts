/**
 * SRV-04 — autenticación del handshake de Socket.IO. La garantía: sin un JWT válido en el
 * handshake, la conexión se corta ANTES de que el cliente pueda suscribirse a una planta, así
 * que la telemetría en vivo deja de ser legible por cualquiera con red al backend. Con
 * `SOCKET_AUTH_REQUIRED=false` (solo el demo de telemetría) no se exige.
 *
 * Y ÁMBITO POR PLANTA, que es lo que faltaba: autenticar no era suficiente. El gateway validaba el
 * JWT y descartaba el payload, así que cualquier cuenta autenticada podía pedir `opc:subscribe` de
 * cualquier planta y recibir su telemetría en vivo. Lo tapaba que el móvil solo pide la suya; un
 * cliente hecho a mano no tiene esa cortesía. Misma regla que el resto del sistema:
 * `view_all_plants` (hoy Admin) ve todo, el resto solo su planta.
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subject } from 'rxjs';
import type { LivenessChange, Role } from '@ptap/shared';
import { ConnectivityGateway } from '../src/infrastructure/connectivity/connectivity.gateway';
import { JwtService } from '../src/modules/auth/jwt.service';
import type { PlantPipelineService } from '../src/infrastructure/connectivity/pipeline/plant-pipeline.service';
import type { PlantCache } from '../src/infrastructure/connectivity/pipeline/plant-cache';
import type { Socket } from 'socket.io';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-gateway-auth';

const SNAPSHOT = { plantId: 'stub' };

function gateway(): ConnectivityGateway {
  return new ConnectivityGateway({} as unknown as PlantPipelineService, {
    get: (plantId: string) => ({ ...SNAPSHOT, plantId }),
  } as unknown as PlantCache);
}

interface FakeSocket {
  socket: Socket;
  disconnected: () => boolean;
  rooms: Set<string>;
  emitted: { event: string; payload: unknown }[];
}

/** Socket doble: registra disconnect(), las rooms en las que está y lo que se le emitió. */
function fakeSocket(token?: string): FakeSocket {
  let disconnected = false;
  const rooms = new Set<string>(['sock-1']); // socket.io siempre mete al socket en su propia room
  const emitted: { event: string; payload: unknown }[] = [];
  const socket = {
    id: 'sock-1',
    handshake: { auth: token === undefined ? {} : { token } },
    rooms,
    data: {},
    join: async (room: string) => { rooms.add(room); },
    leave: async (room: string) => { rooms.delete(room); },
    emit: (event: string, payload: unknown) => { emitted.push({ event, payload }); return true; },
    disconnect: () => { disconnected = true; return socket; },
  } as unknown as Socket;
  return { socket, disconnected: () => disconnected, rooms, emitted };
}

function tokenFor(role: Role, plant: string): string {
  return new JwtService().sign({ sub: 'u1', email: 'a@b.com', name: 'A', role, plant });
}

const validToken = (): string => tokenFor('operador', 'montebello');

/** Deja el socket conectado y con su ámbito ya fijado, listo para suscribirse. */
async function conectado(role: Role, plant: string): Promise<{ gw: ConnectivityGateway } & FakeSocket> {
  const gw = gateway();
  const f = fakeSocket(tokenFor(role, plant));
  await gw.handleConnection(f.socket);
  return { gw, ...f };
}

test('SRV-04: token válido → NO se desconecta', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, disconnected } = fakeSocket(validToken());
  await gateway().handleConnection(socket);
  assert.equal(disconnected(), false);
});

test('SRV-04: sin token → se desconecta', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, disconnected } = fakeSocket(undefined);
  await gateway().handleConnection(socket);
  assert.equal(disconnected(), true);
});

test('SRV-04: token inválido → se desconecta', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, disconnected } = fakeSocket('no-es-un-jwt');
  await gateway().handleConnection(socket);
  assert.equal(disconnected(), true);
});

test('SRV-04: SOCKET_AUTH_REQUIRED=false (demo) → no exige token', async () => {
  process.env.SOCKET_AUTH_REQUIRED = 'false';
  try {
    const { socket, disconnected, rooms } = fakeSocket(undefined);
    await gateway().handleConnection(socket);
    assert.equal(disconnected(), false);
    assert.ok(rooms.has('scope:*'), 'el demo ve todas las plantas');
  } finally {
    delete process.env.SOCKET_AUTH_REQUIRED;
  }
});

test('ámbito: el handshake deja al operador en la room de ámbito de SU planta', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { rooms } = await conectado('operador', 'km18');
  assert.ok(rooms.has('scope:km18'));
  assert.ok(!rooms.has('scope:*'), 'un operador no debe quedar en el ámbito global');
});

test('ámbito: el admin (view_all_plants) queda en el ámbito global', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { rooms } = await conectado('admin', 'voragine');
  assert.ok(rooms.has('scope:*'));
});

test('opc:subscribe: el operador entra a SU planta y recibe el snapshot', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { gw, socket, rooms, emitted } = await conectado('operador', 'km18');
  await gw.subscribeToPlant({ plantId: 'km18' }, socket);

  assert.ok(rooms.has('km18'), 'debe unirse a la room de su planta');
  assert.deepEqual(emitted.at(-1), { event: 'opc:snapshot', payload: { plantId: 'km18' } });
});

test('opc:subscribe: el operador NO entra a otra planta — ni room ni snapshot', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { gw, socket, rooms, emitted } = await conectado('operador', 'km18');
  await gw.subscribeToPlant({ plantId: 'cascajal' }, socket);

  assert.ok(!rooms.has('cascajal'), 'NUNCA debe unirse a la room de una planta ajena');
  assert.equal(
    emitted.some((e) => e.event === 'opc:snapshot'),
    false,
    'no debe filtrarse ni un snapshot suelto',
  );
  // Rechazo explícito, no silencio: si no, la pantalla queda vacía y parece una avería.
  assert.equal(emitted.at(-1)?.event, 'opc:denied');
});

test('opc:subscribe: el jefe tampoco cruza de planta', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { gw, socket, rooms } = await conectado('jefe', 'km18');
  await gw.subscribeToPlant({ plantId: 'sirena' }, socket);
  assert.ok(!rooms.has('sirena'));
});

test('opc:subscribe: el admin entra a cualquier planta', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { gw, socket, rooms } = await conectado('admin', 'voragine');
  await gw.subscribeToPlant({ plantId: 'cascajal' }, socket);
  assert.ok(rooms.has('cascajal'));
});

test('opc:subscribe: cambiar de planta NO saca al socket de su room de ámbito', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { gw, socket, rooms } = await conectado('admin', 'voragine');
  await gw.subscribeToPlant({ plantId: 'cascajal' }, socket);
  await gw.subscribeToPlant({ plantId: 'sirena' }, socket);

  assert.ok(rooms.has('sirena'), 'entra a la nueva');
  assert.ok(!rooms.has('cascajal'), 'y sale de la anterior');
  // Si se saliera del ámbito, dejaría de recibir opc:liveness y los badges se congelarían.
  assert.ok(rooms.has('scope:*'), 'el ámbito sobrevive al cambio de planta');
});

test('opc:subscribe: sin ámbito (handleConnection no corrió) falla CERRADO', async () => {
  delete process.env.SOCKET_AUTH_REQUIRED;
  const { socket, rooms } = fakeSocket(validToken());
  await gateway().subscribeToPlant({ plantId: 'km18' }, socket);
  assert.ok(!rooms.has('km18'), 'un fallo de wiring no debe abrir el acceso a todo');
});

test('opc:liveness: se emite a la room de ámbito de la planta y a la global, no en broadcast', () => {
  const liveness$ = new Subject<LivenessChange>();
  const gw = new ConnectivityGateway(
    { snapshot$: new Subject(), liveness$ } as unknown as PlantPipelineService,
    {} as unknown as PlantCache,
  );

  const envios: { rooms: string[]; event: string }[] = [];
  let broadcasts = 0;
  (gw as unknown as { server: unknown }).server = {
    to: (rooms: string[]) => ({
      emit: (event: string) => { envios.push({ rooms, event }); return true; },
    }),
    emit: () => { broadcasts++; return true; }, // el broadcast global ya NO debe usarse
  };

  gw.onModuleInit();
  try {
    liveness$.next({ plantId: 'cascajal', state: 'live', lastChangeAt: null, windowSec: 300 });

    assert.equal(broadcasts, 0, 'nada de repartir las doce plantas a todo el mundo');
    assert.equal(envios.length, 1);
    assert.equal(envios[0].event, 'opc:liveness');
    // Solo quien puede ver Cascajal: su ámbito y el global (Admin). El operador de km18 está en
    // 'scope:km18', que no aparece aquí, así que nunca lo recibe.
    assert.deepEqual([...envios[0].rooms].sort(), ['scope:*', 'scope:cascajal']);
  } finally {
    gw.onModuleDestroy();
  }
});
