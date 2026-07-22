import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { classifyBridge } from '@ptap/shared';
import {
  fetchConnectionEvents,
  fetchRouteHistory,
  runRouteCheck,
  type ConnectionEvent,
  type RouteCheckReport,
  type RouteProbe,
} from '../services/api';
import { exportDiagnosticsReport } from '../services/diagnostics-export';
import Colors from '../constants/colors';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** Texto de una sonda, en el lenguaje del diagnóstico (la distinción timeout/rechazo importa). */
function probeText(p: RouteProbe): string {
  switch (p.outcome) {
    case 'ok':
      return `responde · ${p.ms} ms`;
    case 'timeout':
      return `sin respuesta (timeout ${Math.round(p.ms / 100) / 10} s)`;
    case 'refused':
      return 'rechazada — host vivo, nada escucha en el puerto';
    case 'error':
      return `error${p.detail ? ` (${p.detail})` : ''}`;
  }
}

function probeLabel(p: RouteProbe): string {
  switch (p.name) {
    case 'internet':
      return `servidor → internet (${p.target})`;
    case 'ping':
      return `ping al host del PLC (${p.target})`;
    case 'plc':
      return `servidor → PLC (${p.target})`;
  }
}

/** `21/07 15:47` — para fechas del registro continuo (pueden ser de ayer). */
function ddmmhhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const VERDICT_COLOR: Record<RouteCheckReport['verdict']['where'], string> = {
  ninguno: Colors.success,
  servidor: Colors.danger,
  'ruta-o-planta': Colors.danger,
  'plc-servicio': Colors.warning,
};

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
  const queryClient = useQueryClient();
  // probarRuta=1: llegó REDIRIGIDO por la notificación (banner PLC-01) → la prueba corre sola.
  const { probarRuta } = useLocalSearchParams<{ probarRuta?: string }>();

  const { data: events, isLoading, isError, refetch } = useQuery({
    queryKey: ['connection-events'],
    queryFn: fetchConnectionEvents,
    refetchInterval: 30_000,
  });
  const [exporting, setExporting] = useState(false);
  const [routeCheck, setRouteCheck] = useState<RouteCheckReport | null>(null);
  const [checkingRoute, setCheckingRoute] = useState(false);
  const [routeError, setRouteError] = useState(false);

  // El registro interno (20 h, muestras ocultas cada hora en punto) SOLO se consulta y se
  // muestra después de que el usuario ejecutó la prueba (botón o redirección automática).
  // Antes de eso, las pruebas existen pero no se enseñan — son internas.
  const { data: history } = useQuery({
    queryKey: ['route-history'],
    queryFn: fetchRouteHistory,
    enabled: routeCheck !== null,
  });

  async function onRouteCheck() {
    setCheckingRoute(true);
    setRouteError(false);
    try {
      setRouteCheck(await runRouteCheck());
      // La prueba manual quedó GRABADA en el registro del servidor: refrescar el resumen para
      // que aparezca ya (y la muestra más vieja salga de la ventana de 20 h).
      void queryClient.invalidateQueries({ queryKey: ['route-history'] });
    } catch {
      setRouteError(true);
    } finally {
      setCheckingRoute(false);
    }
  }

  // Auto-ejecución al llegar redirigido por la notificación: una sola vez por montaje.
  const autoRan = useRef(false);
  useEffect(() => {
    if (probarRuta === '1' && !autoRan.current) {
      autoRan.current = true;
      void onRouteCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probarRuta]);

  async function onExport() {
    if (!events) return;
    setExporting(true);
    try {
      // Si el admin no corrió la prueba de ruta, se intenta una fresca para que el informe
      // salga con evidencia (mejor esfuerzo: si falla, el informe lo dice y sale igual).
      let check = routeCheck;
      if (!check) {
        try {
          check = await runRouteCheck();
          setRouteCheck(check);
        } catch {
          check = null;
        }
      }
      // El registro de 20 h siempre viaja en el .txt (aunque en pantalla aún no se muestre).
      let hist = history ?? null;
      if (!hist) {
        try {
          hist = await fetchRouteHistory();
        } catch {
          hist = null;
        }
      }
      await exportDiagnosticsReport(events, check, hist);
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

      {/* ── Prueba de ruta EN VIVO: sondas reales que dicen DÓNDE falla, con evidencia ── */}
      <TouchableOpacity
        style={[styles.routeBtn, checkingRoute && styles.exportBtnDisabled]}
        onPress={() => void onRouteCheck()}
        disabled={checkingRoute}
        activeOpacity={0.85}
      >
        {checkingRoute ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Ionicons name="pulse-outline" size={16} color={Colors.primary} />
        )}
        <Text style={styles.routeBtnText}>
          {checkingRoute ? 'Probando la ruta…' : 'Probar ruta ahora'}
        </Text>
      </TouchableOpacity>

      {routeError && (
        <Text style={styles.muted}>No se pudo ejecutar la prueba de ruta (¿servidor alcanzable?).</Text>
      )}

      {routeCheck && (
        <View style={styles.console}>
          <Text style={styles.consoleTitle}>
            Prueba de ruta · {hhmm(routeCheck.at)} · objetivo {routeCheck.target.host}:{routeCheck.target.port}
          </Text>
          {routeCheck.probes.map((p) => (
            <View key={p.name} style={styles.consoleRow}>
              <Ionicons
                name={p.outcome === 'ok' ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color={p.outcome === 'ok' ? Colors.success : Colors.danger}
              />
              <Text style={styles.consoleLine}>
                {probeLabel(p)}: {probeText(p)}
              </Text>
            </View>
          ))}
          {routeCheck.serverPublicIp && (
            <View style={styles.consoleRow}>
              <Ionicons name="globe-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.consoleLine}>IP pública del servidor: {routeCheck.serverPublicIp}</Text>
            </View>
          )}
          <View style={[styles.verdict, { borderLeftColor: VERDICT_COLOR[routeCheck.verdict.where] }]}>
            <Text style={[styles.verdictCode, { color: VERDICT_COLOR[routeCheck.verdict.where] }]}>
              {routeCheck.verdict.code === '—' ? 'RUTA OK' : routeCheck.verdict.code}
            </Text>
            <Text style={styles.verdictText}>{routeCheck.verdict.message}</Text>
          </View>
        </View>
      )}

      {/* ── Registro interno de 20 h: SOLO aparece tras ejecutar la prueba (las muestras
             automáticas de cada hora en punto existen siempre, pero no se enseñan antes). ── */}
      {routeCheck && history && (
        <View style={styles.historyRow}>
          <Ionicons
            name={history.summary.downSince ? 'time-outline' : 'checkmark-done-outline'}
            size={15}
            color={history.summary.downSince ? Colors.danger : Colors.success}
          />
          <Text style={styles.historyText}>
            {history.summary.samples === 0
              ? 'Registro interno: aún sin muestras (se toma una cada hora en punto automáticamente).'
              : `Registro 20 h: ${history.summary.plcOk}/${history.summary.samples} pruebas alcanzaron el PLC (${history.summary.uptimePct}%)` +
                (history.summary.downSince ? ` · corte vigente desde ${ddmmhhmm(history.summary.downSince)}` : '')}
          </Text>
        </View>
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
        El informe incluye el historial y la prueba de ruta (sondas, latencias, IP objetivo,
        reintentos) para enviarlo a un técnico. Si no corriste la prueba, se intenta una al exportar.
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
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E5E7EB',
  },
  historyText: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 16 },
  routeBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary, borderRadius: 10, paddingVertical: 10, marginTop: 12,
  },
  routeBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  // Bloque tipo consola: monoespaciado, una línea por sonda, veredicto resaltado.
  console: { backgroundColor: '#0F172A0A', borderRadius: 8, padding: 10, marginTop: 10, gap: 4 },
  consoleTitle: { fontFamily: MONO, fontSize: 11, color: Colors.textSecondary, marginBottom: 2 },
  consoleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  consoleLine: { flex: 1, fontFamily: MONO, fontSize: 11.5, color: Colors.textPrimary },
  verdict: { borderLeftWidth: 3, paddingLeft: 8, marginTop: 6, gap: 2 },
  verdictCode: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  verdictText: { fontSize: 12, lineHeight: 17, color: Colors.textPrimary },
  exportBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 11, marginTop: 12,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 11, color: Colors.textSecondary, marginTop: 8, lineHeight: 15, fontStyle: 'italic' },
});
