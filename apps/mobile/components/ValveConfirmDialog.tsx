import { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';

/**
 * Doble confirmación antes de accionar una válvula real.
 *
 * Mover una válvula mueve agua: una maniobra equivocada puede dejar un sector sin servicio o
 * golpear la red. El botón de la lista ya no ejecuta nada por sí solo — abre este diálogo, que
 * obliga a leer QUÉ planta y QUÉ válvula se van a operar antes de poder aceptar.
 *
 * La espera de 3 s no es decorativa: es lo que impide que un doble clic o un toque por inercia
 * dispare la maniobra. Hasta que no vence, el botón de aceptar está deshabilitado de verdad
 * (no solo atenuado). "Volver" siempre está activo — cancelar nunca debe costar esfuerzo.
 */

/** Segundos que el botón de aceptar permanece bloqueado tras abrirse el diálogo. */
export const ESPERA_SEGUNDOS = 3;

interface Props {
  visible: boolean;
  /** Nombre de la válvula, tal como lo ve el operador. */
  valveName: string;
  /** Nombre de la planta: evita operar la válvula correcta en el sitio equivocado. */
  plantName: string;
  /** Maniobra a ejecutar. */
  verb: 'open' | 'close';
  /** Hay una orden en vuelo: se bloquea todo y se muestra el spinner. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ValveConfirmDialog({ visible, valveName, plantName, verb, busy = false, onConfirm, onCancel }: Props) {
  const [restante, setRestante] = useState(ESPERA_SEGUNDOS);

  // El contador se reinicia en CADA apertura: si no, la segunda maniobra de la sesión saldría
  // sin espera y se perdería justamente la protección contra el toque por inercia.
  useEffect(() => {
    if (!visible) {
      setRestante(ESPERA_SEGUNDOS);
      return;
    }
    setRestante(ESPERA_SEGUNDOS);
    const id = setInterval(() => setRestante((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [visible]);

  const accion = verb === 'open' ? 'ABRIR' : 'CERRAR';
  const listo = restante === 0 && !busy;
  const colorAccion = verb === 'open' ? Colors.success : Colors.danger;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.warnIcon}>
              <Ionicons name="warning-outline" size={24} color={Colors.warning} />
            </View>
            <Text style={styles.title}>¿Seguro que desea mover la válvula?</Text>
          </View>

          <View style={styles.detalle}>
            <View style={styles.detalleFila}>
              <Text style={styles.detalleLabel}>Planta</Text>
              <Text style={styles.detalleValor}>{plantName}</Text>
            </View>
            <View style={styles.detalleFila}>
              <Text style={styles.detalleLabel}>Válvula</Text>
              <Text style={styles.detalleValor}>{valveName}</Text>
            </View>
            <View style={styles.detalleFila}>
              <Text style={styles.detalleLabel}>Acción</Text>
              <Text style={[styles.detalleValor, { color: colorAccion }]}>{accion}</Text>
            </View>
          </View>

          <Text style={styles.advertencia}>
            Esta orden se envía al equipo real de la planta.{' '}
            <Text style={styles.advertenciaFuerte}>
              Una maniobra equivocada puede ocasionar daños en la red o dejar sin servicio a un sector.
            </Text>{' '}
            Confirme que es la válvula y la planta correctas antes de continuar.
          </Text>

          <View style={styles.botones}>
            <TouchableOpacity
              style={[styles.btn, styles.btnVolver]}
              onPress={onCancel}
              disabled={busy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Volver sin mover la válvula"
            >
              <Ionicons name="arrow-back-outline" size={16} color={Colors.textPrimary} />
              <Text style={styles.btnVolverText}>Volver</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, listo ? { backgroundColor: colorAccion } : styles.btnEspera]}
              onPress={onConfirm}
              disabled={!listo}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: !listo }}
              accessibilityLabel={listo ? `Aceptar y ${accion.toLowerCase()} la válvula` : `Espere ${restante} segundos`}
            >
              {busy ? (
                <>
                  <ActivityIndicator size="small" color={Colors.bg} />
                  <Text style={styles.btnAceptarText}>Enviando…</Text>
                </>
              ) : (
                <Text style={[styles.btnAceptarText, !listo && styles.btnEsperaText]}>
                  {listo ? 'Aceptar' : `Aceptar (${restante})`}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {!listo && !busy && (
            <Text style={styles.pie}>El botón se habilita en {restante} s. Tómese ese momento para verificar.</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    // La sombra se declara distinto por plataforma; en web `elevation` no hace nada.
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.25)' } as object,
      default: { elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    }),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  warnIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.warning + '1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 16, fontWeight: '800', color: Colors.textPrimary, lineHeight: 21 },
  detalle: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  detalleFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detalleLabel: { fontSize: 12, color: Colors.textSecondary },
  detalleValor: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  advertencia: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  advertenciaFuerte: { fontWeight: '700', color: Colors.warning },
  botones: { flexDirection: 'row', gap: 10, marginTop: 2 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnVolver: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.divider },
  btnVolverText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  btnEspera: { backgroundColor: Colors.divider },
  btnEsperaText: { color: Colors.textSecondary },
  btnAceptarText: { fontSize: 14, fontWeight: '800', color: Colors.bg },
  pie: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', fontStyle: 'italic' },
});
