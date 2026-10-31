import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { PruebaPushDto, RegistroPushDto } from '@ptap/shared';
import { getAuthGeneration, getAuthToken, postJson, postJsonWithToken } from './api';
import { runningVersion } from './app-release';
import { ensureAndroidChannel, getPermission } from './device-notifications';
import { esFaltaDeFirebase, estadoTrasRegistro, type EstadoPush } from './push-rules';
import { tokenExpiryMs } from './session-store';

/**
 * Registro de ESTE teléfono para recibir los avisos por push (FCM).
 *
 * Con el push, el servidor empuja cada aviso en cuanto lo guarda y Android lo muestra por su cuenta
 * —banner, sonido, pantalla de bloqueo— aunque la app esté cerrada. Para eso el servidor necesita el
 * token de FCM del teléfono y a nombre de quién está: eso es lo que hace este módulo.
 *
 * **La marca `ptap_push_activo`** dice a la consulta de respaldo (`notification-sync`) que este teléfono
 * ya recibe los avisos por push y que no debe publicarlos otra vez. Se pone SOLO cuando el servidor
 * confirma que empuja (`pushActivo: true`) y se quita ante cualquier otra cosa —servidor sin clave,
 * fallo, cierre de sesión—: un teléfono que se creyera atendido por push sin estarlo se quedaría sin
 * ningún aviso, y eso es peor que un aviso repetido (que Android, además, reemplaza por su etiqueta).
 *
 * Solo Android: el token de iPhone es de APNs, no de FCM; y en web no hay push. Ahí todo esto es un
 * no-op y los avisos siguen llegando como antes.
 */

const PUSH_ACTIVO_KEY = 'ptap_push_activo';
/** El token que se registró, para poder darlo de baja al cerrar sesión. */
const PUSH_TOKEN_KEY = 'ptap_push_token';
/** La baja al cerrar sesión no puede dejar a nadie esperando: es lo mejor posible, no un requisito. */
const BAJA_TIMEOUT_MS = 4_000;
const REGISTRO_TIMEOUT_MS = 15_000;
interface SesionPush { token: string; generation: number }
let stoppedGeneration: number | null = null;
function sesionActual(): SesionPush | null {
  const token = getAuthToken();
  if (!token || stoppedGeneration === getAuthGeneration()) return null;
  const expiry = tokenExpiryMs(token);
  return expiry !== null && expiry <= Date.now() ? null : { token, generation: getAuthGeneration() };
}
function sigueActual(session: SesionPush): boolean {
  return session.token === getAuthToken() && session.generation === getAuthGeneration() && session.generation !== stoppedGeneration;
}

// Preserve ordering across logout/login: old registration -> old owner's unregister -> new registration.
// The outgoing JWT is captured; a delayed cleanup never borrows the new user's credentials.
let networkTail: Promise<unknown> = Promise.resolve();
function enOrden<T>(operation: () => Promise<T>): Promise<T> {
  const result = networkTail.catch(() => undefined).then(operation);
  networkTail = result.catch(() => undefined);
  return result;
}
const tokensPorSesion = new Map<string, Set<string>>();
async function enviar<T>(path: string, body: unknown, bearer: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await postJsonWithToken<T>(path, body, bearer, controller.signal); }
  finally { clearTimeout(timer); }
}

/** ¿Recibe este teléfono los avisos por push? Lo consulta `notification-sync` antes de publicar. */
export async function pushActivo(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUSH_ACTIVO_KEY)) === '1';
  } catch {
    // Sin poder leer la marca, se publica: peor un aviso repetido que uno perdido.
    return false;
  }
}

async function recordar(token: string | null, activo: boolean): Promise<void> {
  try {
    await Promise.all([
      activo ? AsyncStorage.setItem(PUSH_ACTIVO_KEY, '1') : AsyncStorage.removeItem(PUSH_ACTIVO_KEY),
      token ? AsyncStorage.setItem(PUSH_TOKEN_KEY, token) : Promise.resolve(),
    ]);
  } catch {
    /* sin almacenamiento la marca no se guarda, y la consulta de respaldo sigue publicando */
  }
}

async function olvidar(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([PUSH_ACTIVO_KEY, PUSH_TOKEN_KEY]);
  } catch {
    /* nada que hacer: lo peor es que la consulta de respaldo no publique hasta el próximo registro */
  }
}

/**
 * Altas en curso por token. El hook se monta dos veces (franja de permiso y tarjeta de Ajustes) y
 * pedir el token dispara además el oyente de cambios: sin esto, el mismo token se registraba dos o tres
 * veces a la vez.
 */
const altasEnCurso = new Map<number, Map<string, Promise<EstadoPush>>>();

function registrarToken(token: string, session: SesionPush): Promise<EstadoPush> {
  const altas = altasEnCurso.get(session.generation) ?? new Map<string, Promise<EstadoPush>>();
  altasEnCurso.set(session.generation, altas);
  const enCurso = altas.get(token);
  if (enCurso) return enCurso;
  const alta = enOrden(async (): Promise<EstadoPush> => {
    if (!sigueActual(session)) return 'pendiente';
    try {
      if ((await getPermission()) !== 'granted' || !sigueActual(session)) return 'pendiente';
      const known = tokensPorSesion.get(session.token) ?? new Set<string>();
      known.add(token);
      tokensPorSesion.set(session.token, known);
      const respuesta = await enviar<RegistroPushDto>('/api/notifications/devices', {
        token,
        platform: 'android',
        appVersion: runningVersion(),
      }, session.token, REGISTRO_TIMEOUT_MS);
      if (!sigueActual(session)) return 'pendiente';
      const estado = estadoTrasRegistro(respuesta);
      await recordar(token, estado === 'activo');
      return estado;
    } catch {
      if (sigueActual(session)) await recordar(null, false);
      return 'error';
    }
  }).finally(() => {
    altas.delete(token);
    if (!altas.size) altasEnCurso.delete(session.generation);
  });
  altas.set(token, alta);
  return alta;
}

const registrosEnCurso = new Map<number, Promise<EstadoPush>>();

/**
 * Registra este teléfono con el token de FCM actual. Se llama con el permiso concedido y la sesión
 * abierta: al abrir la app y cada vez que vuelve a primer plano. Volver a registrar es barato y es
 * lo que mantiene la marca al día (si el servidor pierde la clave, el teléfono vuelve a publicar solo).
 *
 * Nunca lanza.
 */
export function registrarPush(): Promise<EstadoPush> {
  const session = sesionActual();
  if (!session) return Promise.resolve('pendiente');
  const existing = registrosEnCurso.get(session.generation);
  if (existing) return existing;
  const result = registrar(session).finally(() => {
    registrosEnCurso.delete(session.generation);
  });
  registrosEnCurso.set(session.generation, result);
  return result;
}

async function registrar(session: SesionPush): Promise<EstadoPush> {
  if (Platform.OS !== 'android') return 'no-disponible';
  try {
    await ensureAndroidChannel();
    if (!sigueActual(session)) return 'pendiente';
    if ((await getPermission()) !== 'granted') {
      if (sigueActual(session)) await recordar(null, false);
      return 'pendiente';
    }
    const Notifications = await import('expo-notifications');
    if (!sigueActual(session)) return 'pendiente';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data } = await Promise.race([
      Notifications.getDevicePushTokenAsync(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('FCM token timeout')), REGISTRO_TIMEOUT_MS);
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!sigueActual(session)) return 'pendiente';
    if (typeof data !== 'string' || !data) throw new Error('FCM no devolvió un token');
    return await registrarToken(data, session);
  } catch (err) {
    if (sigueActual(session)) await recordar(null, false);
    // Una APK compilada sin `google-services.json` no puede tener token: no es un fallo pasajero.
    return esFaltaDeFirebase(err) ? 'no-disponible' : 'error';
  }
}

/**
 * FCM puede rotar el token con la app abierta; el viejo deja de valer. Esto registra el nuevo en
 * cuanto llega. El viejo no hace falta darlo de baja: el primer envío a él fallará con «no
 * registrado» y el servidor lo borra solo.
 *
 * Devuelve la función para dejar de escuchar.
 */
export function escucharCambiosDeToken(alCambiar?: (estado: EstadoPush) => void): () => void {
  if (Platform.OS !== 'android') return () => undefined;
  const session = sesionActual();
  if (!session) return () => undefined;
  let vivo = true;
  let quitar: (() => void) | null = null;
  void import('expo-notifications')
    .then((Notifications) => {
      if (!vivo) return;
      // Ojo: dentro de este oyente NO se puede llamar a `getDevicePushTokenAsync` —lo vuelve a
      // disparar—; por eso se registra el token que trae el evento.
      const sub = Notifications.addPushTokenListener(({ data }) => {
        if (typeof data !== 'string' || !data || !sigueActual(session)) return;
        void registrarToken(data, session).then((estado) => {
          if (vivo && sigueActual(session)) alCambiar?.(estado);
        });
      });
      quitar = () => sub.remove();
    })
    .catch(() => {
      /* sin el módulo nativo no hay token que vigilar */
    });
  return () => {
    vivo = false;
    quitar?.();
  };
}

/**
 * Da de baja este teléfono al CERRAR SESIÓN. Lo llama `AuthContext.logout` ANTES de borrar el JWT,
 * porque la baja necesita la sesión. Lo mejor posible: nunca lanza y no espera más de unos segundos.
 *
 * Primero olvida la marca y el token guardados y después pide la baja. El orden importa: si la baja
 * recibe un 401, ese 401 vuelve a llamar a `logout` y, con ello, aquí; la segunda vez ya no encuentra
 * nada que dar de baja y no se forma un bucle de peticiones.
 *
 * Si la sesión ya venció (el cierre automático de las 8 h), no se pide nada: la baja daría 401. El
 * teléfono sigue recibiendo los avisos por push, que es lo decidido —el push no depende de la sesión
 * de 8 h— y se corta si la cuenta se desactiva o cambia de rol, porque los destinatarios se calculan
 * en cada envío.
 */
export async function desregistrarPush(): Promise<void> {
  // Queue synchronously before reading storage so the following login cannot overtake cleanup.
  // AuthContext retains the outgoing JWT during cleanup; that must not allow a new registration.
  stoppedGeneration = getAuthGeneration();
  const sesion = getAuthToken();
  const cleanup = enOrden(async () => {
    const tokens = new Set(sesion ? tokensPorSesion.get(sesion) : []);
    try {
      const saved = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
      if (saved) tokens.add(saved);
    } catch { /* in-flight registrations are tracked without relying on storage */ }
    await olvidar();
    if (!sesion) return;
    tokensPorSesion.delete(sesion);
    const exp = tokenExpiryMs(sesion);
    if (exp !== null && exp <= Date.now()) return;
    await Promise.all([...tokens].map(token =>
      enviar('/api/notifications/devices/unregister', { token }, sesion, BAJA_TIMEOUT_MS).catch(() => undefined)));
  }).catch(() => undefined);
  let limite: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        limite = setTimeout(resolve, BAJA_TIMEOUT_MS);
      }),
    ]);
  } catch {
    /* best effort; a later login reassigns this device without borrowing its JWT for old cleanup */
  } finally {
    if (limite) clearTimeout(limite);
  }
}

/** «Enviar aviso de prueba» de Ajustes: el servidor lo manda solo a los teléfonos de quien lo pide. */
export function probarPush(): Promise<PruebaPushDto> {
  return postJson<PruebaPushDto>('/api/notifications/devices/prueba', {});
}
