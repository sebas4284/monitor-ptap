import { FontDisplay, useFonts } from 'expo-font';
import regularFont from '../assets/fonts/Poppins_400Regular.woff2';
import mediumFont from '../assets/fonts/Poppins_500Medium.woff2';
import semiboldFont from '../assets/fonts/Poppins_600SemiBold.woff2';

export const Fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
} as const;
const sources = {
  Poppins_400Regular: {
    uri: regularFont,
    display: FontDisplay.SWAP,
  },
  Poppins_500Medium: {
    uri: mediumFont,
    display: FontDisplay.SWAP,
  },
  Poppins_600SemiBold: {
    uri: semiboldFont,
    display: FontDisplay.SWAP,
  },
};
// La exportación ya declara estas fuentes; volver a registrarlas provoca otro cambio de fuente.
const runtimeSources =
  typeof document !== 'undefined' && document.getElementById('aquora-fonts') ? {} : sources;
export function usePoppins() {
  return useFonts(runtimeSources);
}
