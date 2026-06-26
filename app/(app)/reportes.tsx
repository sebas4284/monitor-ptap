import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { fetchReports, type Report } from '../../services/api';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { PlantSelector } from '../../components/PlantSelector';
import Colors from '../../constants/colors';

export default function ReportesScreen() {
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canExport = hasPermission('export_data');

  const { data: reports, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['reports', selectedPlant],
    queryFn: () => fetchReports(selectedPlant),
    refetchInterval: 30_000,
  });

  function handleExport() {
    Alert.alert(
      'Exportar historial',
      'El historial completo de datos será exportado en formato CSV.',
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Exportar', onPress: () => {} }],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.plantName}>{selectedPlant}</Text>
            <Text style={styles.sectionSubtitle}>Últimos reportes generados</Text>
          </View>
          {canExport && (
            <TouchableOpacity style={styles.exportBtn} onPress={handleExport} activeOpacity={0.8}>
              <Ionicons name="download-outline" size={15} color={Colors.primary} />
              <Text style={styles.exportText}>Exportar</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Cargando reportes…</Text>
          </View>
        ) : (
          reports?.map(report => <ReportItem key={report.id} report={report} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportItem({ report }: { report: Report }) {
  const isPending = report.status === 'pending';
  const statusColor = isPending ? Colors.warning : Colors.success;

  function handlePress() {
    Alert.alert(
      report.title,
      `Fecha: ${report.date}\nEstado: ${isPending ? 'Pendiente' : 'Generado'}\nTipo: ${report.type}`,
    );
  }

  return (
    <TouchableOpacity style={styles.reportCard} activeOpacity={0.75} onPress={handlePress}>
      <View style={[styles.reportIcon, { backgroundColor: statusColor + '18' }]}>
        <Ionicons
          name={isPending ? 'warning-outline' : 'checkmark-circle-outline'}
          size={24}
          color={statusColor}
        />
      </View>

      <View style={styles.reportInfo}>
        <Text style={styles.reportTitle}>{report.title}</Text>
        <Text style={styles.reportDate}>{report.date}</Text>
      </View>

      <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>
          {isPending ? 'Pendiente' : 'Generado'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary + '50',
    backgroundColor: Colors.primary + '0F',
  },
  exportText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  reportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reportInfo: { flex: 1 },
  reportTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  reportDate: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
