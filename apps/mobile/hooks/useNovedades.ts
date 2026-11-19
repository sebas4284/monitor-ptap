import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchNovedades,
  hayNovedadNueva,
  marcarNovedadesVistas,
  ultimaNovedadVista,
  versionMasReciente,
  type Novedad,
} from '../services/novedades';

const KEY = ['novedades'];

/**
 * El changelog de la app y si hay algo sin leer en este dispositivo.
 *
 * Se sondea flojo (5 min de `staleTime`, sin `refetchInterval`): el changelog cambia cuando se
 * publica una versión, o sea cada varios días. Pedirlo cada minuto como el contador de la campana
 * sería tráfico regalado.
 */
export function useNovedades(): {
  novedades: Novedad[];
  /** true si la versión más reciente del listado no se ha visto en este dispositivo. */
  hayNueva: boolean;
  /** Marca leído hasta la más reciente. Se llama al ABRIR la pestaña. */
  marcarVistas: () => void;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  // `undefined` = todavía se está leyendo del almacenamiento. Se distingue de `null` (nunca vista)
  // para no encender la marca de «nuevo» durante el parpadeo inicial y apagarla medio segundo
  // después, que se ve como un defecto.
  const [ultimaVista, setUltimaVista] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    void ultimaNovedadVista().then((v) => {
      if (vivo) setUltimaVista(v);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const query = useQuery({
    queryKey: KEY,
    queryFn: fetchNovedades,
    staleTime: 5 * 60_000,
  });

  const novedades = query.data ?? [];

  const marcarVistas = useCallback(() => {
    if (novedades.length === 0) return;
    void marcarNovedadesVistas(novedades);
    // Se refleja en memoria además de en el disco: el punto tiene que apagarse en el momento, sin
    // esperar a que vuelva a montarse la pantalla.
    setUltimaVista(versionMasReciente(novedades));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novedades.length, novedades[0]?.version]);

  return {
    novedades,
    hayNueva: ultimaVista !== undefined && hayNovedadNueva(novedades, ultimaVista),
    marcarVistas,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
