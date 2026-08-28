# Guía de estilo — App Aquora (`apps/mobile`)

> **Fuente única de verdad del sistema visual.** Antes esto no existía: la identidad vivía solo en
> `constants/colors.ts` y en un spec **archivado** del rediseño xtio. La falta de un documento vivo
> es exactamente la razón por la que se colaron los bordes gris-claro residuales y las
> inconsistencias de marca. Este archivo se mantiene junto al código; al añadir una pantalla o un
> componente, se consulta y se respeta.
>
> Última revisión: **2026-08-28**.

Este proyecto es **React Native / Expo** (no web). No hay CSS, ni cascada, ni especificidad, ni
`:hover`/`:focus`, ni CSS Grid, ni media queries. El estilo es 100 % `StyleSheet` + Flexbox. Esta
guía traduce las buenas prácticas de CSS a su equivalente real en RN.

---

## 1. El principio: tokens = «variables CSS»

En CSS moderno, la mantenibilidad viene de las *Custom Properties* (`:root { --primary }`): un valor
se define una vez y se reutiliza. En RN el equivalente es un **objeto de tokens** importado en toda
la app. Cambiar un token se propaga solo.

**Regla:** ningún componente nuevo introduce un número mágico de espaciado, radio, tamaño de fuente o
color que ya exista como token. Si un valor se repite en dos sitios, se convierte en token o en
primitivo.

---

## 2. Los tokens — `apps/mobile/constants/theme.ts`

```ts
import { Colors, Spacing, Radius, Font, Shadow, withAlpha } from '../constants/theme';
```

| Token | Qué es | Valores |
|---|---|---|
| **`Colors`** | Paleta (sigue en `constants/colors.ts`, re-exportada) | `bg`, `surface`, `textPrimary/Secondary`, `divider`, `primary`, `success`, `warning`, `danger`, `neutral`, `accentInlet`, `accentOutlet` |
| **`Spacing`** | Padding / margin / gap (base 4) | `xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24` |
| **`Radius`** | Radios de borde | `sm 6 · md 10 · lg 14 · xl 16 · pill 999` |
| **`Font.size`** | Escala tipográfica nombrada | `caption 11 · small 13 · body 14 · subtitle 16 · title 20 · display 28 · hero 34` |
| **`Font.weight`** | Pesos | `regular 400 · medium 500 · semibold 600 · bold 700 · heavy 800` |
| **`Shadow.card`** | Elevación (RNW la traduce a `box-shadow`) | props nativas `shadow*` + `elevation` |
| **`withAlpha(hex, a)`** | Opacidad sobre un color → `#RRGGBBAA` | reemplaza el frágil `Colors.danger + '22'` |

**Color con opacidad:** usa siempre `withAlpha(Colors.danger, 0.13)`, **nunca** `Colors.danger + '22'`
(concatenar hex a mano estaba repartido por decenas de archivos y es ilegible).

---

## 3. Primitivos de UI — `apps/mobile/components/ui/`

El «no te repitas» del PDF, aplicado: el contenedor de tarjeta y el chip de estado estaban
**duplicados verbatim** en `GaugeCard`, `FlowMeterCard` y `TankGaugeCard`. Ahora son un componente.

### `Card` — `components/ui/Card.tsx`
El contenedor de tarjeta del tablero (fondo, borde, radio, relleno, y `opacity: 0.55` al congelarse).

```tsx
import { Card } from './ui/Card';

<Card frozen={frozen} style={estiloExtra}>
  {/* contenido */}
</Card>
```

### `Badge` — `components/ui/Badge.tsx`
El chip de estado («congelado», «fuera de rango»). El color es el único parámetro.

```tsx
import { Badge } from './ui/Badge';

<Badge label="congelado" tone={Colors.textSecondary} />
<Badge label="fuera de rango" tone={Colors.danger} />
```

**Cómo se construye una tarjeta nueva:** envuélvela en `<Card>`, usa `<Badge>` para los chips,
y toma tamaños de `Font` y separaciones de `Spacing`. Mira `GaugeCard.tsx` como referencia completa.

---

## 4. Mapeo CSS (web) → React Native

Qué del PDF de buenas prácticas de CSS aplica aquí, qué no, y cómo se traduce.

| Concepto CSS | ¿Aplica? | Traducción en RN |
|---|---|---|
| Variables `:root { --x }` + mantenibilidad | ✅ **Núcleo** | `theme.ts` (tokens). Ver §2. |
| CSS externo / separación / reutilización | ✅ | Primitivos `Card`/`Badge` + `StyleSheet` por componente. Ver §3. |
| Flexbox (`flex-direction`, `justify-content`, `align-items`, `flex-wrap`) | ✅ **Es el core de RN** | Igual, pero el eje por defecto es `column` (en CSS es `row`). |
| `gap` | ✅ | Usar `gap` como canaleta, **no** `margin` entre hermanos. Ver §5. |
| CSS Grid / `auto-fit` + `minmax` | ⚠️ No existe en RN | Columnas adaptativas con `useWindowDimensions` (número de columnas por ancho). Ver §5. |
| Media queries / mobile-first / breakpoints | ⚠️ | `useWindowDimensions` + `Platform.select`. Mobile-first ya es el default. Ver §5. |
| `:hover` / `:focus` / `:active` | ⚠️ Parcial | `Pressable` (`pressed`), `onHoverIn` (web), foco visible. Ver §6. |
| Transiciones / `transform` / `@keyframes` | ✅ | API `Animated` del core. Ver §7. |
| `aspect-ratio` | ✅ | Prop de estilo `aspectRatio` (existe en RN). |
| `clamp()` / `min()` / `max()` / `calc()` | ❌ solo web | En RN se calcula en JS. Solo relevante en el export web. |
| Cascada, especificidad, selectores, combinadores, `::before`, Container Queries, Nesting | ❌ **No aplican** | RN no tiene selectores ni cascada. No forzarlos. |

---

## 5. Layout y responsive

- **Flexbox + `gap`.** Separa hijos con `gap` en el contenedor, no con `marginBottom/Right` en cada
  hijo (hoy conviven 104 usos de `gap` y 134 de `margin`; la dirección es unificar en `gap`).
- **Rejilla de tarjetas.** Hoy es `flexWrap` + ancho `'50%'` fijo (siempre 2 columnas) con `margin: 5`
  dentro de cada tarjeta como canaleta (centralizado en `<Card>`). **Pendiente** (§9): número de
  columnas adaptativo por ancho — el equivalente RN de `auto-fit + minmax`.
- **Responsive.** Un solo breakpoint hoy: `tablero.tsx` usa `useWindowDimensions()` con `width < 400`
  para el tanque a ancho completo. Para el export web conviene una escala pequeña de breakpoints
  (tablet ≥ 768, escritorio ≥ 1024). `Platform.select` es solo para divergencias de plataforma, no
  de tamaño.

---

## 6. Estados de interacción (`:hover` / `:focus` / `:active` en RN)

- **Pulsado (`:active`).** `Pressable` con `style={({ pressed }) => [base, pressed && pulsada]}` (ver
  `SwitchRow.tsx`). Hoy la mayoría usa `TouchableOpacity` con `activeOpacity`; migrar a `Pressable`
  con feedback de `pressed` explícito es la dirección.
- **Foco (`:focus`) — accesibilidad.** En web es la **única** señal de teclado. **Nunca** se suprime
  el anillo de foco. Se corrigió una regresión en `usuarios.tsx` (tenía `outlineStyle: 'none'`, que
  lo eliminaba). El navegador solo lo pinta con `:focus-visible`. Para un foco de marca, alterna una
  clase con `onFocus`/`onBlur` y cambia `borderColor` a `Colors.primary`.
- **Hover (web).** `onHoverIn`/`onHoverOut` en `Pressable` para el export web (hoy: 0 usos).
- **Accesibilidad semántica.** Ya hay buena cobertura (`accessibilityRole/Label/State`). Mantener.

---

## 7. Animación

- **API:** `Animated` del **core** de React Native. `react-native-reanimated` **no está instalado**;
  no añadirlo salvo necesidad real (mantener las dependencias ligeras).
- **Qué anima hoy:** la barra de `TankGaugeCard` (`Animated.timing`, 350 ms, `Easing.out(cubic)`,
  `useNativeDriver: false` porque anima ancho) y el latido de `Skeleton`. Más `Modal animationType="fade"`.
- **Criterio:** micro-interacciones sobrias. La animación de más lee como «hecho por IA»; menos es más.

---

## 8. Identidad de marca «Aquora»

- **Assets:** `apps/mobile/assets/aquora-logo.png`, `aquora-mark*.png`.
- **En la app:** el título de la barra superior (`BrandTitle` en `app/(app)/_layout.tsx`) y el hero
  de `login.tsx`. Acento de marca = `Colors.primary` (`#3B82F6`).
- **Corregido (2026-08-28):** `app.json` `name` pasó de «Monitor PTAP» a **«Aquora»** (los
  identificadores `slug`/`scheme`/`package`/`bundleId` NO cambian — romperían la instalación).
- **Pendiente de marca** (§9): `userInterfaceStyle: "light"` con paleta oscura (revisar contra las
  pantallas de `(auth)`, que parecen claras); `adaptiveIcon.backgroundColor #1565C0` (no es un token);
  extraer `BrandTitle` a `components/` para reutilizarlo en login.

---

## 9. Plan de adopción — hecho vs. pendiente

### ✅ Hecho (2026-08-28, base del sistema)
- Tokens: `constants/theme.ts` (Spacing, Radius, Font, Shadow, `withAlpha`).
- Primitivos: `components/ui/Card.tsx`, `components/ui/Badge.tsx`.
- Migradas las 3 tarjetas del tablero (`GaugeCard`, `FlowMeterCard`, `TankGaugeCard`) → usan
  `Card` + `Badge` + tokens de tipografía. Eliminada la duplicación verbatim de `card`/`tag`.
- Foco de teclado restaurado en `usuarios.tsx`.
- Marca: `app.json` `name` = «Aquora».

### 🔜 Pendiente (siguiente tanda)
- Migrar `ValveItem`, `memo-compare`, `electrovalvulas` a tokens/primitivos — **hoy los toca la rama
  `carbonero-valvula` sin commitear**; hacerlo tras separar ese trabajo para no enredar los diffs.
- Barrer los bordes residuales `#E5E7EB` → `Colors.divider` (8 sitios: `ajustes`, `estado`,
  `reportes`, `login`, `register`).
- Sustituir `marginBottom/Right` por `gap` donde sean canaletas.
- Rejilla de tarjetas con columnas adaptativas por ancho (tablet/web).
- Estados `pressed`/`hover` y foco de marca en los botones (migrar `TouchableOpacity` → `Pressable`).
- Escala tipográfica a los `Text` restantes (o un componente `AppText` con variantes).
- Decisiones de identidad pendientes: fuente de marca (opcional) y los puntos de §8.

### Decisiones tomadas (por defecto, revisables)
- **Fuente:** del sistema + escala tipográfica nombrada (cero dependencias / cero riesgo de carga).
  Una fuente de marca vía `expo-font` es un upgrade opcional (afecta arranque).
- **Web + APK importan ambos:** por eso se prioriza el foco visible (accesibilidad) que sirve a los dos.
