# FLOW_VALIDATION — Caudal de Montebello contra el PLC real

**Fecha:** 2026-07-14 · **Método:** solo lectura (Read), nunca Write ni Call.
**Endpoint:** `opc.tcp://181.204.165.66:59100` (Anonymous + None, hallazgo P0).
**Buffer:** `REAL_IN_MONTEBELLO` → NodeId resuelto en vivo `ns=9;g=EBA8E3EB-53A2-0CCD-3912-501C0F7E4C8F`.

## Hipótesis (documentación de la planta)

- `REAL_IN_MONTEBELLO[0]` = caudal de entrada 1, l/s (decimal real).
- `REAL_IN_MONTEBELLO[5]` = caudal de entrada 2, l/s (decimal real).
- NodeId del HMI: `g=eba8e3eb-53a2-0ccd-3912-501c0f7e4c8f`. Valor observado en HMI: 14.22.

## Paso 1.1 — Coherencia del NodeId ✅

El identifier del HMI `g=eba8e3eb-53a2-0ccd-3912-501c0f7e4c8f` coincide con el del mapping
(`config/opc_mapping.json`, montebello / realIn / REAL_IN_MONTEBELLO =
`g=EBA8E3EB-53A2-0CCD-3912-501C0F7E4C8F`). Mismo GUID (OPC UA es case-insensitive en GUIDs).
**El HMI lee el mismo buffer que el backend suscribe.**

## Paso 1.2 — Array crudo (50 elementos, lectura instantánea)

| idx | valor | idx | valor |
|----:|------|----:|------|
| 0 | **14.168** | 10 | 36.331 |
| 1 | **170466.516** | 11 | 262144 |
| 2 | 0 | 15 | 2.509 |
| 3 | 1913.594 | 16 | 3.133 |
| 5 | **23.206** | 17 | −11.603 |
| 6 | 262144 | 18–49 | 0 (mayoría) |

- **idx[0] = 14.168** → 2 cifras, decimal. Plausible como caudal en l/s. Coincide con el HMI (14.22)
  dentro de la variación normal del proceso (Δ ≈ 0.05, muestreado en instante distinto).
- **idx[1] = 170466.5** → **6 cifras. Es el TOTALIZADOR** (acumulador de volumen), ya identificado
  en Fase 0.3 (≈169933). **idx[0] NO es el totalizador** — la prueba de disambiguación que el
  método exigía vigilar se cumple: la documentación coincide con lo cargado en el PLC.
- **idx[5] = 23.206** → decimal, plausible como segundo caudal en l/s.
- Los demás índices (3, 6, 10, 11, 15–17…) quedan **unmapped**. No se mapean por conveniencia.

## Paso 1.3 — Muestreo temporal (180 s @ 1 s, 134 muestras)

| índice | muestras | valores distintos | cambios | min | max | último | veredicto |
|---|---:|---:|---:|---|---|---|---|
| 0 (inletFlow1) | 134 | 3 | 3 | 14.1687 | 14.1875 | 14.1875 | **vivo**, estable ~14.18 l/s |
| 1 (totalizador) | 134 | 4 | 3 | 170466.5 | 170468.5 | 170468.5 | **monótono creciente** (acumulador) |
| 5 (inletFlow2) | 134 | 4 | 3 | 23.1375 | 23.2063 | 23.1375 | **vivo**, ~23.2 l/s |

`SourceTimestamp` distintos en 180 s: 4 → el buffer refresca ~cada 45 s (montebello es de los
sitios más lentos; aun así los caudales SÍ se mueven).

**Corroboración cruzada:** el totalizador (idx1) creció ~1.98 unidades en 180 s = ~0.011 u/s.
Si la unidad es m³, eso es **~11 l/s**, del mismo orden que idx0 (~14 l/s). El caudal instantáneo
y la tasa de cambio del acumulador de volumen son coherentes → refuerza que idx0 es un caudal
y idx1 su totalizador.

## Veredicto

**RESPALDADA.** La documentación coincide con lo cargado en el PLC hoy:
- idx0 = caudal de entrada 1 (l/s), ~14.2, coincide con el HMI.
- idx5 = caudal de entrada 2 (l/s), ~23.2.
- idx1 es el totalizador (NO un caudal); idx0 no se confunde con él.
- Ambos caudales son señales vivas (cambian en el tiempo).

## Pendiente para marcar `confidence: confirmed` (PASO 2)

Dos cosas que esta validación por sí sola NO resuelve y que exige el contrato:
1. **El documento de la planta debe vivir en el repo** (`docs/plant-documentation/`, campo
   `evidenceRef`). "confirmed" = evidencia verificable por un tercero dentro de un año sin
   preguntarnos. Esta validación empírica lo *respalda*, pero el documento oficial es la fuente.
2. **El `max` físico** de cada caudal debe salir de la capacidad de diseño de la planta
   (documento), no inventarse. Los valores observados (~14 y ~23 l/s) no fijan el máximo físico.
