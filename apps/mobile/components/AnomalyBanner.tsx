import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from './AppIcon';
import Colors from '../constants/colors';
import { Fonts } from '../constants/fonts';

const B = Colors.brand;

/**
 * Franja roja arriba de las tarjetas: la primera señal fuera de rango (hasRangeAnomaly), su valor
 * y el límite que rompe, y "+N más". `role="alert"` para que el lector de pantalla la anuncie.
 * El texto lo arma `anomalyBanner()` de card-look.ts; aquí solo se pinta.
 */
function AnomalyBannerBase({ text, more }: { text: string; more: number }) {
  return (
    <View style={styles.banner} role="alert" accessibilityLiveRegion="assertive">
      <Ionicons name="warning-outline" size={20} color={B.dangerText} />
      <Text style={styles.text}>
        <Text style={styles.strong}>{text}</Text>
        {more > 0 ? <Text style={styles.more}>{`  +${more} más`}</Text> : null}
      </Text>
    </View>
  );
}

export const AnomalyBanner = memo(AnomalyBannerBase);

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#2A1416',
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 5,
    marginBottom: 12,
  },
  text: { flex: 1, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, color: '#E6C9C9' },
  strong: { fontFamily: Fonts.semibold, color: B.dangerText },
  more: { fontFamily: Fonts.medium, color: '#E6C9C9' },
});
