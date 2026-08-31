import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { usePlant, PLANTS } from '../../context/PlantContext';
import {
  fetchRawBuffers,
  formatValorCrudo,
  tipoYLargo,
  type RawBufferView,
  type RawChannel,
} from '../../services/opc-raw';
import { formatWhen } from '../../services/notifications';
import { ListSkeleton } from '../../components/Skeleton';
import { OfflineNotice } from '../../components/OfflineNotice';
import Colors from '../../constants/colors';

/**
 * Modo desarrollador — los buffers crudos de una planta, al estilo de UA Expert. **Solo lectura.**
 *
 * Por qué existe: el 2026-08-25 se tardaron seis horas en concluir que `cascajal.inletPressure1`
 * leía 409,50 psi porque es 4095/10 —el fondo de escala de un convertidor de 12 bits—, y para
 * llegar ahí hubo que abrir fixtures a mano y cruzar índices entre las doce plantas. El backend
 * tenía el dato desde el principio; lo que faltaba era poder verlo. Esta pantalla es ese dato.
 *
 * Lo que la hace accionable, y no una tabla de números: **junto a cada índice, qué señal lo consume
 * y con qué etiqueta y unidad sale en el tablero.**
 *
 * No dispara lecturas al PLC: `/api/opc/raw/:plantId` sirve la última muestra que entró por la
 * Subscription, igual que el resto de `/opc/*`.
 */

/** Cada cuánto se repide. La cache del pipeline se refresca en ~1 s; 10 s es «en vivo» de sobra. */
const REFRESCO_MS = 10_000;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** Una fila del array: índice, valor y quién lo consume. */
function Canal({ c }: { c: RawChannel }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.indice}>[{String(c.index).padStart(2, ' ')}]</Text>
      <Text
        style={[styles.valor, c.outOfRange && styles.valorMal, c.value === null && styles.valorAusente]}
      >
        {formatValorCrudo(c.value)}
      </Text>
      <View style={styles.filaInfo}>
        {c.domainKey ? (
          <>
            <Text style={styles.domainKey}>
              {c.domainKey}
              {c.unit ? <Text style={styles.unidad}> {c.unit}</Text> : null}
            </Text>
            {c.label ? <Text style={styles.etiqueta}>{c.label}</Text> : null}
          </>
        ) : (
          <Text style={styles.sinMapear}>(sin mapear)</Text>
        )}
        {/* Un índice declarado que la muestra no trae es exactamente el fallo que produce un
            dead-letter INDEX_OUT_OF_RANGE. Se dice, en vez de pintarlo como un cero. */}
        {c.value === null && c.domainKey ? (
          <Text style={styles.aviso}>el mapeo declara este índice y la muestra no lo trae</Text>
        ) : null}
      </View>
      {c.outOfRange ? <Ionicons name="warning" size={14} color={Colors.warning} /> : null}
      {c.locked ? <Ionicons name="lock-closed" size={13} color={Colors.textSecondary} /> : null}
    </View>
  );
}

function Buffer({ b }: { b: RawBufferView }) {
  const sinMuestras = b.receivedLength === null;
  const desajuste = !sinMuestras && b.declaredLength !== null && b.receivedLength !== b.declaredLength;

  return (
    <View style={styles.tarjeta}>
      <View style={styles.cabecera}>
        <Text style={styles.browseName}>{b.browseName}</Text>
        <View style={styles.chipCanal}>
          <Text style={styles.chipCanalTexto}>{b.channel}</Text>
        </View>
      </View>

      <Text style={styles.nodeId} selectable numberOfLines={2}>
        ns={b.nsUri} · {b.identifier}
      </Text>

      <View style={styles.meta}>
        <Text style={styles.tipo}>{tipoYLargo(b)}</Text>
        {sinMuestras ? (
          <View style={[styles.chip, styles.chipMal]}>
            <Text style={styles.chipTexto}>nunca llegó una muestra</Text>
          </View>
        ) : null}
        {desajuste ? (
          <View style={[styles.chip, styles.chipOjo]}>
            <Text style={styles.chipTexto}>recibidos {b.receivedLength}</Text>
          </View>
        ) : null}
        {b.quality && b.quality !== 'Good' ? (
          <View style={[styles.chip, styles.chipOjo]}>
            <Text style={styles.chipTexto}>{b.quality}</Text>
          </View>
        ) : null}
        {b.statusCode && b.statusCode !== 'Good' ? (
          <View style={[styles.chip, styles.chipOjo]}>
            <Text style={styles.chipTexto}>{b.statusCode}</Text>
          </View>
        ) : null}
        {b.sourceTimestamp ? <Text style={styles.sello}>{formatWhen(b.sourceTimestamp)}</Text> : null}
      </View>

      {b.channels.length === 0 ? (
        <Text style={styles.vacio}>
          {sinMuestras
            ? 'El NodeId está en el mapeo pero no ha entregado nada. Si el resto de buffers de esta planta sí llegan, el problema es de ESTE nodo y no de la conexión.'
            : 'Todos los índices llegaron en cero y ninguno está mapeado.'}
        </Text>
      ) : (
        b.channels.map((c) => <Canal key={c.index} c={c} />)
      )}

      {b.hiddenZeros > 0 ? (
        <Text style={styles.ocultos}>
          {b.hiddenZeros} {b.hiddenZeros === 1 ? 'índice' : 'índices'} en cero y sin mapear{' '}
          {b.hiddenZeros === 1 ? 'oculto' : 'ocultos'}
        </Text>
      ) : null}

      {b.channel === 'intOut' ? (
        <Text style={styles.ocultos}>
          Este es NUESTRO canal de mando: se muestra completo, ceros incluidos. El pulso se suelta a
          los 300 ms, así que está en cero casi siempre. Quien reporta el estado es intIn.
        </Text>
      ) : null}
    </View>
  );
}

export default function DesarrolladorScreen() {
  const { hasPermission } = useAuth();
  const { selectedPlant, canSwitchPlant } = usePlant();
  // Selección LOCAL, sembrada con la planta activa: cambiar de planta aquí para diagnosticar no debe
  // mover la planta del tablero por debajo de quien vuelva atrás.
  const [plantId, setPlantId] = useState(selectedPlant.id);

  const puede = hasPermission('system_config');
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['opc-raw', plantId],
    queryFn: () => fetchRawBuffers(plantId),
    enabled: puede,
    refetchInterval: REFRESCO_MS,
    staleTime: 5_000,
  });

  if (!puede) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.denegado}>
          <Ionicons name="lock-closed-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.denegadoTitulo}>Solo para administradores</Text>
          <Text style={styles.denegadoTexto}>
            Esta pantalla muestra la configuración interna del puente OPC UA. El servidor la
            restringe al permiso de configuración del sistema.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.contenido}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        <Text style={styles.titulo}>Buffers crudos</Text>
        <Text style={styles.subtitulo}>
          Lo que entrega el PLC, sin interpretar, y qué señal lee cada índice. Solo lectura: la
          edición del mapeo llega más adelante.
        </Text>

        {canSwitchPlant ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.plantas}>
            {PLANTS.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.plantaChip, p.id === plantId && styles.plantaChipActiva]}
                onPress={() => setPlantId(p.id)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityState={{ selected: p.id === plantId }}
              >
                <Text style={[styles.plantaTexto, p.id === plantId && styles.plantaTextoActiva]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.plantaFija}>{selectedPlant.name}</Text>
        )}

        {isLoading ? (
          <ListSkeleton rows={3} label="Cargando los buffers de la planta" />
        ) : isError ? (
          <OfflineNotice
            title="No se pudieron leer los buffers."
            detail="Salen de la memoria del servidor, así que sin conexión con él no hay nada que mostrar."
            onRetry={refetch}
            retryLabel="Reintentar la lectura de buffers"
          />
        ) : !data || data.buffers.length === 0 ? (
          <View style={styles.denegado}>
            <Ionicons name="help-circle-outline" size={40} color={Colors.textSecondary} />
            <Text style={styles.denegadoTitulo}>Esta planta no tiene buffers mapeados</Text>
            <Text style={styles.denegadoTexto}>
              No hay ningún NodeId declarado para {data?.displayName ?? plantId} en el mapeo.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.leyenda}>
              <View style={styles.leyendaFila}>
                <Ionicons name="warning" size={13} color={Colors.warning} />
                <Text style={styles.leyendaTexto}>el valor cae fuera del rango declarado</Text>
              </View>
              <View style={styles.leyendaFila}>
                <Ionicons name="lock-closed" size={13} color={Colors.textSecondary} />
                <Text style={styles.leyendaTexto}>
                  señal de válvula: el mapeo de lo escribible exige documento de la planta y no se
                  edita desde la app
                </Text>
              </View>
              <View style={styles.leyendaFila}>
                <Ionicons name="eye-off-outline" size={13} color={Colors.textSecondary} />
                <Text style={styles.leyendaTexto}>
                  se ocultan los índices en cero que nadie lee; un índice mapeado se muestra aunque
                  valga 0, porque eso también es información
                </Text>
              </View>
            </View>

            {data.buffers.map((b) => (
              <Buffer key={b.browseName} b={b} />
            ))}

            <Text style={styles.pie}>
              {data.buffers.length} {data.buffers.length === 1 ? 'buffer' : 'buffers'} en{' '}
              {data.displayName}
              {dataUpdatedAt ? ` · leído ${formatWhen(new Date(dataUpdatedAt).toISOString())}` : ''}.
              Esta consulta no toca el PLC: sale de la última muestra que ya había entrado.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  contenido: { padding: 16, paddingBottom: 32 },
  titulo: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  subtitulo: { fontSize: 12.5, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  plantas: { gap: 8, paddingVertical: 12 },
  plantaChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  plantaChipActiva: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  plantaTexto: { fontSize: 12.5, fontWeight: '600', color: Colors.textSecondary },
  plantaTextoActiva: { color: Colors.primary },
  plantaFija: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginVertical: 12 },
  leyenda: {
    gap: 6,
    backgroundColor: Colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.divider,
    padding: 12,
    marginBottom: 12,
  },
  leyendaFila: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  leyendaTexto: { flex: 1, fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16 },
  tarjeta: {
    backgroundColor: Colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.divider,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  browseName: { flex: 1, fontFamily: mono, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  chipCanal: { backgroundColor: Colors.primary + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  chipCanalTexto: { fontFamily: mono, fontSize: 10.5, color: Colors.primary, fontWeight: '700' },
  nodeId: { fontFamily: mono, fontSize: 10.5, color: Colors.textSecondary, lineHeight: 15 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  tipo: { fontFamily: mono, fontSize: 11, color: Colors.accentOutlet, fontWeight: '700' },
  chip: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1 },
  chipMal: { borderColor: Colors.danger + '77', backgroundColor: Colors.danger + '18' },
  chipOjo: { borderColor: Colors.warning + '77', backgroundColor: Colors.warning + '18' },
  chipTexto: { fontSize: 10.5, color: Colors.textPrimary, fontWeight: '600' },
  sello: { fontSize: 10.5, color: Colors.textSecondary, fontStyle: 'italic', marginLeft: 'auto' },
  fila: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  indice: { fontFamily: mono, fontSize: 11.5, color: Colors.textSecondary },
  // Ancho fijo para que la columna de valores quede alineada y un 409,50 salte a la vista entre
  // números de dos cifras.
  valor: {
    fontFamily: mono,
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.textPrimary,
    minWidth: 62,
    textAlign: 'right',
  },
  valorMal: { color: Colors.warning },
  valorAusente: { color: Colors.textSecondary },
  filaInfo: { flex: 1, gap: 1 },
  domainKey: { fontFamily: mono, fontSize: 11.5, color: Colors.accentOutlet },
  unidad: { color: Colors.textSecondary },
  etiqueta: { fontSize: 11.5, color: Colors.textSecondary },
  aviso: { fontSize: 10.5, color: Colors.warning, fontStyle: 'italic' },
  sinMapear: { fontSize: 11.5, color: Colors.textSecondary, fontStyle: 'italic' },
  vacio: { fontSize: 11.5, color: Colors.textSecondary, lineHeight: 16, fontStyle: 'italic' },
  ocultos: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 15,
    marginTop: 2,
  },
  denegado: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 8 },
  denegadoTitulo: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  denegadoTexto: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  pie: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
});
