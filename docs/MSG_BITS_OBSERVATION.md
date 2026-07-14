# Observación temporal de los bits DN/ER/TO (FASE 0.2 · arreglo 2)

> **⛔ RESULTADO BLOQUEANTE PARA EL DISEÑO DE `connectionStatus`.** La lectura
> instantánea de DN **no sirve** como estado de conexión. Ver §Conclusión. Este
> documento es **INPUT OBLIGATORIO** para el diseño de `connectionStatus` en Fase 2.

| Campo | Valor |
|---|---|
| **Fecha/hora** | 2026-07-14T11:19:16Z (UTC) |
| **Servidor** | `opc.tcp://181.204.165.66:59100` (FactoryTalk Optix, `Running`) |
| **Sesión** | `SecurityMode=None` + `Anonymous` — **solo lectura** (fachada `ReadOnlySession`, sin write/call/subscription) |
| **Script** | `tools/plc-discovery/src/observe-msg-bits.ts` |
| **Sitios observados** | MONTEBELLO (rico), VORAGINE (estándar), QUIJOTE (mínimo) |
| **Bits por sitio** | `DN`, `ER`, `TO` del `MSG_READ` primario |
| **Duración** | 60 s · **intervalo solicitado 200 ms · intervalo REAL medio 418 ms** · 144 muestras · 0 lecturas Bad |
| **Artefacto crudo** | `tools/plc-discovery/output/msg_bits_observation.json` (gitignored) |

## Resultado medido

| Sitio | DN duty cycle | DN transiciones | DN máx. en bajo | ER activó | TO activó |
|---|---|---|---|---|---|
| MONTEBELLO | **0.000** | 0 | 60 192 ms (todo el tramo) | no | no |
| VORAGINE | **0.000** | 0 | 60 192 ms | no | no |
| QUIJOTE | **0.000** | 0 | 60 192 ms | no | no |

**Las 9 series (3 sitios × 3 bits) fueron `false` (0) en las 144 muestras**, con
`StatusCode = Good` en todas (0 lecturas Bad). DN nunca se observó en alto; ER y TO
nunca se activaron.

## Interpretación

1. **Escenario (a) REFUTADO.** DN **no** está estable en alto. La fórmula directa
   `connectionStatus = DN && !ER && !TO` reportaría **"desconectado" el 100 % del
   tiempo, para todos los sitios** — incluido VORAGINE, que en la captura de
   descubrimiento entregó datos vivos y no-nulos (`REAL_IN_VORAGINE = [7.599, 395811.125, …]`).
   Un tablero de conectividad construido sobre la lectura instantánea de DN estaría
   **siempre en rojo**, lo cual es falso.

2. **Consistente con el escenario (b): DN es un pulso transitorio de la instrucción
   MSG de Rockwell.** DN (Done) se pone en alto al completar el mensaje y se limpia al
   re-disparar la instrucción; si el maestro re-dispara los MSG de forma continua, DN
   está en alto solo durante uno o pocos scans del PLC (~10–50 ms). **No se puede
   observar por lectura (Read) puntual.**

3. **Advertencia de método (obligatoria por el prompt):** el muestreo real fue de
   **418 ms**, no 200 ms — el round-trip de una lectura contra la IP pública es
   ~218 ms. **Es demasiado grueso para caracterizar un pulso de un scan.** Por lo
   tanto: NO se puede afirmar "DN nunca pulsa"; solo que **DN estuvo en bajo en los 144
   instantes muestreados**. Para ver el pulso hay que dejar que el **servidor**
   muestree rápido (MonitoredItem con cola), no el cliente por polling. La fachada de
   solo lectura no expone subscriptions a propósito, así que esa medición pertenece a
   Fase 1/2.

   > Corolario directo sobre el plan actual: la Subscription prevista con
   > `publishingInterval = 2000 ms` **perdería** estos pulsos igual que el polling de
   > 418 ms. El diseño de la subscription debe cambiar (ver recomendación).

## Conclusión y recomendación (input para Fase 2)

**`connectionStatus` NO debe derivarse de la lectura instantánea de DN.** Se requiere
un **agregador con ventana temporal**, alimentado por captura de eventos (no por
snapshot lento):

1. **Captura (Fase 1):** MonitoredItem sobre `DN`/`ER`/`TO` de cada sitio con
   `samplingInterval` pequeño (p. ej. **50–100 ms**), `queueSize > 1` y
   `discardOldest = false`, para que el **servidor** registre los pulsos entre
   publicaciones y los entregue en el siguiente `PublishResponse`. Un MonitoredItem por
   bit de estado (son escalares, no cuentan como buffer de proceso; la regla 6 aplica a
   los arrays de datos).

2. **Derivación (Fase 2):** `connectionStatus(site) = conectado` si **llegó al menos un
   evento `DN = true` en los últimos N segundos y no hubo `ER`/`TO`**; en caso
   contrario, `desconectado`. Con `ER`/`TO` activos → `desconectado` con causa.

3. **Valor de N:** debe **medirse**, no adivinarse. Primero hay que capturar el
   **periodo real de re-disparo de los MSG** con el MonitoredItem encolado del paso 1
   (esta observación por Read no pudo medirlo por ser demasiado gruesa). Provisional,
   con margen: `N ≈ 3 × periodo_de_pulso` observado, con un piso de seguridad (p. ej.
   nunca menos de 10 s) para no parpadear. **No** publicar un `connectionStatus`
   basado en DN antes de esa medición.

4. **Diagnóstico complementario recomendado (Fase 2):** observar también los miembros
   `EN`/`EW`/`ST` del MSG (Enable/Enable-Waiting/Start) con MonitoredItems encolados,
   para distinguir "MSG pulsando normalmente" de "MSG no se está ejecutando". Si `EN`/`ST`
   tampoco muestran actividad, los MSG podrían ser disparados por evento y el modelo de
   `connectionStatus` cambiaría.

## Impacto sobre artefactos previos

- El `confidence: "confirmed"` de `connection` en `opc_mapping.json` sigue siendo
  correcto: significa **"confirmamos qué nodos son DN/ER/TO"** (identidad del mapeo,
  leídos con calidad Good), **no** "el sitio está conectado". La *interpretación
  temporal* de esos bits es lo que este documento acota.
- `docs/PHASE0_VERIFICATION.md` (H5) leyó DN/ER/TO una vez y verificó calidad Good; no
  afirmó nada sobre el valor. Este documento lo complementa, no lo contradice.
