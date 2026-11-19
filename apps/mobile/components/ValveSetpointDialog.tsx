import { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Platform,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { textoApertura, validarConsigna } from '../services/valves';

/**
 * Primer paso para ajustar la CONSIGNA de una válvula proporcional (Fase 4): elegir el valor.
 *
 * No manda nada. «Continuar» pasa el valor a `ValveConfirmDialog`, que es la segunda confirmación
 * con la espera de 3 s, igual que abrir o cerrar. Así una consigna nunca sale de un solo toque.
 *
 * El deslizador es JS puro (PanResponder sobre un `View`), sin módulo nativo: la app no se
 * autoactualiza y un módulo nativo obliga a recompilar la APK (ver `ValveItem`). El campo numérico y
 * los botones ±1/±10 son la vía precisa y accesible; el deslizador, la rápida.
 */

interface Props {
  visible: boolean;
  valveName: string;
  plantName: string;
  /** Apertura medida ahora (valve<N>Position). */
  positionPct: number | null;
  /** Última consigna escrita, si se conoce. */
  setpointPct: number | null;
  limites: { min: number; max: number; unit: string | null };
  onContinue: (value: number) => void;
  onCancel: () => void;
}

export function ValveSetpointDialog({ visible, valveName, plantName, positionPct, setpointPct, limites, onContinue, onCancel }: Props) {
  const reducedMotion = useReducedMotion();
  const { min, max } = limites;
  const unidad = limites.unit ? ` ${limites.unit}` : '';
  // Valor de partida: la consigna vigente; si no se conoce, la apertura medida. La pantalla monta el
  // diálogo al abrirlo, así que esto corre en cada apertura y una lectura nueva no pisa lo escrito.
  const [texto, setTexto] = useState(() =>
    String(Math.round(Math.min(max, Math.max(min, setpointPct ?? (positionPct === null ? min : positionPct))))),
  );
  const [anchoPista, setAnchoPista] = useState(0);

  const validacion = validarConsigna(texto, limites);
  const valor = validacion.ok ? validacion.value : null;
  const fijar = (n: number) => setTexto(String(Math.round(Math.min(max, Math.max(min, n)))));

  // El valor sale de dónde está el dedo SOBRE la pista (`locationX`: las piezas no capturan el toque),
  // al tocar y al arrastrar: sin refs ni estado entre eventos.
  const responder = useMemo(() => {
    const aValor = (x: number) => min + (x / anchoPista) * (max - min);
    const mover = (e: GestureResponderEvent) => {
      if (anchoPista > 0) setTexto(String(Math.round(Math.min(max, Math.max(min, aValor(e.nativeEvent.locationX))))));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: mover,
      onPanResponderMove: mover,
    });
  }, [anchoPista, min, max]);

  const pctBarra = (n: number | null) => (n === null ? 0 : ((Math.min(max, Math.max(min, n)) - min) / (max - min)) * 100);

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <ScrollView style={styles.card} contentContainerStyle={styles.content} accessibilityViewIsModal>
          <View style={styles.headerRow}>
            <View style={styles.icono}>
              <Ionicons name="options-outline" size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Ajustar apertura</Text>
              <Text style={styles.sub}>{valveName} · {plantName}</Text>
            </View>
          </View>

          <View style={styles.detalle}>
            <View style={styles.fila}>
              <Text style={styles.label}>Apertura actual</Text>
              <Text style={styles.valor}>{textoApertura(positionPct).replace(/^Apertura /, '')}</Text>
            </View>
            <View style={styles.fila}>
              <Text style={styles.label}>Consigna vigente</Text>
              <Text style={styles.valor}>{setpointPct === null ? 'sin dato' : `${setpointPct}${unidad}`}</Text>
            </View>
          </View>

          <Text style={styles.label}>Nueva consigna ({min}–{max}{unidad})</Text>

          <View
            style={styles.pista}
            onLayout={(e: LayoutChangeEvent) => setAnchoPista(e.nativeEvent.layout.width)}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`Nueva consigna de ${valveName}`}
            accessibilityValue={{ min, max, now: valor ?? undefined, text: valor === null ? 'sin valor' : `${valor}${unidad}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => fijar((valor ?? min) + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
            {...responder.panHandlers}
          >
            {/* Las piezas no capturan el toque: así `locationX` siempre es relativo a la pista. */}
            <View pointerEvents="none" style={styles.pistaFondo}>
              <View style={[styles.pistaRelleno, { width: `${pctBarra(valor)}%` }]} />
            </View>
            {positionPct !== null && (
              <View pointerEvents="none" style={[styles.marcaActual, { left: `${pctBarra(positionPct)}%` }]} />
            )}
            <View pointerEvents="none" style={[styles.pulgar, { left: `${pctBarra(valor)}%` }]} />
          </View>
          <View style={styles.leyenda}>
            <Text style={styles.leyendaTexto}>{min}{unidad}</Text>
            <Text style={styles.leyendaTexto}>▏ apertura actual</Text>
            <Text style={styles.leyendaTexto}>{max}{unidad}</Text>
          </View>

          <View style={styles.ajuste}>
            {[-10, -1].map((d) => (
              <TouchableOpacity key={d} style={styles.paso} onPress={() => fijar((valor ?? min) + d)} accessibilityRole="button" accessibilityLabel={`Restar ${-d}`}>
                <Text style={styles.pasoTexto}>{d}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={[styles.input, !validacion.ok && styles.inputMal]}
              value={texto}
              onChangeText={setTexto}
              keyboardType="numeric"
              maxLength={6}
              selectTextOnFocus
              accessibilityLabel={`Nueva consigna en ${limites.unit ?? 'unidades'}`}
            />
            <Text style={styles.unidad}>{limites.unit ?? ''}</Text>
            {[1, 10].map((d) => (
              <TouchableOpacity key={d} style={styles.paso} onPress={() => fijar((valor ?? min) + d)} accessibilityRole="button" accessibilityLabel={`Sumar ${d}`}>
                <Text style={styles.pasoTexto}>+{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!validacion.ok && <Text style={styles.error}>{validacion.error}</Text>}
          {validacion.ok && Number(texto.replace(',', '.')) !== validacion.value && (
            <Text style={styles.nota}>Se enviará {validacion.value}{unidad}: el PLC recibe un número entero.</Text>
          )}

          <View style={styles.botones}>
            <TouchableOpacity style={[styles.btn, styles.btnVolver]} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Volver sin ajustar la apertura">
              <Ionicons name="arrow-back-outline" size={16} color={Colors.textPrimary} />
              <Text style={styles.btnVolverText}>Volver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, valor !== null ? { backgroundColor: Colors.primary } : styles.btnInactivo]}
              onPress={() => valor !== null && onContinue(valor)}
              disabled={valor === null}
              accessibilityRole="button"
              accessibilityState={{ disabled: valor === null }}
              accessibilityLabel={valor === null ? 'Continuar (valor no válido)' : `Continuar con ${valor}${unidad}`}
            >
              <Text style={[styles.btnContinuarText, valor === null && { color: Colors.textSecondary }]}>Continuar</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.pie}>En el siguiente paso deberá confirmar la maniobra.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    flexGrow: 0,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.25)' } as object,
      default: { elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    }),
  },
  content: { padding: 18, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icono: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primary + '1A', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  sub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  detalle: { backgroundColor: Colors.surface, borderRadius: 10, padding: 12, gap: 6, borderWidth: 1, borderColor: Colors.divider },
  fila: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 12, color: Colors.textSecondary },
  valor: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  // 44 px de alto: el área táctil mínima, aunque la pista visible sea fina.
  pista: { height: 44, justifyContent: 'center' },
  pistaFondo: { height: 8, borderRadius: 4, backgroundColor: Colors.surface, overflow: 'hidden', borderWidth: 1, borderColor: Colors.divider },
  pistaRelleno: { height: '100%', backgroundColor: Colors.primary },
  marcaActual: { position: 'absolute', width: 2, height: 22, marginLeft: -1, backgroundColor: Colors.textSecondary },
  pulgar: {
    position: 'absolute',
    width: 26,
    height: 26,
    marginLeft: -13,
    borderRadius: 13,
    backgroundColor: Colors.bg,
    borderWidth: 3,
    borderColor: Colors.primary,
  },
  leyenda: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  leyendaTexto: { fontSize: 10.5, color: Colors.textSecondary },
  ajuste: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  paso: { minWidth: 44, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: Colors.divider, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  pasoTexto: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  input: {
    width: 72,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    backgroundColor: Colors.bg,
  },
  inputMal: { borderColor: Colors.danger },
  unidad: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  error: { fontSize: 12, color: Colors.danger, textAlign: 'center' },
  nota: { fontSize: 11.5, color: Colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
  botones: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, minHeight: 44 },
  btnVolver: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.divider },
  btnVolverText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  btnInactivo: { backgroundColor: Colors.divider },
  btnContinuarText: { fontSize: 14, fontWeight: '800', color: Colors.bg },
  pie: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
});
