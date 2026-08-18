import { useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { dismissToast, getToasts, subscribeToasts, type ToastKind } from '../services/toast-store';

/**
 * Pila de avisos no bloqueantes. Se monta UNA vez en la cáscara de `(app)`.
 *
 * Vive fuera del flujo (`position: absolute`) para no empujar el contenido, y sobre la barra de
 * pestañas. Cada aviso se puede cerrar a mano sin esperar a que expire.
 */
const TONE: Record<ToastKind, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  success: { color: Colors.success, icon: 'checkmark-circle' },
  error: { color: Colors.danger, icon: 'alert-circle' },
  info: { color: Colors.primary, icon: 'information-circle' },
};

export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);

  if (toasts.length === 0) return null;

  return (
    <View style={styles.host} pointerEvents="box-none">
      {toasts.map((t) => {
        const tone = TONE[t.kind];
        return (
          <TouchableOpacity
            key={t.id}
            style={[styles.toast, { borderLeftColor: tone.color }]}
            onPress={() => dismissToast(t.id)}
            activeOpacity={0.85}
            accessibilityRole="button"
            // `polite`: informa sin cortar lo que el lector esté diciendo. Los avisos críticos no
            // pasan por aquí — van a un diálogo con acuse de recibo.
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${t.title}. ${t.message ?? ''} Toca para descartar.`}
          >
            <Ionicons name={tone.icon} size={18} color={tone.color} />
            <View style={styles.texts}>
              <Text style={styles.title}>{t.title}</Text>
              {t.message ? (
                <Text style={styles.message} numberOfLines={3}>
                  {t.message}
                </Text>
              ) : null}
            </View>
            <Ionicons name="close" size={14} color={Colors.textSecondary} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 78,
    gap: 8,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderLeftWidth: 4,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    // Sombra para despegarlo del contenido sobre el que flota.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  message: { fontSize: 12, lineHeight: 16, color: Colors.textSecondary },
});
