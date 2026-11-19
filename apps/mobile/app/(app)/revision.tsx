import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { PlantSelector } from '../../components/PlantSelector';
import { ListSkeleton } from '../../components/Skeleton';
import { OfflineNotice } from '../../components/OfflineNotice';
import { useAuth } from '../../context/AuthContext';
import { usePlant } from '../../context/PlantContext';
import { fetchPlantReport } from '../../services/api';
import { exportPlantDiagnosticsReport } from '../../services/diagnostics-export';
import { plantReportSections } from '../../services/plant-report';
import Colors from '../../constants/colors';
import { Fonts } from '../../constants/fonts';

const B = Colors.brand;

const STATES = {
  ok: { label: 'Correcto', color: B.green },
  warning: { label: 'Revisar', color: Colors.warning },
  error: { label: 'Fallo', color: B.dangerText },
  unknown: { label: 'Sin evidencia', color: B.textSecondary },
};

export default function RevisionScreen() {
  const { hasPermission, user } = useAuth();
  const { selectedPlant } = usePlant();
  const allowed = hasPermission('system_config');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const query = useQuery({
    queryKey: ['plant-report', user?.id, selectedPlant.id],
    queryFn: () => fetchPlantReport(selectedPlant.id),
    enabled: allowed,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  async function exportReport() {
    if (!query.data) return;
    setExporting(true);
    setExportError(false);
    try {
      setExportError(!(await exportPlantDiagnosticsReport(query.data)));
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  if (!allowed) return <View style={styles.content}><Text style={styles.title}>Solo para administradores</Text><Text style={styles.detail}>La revisión por planta requiere el permiso de configuración del sistema.</Text></View>;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />
      <ScrollView contentContainerStyle={styles.content} refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={B.action} />
      }>
        <Text style={styles.title}>Revisión · {selectedPlant.name}</Text>
        <Text style={styles.detail}>Red, puente, buffers, señales y anomalías. La red y el puente son compartidos por todas las plantas. Esta consulta usa la cache del servidor y no lee directamente el PLC.</Text>
        {query.isLoading ? <ListSkeleton rows={5} label="Cargando el informe de la planta" />
          : query.isError ? <OfflineNotice title="No se pudo actualizar el informe." detail="Reintenta para consultar el estado del servidor." onRetry={query.refetch} retryLabel="Reintentar el informe por planta" /> : null}
        {query.data && <>
          <Text style={styles.detail}>Informe: {query.data.at}</Text>
          <TouchableOpacity style={styles.button} onPress={() => void exportReport()} disabled={exporting} accessibilityRole="button" accessibilityState={{ disabled: exporting }}>
            <Text style={styles.buttonText}>{exporting ? 'Exportando…' : 'Exportar informe .txt'}</Text>
          </TouchableOpacity>
          {exportError && <Text style={styles.error} accessibilityRole="alert">No se pudo exportar. Vuelve a intentarlo.</Text>}
          <Text style={styles.detail}>Las horas del PLC indican la fecha del dato; no prueban cuándo cambió el valor. “Sin hora” significa que no hay evidencia temporal disponible.</Text>
          {plantReportSections(query.data).map((section) => <View key={section.title} style={styles.card}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{section.title} · {section.items.length}</Text>
            {!section.items.length && <Text style={styles.detail}>Sin registros para esta planta.</Text>}
            {section.items.map((item, index) => <View key={`${item.label}-${index}`} style={styles.item}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={[styles.status, { color: STATES[item.state].color }]}>{STATES[item.state].label}</Text>
              <Text style={styles.detail} selectable>{item.detail}</Text>
              <Text style={styles.time} selectable>Hora: {item.at ?? 'sin hora disponible'}</Text>
            </View>)}
          </View>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: B.page },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 20, fontFamily: Fonts.semibold, color: B.text },
  sectionTitle: { fontSize: 16, fontFamily: Fonts.semibold, color: B.text },
  card: { backgroundColor: B.card, borderColor: B.cardBorder, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  item: { borderTopWidth: 1, borderTopColor: B.cardBorder, paddingTop: 10, gap: 4 },
  label: { fontSize: 14, fontFamily: Fonts.semibold, color: B.text },
  status: { fontSize: 12, fontFamily: Fonts.semibold },
  detail: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.regular, color: B.textSecondary },
  time: { fontSize: 11, fontFamily: Fonts.regular, color: B.textSecondary },
  button: { alignSelf: 'flex-start', backgroundColor: B.action, padding: 12, minHeight: 44, borderRadius: 8 },
  buttonText: { color: B.white, fontFamily: Fonts.semibold },
  error: { color: B.dangerText, fontSize: 13 },
});
