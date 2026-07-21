import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { classifyBridge } from '@ptap/shared';
import { fetchConnectionEvents, type ConnectionEvent } from '../services/api';
import { exportDiagnosticsReport } from '../services/diagnostics-export';
import Colors from '../constants/colors';

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Traduce un evento a una frase que un administrador entienda, sin jerga OPC. */
function frase(ev: ConnectionEvent): { text: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  const status = ev.detail?.status;
  if (!status) return { text: 'Evento de conexión', color: Colors.textSecondary, icon: 'ellipse-outline' };
  switch (classifyBridge(status)) {
    case 'ok':
      return { text: 'Conexión con el PLC establecida', color: Colors.success, icon: 'checkmark-circle' };
    case 'master_no_data':
      return { text: 'El PLC dejó de enviar datos', color: Colors.warning, icon: 'alert-circle' };
    case 'route':
      return { text: 'Sin conexión con el PLC (problema de ruta de red)', color: Colors.danger, icon: 'git-network-outline' };
  }
}

/**
 * Sección de diagnóstico de conexión para el ADMIN. Muestra el historial de cortes en lenguaje
 * llano (para que lo lea y lo entienda) y permite exportar el mismo historial en un .txt técnico
 * (para que un programador lo documente). Los eventos ya viven en el audit_log; esto solo los lee.
 */
export function ConnectionDiagnostics() {
  const { data: events, isLoading, isError, refetch } = useQuery({
    queryKey: ['connection-events'],
    queryFn: fetchConnectionEvents,
    refetchInterval: 30_000,
  });
  const [exporting, setExporting] = useState(false);

  async function onExport() {
    if (!events) return;
    setExporting(true);
    try {
      await exportDiagnosticsReport(events);
    } finally {
      setExporting(false);
    }
  }

  const recent = (events ?? []).slice(0, 20);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.headText}>Historial de conexión con el PLC</Text>
        <TouchableOpacity onPress={() => void refetch()} hitSlop={8}>
          <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: 12 }} />
      ) : isError ? (
        <Text style={styles.muted}>No se pudo cargar el historial.</Text>
      ) : recent.length === 0 ? (
        <Text style={styles.muted}>Sin eventos de conexión registrados.</Text>
      ) : (
        recent.map((ev, i) => {
          const f = frase(ev);
          return (
            <View key={`${ev.at}-${i}`} style={styles.eventRow}>
              <Ionicons name={f.icon} size={16} color={f.color} />
              <Text style={styles.eventTime}>{hhmm(ev.at)}</Text>
              <Text style={styles.eventText}>{f.text}</Text>
            </View>
          );
        })
      )}

      <TouchableOpacity
        style={[styles.exportBtn, (exporting || !events?.length) && styles.exportBtnDisabled]}
        onPress={() => void onExport()}
        disabled={exporting || !events?.length}
        activeOpacity={0.85}
      >
        <Ionicons name="download-outline" size={16} color="#fff" />
        <Text style={styles.exportText}>{exporting ? 'Exportando…' : 'Exportar informe (.txt)'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        El informe descarga el detalle técnico (códigos y causas) para enviarlo a un técnico cuando
        el fallo sea de ruta.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headText: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  muted: { fontSize: 12.5, color: Colors.textSecondary, marginVertical: 8 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  eventTime: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, width: 44 },
  eventText: { flex: 1, fontSize: 12.5, color: Colors.textPrimary },
  exportBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 11, marginTop: 12,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 11, color: Colors.textSecondary, marginTop: 8, lineHeight: 15, fontStyle: 'italic' },
});
