import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useElectrovalvulas } from '../../hooks/useElectrovalvulas';
import { usePlant } from '../../context/PlantContext';
import { useAuth } from '../../context/AuthContext';
import { ValveItem } from '../../components/ValveItem';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import Colors from '../../constants/colors';

export default function ElectrovalvulasScreen() {
  const { data: valves, isLoading, refetch, isRefetching } = useElectrovalvulas();
  const { selectedPlant } = usePlant();
  const { hasPermission } = useAuth();
  const canControl = hasPermission('control_valves');

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const effectiveValves = valves?.map(v => ({
    ...v,
    isOpen: v.id in overrides ? overrides[v.id] : v.isOpen,
  }));

  const openCount  = effectiveValves?.filter(v => v.isOpen).length  ?? 0;
  const closedCount = effectiveValves?.filter(v => !v.isOpen).length ?? 0;

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

      <LiveBadge state="unknown" />
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
