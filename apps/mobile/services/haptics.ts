import { Platform, Vibration } from 'react-native';

/**
 * Servicio háptico y de retroalimentación física para control industrial crítico.
 *
 * Implementado bajo ingeniería propia (Clean-Room / REA):
 * - Cero dependencias externas propietarias.
 * - Cero telemetría ni comunicación de red.
 * - Utiliza las capacidades nativas del hardware (Vibration API) calibradas
 *   para entornos industriales ruidosos (cuartos de bombas, plantas de tratamiento).
 */

export const HapticFeedback = {
  /**
   * Pulso sutil al abrir un modal o tocar un selector de acción.
   */
  modalOpen(): void {
    if (Platform.OS === 'android') {
      Vibration.vibrate(20);
    } else if (Platform.OS === 'ios') {
      Vibration.vibrate();
    }
  },

  /**
   * Pulso de desbloqueo: indica al operador que el temporizador de seguridad
   * (los 3 segundos obligatorios) ha terminado y ya es posible accionar la válvula.
   */
  safetyUnlocked(): void {
    if (Platform.OS === 'android') {
      // Patrón: espera 0ms, vibra 35ms
      Vibration.vibrate([0, 35]);
    } else if (Platform.OS === 'ios') {
      Vibration.vibrate();
    }
  },

  /**
   * Pulso firme de confirmación: el operador tocó "Aceptar" y la orden crítica
   * está en viaje hacia el PLC.
   */
  criticalConfirm(): void {
    if (Platform.OS === 'android') {
      // Pulso contundente de 60ms
      Vibration.vibrate(60);
    } else if (Platform.OS === 'ios') {
      Vibration.vibrate();
    }
  },

  /**
   * Retroalimentación del resultado según el veredicto del hardware:
   * - 'success': Doble pulso corto confirmando lectura real del actuador.
   * - 'warning': Pulso prolongado (orden recibida pero sin read-back de estado eléctrico).
   * - 'danger': Triple pulso de alerta (enclavamiento o rechazo del PLC).
   */
  commandVerdict(tone: 'success' | 'warning' | 'danger'): void {
    if (Platform.OS === 'android') {
      switch (tone) {
        case 'success':
          // Doble pulso: 0ms espera, 30ms vibración, 60ms pausa, 30ms vibración
          Vibration.vibrate([0, 30, 60, 30]);
          break;
        case 'warning':
          // Pulso de atención de 120ms
          Vibration.vibrate(120);
          break;
        case 'danger':
          // Triple pulso de advertencia
          Vibration.vibrate([0, 50, 40, 50, 40, 70]);
          break;
      }
    } else if (Platform.OS === 'ios') {
      Vibration.vibrate();
    }
  },
};
