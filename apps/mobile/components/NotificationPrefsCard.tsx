import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { SwitchRow } from './SwitchRow';
import {
  NIVELES_DE_GRAVEDAD,
  TIPOS_DE_AVISO,
  useNotificationPrefs,
} from '../services/notification-prefs';

/**
 * Elegir qué avisa la aplicación.
 *
 * Hasta ahora avisaba de TODO y no había forma de opinar. Con 110 señales en doce plantas, un mal
 * día llena la bandeja de decenas de avisos de los que uno o dos exigen moverse — y cuando todo
 * grita, no se lee nada.
 *
 * Tres decisiones que conviene no revertir:
 *
 *  - **El ajuste es de la CUENTA, no del teléfono.** Se guarda en el servidor, que es quien cuenta
 *    los no vistos de la campana; si viviera solo aquí, la campana diría «3» sobre una bandeja que
 *    muestra dos.
 *  - **Silenciar no borra.** El aviso se sigue guardando y se puede ver pidiéndolo. La diferencia
 *    entre «no me molestes con esto» y «esto no existió» importa cuando hay que reclamar algo.
 *  - **Lo crítico atraviesa el horario de silencio.** Un tanque rebosando suena a las cuatro de la
 *    mañana; para eso se distingue la gravedad.
 *
 * El ámbito por planta NO se toca aquí: cada quien sigue recibiendo solo lo de su planta, y eso no
 * es una preferencia sino un permiso.
 */

/** Franjas de silencio ofrecidas. La mayoría quiere «de noche no», no configurar un reloj. */
const FRANJAS: { etiqueta: string; desde: string | null; hasta: string | null }[] = [
  { etiqueta: 'Sin silencio', desde: null, hasta: null },
  { etiqueta: '22:00 – 06:00', desde: '22:00', hasta: '06:00' },
  { etiqueta: '20:00 – 07:00', desde: '20:00', hasta: '07:00' },
  { etiqueta: '18:00 – 08:00', desde: '18:00', hasta: '08:00' },
];

export function NotificationPrefsCard() {
  const { prefs, guardando, error, alternarTipo, fijarGravedad, fijarSilencio } = useNotificationPrefs();
  const activos = TIPOS_DE_AVISO.filter((t) => !prefs.mutedKinds.includes(t.kind)).length;

  return (
    <View style={styles.card}>
      <View style={styles.cabecera}>
        <Text style={styles.titulo}>Qué quieres que te avise</Text>
        {guardando ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
      </View>
      <Text style={styles.ayuda}>
        {activos === TIPOS_DE_AVISO.length
          ? 'Ahora mismo te llega todo. Apaga lo que no te interese.'
          : `Te llegan ${activos} de ${TIPOS_DE_AVISO.length} tipos. Lo apagado se sigue guardando en el historial.`}
      </Text>

      {TIPOS_DE_AVISO.map((t) => (
        <SwitchRow
          key={t.kind}
          titulo={t.titulo}
          detalle={t.detalle}
          valor={!prefs.mutedKinds.includes(t.kind)}
          onChange={() => alternarTipo(t.kind)}
          disabled={guardando}
        />
      ))}

      <View style={styles.separador} />

      <Text style={styles.subtitulo}>Gravedad mínima</Text>
      <View style={styles.opciones}>
        {NIVELES_DE_GRAVEDAD.map((n) => {
          const activo = prefs.minSeverity === n.valor;
          return (
            <Pressable
              key={n.valor}
              style={[styles.chip, activo && styles.chipActivo]}
              onPress={() => fijarGravedad(n.valor)}
              disabled={guardando}
              accessibilityRole="radio"
              accessibilityState={{ selected: activo }}
              accessibilityLabel={`${n.titulo}. ${n.detalle}`}
            >
              <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>{n.titulo}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.ayuda}>
        {NIVELES_DE_GRAVEDAD.find((n) => n.valor === prefs.minSeverity)?.detalle}
      </Text>

      <View style={styles.separador} />

      <Text style={styles.subtitulo}>No molestar</Text>
      <View style={styles.opciones}>
        {FRANJAS.map((f) => {
          const activo = prefs.quietFrom === f.desde && prefs.quietTo === f.hasta;
          return (
            <Pressable
              key={f.etiqueta}
              style={[styles.chip, activo && styles.chipActivo]}
              onPress={() => fijarSilencio(f.desde, f.hasta)}
              disabled={guardando}
              accessibilityRole="radio"
              accessibilityState={{ selected: activo }}
              accessibilityLabel={`Horario de silencio: ${f.etiqueta}`}
            >
              <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>{f.etiqueta}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.nota}>
        <Ionicons name="alert-circle-outline" size={15} color={Colors.warning} />
        <Text style={styles.notaTexto}>
          Durante el silencio, el teléfono no suena pero los avisos siguen llegando a la bandeja. Lo
          crítico —un tanque rebosando— suena igual.
        </Text>
      </View>

      {error ? (
        <View style={styles.error}>
          <Ionicons name="cloud-offline-outline" size={15} color={Colors.danger} />
          <Text style={styles.errorTexto}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titulo: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  subtitulo: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  ayuda: { fontSize: 12, lineHeight: 17, color: Colors.textSecondary, marginTop: 4 },
  separador: { height: 1, backgroundColor: Colors.divider, marginVertical: 14 },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    // 40 px de alto: se toca de pie, delante de un tablero.
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  chipActivo: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  chipTexto: { fontSize: 12.5, fontWeight: '600', color: Colors.textSecondary },
  chipTextoActivo: { color: Colors.primary },
  nota: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 },
  notaTexto: { flex: 1, fontSize: 11.5, lineHeight: 16, color: Colors.textSecondary },
  error: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  errorTexto: { flex: 1, fontSize: 12, color: Colors.danger },
});
