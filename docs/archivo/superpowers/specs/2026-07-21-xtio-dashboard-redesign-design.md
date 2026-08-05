# Rediseño del dashboard móvil al estilo xtio.io

## Contexto

El usuario usaba antes `app.xtio.io/dashboards` (SCADA cloud de terceros) para monitorear
las PTAP y quiere que la app propia (`apps/mobile`) adopte ese mismo lenguaje visual, ahora
que el puente OPC UA real ya está conectado (ver README, Fase 0–4 completas). Compartió dos
capturas del tablero de "PTAP Alto los Mangos" en xtio: tema oscuro, tarjetas con barra de
progreso para caudal, tarjeta de tanque con chips MAX/MIN y badge de estado, y tarjeta de
presión con valor centrado.

Hoy la app tiene tema claro, una tarjeta genérica (`SignalCard`) para todas las señales
numéricas y una tarjeta especializada (`TankCard`) solo para tanques, repartidas en dos
pestañas separadas (Sensores / Tanques).

## Decisiones (de la sesión de brainstorming)

1. **Rediseño completo**, no solo tomar prestada la paleta — se reemplazan los componentes
   de tarjeta existentes.
2. **Se quitan los indicadores de confianza** (badge "inferido", nota al pie) de las nuevas
   tarjetas, para igualar el look de xtio. Esto es una desviación **intencional** de la
   regla 10 del README (*"Un `inferred` no se presenta igual que un `confirmed`"*) — decisión
   explícita del usuario, no un descuido. Si en el futuro se quiere retomar, hay que revisar
   esta spec.
3. **Una sola pantalla por planta** (fusiona Sensores + Tanques) en vez de dos pestañas.
4. **Los "Totalizador Entrada/Salida" de xtio quedan fuera de alcance** — ni UI ni mapping
   de backend en este trabajo. El usuario mencionó que en el futuro se capturarán como dato
   interno para notificaciones, pero eso es una iniciativa aparte, no parte de este rediseño.
5. Únicamente **caudal** (`inletFlow*`/`outletFlow*`) usa la tarjeta con barra de progreso
   (`FlowMeterCard`); todo lo demás (presión, pH, turbidez, temperatura, oxígeno,
   conductividad, cloro) usa la tarjeta simple (`GaugeCard`).

## Componentes nuevos (`apps/mobile/components/`)

### `TankGaugeCard.tsx` (reemplaza `TankCard.tsx`)
Mismo dato que `TankCard` hoy (`TankView`: `levelM`, `volumeM3`, `percentage`,
`outOfRange`), pero con el look de xtio:
- Chips `MAX {maxLevelM} m` / `MIN {minLevelM} m` arriba (si existen).
- % grande centrado + badge de estado textual derivado del %: `< 25` Bajo (rojo),
  `25–70` Medio (ámbar), `> 70` Alto (verde) — umbrales cosméticos, no de negocio.
- Barra de relleno vertical (se mantiene la animación actual de `TankCard`).
- Filas `Nivel` / `Volumen` abajo.
- **Se preserva** el guard de `TankCard` actual: si `percentage` es `null` (capacidad del
  tanque sin confirmar), no se inventa un %, se muestra solo `levelM` o "—". Esto es una
  regla de "no fabricar datos", distinta del badge de confianza que sí se quita (punto 2).

### `FlowMeterCard.tsx` (nuevo)
Para `domainKey` que contiene `"Flow"`.
- Cabecera con ícono + `signal.label`, barra de color por dirección (ver Theming).
- Valor grande arriba a la derecha + unidad.
- Barra de progreso horizontal 0–100%, calculada como
  `(value - opMin) / (opMax - opMin)` **solo si** `opMin` y `opMax` son ambos numéricos.
- **Fallback:** si falta `opMin` u `opMax`, renderiza igual que `GaugeCard` (sin barra) —
  no es una decisión de UX, es que no hay con qué dibujar el 0–100%.
- `value === null` → mismo estado "sin dato" que existe hoy en `SignalCard`.

### `GaugeCard.tsx` (reemplaza `SignalCard.tsx`)
Para todo lo que no sea caudal.
- Ícono + `signal.label`.
- Valor grande centrado + unidad.
- Texto chico `Mín: X   Máx: Y` si `opMin`/`opMax` existen (se mantiene, no es un
  indicador de confianza).
- `value === null` → "sin dato" (se mantiene igual que hoy).
- **No** se dibuja el badge "inferido" ni la nota al pie (se elimina respecto a
  `SignalCard` actual).

## Theming (`constants/colors.ts`)

Se reemplaza la paleta clara actual por una oscura. Valores exactos a definir en el plan de
implementación (no bloquean el diseño), pero la estructura es:
- `background` / `surface` cercanos a negro (fondo app y tarjetas).
- `accentInlet` (ámbar/naranja) y `accentOutlet` (azul/cian) — mapeados desde el prefijo
  `inlet`/`outlet` del `domainKey`, reutilizando una convención que ya existe en el dominio
  (no se inventa una taxonomía nueva).
- Se conservan `danger`/`warning`/`success` para los badges de estado del tanque.

## Estructura de pantallas

- **Nueva** `apps/mobile/app/(app)/tablero.tsx`: reemplaza a `sensores.tsx`. Usa
  `useSnapshot(plantId)` + `useTanques()` (sin cambios en los hooks ni en el backend),
  renderiza en una sola columna: tarjetas de tanque primero, luego `FlowMeterCard`, luego
  `GaugeCard` para el resto.
- **Se elimina** `apps/mobile/app/(app)/tanques.tsx` y su tab.
- En `apps/mobile/app/(app)/_layout.tsx`: el `Tabs.Screen name="sensores"` se renombra a
  `name="tablero"` con `tabBarLabel: 'Tablero'`; se quita el `Tabs.Screen name="tanques"`.
- Válvulas, Reportes, Estado, Usuarios, Ajustes: **sin cambios**.

## Clasificación señal → tarjeta

Función pura (nueva, junto a los componentes o en `services/`):
```ts
function cardKindFor(domainKey: string): 'flow' | 'gauge' {
  return domainKey.toLowerCase().includes('flow') ? 'flow' : 'gauge';
}
function directionFor(domainKey: string): 'inlet' | 'outlet' | null {
  if (domainKey.startsWith('inlet')) return 'inlet';
  if (domainKey.startsWith('outlet')) return 'outlet';
  return null;
}
```
Se reutiliza el `ICONS` map que ya existe en `sensores.tsx` (se mueve a `tablero.tsx`).

## Fuera de alcance

- Totalizadores (UI y backend/mapping).
- Válvulas, Reportes, Estado y cualquier otra pantalla.
- Cambios al backend/`opc_mapping.json` — todas las señales usadas ya existen en el DTO.
- Notificaciones/alertas mencionadas por el usuario como trabajo futuro.

## Verificación

- `npm run typecheck` (raíz) limpio tras el cambio.
- Levantar `npm run start:telemetry -w @ptap/api` + `npm run web -w @ptap/mobile`, entrar a
  **Montebello** (tiene caudal real con `opMin`/`opMax`) y confirmar que `FlowMeterCard`
  dibuja la barra de progreso con datos reales; confirmar que una señal sin rango (ej.
  presión) cae correctamente a `GaugeCard` sin romper.
- Revisar visualmente que no quede ningún rastro del badge "inferido" ni del pie de nota
  en las tarjetas nuevas.
- Confirmar que la pestaña "Tanques" ya no aparece y que `tablero.tsx` muestra tanques +
  señales de la planta seleccionada en una sola pantalla.
