import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ListSkeleton } from './Skeleton';
import { OfflineNotice } from './OfflineNotice';
import type { Novedad } from '../services/novedades';
import Colors from '../constants/colors';

/**
 * El changelog, dentro de la bandeja.
 *
 * Render PROPIO y no una fila de notificación: una novedad no tiene planta, ni gravedad, ni «visto»
 * por usuario, ni se puede tocar para ir a ningún sitio. Reutilizar `NotificationRow` habría
 * obligado a inventarle esos campos.
 *
 * La entrada marcada como nueva se resalta y **se queda resaltada mientras se lee**: la marca de
 * leído se escribe al abrir la pestaña, pero el resalte se decide una sola vez al entrar. Si
 * dependiera del estado guardado, el recuadro se apagaría delante del usuario.
 */
export function NovedadesLista({
  novedades,
  versionNueva,
  isLoading,
  isError,
  onRetry,
}: {
  novedades: Novedad[];
  /** Versión que estaba sin ver al entrar, o null. */
  versionNueva: string | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <ListSkeleton rows={2} label="Cargando las novedades" />;

  if (isError) {
    return (
      <OfflineNotice
        title="No se pudieron cargar las novedades."
        detail="El listado vive en el servidor. Sin conexión no hay copia local que mostrar."
        onRetry={onRetry}
        retryLabel="Reintentar la carga de novedades"
      />
    );
  }

  if (novedades.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="sparkles-outline" size={40} color={Colors.textSecondary} />
        <Text style={styles.emptyTitle}>Todavía nada que contar</Text>
        <Text style={styles.emptyText}>
          Aquí aparecerá lo que cambie en cada versión de la aplicación, con la más reciente arriba.
        </Text>
      </View>
    );
  }

  return (
    <>
      {novedades.map((n) => {
        const nueva = versionNueva !== null && n.version === versionNueva;
        return (
          <View key={n.version} style={[styles.card, nueva && styles.cardNueva]}>
            <View style={styles.head}>
              <Text style={styles.version}>Versión {n.version}</Text>
              {nueva && (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>NUEVO</Text>
                </View>
              )}
              {n.fecha.length > 0 && <Text style={styles.fecha}>{n.fecha}</Text>}
            </View>
            {n.puntos.map((p, i) => (
              <View key={i} style={styles.punto}>
                <Ionicons name="ellipse" size={5} color={Colors.primary} style={styles.bullet} />
                <Text style={styles.puntoTexto}>{p}</Text>
              </View>
            ))}
          </View>
        );
      })}
      <Text style={styles.pie}>
        Esta lista es de la aplicación, no de la planta: no lleva avisos ni se puede filtrar por
        sensor. La versión que tienes instalada se ve en Ajustes.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  cardNueva: { backgroundColor: Colors.primary + '0E', borderColor: Colors.primary + '55' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  version: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  fecha: { fontSize: 11.5, color: Colors.textSecondary, marginLeft: 'auto' },
  pill: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { color: '#fff', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  punto: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // El punto se alinea con la primera línea del texto, no con el centro del bloque.
  bullet: { marginTop: 6 },
  puntoTexto: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  pie: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
});
