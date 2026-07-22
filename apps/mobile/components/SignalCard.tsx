import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto, UnusableReason } from '../services/api';

/**
 * Por qué no hay número, dicho para un operador y no para un integrador. "calidad OPC no buena"
 * sonaba a fallo del programa cuando casi siempre significa que el PLC no está entregando el
 * dato; el banner de la pantalla da el contexto de conexión.
 */
const REASON_TEXT: Record<UnusableReason, string> = {
  BAD_QUALITY: 'el PLC no está entregando esta lectura',
  INVALID_NUMBER: 'el PLC entregó un valor inválido',
  BRIDGE_STALE: 'sin conexión con el PLC',
};

/**
 * Tarjeta de una señal de dominio. Distingue lo confirmado de lo inferido (regla 10):

 * un caudal inferido NO se ve igual que uno confirmado.
 *
 * Política de datos (usuario, 2026-07-15): si hay valor numérico SE MUESTRA tal cual,
 * sin importar usable/reason — el backend entrega datos y metadatos; la interpretación
 * (congelado, fuera de escala, etc.) es del frontend en diálogo con el cliente, no de
 * esta capa. "sin dato" solo cuando literalmente no hay número (value null).
 */
function horaDe(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * `stale` = la planta está congelada (sin conexión con el PLC). Con `stale`, si HAY un último
 * valor se muestra atenuado y con su hora ("última lectura HH:MM") en vez de vaciarse: el dato
 * viejo sigue siendo útil mientras no engañe sobre su frescura. Sin valor previo → "sin dato".
 */
export function SignalCard({
  signal,
  name,
  icon,
  stale = false,
}: {
  signal: SignalDto;
  name: string;
  icon: string;
  stale?: boolean;
}) {
  const isInferred = signal.confidence !== 'confirmed';
  const numeric = typeof signal.value === 'number';
  const hasRange = typeof signal.opMin === 'number' || typeof signal.opMax === 'number';
  const lastSeen = stale && numeric ? horaDe(signal.ts) : null;

  // Color de ALERTA del valor (la misma lógica que services/alerts.ts): con datos frescos, un
  // valor fuera del rango físico = rojo; fuera del operativo = ámbar. Congelado no alarma (viejo).
  const v = signal.value;
  const outOfOp =
    typeof v === 'number' &&
    ((typeof signal.opMin === 'number' && v < signal.opMin) ||
      (typeof signal.opMax === 'number' && v > signal.opMax));
  const alertColor = stale ? null : signal.outOfRange ? Colors.danger : outOfOp ? Colors.warning : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon as never} size={18} color={Colors.primary} />
        </View>
        <Text style={styles.name}>{signal.label ?? name}</Text>
        {isInferred && (
          <View style={styles.inferredTag}>
            <Text style={styles.inferredText}>inferido</Text>
          </View>
        )}
      </View>

      {numeric ? (
        <>
          <Text style={[styles.value, stale && styles.valueStale, alertColor ? { color: alertColor } : null]}>
            {(signal.value as number).toFixed(2)}
            <Text style={styles.unit}> {signal.unit ?? ''}</Text>
          </Text>
          {stale && (
            <Text style={styles.staleNote}>
              {lastSeen ? `última lectura ${lastSeen} · sin actualizar` : 'sin actualizar'}
            </Text>
          )}
        </>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataValue}>sin dato</Text>
          {signal.reason && <Text style={styles.noDataReason}>{REASON_TEXT[signal.reason]}</Text>}
        </View>
      )}

      {hasRange && (
        <View style={styles.rangeRow}>
          {typeof signal.opMin === 'number' && <Text style={styles.rangeText}>Mín: {signal.opMin.toFixed(2)}</Text>}
          {typeof signal.opMax === 'number' && <Text style={styles.rangeText}>Máx: {signal.opMax.toFixed(2)}</Text>}
        </View>
      )}

      {isInferred && (
        <Text style={styles.footnote}>
          * semántica inferida (no confirmada por documento de la planta)
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 5,
    padding: 14,
    backgroundColor: Colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  inferredTag: {
    backgroundColor: '#FFF7ED',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inferredText: { fontSize: 9, fontWeight: '700', color: Colors.warning, letterSpacing: 0.5 },
  value: { fontSize: 28, fontWeight: '800', color: Colors.primary, marginBottom: 6 },
  valueWarning: { color: Colors.warning },
  // Dato viejo: atenuado, para que se lea como "última lectura conocida", no como valor en vivo.
  valueStale: { color: Colors.textSecondary, marginBottom: 2 },
  staleNote: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic', marginBottom: 6 },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  rangeRow: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  rangeText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  noData: { marginBottom: 6 },
  noDataValue: { fontSize: 22, fontWeight: '700', color: Colors.neutral },
  noDataReason: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  footnote: { fontSize: 9, color: Colors.textSecondary, marginTop: 2 },
});
