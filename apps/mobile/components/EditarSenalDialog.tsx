import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useWebEscape } from '../hooks/useWebEscape';
import { aplicarCorreccion, valoresDe, type SenalEditable } from '../services/mapping-edit';
import {
  CAMPOS,
  borradorDesde,
  hayCambios,
  hayErrores,
  parsearBorrador,
  resumenCambios,
  valorEnIndice,
  type Borrador,
  type CampoEditable,
  type MuestraBuffer,
} from '../services/mapping-edit-form';
import { formatValorCrudo } from '../services/opc-raw';
import Colors from '../constants/colors';

/**
 * Editar una señal del mapeo, en dos pasos: **se escribe y después se REVISA.**
 *
 * Los dos pasos son el punto de este diálogo. Un formulario que guarda al pulsar «Aceptar» convierte
 * un cambio de configuración de planta en un reflejo; el 2026-08-25 costó seis horas descubrir que
 * `cascajal.inletPressure1` leía el fondo de escala de un ADC porque nadie contrastó el índice con
 * lo que de verdad entregaba el PLC en esa posición.
 *
 * Así que la revisión enseña tres cosas que el formulario no puede: el **de → a** campo por campo,
 * **qué se está leyendo ahora mismo en el índice de destino** —el dato que decide si el cambio es
 * correcto— y que la señal pasará a `inferred` porque ya no hay documento de la planta detrás.
 *
 * Se aplica en caliente: el servidor valida, guarda y recarga el mapeo sin reiniciar el proceso.
 */
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type Paso = 'formulario' | 'revision';

export function EditarSenalDialog({
  senal,
  plantId,
  buffersDelCanal,
  muestraDe,
  onCerrar,
  onGuardada,
}: {
  senal: SenalEditable;
  plantId: string;
  /** Buffers del MISMO canal en esa planta: son los únicos a los que se puede mover la señal. */
  buffersDelCanal: { browseName: string; declaredLength: number | null }[];
  /** Última muestra de un buffer, para poder mirar el índice de destino antes de guardar. */
  muestraDe: (browseName: string | null) => MuestraBuffer | undefined;
  onCerrar: () => void;
  onGuardada: (senal: SenalEditable) => void;
}) {
  const actual = useMemo(() => valoresDe(senal), [senal]);
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDesde(actual));
  const [paso, setPaso] = useState<Paso>('formulario');
  const [guardando, setGuardando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  useWebEscape(true, onCerrar);

  const { patch, errores } = useMemo(() => parsearBorrador(borrador, actual), [borrador, actual]);
  const cambios = useMemo(() => resumenCambios(actual, patch), [actual, patch]);
  const listo = hayCambios(patch) && !hayErrores(errores);

  // El buffer de DESTINO: el que quede tras el cambio, no el actual. Es lo que hay que mirar para
  // saber qué se va a leer.
  const destinoBrowseName =
    'sourceBuffer' in patch
      ? patch.sourceBuffer ?? primarioDelCanal(buffersDelCanal)
      : senal.sourceBuffer ?? senal.browseName;
  const indiceDestino = patch.index ?? senal.index;
  const enDestino = valorEnIndice(muestraDe(destinoBrowseName), indiceDestino);

  function set(campo: CampoEditable, texto: string) {
    setBorrador((b) => ({ ...b, [campo]: texto }));
    setErrorServidor(null);
  }

  async function guardar() {
    setGuardando(true);
    setErrorServidor(null);
    try {
      const resultado = await aplicarCorreccion(plantId, senal.domainKey, patch);
      onGuardada(resultado);
    } catch (err) {
      // El servidor devuelve el motivo en texto llano (INDICE_FUERA_DE_RANGO dice cuál es el último
      // índice válido). Se enseña tal cual: es más útil que «no se pudo guardar».
      setErrorServidor(err instanceof Error ? err.message : 'No se pudo guardar el cambio.');
      setPaso('revision');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.overlay} onPress={onCerrar} accessibilityLabel="Cerrar sin guardar">
        <Pressable style={styles.hoja} onPress={() => {}} accessibilityViewIsModal>
          <View style={styles.cabecera}>
            <View style={styles.flex}>
              <Text style={styles.titulo}>{paso === 'formulario' ? 'Editar señal' : 'Revisar antes de guardar'}</Text>
              <Text style={styles.subtitulo} selectable>
                {senal.domainKey}
                {senal.label ? ` · ${senal.label}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onCerrar} hitSlop={10} accessibilityLabel="Cerrar">
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.cuerpo} keyboardShouldPersistTaps="handled">
            {paso === 'formulario' ? (
              <>
                {CAMPOS.map((def) => (
                  <View key={def.campo} style={styles.campo}>
                    <Text style={styles.campoEtiqueta}>
                      {def.etiqueta} <Text style={styles.campoIngles}>{def.ingles}</Text>
                    </Text>

                    {def.tipo === 'buffer' ? (
                      <View style={styles.chips}>
                        <Chip
                          texto="Principal"
                          activo={borrador.sourceBuffer.trim() === ''}
                          onPress={() => set('sourceBuffer', '')}
                        />
                        {buffersDelCanal.map((b) => (
                          <Chip
                            key={b.browseName}
                            texto={`${b.browseName}${b.declaredLength === null ? '' : ` [${b.declaredLength}]`}`}
                            activo={borrador.sourceBuffer.trim() === b.browseName}
                            onPress={() => set('sourceBuffer', b.browseName)}
                          />
                        ))}
                      </View>
                    ) : (
                      <TextInput
                        style={[styles.input, errores[def.campo] ? styles.inputMal : null]}
                        value={borrador[def.campo]}
                        onChangeText={(t) => set(def.campo, t)}
                        keyboardType={def.tipo === 'texto' ? 'default' : 'numbers-and-punctuation'}
                        placeholder={def.tipo === 'texto' ? 'sin unidad' : 'vacío = sin límite'}
                        placeholderTextColor={Colors.textSecondary}
                        accessibilityLabel={`${def.etiqueta} (${def.ingles})`}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    )}

                    <Text style={errores[def.campo] ? styles.campoError : styles.campoAyuda}>
                      {errores[def.campo] ?? def.ayuda}
                    </Text>
                  </View>
                ))}

                <Text style={styles.nota}>
                  No se pueden crear ni borrar señales, ni cambiar el NodeId: solo mover esta señal
                  dentro de su canal y corregir cómo se interpreta. Es lo que permite aplicarlo sin
                  reiniciar el servidor.
                </Text>
              </>
            ) : (
              <>
                {cambios.map((c) => (
                  <View key={c.campo} style={styles.cambio}>
                    <Text style={styles.cambioCampo}>
                      {c.etiqueta} <Text style={styles.campoIngles}>{c.ingles}</Text>
                    </Text>
                    <View style={styles.cambioValores}>
                      <Text style={styles.cambioDe}>{c.de}</Text>
                      <Ionicons name="arrow-forward" size={13} color={Colors.textSecondary} />
                      <Text style={styles.cambioA}>{c.a}</Text>
                    </View>
                  </View>
                ))}

                {/* El dato que de verdad decide si el cambio es correcto. */}
                <View style={styles.destino}>
                  <Text style={styles.destinoTitulo}>Qué se lee ahora en el destino</Text>
                  <Text style={styles.destinoRuta} selectable>
                    {destinoBrowseName ?? '(buffer principal)'} [{indiceDestino}]
                  </Text>
                  {enDestino === null ? (
                    <Text style={styles.destinoAviso}>
                      Ese índice no está entregando dato ahora mismo. Puede ser correcto —el PLC no lo
                      usa— o puede significar que la señal se quedará muda.
                    </Text>
                  ) : (
                    <Text style={styles.destinoValor}>
                      {formatValorCrudo(enDestino.value)}
                      {enDestino.oculto ? ' (cero)' : ''}
                    </Text>
                  )}
                </View>

                <View style={styles.avisoConfianza}>
                  <Ionicons name="information-circle-outline" size={16} color={Colors.warning} />
                  <Text style={styles.avisoConfianzaTexto}>
                    La señal pasará a <Text style={styles.mono}>inferred</Text>: detrás de este índice
                    queda una decisión tuya, no un documento de la planta. Queda registrado con tu
                    nombre y se puede revertir.
                  </Text>
                </View>

                {errorServidor ? (
                  <View style={styles.errorServidor}>
                    <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                    <Text style={styles.errorServidorTexto}>{errorServidor}</Text>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>

          <View style={styles.pie}>
            {paso === 'formulario' ? (
              <>
                <TouchableOpacity style={styles.botonPlano} onPress={onCerrar} activeOpacity={0.8}>
                  <Text style={styles.botonPlanoTexto}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.botonPrimario, !listo && styles.botonApagado]}
                  onPress={() => setPaso('revision')}
                  disabled={!listo}
                  activeOpacity={0.8}
                  accessibilityLabel="Revisar los cambios antes de guardar"
                >
                  <Text style={styles.botonPrimarioTexto}>
                    Revisar{cambios.length > 0 ? ` (${cambios.length})` : ''}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.botonPlano}
                  onPress={() => setPaso('formulario')}
                  activeOpacity={0.8}
                  disabled={guardando}
                >
                  <Text style={styles.botonPlanoTexto}>Volver a editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.botonPrimario, guardando && styles.botonApagado]}
                  onPress={() => void guardar()}
                  disabled={guardando}
                  activeOpacity={0.8}
                  accessibilityLabel="Guardar y aplicar la corrección"
                >
                  {guardando ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.botonPrimarioTexto}>Guardar y aplicar</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Chip({ texto, activo, onPress }: { texto: string; activo: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, activo && styles.chipActivo]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected: activo }}
    >
      <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>{texto}</Text>
    </TouchableOpacity>
  );
}

/** El primario del canal es el de más elementos: la misma convención que usa el backend. */
function primarioDelCanal(buffers: { browseName: string; declaredLength: number | null }[]): string | null {
  let mejor: { browseName: string; declaredLength: number | null } | null = null;
  for (const b of buffers) {
    if (!mejor || (b.declaredLength ?? 0) > (mejor.declaredLength ?? 0)) mejor = b;
  }
  return mejor?.browseName ?? null;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
  hoja: {
    backgroundColor: Colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.divider,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  flex: { flex: 1 },
  cabecera: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  titulo: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  subtitulo: { fontFamily: mono, fontSize: 11.5, color: Colors.accentOutlet, marginTop: 2 },
  cuerpo: { padding: 14, gap: 12 },
  campo: { gap: 5 },
  campoEtiqueta: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  campoIngles: { fontFamily: mono, fontSize: 11, fontWeight: '400', color: Colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    minHeight: 44,
    fontFamily: mono,
    fontSize: 13.5,
    color: Colors.textPrimary,
  },
  inputMal: { borderColor: Colors.danger + '99' },
  campoAyuda: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15 },
  campoError: { fontSize: 11, color: Colors.danger, lineHeight: 15, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  chipActivo: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  chipTexto: { fontFamily: mono, fontSize: 11, color: Colors.textSecondary },
  chipTextoActivo: { color: Colors.primary, fontWeight: '700' },
  nota: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' },
  cambio: {
    borderWidth: 1,
    borderColor: Colors.divider,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    backgroundColor: Colors.surface,
  },
  cambioCampo: { fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary },
  cambioValores: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cambioDe: { fontFamily: mono, fontSize: 13, color: Colors.textSecondary, textDecorationLine: 'line-through' },
  cambioA: { fontFamily: mono, fontSize: 14, fontWeight: '800', color: Colors.success },
  destino: {
    borderWidth: 1,
    borderColor: Colors.primary + '55',
    backgroundColor: Colors.primary + '0E',
    borderRadius: 8,
    padding: 12,
    gap: 3,
  },
  destinoTitulo: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  destinoRuta: { fontFamily: mono, fontSize: 11.5, color: Colors.textSecondary },
  destinoValor: { fontFamily: mono, fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  destinoAviso: { fontSize: 11.5, color: Colors.warning, lineHeight: 16 },
  avisoConfianza: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  avisoConfianzaTexto: { flex: 1, fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16 },
  mono: { fontFamily: mono, color: Colors.warning },
  errorServidor: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.danger + '77',
    backgroundColor: Colors.danger + '15',
    borderRadius: 8,
    padding: 10,
  },
  errorServidorTexto: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 17 },
  pie: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  botonPlano: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonPlanoTexto: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  botonPrimario: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 18,
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonApagado: { opacity: 0.45 },
  botonPrimarioTexto: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});
