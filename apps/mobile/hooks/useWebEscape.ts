import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Cierra un modal con la tecla Escape en web.
 *
 * `onRequestClose` de `<Modal>` solo dispara en Android: en web y iOS no existe, así que los dos
 * modales de la app (menú lateral y confirmación de válvula) solo se podían cerrar acertándole al
 * fondo o al botón. Escape es lo que cualquiera espera de un diálogo en un navegador, y es la única
 * salida cómoda para quien navega con teclado.
 *
 * No-op fuera de web.
 */
export function useWebEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onEscape]);
}
