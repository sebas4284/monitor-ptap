import { useFonts } from 'expo-font';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';

/** Familias de Poppins cargadas por `usePoppins`. Úsalas como `fontFamily`, no con `fontWeight`. */
export const Fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
} as const;

/** Carga Poppins 400/500/600 en tiempo de ejecución (funciona también en web). Devuelve [cargada, error]. */
export function usePoppins() {
  return useFonts({ Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold });
}
