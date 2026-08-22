import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { useItemSilenciado } from '../services/notification-prefs';

/**
 * Campana de un ítem concreto: silenciado o con sonido, nada más.
 *
 * Dos modos y ninguno esconde nada. Silenciado significa que ese sensor deja de sonar en el
 * teléfono; sus avisos siguen apareciendo en la bandeja y contando en la campana. Es la diferencia
 * entre «ya sé que está averiado, no me despiertes» y «bórramelo de la vista», y solo la primera
 * es aceptable en una planta.
 *
 * **Se suscribe él solo a las preferencias.** Las tarjetas del tablero están memoizadas para no
 * re-renderizarse con cada snapshot (llegan cada 2 s), así que si el estado del botón viajara como
 * prop de la tarjeta se quedaría congelado en el valor que tuviera al montarse — el mismo modo de
 * fallo que advierte `memo-compare.ts`. Teniendo su propia suscripción, se actualiza solo.
 *
 * Guarda en el servidor, en la cuenta: la elección sobrevive a cerrar sesión y a cambiar de
 * teléfono, que es lo que se pidió.
 */
export function BotonSilencio({
  plantId,
  subject,
  etiqueta,
}: {
  plantId: string;
  /** Clave de la señal o del tanque, la misma con la que llegan sus avisos. */
  subject: string;
  /** Nombre legible, solo para el lector de pantalla. */
  etiqueta: string;
}) {
  const { silenciado, alternar, guardando } = useItemSilenciado(plantId, subject);

  return (
    <TouchableOpacity
      style={styles.boton}
      onPress={alternar}
      disabled={guardando}
      // Área táctil de 44 px sin agrandar el icono: la tarjeta es pequeña y el dato manda.
      hitSlop={14}
      accessibilityRole="switch"
      accessibilityState={{ checked: !silenciado, disabled: guardando }}
      accessibilityLabel={
        silenciado
          ? `${etiqueta}: silenciado. Toca para que vuelva a sonar en el dispositivo.`
          : `${etiqueta}: con sonido. Toca para silenciarlo en el dispositivo.`
      }
    >
      <Ionicons
        name={silenciado ? 'notifications-off' : 'notifications-outline'}
        size={15}
        color={silenciado ? Colors.warning : Colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  boton: { padding: 2, opacity: 0.9 },
});
