import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { useAuth } from '../context/AuthContext';
import { fetchVerificacionFirmas, type VerificacionFirmas } from '../services/command-signatures';

/**
 * Estado del libro de firmas de las maniobras de válvula.
 *
 * Por qué está en la bandeja y no en Ajustes: es donde vive el registro de maniobras. Quien quiere
 * saber si puede fiarse de lo que está leyendo lo quiere saber MIENTRAS lo lee, no tres pantallas
 * más allá.
 *
 * Se comprueba al abrir la pantalla, y hay un botón para repetirlo a mano. La vigilancia continua
 * no depende de esto: el servidor recorre la cadena cada 6 h por su cuenta y, si algo no cuadra,
 * publica un aviso crítico que suena en el teléfono aunque nadie abra la app. Este botón es para
 * poder mirar cuando a uno le apetezca, no el único camino.
 *
 * Solo se monta con `view_event_logs`, el mismo permiso que exige el endpoint: un botón que siempre
 * devuelve 403 es peor que no tenerlo.
 */
export function RegistroIntegridadCard() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('view_event_logs');
  const [estado, setEstado] = useState<VerificacionFirmas | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const comprobar = useCallback(() => {
    setCargando(true);
    setError(false);
    fetchVerificacionFirmas()
      .then(setEstado)
      .catch(() => setError(true))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    if (puede) comprobar();
  }, [puede, comprobar]);

  if (!puede) return null;

  // Sin respuesta todavía no se dice nada: una tarjeta vacía que luego cambia de color es peor que
  // esperar medio segundo. Si la red falla tampoco se afirma nada — no saber no es estar íntegro.
  if (!estado && !error) return null;

  const roto = estado ? !estado.integra && estado.verificable : false;
  const sinFirmar = estado ? !estado.verificable : false;
  const tono = error || sinFirmar ? Colors.warning : roto ? Colors.danger : Colors.success;
  const icono: keyof typeof Ionicons.glyphMap = error
    ? 'cloud-offline-outline'
    : sinFirmar
      ? 'alert-circle-outline'
      : roto
        ? 'warning'
        : 'shield-checkmark-outline';

  return (
    <View style={[styles.card, { borderColor: tono + '66', backgroundColor: tono + '10' }]}>
      <Ionicons name={icono} size={20} color={tono} />
      <View style={styles.cuerpo}>
        <Text style={[styles.titulo, { color: tono }]}>
          {error
            ? 'No se pudo comprobar el registro'
            : sinFirmar
              ? 'Las maniobras no se están firmando'
              : roto
                ? 'El registro de maniobras fue alterado'
                : 'Registro de maniobras íntegro'}
        </Text>
        <Text style={styles.detalle}>
          {error
            ? 'Sin conexión con el servidor. No saber no es lo mismo que estar bien: vuelve a intentarlo.'
            : (estado?.mensaje ?? '')}
        </Text>
        {roto && (
          <Text style={styles.detalle}>
            No borres nada: el propio rastro es la prueba. Avisa a quien administra el sistema.
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.boton}
        onPress={comprobar}
        disabled={cargando}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Volver a comprobar la integridad del registro de maniobras"
      >
        {cargando ? (
          <ActivityIndicator size="small" color={tono} />
        ) : (
          <Ionicons name="refresh-outline" size={17} color={tono} />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  cuerpo: { flex: 1, gap: 3 },
  titulo: { fontSize: 13.5, fontWeight: '700' },
  detalle: { fontSize: 12, lineHeight: 16.5, color: Colors.textSecondary },
  // Objetivo táctil real sin robarle sitio al texto: el `hitSlop` hace el resto.
  boton: { padding: 6, minWidth: 28, alignItems: 'center' },
});
