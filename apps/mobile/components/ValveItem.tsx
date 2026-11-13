import { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from './AppIcon';
import {
  accionDisponible,
  anchoBarraApertura,
  textoApertura,
  presentacionDeValvula,
} from '../services/valves';
import type { SupervisedValve } from '../hooks/useValveSupervisor';
import Colors from '../constants/colors';
import { sameValveItem } from './memo-compare';

interface Props {
  valve: SupervisedValve;
  /** Acción de mando; recibe la válvula. Si falta, la fila es de solo lectura (rol sin permiso).
   *  Recibe la válvula en vez de cerrarse sobre ella para que la pantalla pueda pasar UNA función
   *  estable a todas las filas y el `memo` sirva de algo. */
  onToggle?: (valve: SupervisedValve, verb?: 'open' | 'close') => void;
  /** La planta perdió la conexión: los valores mostrados son la última lectura. */
  frozen?: boolean;
  /** Hay una orden en vuelo para esta válvula. */
  busy?: boolean;
  compact?: boolean;
}

/**
 * Una fila de electroválvula: su estado, y el mando SOLO si de verdad puede salir.
 *
 * Un solo botón propone la acción correspondiente al estado actual. El icono de agua
 * identifica el equipo sin aparentar un interruptor interactivo. Si no se conoce el estado,
 * se explica el bloqueo en lugar de elegir una dirección sin evidencia.
 *
 * Qué acción hay disponible lo decide `accionDisponible` en `services/valves.ts`, que está probada
 * sin UI: aquí solo se pinta su veredicto.
 *
 * Una válvula PROPORCIONAL suma su apertura («Apertura 47 %») y una barra de 0 a 100 %, con el mismo
 * trazo que la barra de `FlowMeterCard`: un `View` con ancho en %, nada de módulo nativo de slider
 * (la app no se autoactualiza y un módulo nativo obliga a recompilar la APK). Es de solo lectura: la
 * consigna aún no se puede enviar y la fila lo dice con el motivo de `setpoint-pending`.
 */
function ValveItemBase({ valve, onToggle, frozen = false, busy = false }: Props) {
  const evidence = presentacionDeValvula(valve);
  const color =
    evidence.kind === 'fault'
      ? Colors.danger
      : evidence.physicalState === 'open'
        ? Colors.success
        : evidence.physicalState === 'closed'
          ? Colors.danger
          : Colors.neutral;
  const textColor =
    color === Colors.danger
      ? Colors.brand.dangerText
      : color === Colors.neutral
        ? Colors.brand.textSecondary
        : color;

  const accion = accionDisponible(valve, frozen);
  // El mando exige LAS DOS cosas: que la válvula lo permita y que el rol tenga el permiso (sin
  // `onToggle` la pantalla ya decidió que esta persona no acciona).
  const accionable = accion.kind === 'command' && Boolean(onToggle);

  return (
    <View style={[styles.row, frozen && styles.rowFrozen]}>
      <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name="water-outline" size={22} color={color} />
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{valve.name}</Text>
          {frozen && (
            <View style={styles.tagNeutral}>
              <Text style={styles.tagNeutralText}>congelado</Text>
            </View>
          )}
          {valve.manualOverride && (
            <View style={styles.tagWarn}>
              <Text style={styles.tagWarnText}>posible operación manual</Text>
            </View>
          )}
        </View>
        {valve.kind === 'proportional' && (
          <View style={styles.apertura}>
            <Text style={styles.aperturaTexto}>{textoApertura(valve.positionPct)}</Text>
            <View
              style={styles.barOuter}
              accessibilityRole="progressbar"
              accessibilityLabel={`Apertura de ${valve.name}`}
              accessibilityValue={
                valve.positionPct === null
                  ? { text: 'sin dato' }
                  : { min: 0, max: 100, now: Math.round(anchoBarraApertura(valve.positionPct)) }
              }
            >
              {valve.positionPct !== null && (
                <View
                  style={[
                    styles.barFill,
                    { width: `${anchoBarraApertura(valve.positionPct)}%`, backgroundColor: color },
                  ]}
                />
              )}
            </View>
          </View>
        )}
      </View>

      <View style={styles.right}>
        <View style={[styles.badge, { backgroundColor: color + '18' }]}>
          <Text style={[styles.badgeText, { color: textColor }]}>{evidence.label}</Text>
        </View>

        {accion.kind === 'command' && onToggle && (
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              { backgroundColor: Colors.brand.action + '15', opacity: busy ? 0.5 : 1 },
            ]}
            onPress={() => onToggle(valve, accion.verb)}
            activeOpacity={0.7}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            accessibilityLabel={`${accion.verb === 'close' ? 'Cerrar' : 'Abrir'} ${valve.name}. Pedirá confirmación.`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={Colors.brand.link} />
            ) : (
              <Ionicons
                name={accion.verb === 'close' ? 'close-circle-outline' : 'checkmark-circle-outline'}
                size={16}
                color={Colors.brand.link}
              />
            )}
            <Text style={[styles.toggleText, { color: Colors.brand.link }]}>
              {busy ? 'Enviando…' : accion.verb === 'close' ? 'Cerrar' : 'Abrir'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Sin acción: se dice el motivo. Un hueco mudo se lee como un fallo de la app o como un
            permiso que falta, y casi nunca es ninguna de las dos cosas. */}
        {/* 4 líneas y no 3: el motivo de `setpoint-pending` (~100 caracteres) en esta columna de
            ~46 % de ancho y a 10 pt no cabría en 3 en un teléfono estrecho, y se cortaría justo en
            «solo se muestra la apertura». */}
        {!accionable && accion.kind === 'blocked' && (
          <Text style={styles.sinMando} numberOfLines={4}>
            {accion.explain}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Memo con comparación POR VALOR — ver `memo-compare.ts`. */
export const ValveItem = memo(ValveItemBase, sameValveItem);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.brand.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.brand.cardBorder,
  },
  rowFrozen: { borderStyle: 'dashed' },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '700', color: Colors.brand.text },
  tagWarn: {
    backgroundColor: Colors.warning + '22',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagWarnText: { fontSize: 11, fontWeight: '700', color: Colors.warning, letterSpacing: 0.3 },
  tagNeutral: {
    backgroundColor: Colors.textSecondary + '22',
    borderColor: Colors.textSecondary,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagNeutralText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.3,
  },
  apertura: { marginTop: 6, marginRight: 10, gap: 4 },
  aperturaTexto: { fontSize: 12, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  // La misma barra que `FlowMeterCard`: pista en el color de fondo y relleno con ancho en %.
  barOuter: { height: 8, borderRadius: 4, backgroundColor: Colors.brand.page, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  right: { alignItems: 'flex-end', gap: 6, maxWidth: '46%' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 4,
  },
  toggleText: { fontSize: 12, fontWeight: '700' },
  // Discreta a propósito: informa de una limitación, no de un problema. Compite con el badge de
  // estado, que es lo que el operador viene a mirar.
  sinMando: { fontSize: 10, color: Colors.textSecondary, marginTop: 2, textAlign: 'right' },
});
