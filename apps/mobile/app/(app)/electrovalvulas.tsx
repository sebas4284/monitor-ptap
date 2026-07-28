import { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useElectrovalvulas } from '../../hooks/useElectrovalvulas';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { ValveItem } from '../../components/ValveItem';
import { PlantSelector } from '../../components/PlantSelector';
import { ExampleDataBanner } from '../../components/ExampleDataBanner';
import Colors from '../../constants/colors';

export default function ElectrovalvulasScreen() {
  const { data: valves, isLoading, refetch, isRefetching } = useElectrovalvulas();
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canView = hasPermission('view_dashboard'); // el Civil no ve electroválvulas
  const canControl = hasPermission('control_valves');

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // Los overrides son por valve.id; al cambiar de planta hay que limpiarlos o un id que coincida
  // entre plantas arrastraría el estado alterado de la planta anterior.
  useEffect(() => setOverrides({}), [selectedPlant.id]);

  const effectiveValves = valves?.map(v => ({
    ...v,
    isOpen: v.id in overrides ? overrides[v.id] : v.isOpen,
  }));

  const openCount  = effectiveValves?.filter(v => v.isOpen).length  ?? 0;
  const closedCount = effectiveValves?.filter(v => !v.isOpen).length ?? 0;

  // Guard de rol de pantalla (coherente con tablero/reportes): un Civil que llegue por deep-link
  // no debe ver el estado de válvulas. Va tras TODOS los hooks (reglas de hooks).
  if (!canView) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.plantName}>Acceso restringido</Text>
          <Text style={styles.sectionSubtitle}>Las electroválvulas no están disponibles para tu rol.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />
      <ExampleDataBanner detail="Las válvulas aún no se controlan por el canal real del PLC (escritura bloqueada). Lo que ves es una demostración; abrir/cerrar no afecta la planta." />

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
          <View>
            <Text style={styles.plantName}>{selectedPlant.name}</Text>
            <Text style={styles.sectionSubtitle}>Electroválvulas</Text>
          </View>
          {effectiveValves && (
            <View style={styles.summary}>
              <Text style={[styles.summaryCount, { color: Colors.success }]}>{openCount} abiertas</Text>
              <Text style={styles.summaryDot}> · </Text>
              <Text style={[styles.summaryCount, { color: Colors.danger }]}>{closedCount} cerradas</Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Cargando electroválvulas…</Text>
          </View>
        ) : (
          effectiveValves?.map(valve => (
            <ValveItem
              key={valve.id}
              valve={valve}
              onToggle={canControl
                ? () => setOverrides(prev => ({ ...prev, [valve.id]: !valve.isOpen }))
                : undefined
              }
            />
          ))
        )}
      </ScrollView>

      {/* Sin badge de frescura a propósito: las válvulas son todavía datos de ejemplo
          (services/mock-data.ts). Cualquier etiqueta aquí mentiría — "EN VIVO" sobre datos
          inventados, o "SIN CONEXIÓN" cuando el enlace no tiene nada que ver. Vuelve cuando
          la pantalla consuma el canal real de comandos. */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  summaryCount: { fontSize: 12, fontWeight: '700' },
  summaryDot: { color: Colors.textSecondary, fontSize: 12 },
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
});
