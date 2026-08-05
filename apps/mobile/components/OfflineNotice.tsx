import { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';

/**
 * Estado de error "no se pudo cargar y no hay respaldo que enseñar", con botón de reintentar.
 *
 * Se muestra SOLO cuando no hay ninguna lectura guardada del dispositivo. Si la hay, manda el
 * diseño de siempre: banner de conexión + tarjetas marcadas como congeladas, que informa mucho
 * mejor que una pantalla de error vacía.
 */
function OfflineNoticeBase({
  title,
  detail,
  onRetry,
  retryLabel,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  /** Etiqueta accesible del botón; el texto visible siempre es "Reintentar". */
  retryLabel: string;
}) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="cloud-offline-outline" size={36} color={Colors.textSecondary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <TouchableOpacity
        style={styles.retryBtn}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
      >
        <Ionicons name="refresh-outline" size={16} color={Colors.primary} />
        <Text style={styles.retryText}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  );
}

export const OfflineNotice = memo(OfflineNoticeBase);

const styles = StyleSheet.create({
  wrap: { paddingVertical: 46, alignItems: 'center', gap: 6 },
  title: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 2 },
  detail: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 17,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
});
