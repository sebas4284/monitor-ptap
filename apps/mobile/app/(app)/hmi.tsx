import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { PlantSelector } from '../../components/PlantSelector';
import { openHmiSession } from '../../services/api';
import Colors from '../../constants/colors';

/**
 * Pantalla HMI — proyecta el runtime de Siemens WinCC Unified dentro de la plataforma.
 *
 * Cómo llega la imagen: el HMI vive en la red OT (`10.10.51.225:443`), inalcanzable desde Internet.
 * nginx lo reexpone bajo `/hmi/` en NUESTRO origen, así que el navegador nunca habla con la red OT
 * ni ve su certificado (que además está vencido desde mayo de 2025 — otra razón para proxear con el
 * nuestro). Al ser mismo origen, no hay CORS ni contenido mixto.
 *
 * Por qué un iframe y no una captura de vídeo: WinCC Unified es cliente HTML5 nativo. Reproducirlo
 * como imagen costaría un colector, CPU y latencia para obtener algo peor.
 *
 * ⚠️ El HMI es UNO SOLO y central (verificado el 2026-08-03: las IP por planta no responden). Hasta
 * saber si WinCC admite enlace directo por pantalla, todas las plantas muestran el mismo runtime y
 * la navegación interna la hace el operador. El `plantId` ya viaja en la URL para el día que se
 * pueda hacer deep-link sin tocar este archivo.
 */

/** Ruta del proxy en nginx. Mismo origen: nada de CORS ni mixed-content. */
const HMI_BASE = '/hmi/';

export default function HmiScreen() {
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canView = hasPermission('view_dashboard');
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);
  /** null = todavía pidiendo la llave; false = el backend la negó. */
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const contenedor = useRef<View>(null);

  // nginx exige la cookie `hmi_session` antes de servir /hmi/. Se pide ANTES de montar el iframe:
  // si el iframe cargara primero, recibiría un 401 y el navegador cachearía esa respuesta.
  // Se renueva a la mitad de su vigencia (30 min) para que una jornada larga no se corte sola.
  useEffect(() => {
    if (Platform.OS !== 'web' || !canView) return;
    let vivo = true;
    const pedir = async (): Promise<void> => {
      const ok = await openHmiSession();
      if (!vivo) return;
      setAutorizado(ok);
      if (ok) setRecarga((n) => n + 1); // recarga el iframe ya con la cookie puesta
    };
    void pedir();
    const id = setInterval(() => void openHmiSession(), 15 * 60 * 1000);
    return () => { vivo = false; clearInterval(id); };
  }, [canView]);

  // `plantId` como parámetro: hoy WinCC lo ignora, pero deja la URL lista para el deep-link y hace
  // que cada planta tenga su propia entrada en el historial del iframe.
  const src = useMemo(
    () => `${HMI_BASE}?planta=${encodeURIComponent(selectedPlant.id)}&r=${recarga}`,
    [selectedPlant.id, recarga],
  );

  if (!canView) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centrado}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.titulo}>Acceso restringido</Text>
          <Text style={styles.sub}>La pantalla HMI no está disponible para tu rol.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // El APK no incluye `react-native-webview`, así que no hay forma de renderizar HTML embebido.
  // Se dice con claridad en vez de mostrar un recuadro vacío.
  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <PlantSelector />
        <View style={styles.centrado}>
          <Ionicons name="desktop-outline" size={44} color={Colors.textSecondary} />
          <Text style={styles.titulo}>Disponible en la versión web</Text>
          <Text style={styles.sub}>
            La pantalla del HMI se proyecta desde el navegador. Abre la plataforma en un computador
            para verla; el resto de la app funciona igual aquí.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  function pantallaCompleta() {
    // Fullscreen API sobre el contenedor: el iframe solo no siempre puede pedirla.
    const nodo = contenedor.current as unknown as HTMLElement | null;
    void nodo?.requestFullscreen?.();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />

      <View style={styles.barra}>
        <Ionicons name="desktop-outline" size={16} color={Colors.textSecondary} />
        <Text style={styles.barraTexto} numberOfLines={1}>
          HMI en vivo · {selectedPlant.name}
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setCargando(true); setRecarga((n) => n + 1); }} hitSlop={6}>
          <Ionicons name="refresh-outline" size={15} color={Colors.primary} />
          <Text style={styles.btnTexto}>Recargar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={pantallaCompleta} hitSlop={6}>
          <Ionicons name="expand-outline" size={15} color={Colors.primary} />
          <Text style={styles.btnTexto}>Ampliar</Text>
        </TouchableOpacity>
      </View>

      <View ref={contenedor} style={styles.marco}>
        {autorizado === false && (
          <View style={styles.cargando}>
            <Ionicons name="lock-closed-outline" size={36} color={Colors.warning} />
            <Text style={styles.titulo}>No se pudo abrir la sesión del HMI</Text>
            <Text style={styles.sub}>
              El servidor no autorizó la visualización. Vuelve a iniciar sesión e inténtalo de nuevo.
            </Text>
          </View>
        )}
        {autorizado !== false && cargando && (
          <View style={styles.cargando}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.sub}>{autorizado === null ? 'Autorizando…' : 'Conectando con el HMI…'}</Text>
          </View>
        )}
        {/* El iframe se monta SOLO con la cookie ya puesta: si cargara antes, recibiría un 401. */}
        {autorizado === true && createElement('iframe', {
          src,
          onLoad: () => setCargando(false),
          style: { width: '100%', height: '100%', border: 'none', backgroundColor: Colors.surface },
          title: `HMI ${selectedPlant.name}`,
          // El HMI se proyecta para MIRAR. `allow-scripts` es imprescindible (es una SPA) y
          // `allow-same-origin` lo necesita para su propia sesión; se niega todo lo demás —
          // descargas, popups, navegación del contenedor y apertura automática de ventanas.
          sandbox: 'allow-scripts allow-same-origin allow-forms',
          referrerPolicy: 'no-referrer',
        })}
      </View>

      <Text style={styles.pie}>
        Proyección del runtime WinCC Unified. Es la misma pantalla que se ve en planta; operar desde
        aquí depende de los permisos de tu usuario en el HMI, no de esta plataforma.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  titulo: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  barraTexto: { flex: 1, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '15',
  },
  btnTexto: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  marco: {
    flex: 1,
    marginHorizontal: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
  },
  cargando: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 1,
    backgroundColor: Colors.surface,
  },
  pie: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    lineHeight: 15,
  },
});
