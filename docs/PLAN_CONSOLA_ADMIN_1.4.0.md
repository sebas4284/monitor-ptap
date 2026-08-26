# Plan de implementación — Consola de administración (versión 1.4.0)

> **Cómo usar este documento.** Cinco fases independientes, pensadas para ejecutarse **de una en
> una**. Cada una es autosuficiente: trae el caso real que la motiva, qué existe ya y no hay que
> reconstruir, los archivos exactos, los contratos de datos, las reglas duras, los tests y su
> criterio de terminado. Al final está el procedimiento de publicación, que se hace **una sola vez**
> cuando las cinco estén cerradas.
>
> Escrito el 2026-08-26, con la 1.3.0 ya en producción.

---

## Índice

- [Por qué existe este plan](#por-qué-existe-este-plan)
- [Decisiones tomadas](#decisiones-tomadas)
- [Estado de partida](#estado-de-partida)
- [Mapa de ubicaciones](#mapa-de-ubicaciones)
- [Fase D — Novedades en la bandeja](#fase-d--novedades-en-la-bandeja)
- [Fase A — Informe de estado por planta](#fase-a--informe-de-estado-por-planta)
- [Fase B1 — Preguntas y problemas frecuentes](#fase-b1--preguntas-y-problemas-frecuentes)
- [Fase B2 — Tutorial guiado](#fase-b2--tutorial-guiado)
- [Fase C — Modo desarrollador](#fase-c--modo-desarrollador)
- [Transversal — higiene de ramas](#transversal--higiene-de-ramas)
- [Publicación de la 1.4.0](#publicación-de-la-140)

---

## Por qué existe este plan

El incidente del 2026-08-25 dejó una lección concreta: **el sistema ya sabía qué pasaba y no había
forma de verlo desde la app.** Hicieron falta seis horas, SSH, `nmap` y lecturas OPC a mano para
concluir algo que el backend tenía medido desde el principio.

Tres casos reales, y la fase que resuelve cada uno:

| Caso | Qué faltó | Fase |
|---|---|---|
| Cascajal marcaba **EN VIVO** con el tanque de hace un mes | Ver la frescura **por señal**, no por planta | A |
| `inletPressure1` = 409,50 psi (= 4095/10, fondo de escala de un ADC de 12 bits) | Reapuntar el canal sin desplegar | C |
| El corte del PLC hubo que diagnosticarlo a mano con `nmap` | Informe por planta con hasta dónde llega la conexión | A |

## Decisiones tomadas

Cerradas el 2026-08-26. No reabrirlas sin un motivo nuevo.

1. **Guardar aplica al instante; llevar a git es un segundo paso explícito.** Un toque en el móvil no
   dispara un despliegue completo.
2. **Todo a `yosh`.** Se adelantan `dev` y `main`, y se corrige el runbook.
3. **El editor es un formulario conectado al valor en vivo.** Sin bloques visuales tipo Scratch, sin
   crear ni borrar señales.
4. **Tutorial híbrido:** anclado en 4-5 pantallas, tarjetas autocontenidas para el resto.
5. **Una sola publicación al final, como 1.4.0 / versionCode 9.**

**Orden de ejecución: D → A → B1 → B2 → C.**

Novedades primero por ser autocontenida y pequeña. **La revisión por planta va antes del modo
desarrollador porque sin ella no hay forma de verificar que un canal reapuntado quedó bien** —
cambiar un índice a ciegas y no poder comprobarlo es peor que no poder cambiarlo. El tutorial va
antes del modo dev porque es menos peligroso.

## Estado de partida

Ya en producción con la **1.3.0** (publicada y verificada el 2026-08-26):

- Mando de válvulas por verbo: cada planta ofrece solo lo que su mapping declara.
- El `bridgeStatus` del DTO ya no se queda congelado cuando el PLC deja de ser alcanzable.
- Sonda de control y código `PLC-13` en el diagnóstico de ruta.
- Barra superior con la marca Aquora.
- Aviso de versión nueva también en el tablero (antes solo en login y Ajustes).

Contexto operativo a tener presente mientras se implementa:

- **El PLC está caído por un fallo físico** en la alcaldía (la señal no está arriba). Con el puente
  caído el interlock rechaza toda maniobra, así que **toda verificación de punta a punta va contra el
  simulador** (`CONNECTIVITY_PROVIDER=simulator`).
- 12 plantas en el mapping. Estados de frescura: `live` | `stable` | `frozen`.
- `UnusableReason`: `BAD_QUALITY` | `INVALID_NUMBER` | `BRIDGE_STALE`.
- `DeadLetterType`: `INVALID_NUMBER` | `INDEX_OUT_OF_RANGE` | `BUFFER_MISSING` | `UNEXPECTED_LENGTH`.

## Mapa de ubicaciones

Patrones que el proyecto ya usa. **Seguirlos, no inventar otros.**

- **Pantalla nueva:** `Tabs.Screen` con `href: null` en `apps/mobile/app/(app)/_layout.tsx` (como
  `estado`, `alertas`, `usuarios`), y `router.push('/(app)/<ruta>')` desde donde se entre.
- **Menú lateral:** el `Modal` de `_layout.tsx`, con `hasPermission(...)` envolviendo el item.
- **Sección de Ajustes:** `apps/mobile/app/(app)/ajustes.tsx`, con
  `{hasPermission('system_config') && ...}`. Ya existe así "Estado de conexión con el PLC".

| Qué | Archivo | Cómo se entra |
|---|---|---|
| Revisión por planta | `app/(app)/revision.tsx` | Ajustes → "Estado de conexión con el PLC" gana un botón; + menú lateral (`system_config`) |
| Ayuda y tutorial | `app/(app)/ayuda.tsx` | Ajustes → sección nueva "Ayuda y tutorial" |
| Modo desarrollador | `app/(app)/desarrollador.tsx` | Ajustes → sección propia, con aviso de que edita el mapeo real |
| Novedades | pestaña en `app/(app)/alertas.tsx` | junto a Válvulas / Tanques / Sensores / Señales |

| Endpoint | Controlador | Permiso |
|---|---|---|
| `GET /api/app/novedades` | `modules/app-release/` | `@Public()`, igual que `/api/app/version` |
| `GET /api/diagnostics/plant/:plantId` | `connectivity/diagnostics.controller.ts` | `system_config` |
| `GET /api/opc/raw/:plantId` | `connectivity/opc.controller.ts` | `system_config` |
| `PATCH /api/opc/mapping/:plantId/:domainKey` | controlador nuevo | `system_config` |
| `POST /api/opc/mapping/git` | ídem | `system_config` |

---

## Fase D — Novedades en la bandeja

**Requisito:** un espacio en notificaciones para versiones nuevas y funciones añadidas.

### Restricción encontrada

`notification.plant_id` es **NOT NULL** (migración `0009`). Un aviso global no cabe en esa tabla sin
inventar una planta falsa ni migrar el esquema. **Ninguna de las dos hace falta.**

### Qué existe ya

- `AppReleaseService` (`modules/app-release/app-release.service.ts`) ya lee `version.json` publicado
  junto al APK y expone `notes`. **No cachea a propósito**: publicar un APK no reinicia el backend.
- `AppUpdateBanner.tsx` ya muestra esas notas en login, Ajustes y tablero.
- `alertas.tsx` ya tiene el patrón de **pestañas con contador**: `FAMILIAS` y `familiaDe()` en
  `services/notifications.ts` (hoy `valvulas | tanques | sensores | senales`).

### Qué construir

1. **`docs/NOVEDADES.md`** versionado. Una entrada por versión:

   ```markdown
   ## 1.4.0 — 2026-08-26
   - Revisión de estado por planta, desde Ajustes.
   - Preguntas frecuentes y tutorial guiado.
   ```

2. **`GET /api/app/novedades`** en `modules/app-release/`. `@Public()`, con el mismo criterio que
   `/api/app/version`: lo consulta la pantalla de login antes de que exista sesión.
   Lee el `.md` **en cada petición, sin cachear** — misma disciplina que `AppReleaseService`.
   Contrato:

   ```ts
   interface Novedad { version: string; fecha: string; puntos: string[] }
   // GET /api/app/novedades -> { novedades: Novedad[] }   // más reciente primero
   ```

3. **Front:** `services/novedades.ts` + pestaña hermana en `alertas.tsx`.
   **No** es un `NotificationKind`: no entra en `FAMILIAS`, no pasa por `markSeen` ni por el dedupe.
   Fuente propia, render propio.

4. **Marca de "nuevo":** comparar la versión más reciente del listado con la última vista, guardada
   en `AsyncStorage`. Por dispositivo, no en MySQL: es una conveniencia por visor, no un dato del
   sistema.

### Tests

- El parser de `NOVEDADES.md` devuelve las entradas **más reciente primero**, y tolera un archivo
  vacío o sin entradas sin lanzar.

### Terminado cuando

La pestaña Novedades lista el changelog, marca como nueva la entrada no vista, y no aparece ninguna
fila en la tabla `notification`.

---

## Fase A — Informe de estado por planta

**Requisitos:** ver cada planta individualmente · su conexión al PLC contrastada con el estado de
datos · qué pasa hasta la obtención del dato del nodo · hace cuánto no cambian · qué le pasó a la
planta · hasta dónde llega la conexión · informe completo · selector de planta · cada ítem con
funciona/no, hora y detalles.

### Lo esencial: esto es composición, no medición nueva

Ya existe, y con `plantId`:

| Fuente | Qué aporta | Alcance |
|---|---|---|
| `RouteCheckReport` (`route-check.service.ts`) | 4 sondas (internet, ping, PLC, **control**) + veredicto `SRV-07`/`PLC-01`/`PLC-11`/`PLC-12`/`PLC-13` | global |
| `AdapterDiagnostics` | `bridgeStatus`, `recentTransitions`, heartbeat, `notificationsTotal`, `droppedNotifications` | global |
| `PerPlantStatus` (en `AdapterDiagnostics.perPlant`) | `lastFrameAt`, `buffersTotal`, `buffersFaulted` | por planta |
| `BufferHealth[]` (`/api/opc/buffers`) | `browseName`, `channel`, `resolved`, `faulted`, `reason` | por planta |
| `PlantSnapshotDto` | `liveness.state/lastChangeAt/windowSec`; por señal `ts`, `quality`, `usable`, `reason`, `outOfRange`, `confidence` | **por señal** |
| `DeadLetterBuffer.snapshot()` | anomalías con `plantId`, `domainKey`, `detail` | por planta |
| `audit_log` → `opc.bridge_status_change` | historial de transiciones con motivo | global |

**El puente y la red son globales por naturaleza** — hay un solo puente OPC por servidor. Eso no es
una carencia: es la respuesta honesta a "hasta dónde llega la conexión". Lo que **sí** es por planta
empieza en los buffers.

### A.1 — Extraer el servicio de frescura (la única pieza que falta de verdad)

La lectura **directa** del `SourceTimestamp` (`session.read`, **sin pasar por la Subscription**) es lo
único que separa *"nosotros no lo leemos"* de *"el servidor lo entrega viejo"* — la distinción que
costó media hora en Cascajal. La lógica ya está escrita en `apps/api/scripts/diagnose-freshness.ts`.

- **Extraerla** a `connectivity/opcua/freshness.service.ts`. Reutiliza `resolveNamespaces`.
- Devuelve por buffer: `browseName`, `channel`, `sourceTimestamp`, `statusCode`, `ageMs`, `veredicto`.
- **Corregir su falso verde.** Con los 22 buffers devolviendo `BadUserAccessDenied` y "sin
  timestamp", su veredicto imprimió `VIVAS (10): …cascajal…`. Sin timestamp **o** con StatusCode
  no-Good el veredicto es **`indeterminado`**, nunca "viva". Un verde falso en una herramienta de
  diagnóstico es peor que no tener la herramienta.
- `scripts/diagnose-freshness.ts` pasa a **usar** el servicio, sin duplicar la lógica.

### A.2 — El endpoint

`GET /api/diagnostics/plant/:plantId` con `@RequirePermission('system_config')`, en
`diagnostics.controller.ts` junto a los demás.

`?probe=deep` activa la lectura directa. **Detrás de bandera a propósito:** lanza `session.read` al
PLC y no debe ocurrir en cada refresco de pantalla. Sin la bandera todo sale de cache y no toca el PLC.

**El compositor es una función pura**, `buildPlantReport(input): PlantReport`, en
`connectivity/diagnostics/plant-report.ts`. Testeable sin red, mismo patrón que `buildVerdict` y
`buildRouteHistory`.

### A.3 — La pantalla

`app/(app)/revision.tsx`, con `PlantSelector.tsx` **reutilizado** arriba. Secciones en el orden de la
cadena, y **cada ítem con estado, hora y detalle**:

```
Red         ✅ servidor → internet           24 ms
            ✅ ping al host del PLC           27 ms
            ❌ servidor → PLC :59200          EHOSTUNREACH tras 3021 ms
            ✅ otro puerto del mismo host     25 ms → la ruta está BIEN
            ⚠️ PLC-13: el equipo detrás del reenvío no contesta
Puente      ⚠️ Connecting · última notificación hace 19 h · 0 reconexiones
Buffers     ✅ REAL_IN_CASCAJAL    NodeId resuelto
            ✅ INT_IN_CASCAJAL     NodeId resuelto
Señales     ⚠️ Nivel tanque 1      -0,19 m   fuera de rango   sin cambiar hace 32 d
            ✅ Caudal de salida 1    3,04 l/s                 hace 32 d
Anomalías   107 en el dead-letter (BUFFER_MISSING ×102, INVALID_NUMBER ×5)
```

Exportable: extender `services/diagnostics-export.ts`, que ya tiene el formato `.txt` y el `Share`.

### Archivos

`connectivity/opcua/freshness.service.ts` · `connectivity/diagnostics/plant-report.ts` ·
`connectivity/diagnostics.controller.ts` · `scripts/diagnose-freshness.ts` ·
`app/(app)/revision.tsx` · `app/(app)/ajustes.tsx` · `app/(app)/_layout.tsx` ·
`services/diagnostics-export.ts`

### Tests

- `buildPlantReport` es puro y se prueba **sin red**, con entradas fabricadas.
- La frescura devuelve `indeterminado` sin timestamp y con StatusCode no-Good.
- El informe de una planta con un buffer `faulted` lo marca sin degradar las otras.

### Terminado cuando

Se puede elegir cualquiera de las 12 plantas y el informe responde, con hora en cada ítem: hasta
dónde llega la red, el estado del puente, si el NodeId de cada buffer de ESA planta resolvió, hace
cuánto no cambia cada señal, cuáles no son usables y por qué, y qué cayó al dead-letter.

---

## Fase B1 — Preguntas y problemas frecuentes

**Requisitos:** zona nueva en Ajustes · desplegables · para qué sirve cada herramienta, cómo usarla y
qué leer para determinar el problema.

### Qué existe ya

**El contenido.** `docs/CATALOGO_ERRORES.md` tiene, por código: qué es, la causa, a quién escalar y
el archivo donde vive. Incluye el `PLC-13` añadido el 2026-08-25.

### Cómo evitar que se desincronice, sin generador

El texto vive en `apps/mobile/services/faq.ts` indexado por código, y **un test comprueba que todo
código presente en `CATALOGO_ERRORES.md` tiene entrada de FAQ**. Si mañana aparece un `PLC-14`, el
test falla y avisa. Más simple que un generador y atrapa la deriva igual.

### Contenido a cubrir

Cada entrada responde tres cosas: **qué es**, **cómo se usa la herramienta**, **qué leer** para decidir.

- **Sin conexión** — `SRV-07` / `PLC-01` / `PLC-11` / `PLC-12` / `PLC-13`, y **cómo se distinguen**.
  Es el árbol de decisión que quedó documentado en el catálogo: timeout = descarte silencioso
  (cortafuegos); error ICMP lento con el puerto de control respondiendo = el equipo detrás del
  reenvío está caído; rechazo = servicio caído; todo muerto = ruta.
- **Datos que no cuadran** — planta "en vivo" con valores quietos (el caso Cascajal), señal fuera de
  rango, dato congelado. Herramienta: el informe de la Fase A y `diagnose-freshness`.
- **Usuarios y contraseñas** — **no hay recuperación**: se rehace con `npm run db:credenciales` en la
  VM y la contraseña **se imprime una sola vez**. Toda cuenta nueva nace con rol `civil`; elevarla es
  exclusivo del administrador y queda auditado.
- **Válvulas** — por qué casi toda maniobra acaba en **ámbar**: `readBack.stateVerified` es `false`
  en las 10 plantas, así que nadie puede confirmar que el equipo se movió. Y por qué ocho plantas no
  pueden cerrar: no declaran el verbo `close`.
- **Demoras y trabas** — qué mira `/api/health/opc`, y qué significan `droppedNotifications`
  (muestras superadas dentro de la misma ventana de coalescing: es normal) y `publishLatencyMs`.

### Terminado cuando

La pantalla de Ayuda lista los problemas en desplegables, cada uno dice qué herramienta usar y qué
leer, y el test de cobertura de códigos pasa.

---

## Fase B2 — Tutorial guiado

**Requisitos:** botón al final de Ayuda · recorre la app con banners uno a uno · explica qué hace
cada módulo · repetible · avanzar y retroceder hasta un punto concreto.

### Estructura

- `components/Tutorial/TutorialProvider.tsx` — el contexto que lleva el paso actual.
- `components/Tutorial/TutorialOverlay.tsx` — el banner, con anterior / siguiente / salir / índice.
- `hooks/useTutorialTarget.ts` — registra un anclaje con `onLayout` / `measureInWindow`.
- `services/tutorial-steps.ts` — **los pasos declarados en un solo sitio**:
  `{ id, pantalla, target?, titulo, cuerpo }`. Añadir un paso es añadir una entrada, no tocar
  componentes.

### Híbrido: dónde se ancla y dónde no

**Anclado** en las cinco pantallas que importan: tablero, electroválvulas, alertas, estado, ajustes.
**Autocontenido** (tarjeta centrada) para el resto.

Anclar los ~30 módulos sería frágil: medir posiciones va distinto en Android y en web, y cada cambio
de UI puede descolocar un paso.

### La válvula de seguridad

**Si un anclaje no se puede medir** —el elemento no está en pantalla, o cambió la UI— el paso
**degrada a tarjeta centrada** en vez de señalar a un hueco. Esto es lo que hace viable la parte
frágil: un tutorial descolocado se ve peor que uno sin flechas.

### Persistencia

Progreso y "ya lo vi" en `AsyncStorage`, **por dispositivo**. No va a MySQL: es conveniencia por
visor, no un dato del sistema.

### Tests

- Un paso cuyo anclaje no se mide degrada a tarjeta centrada y **no** apunta a coordenadas vacías.
- Avanzar, retroceder y saltar a un índice concreto dejan el paso correcto.

---

## Fase C — Modo desarrollador

**Requisitos:** ver el NodeId de la planta · los datos de cada `realIn`, `intIn`, `intOut` · canales
numerados · solo los distintos de 0 excepto `intOut` · reapuntar el canal de una señal · que se
aplique sin que los usuarios actualicen la app.

**Va última a propósito: es la única fase que puede corromper datos en producción.**

### Corrección a la premisa del pedido

`intOut` **no es donde el PLC escribe a las válvulas: es donde escribimos NOSOTROS.** Verificado en el
write spec de Cascajal: `write.target.channel = "intOut"`, `commands.open = 4096` (bit12),
`pulse.holdMs = 300`. El backend pone el valor, el PLC lo lee y actúa; quien **reporta** el estado es
`intIn` (`readBack.channel`).

**Pero la conclusión práctica del pedido es correcta, con el motivo inverso:** como el pulso vuelve a
0 a los 300 ms, `intOut` está en cero casi siempre y un filtro "oculta ceros" lo escondería justo
cuando se quiere ver. **La excepción hace falta.**

### C.1 — Solo lectura primero

`GET /api/opc/raw/:plantId` (`system_config`). El pipeline ya guarda `latestBuffers`
(`Map<browseName, RawBufferSample>`) por planta; se expone tal cual, con el NodeId
(`nsUri` + `identifier`) de cada buffer sacado del mapping.

Lo que la hace accionable: **junto a cada índice, qué señal lo consume y cómo se ve en el tablero.**

```
REAL_IN_CASCAJAL   ns=AQUATECH4  g=F0C27430-68DC-74D7-BDAB-B9EDCC19F8A7   Float[50]
  [ 0]    3,04   → outletFlow1      "Caudal de salida 1"     3,04 l/s
  [ 5]   -0,19   → tank1Level       "Nivel tanque 1"        -0,19 m   ⚠️ fuera de rango
  [19]  409,50   → inletPressure1   "Presión de entrada"   409,50 psi  ⚠️ fuera de rango
  [ 3]  230,46   → (sin mapear)
INT_OUT_CASCAJAL   ns=AQUATECH4  g=37DF3BEA-…   Int16[20]   (todos los índices, incluidos los 0)
  [ 0]       0   → valve1           "Válvula 1"   🔒 no editable
```

### C.2 — La edición

`PATCH /api/opc/mapping/:plantId/:domainKey` con
`{ index?, buffer?, sourceBuffer?, unit?, min?, max?, opMin?, opMax? }`.

**Reglas duras:**

- **Las señales `writable` (válvulas) quedan excluidas.** El schema exige `confidence: confirmed`
  para lo escribible, y eso requiere documento oficial de la planta.
- Todo cambio hecho desde la app baja la señal a **`confidence: inferred`**: no hay documento detrás.
  Es exactamente para lo que existe ese campo.
- **Se revalida contra `config/opc_mapping.schema.json` ANTES de aplicar.** Si no valida, se rechaza.
- Se audita: quién, cuándo, de qué índice a cuál. **Reversible uno a uno.**

**Almacenamiento:** tabla `mapping_override`, migración **`0014`** (la última es `0013`). El loader
aplica los overrides encima del JSON al cargar. Es auditoría/configuración, no telemetría: respeta la
regla 1.

### C.3 — "Se aplica ya", sin reiniciar el proceso

Un cambio de índice, unidad o rango es **puramente de la capa de dominio**: no toca NodeIds, ni
buffers, ni la Subscription OPC. Así que aplicarlo es **recargar `MappingEngine` y reconstruir los
snapshots** — la versión **estrecha** de `docs/PROPUESTA_HOT_RELOAD_MAPPING.md`, que es justo la que
esa propuesta recomienda: dominio sí, NodeIds nunca.

**Nada de `pm2 restart` desde dentro del propio proceso.**

### C.4 — "Llevar a git" (segundo paso, explícito)

`POST /api/opc/mapping/git`: escribe los overrides pendientes en `config/opc_mapping.json`, commitea
a **`yosh`** y hace push. **No despliega** — producción ya está corregida por el override.

> **Seguridad, y esto no es negociable.** Hoy la VM solo hace `pull`: si se compromete, no puede
> tocar el repositorio. Darle escritura amplía el radio de daño sobre infraestructura que acciona
> válvulas de agua potable. Se usa un **deploy key SSH con permiso de escritura, limitada a este
> repositorio** — **no** un token clásico con scope `repo`, que da acceso a todos los repos de la
> cuenta (los fine-grained no sirven aquí, por ser repo de otra cuenta personal). Permisos `0600`,
> fuera de git. **Hay que crearla en GitHub antes de empezar esta sub-fase.**

Cuando el commit llegue a la base en el siguiente despliegue normal, el loader detecta que el
override ya está en el JSON y lo marca aplicado, para que no se acumulen capas.

### Tests

- Un override que rompe el schema se rechaza y no se persiste.
- Una señal `writable` no es editable.
- El override baja `confidence` a `inferred`.
- Tras aplicar un override, el DTO sale con el índice nuevo sin reiniciar el proceso.

---

## Transversal — higiene de ramas

`origin/dev` y `origin/main` están las dos en `184b350`, **doce commits por detrás de `yosh`**. Un
`BRANCH=dev bash ~/deploy.sh` **revierte producción** sin avisar, y `deploy.sh` acepta ese parámetro.

- Adelantar `dev` y `main` a `yosh` (fast-forward).
- Corregir `docs/RUNBOOK_PRODUCCION.md`: su **línea 68** sigue diciendo que la VM sigue `dev`,
  mientras su **§7** dice `yosh`. Esa contradicción ya hizo dudar una vez.
- Borrar de la VM la rama local `dev` obsoleta (estaba `ahead 5` sin subir).

---

## Publicación de la 1.4.0

**Una sola vez, cuando las cinco fases estén cerradas.** Este orden importa: el 2026-08-25 costó tres
intentos por saltárselo.

```bash
# 1. En el repo: subir version y versionCode
#    apps/mobile/app.json  ->  "version": "1.4.0"  y  "versionCode": 9

# 2. Notas para los usuarios
#    docs/NOVEDADES.md  +  ~/deploy-scripts/notas-version.txt   (en la VM)

# 3. Backend
ssh ptap 'bash ~/deploy.sh'

# 4. OBLIGATORIO ANTES DE COMPILAR: propaga la versión al proyecto Android
ssh ptap 'bash ~/deploy-scripts/prebuild-vm.sh'

# 5. UNA sola compilación (dos a la vez corrompen la caché de Gradle)
ssh ptap 'rm -f ~/apk-build.done; setsid nohup bash ~/deploy-scripts/apk-build.sh >/dev/null 2>&1 &'
#    termina cuando ~/apk-build.done dice EXIT=0

# 6. Bundle web
ssh ptap 'cd ~/monitor-ptap/apps/mobile && API_BASE_URL= npx expo export -p web --clear'

# 7. Publicar (necesita contraseña de sudo: lo corre el usuario)
sudo bash ~/deploy-scripts/publicar-todo.sh
```

**Si se salta el paso 4**, el APK sale con la versión vieja y `apk-publicar.sh` **aborta** la
publicación avisando — el guard se añadió el 2026-08-25 tras descubrir que la APK servida decía
`1.2.1` por dentro mientras anunciaba `1.2.3`, lo que dejaba a todo el mundo con un aviso de
actualización que nunca se podía satisfacer.

### Comprobaciones antes de dar la versión por publicada

```bash
# La versión REAL del binario, no la que anuncia nadie
ssh ptap 'A=$(ls ~/android-build/sdk/build-tools/*/aapt2|sort -V|tail -1); "$A" dump badging \
  /var/www/ptap-download/monitor-ptap.apk | sed -n 1p'
# debe decir versionCode='9' versionName='1.4.0'

curl -s https://aquora.xpertic.co/api/app/version    # 1.4.0 / 9
```

- **Peso ~34 MB.** Si sube a 92, se perdió `buildArchs` de `app.config.js` y el APK trae las cuatro
  ABIs; `x86` y `x86_64` son 40 MB que solo sirven para emuladores.
- **Solo `arm64-v8a`** dentro del APK.
- Las cadenas con acentos **no se encuentran con un grep normal** en el bundle: es bytecode de Hermes
  y las guarda en UTF-16. Buscar en UTF-16LE, o usar una cadena sin acentos.
