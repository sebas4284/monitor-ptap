import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

/**
 * Estado de la conexión DEL DISPOSITIVO (antes de que intervengan el servidor o el PLC):
 *   offline     → no está conectado a ninguna red (WiFi/datos apagados).
 *   no-internet → conectado a una red, pero esa red no tiene salida a internet (proveedor).
 *   online      → hay internet; si aún así no se llega al servidor, el problema es del servidor.
 *   checking    → comprobando (el ping a internet está en curso).
 */
export type ClientNetworkStatus = 'offline' | 'no-internet' | 'online' | 'checking';

/** Host público de comprobación de conectividad (devuelve 204, pensado para esto). */
const CONNECTIVITY_PROBE_URL = 'https://www.gstatic.com/generate_204';
const PROBE_TIMEOUT_MS = 4000;

/** ¿El dispositivo dice estar conectado a una red? En nativo `navigator.onLine` no existe → se
 *  asume que sí (la distinción offline vs. sin-internet exigiría netinfo; el ping cubre el resto). */
function readOnLine(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') return navigator.onLine;
  return true;
}

/**
 * true si internet responde. Ping `no-cors` (respuesta opaca, solo importa si LLEGÓ) con timeout:
 * resuelve si el host es alcanzable, rechaza si la red no tiene salida.
 */
async function probeInternet(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(CONNECTIVITY_PROBE_URL, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `enabled` = solo comprobar cuando hace falta (la app NO alcanza al servidor). Cuando todo va
 * bien no se hace ningún ping externo — el diagnóstico solo se activa ante un corte.
 */
export function useClientNetworkStatus(enabled: boolean): ClientNetworkStatus {
  const [online, setOnline] = useState<boolean>(readOnLine());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const update = () => setOnline(readOnLine());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Solo se pinga internet si el dispositivo cree estar conectado Y no se llega al servidor.
  const probeEnabled = enabled && online;
  const { data: internetReachable, isLoading } = useQuery({
    queryKey: ['internet-probe'],
    queryFn: probeInternet,
    enabled: probeEnabled,
    refetchInterval: probeEnabled ? 10_000 : false,
    retry: false,
    staleTime: 5_000,
  });

  if (!online) return 'offline';
  if (!probeEnabled) return 'online'; // no hay corte que diagnosticar
  if (isLoading || internetReachable === undefined) return 'checking';
  return internetReachable ? 'online' : 'no-internet';
}
