import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../constants/colors';
import {
  fetchAppRelease,
  hayActualizacionInstalada,
  tamanoLegible,
  type AppRelease,
} from '../services/app-release';

/**
 * Franja de descarga/actualización de la app.
 *
 * Cubre los dos casos con la MISMA consulta, porque son el mismo problema visto desde dos lados:
 *
 *  - **En web** (`modo="descarga"`): quien entra por el navegador quizá no sepa que existe una app.
 *    Se le ofrece el enlace igual que ya se le ofrece "crear cuenta nueva".
 *  - **En la APK** (`modo="actualizacion"`): si la instalada se quedó atrás, se avisa y se lleva a
 *    la página de descargas.
 *
 * **Nunca instala nada por su cuenta.** Android no permite actualizar en silencio una app de fuera
 * de la tienda: haría falta el permiso sensible `REQUEST_INSTALL_PACKAGES`, que el usuario habilite
 * "instalar apps desconocidas" y un módulo nativo — y al final el sistema le pide confirmar igual.
 * Abrir la página de descargas cuesta los mismos toques sin pedir permisos peligrosos.
 */
type Modo = 'descarga' | 'actualizacion';

export function AppUpdateBanner({ modo }: { modo: Modo }) {
  const [release, setRelease] = useState<AppRelease | null>(null);

  useEffect(() => {
    let vivo = true;
    void fetchAppRelease().then((r) => {
      if (vivo) setRelease(r);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!release) return null;

  // En web se ofrece la descarga siempre; en la app, solo si de verdad hay algo más nuevo.
  const enWeb = Platform.OS === 'web';
  const mostrar = modo === 'descarga' ? enWeb : hayActualizacionInstalada(release);
  if (!mostrar) return null;

  const tamano = tamanoLegible(release.sizeBytes);
  const titulo =
    modo === 'descarga'
      ? '¿No tienes la app instalada?'
      : `Hay una versión nueva${release.version ? ` (${release.version})` : ''}`;
  const detalle =
    modo === 'descarga'
      ? `Descarga la última versión para Android${release.version ? ` (${release.version}` : ''}${
          release.version && tamano ? `, ${tamano})` : release.version ? ')' : ''
        }.`
      : release.notes ?? 'Descárgala e instálala encima; no perderás tu sesión.';

  return (
    <View style={styles.caja}>
      <Text style={styles.titulo}>{titulo}</Text>
      <Text style={styles.detalle}>{detalle}</Text>
      <TouchableOpacity
        style={styles.boton}
        onPress={() => void Linking.openURL(release.downloadUrl)}
        activeOpacity={0.85}
      >
        <Text style={styles.botonTexto}>
          {modo === 'descarga' ? 'Descargar la app' : 'Actualizar ahora'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    marginTop: 20,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
  },
  titulo: { color: Colors.textPrimary, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  detalle: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 4 },
  boton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
  },
  botonTexto: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
});
