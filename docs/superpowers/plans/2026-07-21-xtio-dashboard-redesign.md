# Rediseño del dashboard móvil estilo xtio.io — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar las tarjetas de señales/tanques de la app móvil por tres tarjetas nuevas
con el look oscuro de `xtio.io`, y fusionar las pestañas Sensores/Tanques en un solo tablero
por planta.

**Architecture:** Tres componentes de tarjeta nuevos (`GaugeCard`, `FlowMeterCard`,
`TankGaugeCard`) en `apps/mobile/components/`, una paleta oscura global en
`constants/colors.ts`, una pantalla nueva `app/(app)/tablero.tsx` que reemplaza a
`sensores.tsx` + `tanques.tsx` reutilizando los hooks de datos existentes
(`useSnapshot`, `useTanques`) sin tocar el backend.

**Tech Stack:** Expo Router + React Native (StyleSheet, no NativeWind en estos archivos,
seguimos el patrón existente de los componentes que se reemplazan), TypeScript estricto,
`node:test` + `tsx` para la única lógica pura nueva (clasificador de señales).

## Global Constraints

- Todas las señales usadas ya existen en el DTO (`SignalDto`, `TankView`); **no se toca el
  backend** ni `apps/api/config/opc_mapping.json` en este plan.
- Se elimina el badge "inferido" y la nota de confianza de las tarjetas nuevas (desviación
  intencional de la regla 10 del README, documentada en
  `docs/superpowers/specs/2026-07-21-xtio-dashboard-redesign-design.md`). Se **conservan**
  los estados "sin dato" (`value === null`) y "fuera de rango" (`outOfRange`): son avisos de
  disponibilidad/calidad del dato, no indicadores de confianza.
- El tema oscuro es **global** (`constants/colors.ts`), así que toda la app cambia de paleta
  de golpe (decisión tomada explícitamente: menos trabajo que mantener dos temas). Solo se
  corrigen colores **hardcodeados** (no tokens de `Colors`) en los archivos que este plan ya
  toca (`PlantSelector.tsx`, `LiveBadge.tsx`, `_layout.tsx`); otras pantallas no tocadas por
  este plan (Válvulas, Reportes, Estado, Ajustes, Usuarios, login/register) pueden quedar con
  algún borde gris-claro residual sobre fondo oscuro — inconsistencia menor conocida y
  aceptada, fuera de alcance.
- `apps/mobile` no tiene infraestructura de tests de componentes (no hay Jest ni React
  Native Testing Library instalados, y ningún componente existente tiene test). Este plan
  **no la agrega** — sería una expansión de alcance no aprobada en el spec. La única lógica
  nueva que es pura función (sin JSX/RN) sí lleva test real con `node:test` + `tsx`, igual
  que ya hace `apps/api`. El resto de tareas se verifica con `tsc --noEmit` y, en la tarea
  final, con una corrida manual real de la app.
- Comandos de typecheck: `npm run typecheck -w @ptap/mobile` (equivale a
  `tsc -p apps/mobile/tsconfig.json --noEmit`) — se corre desde la raíz del repo.

---

### Task 1: Clasificador de señales (`cardKindFor` / `directionFor`)

**Files:**
- Create: `apps/mobile/services/signal-kind.ts`
- Create: `apps/mobile/services/signal-kind.test.ts`
- Modify: `apps/mobile/package.json` (agrega `tsx` como devDependency y un script `test`)

**Interfaces:**
- Produces:
  - `export type SignalCardKind = 'flow' | 'gauge'`
  - `export type SignalDirection = 'inlet' | 'outlet' | null`
  - `export function cardKindFor(domainKey: string): SignalCardKind`
  - `export function directionFor(domainKey: string): SignalDirection`
  - Todo desde `apps/mobile/services/signal-kind.ts` (import relativo `../services/signal-kind`
    desde `apps/mobile/components/`, `./services/signal-kind` desde `apps/mobile/app/(app)/`
    ya que Expo Router resuelve desde la raíz de `apps/mobile` — usar exactamente el mismo
    patrón de import relativo que usan `SignalCard.tsx`/`sensores.tsx` hoy para
    `services/api`).

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/mobile/services/signal-kind.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardKindFor, directionFor } from './signal-kind';

test('cardKindFor: caudal (Flow) usa la tarjeta flow', () => {
  assert.equal(cardKindFor('inletFlow1'), 'flow');
  assert.equal(cardKindFor('outletFlow2'), 'flow');
});

test('cardKindFor: todo lo que no es caudal usa gauge', () => {
  assert.equal(cardKindFor('inletPressure1'), 'gauge');
  assert.equal(cardKindFor('inletPh'), 'gauge');
  assert.equal(cardKindFor('tank1Level'), 'gauge');
});

test('directionFor: detecta entrada y salida por prefijo', () => {
  assert.equal(directionFor('inletFlow1'), 'inlet');
  assert.equal(directionFor('outletPressure1'), 'outlet');
});

test('directionFor: null cuando no hay prefijo de dirección', () => {
  assert.equal(directionFor('tank1Level'), null);
  assert.equal(directionFor('conductivity'), null);
});
```

- [ ] **Step 2: Agregar `tsx` y el script `test` en `apps/mobile/package.json`**

En `"devDependencies"` (junto a `@types/react`), agregar:
```json
"tsx": "^4.20.3"
```
En `"scripts"`, agregar (mismo patrón que `apps/api`):
```json
"test": "node --import tsx --test services/signal-kind.test.ts"
```

- [ ] **Step 3: Instalar dependencias**

Run: `npm install` (desde la raíz del repo)
Expected: termina sin errores; `package-lock.json` se actualiza.

- [ ] **Step 4: Correr el test y confirmar que falla**

Run: `npm run test -w @ptap/mobile`
Expected: FAIL — `Cannot find module './signal-kind'` (el archivo de implementación no existe todavía).

- [ ] **Step 5: Implementación mínima**

Crear `apps/mobile/services/signal-kind.ts`:
```ts
export type SignalCardKind = 'flow' | 'gauge';
export type SignalDirection = 'inlet' | 'outlet' | null;

/** Caudal usa la tarjeta con barra de progreso; todo lo demás usa la tarjeta simple. */
export function cardKindFor(domainKey: string): SignalCardKind {
  return domainKey.toLowerCase().includes('flow') ? 'flow' : 'gauge';
}

/** Dirección de la señal, derivada del prefijo del domainKey (inletFlow1, outletPressure1, ...). */
export function directionFor(domainKey: string): SignalDirection {
  if (domainKey.startsWith('inlet')) return 'inlet';
  if (domainKey.startsWith('outlet')) return 'outlet';
  return null;
}
```

- [ ] **Step 6: Correr el test y confirmar que pasa**

Run: `npm run test -w @ptap/mobile`
Expected: PASS — 4 tests, 0 fallos.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/services/signal-kind.ts apps/mobile/services/signal-kind.test.ts apps/mobile/package.json package-lock.json
git commit -m "feat(mobile): clasificador de tarjeta y dirección por domainKey"
```

---

### Task 2: Paleta oscura (`constants/colors.ts`)

**Files:**
- Modify: `apps/mobile/constants/colors.ts` (reemplazo completo)

**Interfaces:**
- Consumes: ninguno.
- Produces: `Colors` (export default) con las claves `primary, primaryLight, success, danger,
  warning, neutral, bg, surface, textPrimary, textSecondary, divider, accentInlet,
  accentOutlet` — se agregan `divider`, `accentInlet`, `accentOutlet` respecto al archivo
  actual; el resto de claves se mantienen (mismos nombres, valores nuevos) para no romper
  ningún import existente (`Colors.primary`, `Colors.bg`, etc. se siguen usando en
  `_layout.tsx`, `PlantSelector.tsx`, `LiveBadge.tsx`, pantallas no tocadas).

- [ ] **Step 1: Reemplazar el archivo**

Reemplazar el contenido completo de `apps/mobile/constants/colors.ts`:
```ts
const Colors = {
  primary: '#3B82F6',
  primaryLight: '#60A5FA',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  neutral: '#64748B',
  bg: '#171C28',
  surface: '#0B0F19',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  divider: '#2A3244',
  accentInlet: '#F97316',
  accentOutlet: '#38BDF8',
} as const;

export default Colors;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores (cambiar valores de un `const` con las mismas claves no puede romper
tipos; si algún archivo usaba una clave que ya no existe, esto lo revela).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/constants/colors.ts
git commit -m "feat(mobile): paleta oscura global (tema xtio)"
```

---

### Task 3: Corregir bordes hardcodeados del chrome de la app

**Files:**
- Modify: `apps/mobile/components/PlantSelector.tsx:9` (borderBottomColor)
- Modify: `apps/mobile/components/LiveBadge.tsx:29` (borderTopColor)
- Modify: `apps/mobile/app/(app)/_layout.tsx` (borderTopColor del tab bar, línea 146; color
  de `drawerDivider`, línea 308)

**Interfaces:**
- Consumes: `Colors.divider` (Task 2).
- Produces: ninguno nuevo (solo estilo).

- [ ] **Step 1: `PlantSelector.tsx`**

En `apps/mobile/components/PlantSelector.tsx:9`, cambiar:
```tsx
<View style={{ backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
```
por:
```tsx
<View style={{ backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.divider }}>
```

- [ ] **Step 2: `LiveBadge.tsx`**

En `apps/mobile/components/LiveBadge.tsx:29`, cambiar:
```tsx
borderTopColor: '#E5E7EB',
```
por:
```tsx
borderTopColor: Colors.divider,
```

- [ ] **Step 3: `_layout.tsx`**

En `apps/mobile/app/(app)/_layout.tsx:146`, dentro de `tabBarStyle`, cambiar:
```tsx
borderTopColor: '#E5E7EB',
```
por:
```tsx
borderTopColor: Colors.divider,
```

En `apps/mobile/app/(app)/_layout.tsx:308` (`drawerDivider` en `styles`), cambiar:
```tsx
backgroundColor: '#E5E7EB',
```
por:
```tsx
backgroundColor: Colors.divider,
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/PlantSelector.tsx apps/mobile/components/LiveBadge.tsx apps/mobile/app/\(app\)/_layout.tsx
git commit -m "fix(mobile): usar Colors.divider en vez de bordes hardcodeados"
```

---

### Task 4: `GaugeCard` (reemplaza `SignalCard`)

**Files:**
- Create: `apps/mobile/components/GaugeCard.tsx`

**Interfaces:**
- Consumes:
  - `SignalDto`, `UnusableReason` de `apps/mobile/services/api.ts` (ya existen).
  - `Colors` de `apps/mobile/constants/colors.ts` (Task 2).
  - `directionFor(domainKey: string): SignalDirection` de `apps/mobile/services/signal-kind.ts` (Task 1).
- Produces:
  - `export function GaugeCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }): JSX.Element`
    desde `apps/mobile/components/GaugeCard.tsx`.

- [ ] **Step 1: Crear el componente**

Crear `apps/mobile/components/GaugeCard.tsx`:
```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto, UnusableReason } from '../services/api';
import { directionFor } from '../services/signal-kind';

const REASON_TEXT: Record<UnusableReason, string> = {
  BAD_QUALITY: 'calidad OPC no buena',
  INVALID_NUMBER: 'valor inválido',
  BRIDGE_STALE: 'sin datos frescos',
};

/**
 * Tarjeta simple de una señal de dominio (presión, pH, turbidez, temperatura, oxígeno,
 * conductividad, cloro). Política de datos (usuario, 2026-07-15): si hay valor numérico
 * SE MUESTRA tal cual; "sin dato" solo cuando value es null (rule: no fabricar números).
 */
export function GaugeCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }) {
  const numeric = typeof signal.value === 'number';
  const hasMin = typeof signal.opMin === 'number';
  const hasMax = typeof signal.opMax === 'number';
  const direction = directionFor(name);
  const accent =
    direction === 'inlet' ? Colors.accentInlet : direction === 'outlet' ? Colors.accentOutlet : Colors.textPrimary;

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon as never} size={20} color={Colors.primary} />
      </View>
      <Text style={styles.name}>{signal.label ?? name}</Text>

      {numeric ? (
        <Text style={[styles.value, { color: accent }]}>
          {(signal.value as number).toFixed(2)}
          <Text style={styles.unit}> {signal.unit ?? ''}</Text>
        </Text>
      ) : (
        <View style={styles.noData}>
          <Text style={styles.noDataValue}>sin dato</Text>
          {signal.reason && <Text style={styles.noDataReason}>{REASON_TEXT[signal.reason]}</Text>}
        </View>
      )}

      {(hasMin || hasMax) && (
        <Text style={styles.rangeText}>
          {hasMin ? `Mín: ${(signal.opMin as number).toFixed(2)}` : ''}
          {hasMin && hasMax ? '   ' : ''}
          {hasMax ? `Máx: ${(signal.opMax as number).toFixed(2)}` : ''}
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
    borderColor: Colors.divider,
    alignItems: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  name: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textAlign: 'center' },
  value: { fontSize: 28, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  rangeText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  noData: { marginBottom: 6, alignItems: 'center' },
  noDataValue: { fontSize: 20, fontWeight: '700', color: Colors.neutral },
  noDataReason: { fontSize: 11, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/GaugeCard.tsx
git commit -m "feat(mobile): tarjeta GaugeCard (reemplazo de SignalCard, tema xtio)"
```

---

### Task 5: `FlowMeterCard` (nueva, estilo Macromedidor)

**Files:**
- Create: `apps/mobile/components/FlowMeterCard.tsx`

**Interfaces:**
- Consumes:
  - `SignalDto` de `apps/mobile/services/api.ts`.
  - `Colors` de `apps/mobile/constants/colors.ts` (Task 2).
  - `directionFor` de `apps/mobile/services/signal-kind.ts` (Task 1).
  - `GaugeCard({ signal, name, icon })` de `apps/mobile/components/GaugeCard.tsx` (Task 4) —
    fallback cuando no hay `opMin`/`opMax` o el valor es `null`.
- Produces:
  - `export function FlowMeterCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }): JSX.Element`
    desde `apps/mobile/components/FlowMeterCard.tsx`.

- [ ] **Step 1: Crear el componente**

Crear `apps/mobile/components/FlowMeterCard.tsx`:
```tsx
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../constants/colors';
import type { SignalDto } from '../services/api';
import { directionFor } from '../services/signal-kind';
import { GaugeCard } from './GaugeCard';

/**
 * Tarjeta de caudal con barra de progreso 0-100%, estilo "Macromedidor" de xtio.
 * Requiere opMin y opMax numéricos para calcular el %; si faltan, o si el valor es null,
 * cae a GaugeCard — no hay con qué dibujar la barra (no es una decisión de UX).
 */
export function FlowMeterCard({ signal, name, icon }: { signal: SignalDto; name: string; icon: string }) {
  const numeric = typeof signal.value === 'number';
  const hasBothBounds = typeof signal.opMin === 'number' && typeof signal.opMax === 'number';

  if (!numeric || !hasBothBounds) {
    return <GaugeCard signal={signal} name={name} icon={icon} />;
  }

  const value = signal.value as number;
  const opMin = signal.opMin as number;
  const opMax = signal.opMax as number;
  const pct = Math.min(100, Math.max(0, ((value - opMin) / (opMax - opMin)) * 100));
  const direction = directionFor(name);
  const accent = direction === 'inlet' ? Colors.accentInlet : direction === 'outlet' ? Colors.accentOutlet : Colors.primary;

  return (
    <View style={styles.card}>
      <View style={[styles.headerBar, { backgroundColor: accent + '22', borderColor: accent }]}>
        <Ionicons name={icon as never} size={16} color={accent} />
        <Text style={[styles.headerText, { color: accent }]}>{(signal.label ?? name).toUpperCase()}</Text>
      </View>

      <Text style={styles.value}>
        {value.toFixed(2)}
        <Text style={styles.unit}> {signal.unit ?? ''}</Text>
      </Text>

      <View style={styles.barOuter}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: accent }]} />
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.barLabelText}>0%</Text>
        <Text style={styles.barLabelText}>{Math.round(pct)}%</Text>
        <Text style={styles.barLabelText}>100%</Text>
      </View>
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
    borderColor: Colors.divider,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 10,
  },
  headerText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  value: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  unit: { fontSize: 14, fontWeight: '400', color: Colors.textSecondary },
  barOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    marginBottom: 4,
  },
  barFill: { height: '100%', borderRadius: 4 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabelText: { fontSize: 10, color: Colors.textSecondary },
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/FlowMeterCard.tsx
git commit -m "feat(mobile): tarjeta FlowMeterCard (Macromedidor con barra de progreso)"
```

---

### Task 6: `TankGaugeCard` (reemplaza `TankCard`)

**Files:**
- Create: `apps/mobile/components/TankGaugeCard.tsx`

**Interfaces:**
- Consumes: `TankView` de `apps/mobile/services/tanks.ts` (ya existe, sin cambios), `Colors`
  de `apps/mobile/constants/colors.ts` (Task 2).
- Produces: `export function TankGaugeCard({ tank }: { tank: TankView }): JSX.Element` desde
  `apps/mobile/components/TankGaugeCard.tsx`.

- [ ] **Step 1: Crear el componente**

Crear `apps/mobile/components/TankGaugeCard.tsx`:
```tsx
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import type { TankView } from '../services/tanks';
import Colors from '../constants/colors';

interface Props {
  tank: TankView;
}

function waterColor(pct: number): string {
  if (pct >= 70) return Colors.success;
  if (pct >= 25) return Colors.warning;
  return Colors.danger;
}

function statusLabel(pct: number): string {
  if (pct > 70) return 'Alto';
  if (pct >= 25) return 'Medio';
  return 'Bajo';
}

export function TankGaugeCard({ tank }: Props) {
  // percentage llega null hasta que la planta confirme la capacidad real del tanque;
  // en ese caso NO se dibuja % de llenado (sería inventado), solo nivel y volumen reales.
  const pct = tank.percentage !== null ? Math.min(100, Math.max(0, tank.percentage)) : null;
  const hasLevel = tank.levelM !== null;
  const fillAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (pct === null) return;
    Animated.timing(fillAnim, {
      toValue: pct,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [pct, fillAnim]);

  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.card}>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{tank.name}</Text>
        {tank.outOfRange && (
          <View style={styles.rangeTag}>
            <Text style={styles.rangeTagText}>fuera de rango</Text>
          </View>
        )}
      </View>

      <View style={styles.chipsRow}>
        {tank.levelOpMax !== null && (
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>MAX</Text>
            <Text style={styles.chipValue}>{tank.levelOpMax.toFixed(2)} m</Text>
          </View>
        )}
        {tank.levelOpMin !== null && (
          <View style={styles.chip}>
            <Text style={styles.chipLabel}>MIN</Text>
            <Text style={styles.chipValue}>{tank.levelOpMin.toFixed(2)} m</Text>
          </View>
        )}
      </View>

      {pct !== null ? (
        <>
          <Text style={styles.pctText}>{Math.round(pct)}%</Text>
          <View style={[styles.statusBadge, { backgroundColor: waterColor(pct) + '30', borderColor: waterColor(pct) }]}>
            <Text style={[styles.statusText, { color: waterColor(pct) }]}>{statusLabel(pct)}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.pctTextUnknown}>{hasLevel ? `${tank.levelM!.toFixed(2)} m` : '—'}</Text>
      )}

      <View style={styles.barOuter}>
        {pct !== null && (
          <Animated.View style={[styles.barFill, { width: fillWidth, backgroundColor: waterColor(pct) }]} />
        )}
      </View>

      <View style={styles.info}>
        <InfoRow label="Nivel" value={tank.levelM !== null ? `${tank.levelM.toFixed(2)} m` : 'Sin dato'} />
        <InfoRow label="Volumen" value={tank.volumeM3 !== null ? `${tank.volumeM3.toFixed(1)} m³` : 'Sin dato'} />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
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
    borderColor: Colors.divider,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  name: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  rangeTag: {
    backgroundColor: Colors.warning + '22',
    borderColor: Colors.warning,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rangeTagText: { fontSize: 9, fontWeight: '700', color: Colors.warning, letterSpacing: 0.5 },
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  chipLabel: { fontSize: 9, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  chipValue: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  pctText: { fontSize: 34, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  pctTextUnknown: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginVertical: 8,
  },
  statusBadge: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginTop: 4,
    marginBottom: 10,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  barOuter: {
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    marginBottom: 12,
  },
  barFill: { height: '100%', borderRadius: 5 },
  info: { gap: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 11, color: Colors.textSecondary },
  infoValue: { fontSize: 11, fontWeight: '600', color: Colors.textPrimary },
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/TankGaugeCard.tsx
git commit -m "feat(mobile): tarjeta TankGaugeCard (reemplazo de TankCard, tema xtio)"
```

---

### Task 7: Pantalla `tablero.tsx` y rewiring de navegación

**Files:**
- Create: `apps/mobile/app/(app)/tablero.tsx`
- Delete: `apps/mobile/app/(app)/sensores.tsx`
- Delete: `apps/mobile/app/(app)/tanques.tsx`
- Delete: `apps/mobile/components/SignalCard.tsx`
- Delete: `apps/mobile/components/TankCard.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx` (Tabs.Screen `sensores`→`tablero`, quitar
  Tabs.Screen `tanques`)

**Interfaces:**
- Consumes: `useSnapshot` (`apps/mobile/hooks/useSnapshot.ts`), `useTanques`
  (`apps/mobile/hooks/useTanques.ts`), `useTime` (`apps/mobile/hooks/useTime.ts`),
  `usePlant` (`apps/mobile/context/PlantContext.tsx`), `GaugeCard` (Task 4),
  `FlowMeterCard` (Task 5), `TankGaugeCard` (Task 6), `cardKindFor` (Task 1),
  `isTankSignal` (`apps/mobile/services/tanks.ts`), `PlantSelector`, `LiveBadge`, `Colors`.
- Produces: ruta `tablero` en `(app)` (default export `TableroScreen`).

- [ ] **Step 1: Crear `tablero.tsx`**

Crear `apps/mobile/app/(app)/tablero.tsx`:
```tsx
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSnapshot } from '../../hooks/useSnapshot';
import { useTanques } from '../../hooks/useTanques';
import { useTime } from '../../hooks/useTime';
import { usePlant } from '../../context/PlantContext';
import { GaugeCard } from '../../components/GaugeCard';
import { FlowMeterCard } from '../../components/FlowMeterCard';
import { TankGaugeCard } from '../../components/TankGaugeCard';
import { LiveBadge } from '../../components/LiveBadge';
import { PlantSelector } from '../../components/PlantSelector';
import Colors from '../../constants/colors';
import type { SignalDto } from '../../services/api';
import { isTankSignal } from '../../services/tanks';
import { cardKindFor } from '../../services/signal-kind';

/** Icono por domainKey conocido (cosmético). */
const ICONS: Record<string, string> = {
  inletFlow1: 'water-outline',
  inletFlow2: 'water-outline',
  outletFlow1: 'water-outline',
  outletFlow2: 'water-outline',
  inletPressure1: 'speedometer-outline',
  inletPressure2: 'speedometer-outline',
  outletPressure1: 'speedometer-outline',
  outletPressure2: 'speedometer-outline',
  inletTurbidity: 'color-filter-outline',
  outletTurbidity: 'color-filter-outline',
  inletOxygen: 'leaf-outline',
  conductivity: 'flash-outline',
  inletPh: 'flask-outline',
  outletPh: 'flask-outline',
  inletTemperature: 'thermometer-outline',
  outletTemperature: 'thermometer-outline',
  outletChlorine: 'eyedrop-outline',
};

export default function TableroScreen() {
  const { selectedPlant } = usePlant();
  const { data: snapshot, isLoading, refetch, isRefetching } = useSnapshot(selectedPlant.id);
  const { tanks } = useTanques();
  const time = useTime();

  const timeStr = time.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const signals: [string, SignalDto][] = snapshot
    ? Object.entries(snapshot.signals).filter(([domainKey]) => !isTankSignal(domainKey))
    : [];
  const livenessState = snapshot?.liveness.state ?? 'unknown';
  const hasContent = tanks.length > 0 || signals.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <PlantSelector />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[Colors.primary]} tintColor={Colors.primary} />
        }
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.plantName}>{snapshot?.displayName ?? selectedPlant.name}</Text>
            <Text style={styles.sectionSubtitle}>Tablero en tiempo real</Text>
          </View>
          <Text style={styles.clock}>{timeStr}</Text>
        </View>

        {isLoading ? (
          <View style={styles.info}>
            <Text style={styles.infoText}>Cargando tablero…</Text>
          </View>
        ) : !hasContent ? (
          <View style={styles.info}>
            <Text style={styles.infoText}>Esta planta no tiene señales mapeadas todavía.</Text>
            <Text style={styles.infoSub}>Sin export L5X, solo Montebello expone caudal (inferido).</Text>
          </View>
        ) : (
          <>
            {tanks.length > 0 && (
              <View style={styles.grid}>
                {tanks.map((tank) => (
                  <View key={tank.id} style={styles.cell}>
                    <TankGaugeCard tank={tank} />
                  </View>
                ))}
              </View>
            )}

            {signals.length > 0 && (
              <View style={styles.grid}>
                {signals.map(([domainKey, signal]) => {
                  const icon = ICONS[domainKey] ?? 'analytics-outline';
                  return (
                    <View key={domainKey} style={styles.cell}>
                      {cardKindFor(domainKey) === 'flow' ? (
                        <FlowMeterCard signal={signal} name={domainKey} icon={icon} />
                      ) : (
                        <GaugeCard signal={signal} name={domainKey} icon={icon} />
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <LiveBadge state={livenessState} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  content: { padding: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  plantName: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary },
  sectionSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  clock: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  cell: { width: '50%' },
  info: { paddingVertical: 48, alignItems: 'center' },
  infoText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
  infoSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center' },
});
```

- [ ] **Step 2: Borrar las pantallas y componentes reemplazados**

```bash
git rm apps/mobile/app/\(app\)/sensores.tsx apps/mobile/app/\(app\)/tanques.tsx apps/mobile/components/SignalCard.tsx apps/mobile/components/TankCard.tsx
```

- [ ] **Step 3: Actualizar los tabs en `_layout.tsx`**

En `apps/mobile/app/(app)/_layout.tsx`, reemplazar el bloque `<Tabs.Screen name="sensores" ...>`:
```tsx
        <Tabs.Screen
          name="sensores"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Sensores',
            tabBarIcon: ({ color, size, focused }) => (
              <View>
                <Ionicons name={focused ? 'pulse' : 'pulse-outline'} size={size} color={color} />
                <TabBadge count={1} />
              </View>
            ),
          }}
        />
```
por:
```tsx
        <Tabs.Screen
          name="tablero"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Tablero',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'grid' : 'grid-outline'} size={size} color={color} />
            ),
          }}
        />
```
Y eliminar por completo el bloque:
```tsx
        <Tabs.Screen
          name="tanques"
          options={{
            ...HEADER_OPTS,
            tabBarLabel: 'Tanques',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'water' : 'water-outline'} size={size} color={color} />
            ),
          }}
        />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @ptap/mobile`
Expected: sin errores (en particular: nada debe seguir importando `SignalCard`, `TankCard`,
`sensores.tsx` ni `tanques.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(app\)/tablero.tsx apps/mobile/app/\(app\)/_layout.tsx
git commit -m "feat(mobile): fusionar Sensores+Tanques en un solo tablero por planta"
```

---

### Task 8: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Levantar el backend de telemetría**

Run: `npm run start:telemetry -w @ptap/api` (dejar corriendo en una terminal; verificar
antes que el puerto `4000` esté libre, `Get-NetTCPConnection -LocalPort 4000` en
PowerShell).
Expected: log `Nest application successfully started`, sin errores.

- [ ] **Step 2: Levantar la app móvil en modo web**

Run: `npm run web -w @ptap/mobile` (otra terminal; verificar antes que el puerto `8081`
esté libre).
Expected: `Waiting on http://localhost:8081`; el navegador abre la app.

- [ ] **Step 3: Revisar el tema oscuro global**

Abrir `http://localhost:8081`. Confirmar visualmente: tab bar, header, menú lateral y
`PlantSelector` en tema oscuro, sin bordes gris-claro visibles en esos elementos.

- [ ] **Step 4: Revisar la pestaña "Tablero" en Montebello**

Seleccionar la planta **Montebello** (tiene `inletFlow1`/`inletFlow2` con `opMin`/`opMax`
reales, según `docs/FLOW_VALIDATION.md`). Confirmar:
- Aparece una sola pestaña "Tablero" (ya no hay pestaña "Tanques" separada).
- Los caudales (`inletFlow1`, `inletFlow2`) se ven como `FlowMeterCard` con barra de
  progreso 0–100%.
- Ninguna tarjeta muestra el badge "inferido" ni una nota al pie de confianza.
- Si hay tanques mapeados para Montebello, aparecen como `TankGaugeCard` con chips
  MAX/MIN, % y badge de estado (o el estado "—"/nivel si `percentage` es `null`).

- [ ] **Step 5: Revisar el fallback de `FlowMeterCard`**

Seleccionar una planta cuyo caudal (si lo hay) no tenga `opMin`/`opMax` definidos, o una
señal de presión/pH/etc. Confirmar que se renderiza como `GaugeCard` (valor centrado, sin
barra de progreso) y no rompe la pantalla.

- [ ] **Step 6: Confirmar que no quedan referencias muertas**

Run: `npm run typecheck` (raíz, corre todos los workspaces)
Expected: sin errores en `@ptap/mobile` ni en `@ptap/api` ni `@ptap/shared`.

- [ ] **Step 7: Detener los procesos de prueba**

Cerrar (Ctrl+C o `TaskStop`) los procesos de `start:telemetry` y `web` levantados en los
Steps 1–2 si no se van a seguir usando.
