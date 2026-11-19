# Consigna de la válvula de salida proporcional (Fase 4)

## Estado: AUTORIZADA y ENCENDIDA

**Autorizada por Operación el 2026-11-13.** En la rama `yosh`, `cabuyo/valve1` tiene `writable: true`.
Hasta esa fecha se probó **solo en simulador**, nunca contra el PLC real: la primera orden real debe
hacerse con Operación presente (riesgos abiertos en `docs/RIESGOS_CABUYO.md`).

Si hubiera que apagarla (`cabuyo/valve1` con `writable: false`):
- **Backend:** el WriteService no resuelve la válvula. Cualquier `{ command: "setpoint" }` se rechaza
  con `404 TARGET_NOT_WRITABLE`, sin escribir nada en el PLC, y el intento queda auditado.
- **App:** muestra la apertura y el aviso «Consigna pendiente de autorización de Operación». No muestra
  el botón «Ajustar apertura».
- **Mapping:** el spec de la consigna se conserva y se sigue validando (`validate:mapping` y el loader).
  Así, encenderla es cambiar un solo campo, y ese cambio no puede destapar un spec roto.

### Quién la autoriza

**Operación**, por escrito: el responsable de operación de la planta Cabuyo. Autorizada el 2026-11-13.

### Cómo se apaga (o se vuelve a encender)

1. En `apps/api/config/opc_mapping.json`, en `cabuyo/valve1`, cambiar `"writable": true` a `"writable": false`.
2. En esa misma señal, cambiar la `_nota` para que diga quién lo decidió y cuándo.
3. Ajustar los tests que fijan el estado (`consigna-valvula.test.ts`, `command-mapping.test.ts`,
   `plantas-en-integracion.test.ts`) y correr `npm run validate:mapping -w @ptap/api` y `npm test -w @ptap/api`.
4. Desplegar como siempre y **reiniciar el backend**, porque el mapping se carga al arrancar.

Para encenderla otra vez, el mismo cambio al revés.

Los archivos que componen la consigna están en la lista del final.

## Qué hace

Desde la pantalla de Válvulas, quien tenga el permiso `control_valves` puede fijar la apertura de la
válvula de salida proporcional de Cabuyo entre 0 y 100 %.

Fuente: ficha del integrador del PLC (Brayan Grueso, Telcobras, 2026-11-09/10).

| Dato | Valor |
|---|---|
| Consigna | `INT_OUT_CABUYO[1]`, INT, 0–100 % (valor directo en %), límites 0–100 |
| Fuera de límites | el PLC satura. Aquora **rechaza** el valor antes de escribirlo y no depende de esa saturación. |
| Realimentación | `valve1Position` = `REAL_IN_CABUYO[16]` (0–100 %) |
| Modo local/manual | no hay |
| Rampa | desconocida |

## Contrato

```
POST /api/plants/cabuyo/commands
{ "command": "setpoint", "target": "valve1", "value": 40, "idempotencyKey": "opcional" }
```

| Caso | HTTP | Resultado |
|---|---|---|
| La apertura llega a ±2 % del valor en 120 s | 200 | `confirmed` |
| El valor quedó escrito (eco verificado), pero la apertura no llega a tiempo | 202 | `sent` / `SENT_POSITION_PENDING` |
| El servidor OPC UA rechaza la escritura | 502 | `failed` / `WRITE_REJECTED` |
| Valor fuera de 0–100 o no finito | 400 | `rejected` / `VALUE_OUT_OF_RANGE` (no escribe nada) |
| La palabra `INT_OUT_CABUYO[1]` ya contiene algo fuera de 0–100 (p. ej. 257), o no se puede leer | 409 | `rejected` / `SETPOINT_WORD_IN_USE: La palabra de consigna contiene un valor fuera de rango: posible uso por otro equipo; verificar con el integrador` (no escribe nada) |
| `setpoint` sin `value`, o `value` en abrir/cerrar | 400 | `rejected` / `VALUE_REQUIRED` |
| Rol sin `control_valves` (civil) | 403 | `rejected` / `FORBIDDEN` |

- **Redondeo:** el valor se redondea a entero (40,6 → 41). Se escribe y se audita el redondeado. La auditoría guarda también lo que se pidió (`requestedValue`).
- **Sin rollback:** volver a otro valor movería la válvula. La consigna escrita se queda puesta.
- **Espera síncrona:** la petición espera la apertura hasta 120 s. Cabe en el `proxy_read_timeout 300s` de nginx.
- **Controles del canal:** se mantienen igual que en las válvulas on/off:
  - RBAC: operador, jefe y admin pueden; civil no (matriz vigente desde el 2026-10-31);
  - interlocks: puente conectado, planta `live` y conexión OK;
  - una sola orden a la vez por válvula;
  - idempotencia;
  - auditoría;
  - registro firmado;
  - precondición de sesión segura.

## Protección de la palabra de consigna

La consigna se escribe en absoluto, sobre la palabra completa. Si `INT_OUT_CABUYO[1]` no fuera de uso
exclusivo (pendiente 1 del integrador), esa escritura pisaría los bits del otro uso. Por eso, **antes de
reservar y de escribir**, el WriteService lee la palabra:

- **Contiene un número dentro de [min, max]:** es una consigna, y se escribe normal.
- **Contiene cualquier otra cosa** (por ejemplo 257, que son bits, un valor ilegible o una calidad que no es `Good`): rechaza con **409 `SETPOINT_WORD_IN_USE`**. No se escribe nada, el intento queda auditado y la respuesta lleva en `previousValue` el valor encontrado.

Falla cerrado. Si aparece este rechazo, hay que verificar con el integrador quién más escribe en esa
palabra antes de forzar nada.

## Mapping

En `apps/api/config/opc_mapping.json`, señal `cabuyo/valve1`:

```json
"write": {
  "target": { "channel": "intOut", "sourceBuffer": "INT_OUT_CABUYO", "index": 1 },
  "commands": { "setpoint": true },
  "mode": "absolute",
  "setpoint": { "min": 0, "max": 100, "unit": "%", "tolerance": 2 },
  "readBack": { "channel": "realIn", "sourceBuffer": "REAL_IN_CABUYO", "index": 16,
                "confirmsWrittenValue": false, "stateVerified": false },
  "timeoutMs": 120000,
  "permission": "control_valves"
}
```

Reglas que exigen el schema, `validate:mapping` y el loader (el backend no arranca con una consigna
inválida, según `motivoConsignaInvalida`):
- el único verbo es `setpoint`, con valor `true`; el número lo trae la petición;
- `mode: absolute`;
- sin `pulse`, `rollbackValue`, `sequences`, `sustained` ni `latched`;
- `min < max` y `tolerance > 0`;
- el destino es `intOut` o `realOut`;
- el read-back es `realIn` o `intIn`, sin máscaras.

**`stateVerified: false` no impide el `confirmed`.** Aquí el read-back es una medida analógica de la
apertura, no una codificación inferida. Decisión aprobada el 2026-11-10.

## Provisional: pendiente del integrador

Las mismas cuatro cosas están en el `_riesgo` de `valve1`:
1. **Uso exclusivo de `INT_OUT_CABUYO[1]`** para la consigna. Si esa palabra comparte bits, la escritura en absoluto los pisaría.
2. **Tiempo de recorrido 0–100 %** del actuador. De él depende el `timeoutMs`, hoy 120 s.
3. **Tolerancia aceptable** entre consigna y apertura. **±2 % es provisional.**
4. **Rampa permitida.**

## App

En la fila de la válvula proporcional:
1. El botón **«Ajustar apertura»** aparece solo con `control_valves` y si el mapping declara la consigna.
2. El selector muestra la apertura actual y la consigna vigente, con un deslizador en JS puro (sin módulo nativo), un campo numérico y botones ±1/±10.
3. La confirmación es la de siempre, con la espera de 3 s: «AJUSTAR A 40 %».
4. El diálogo de resultado dice «Apertura alcanzada» (verde) o «Consigna enviada; la apertura aún no llega» (ámbar).

Las proporcionales sin consigna declarada (La Luisa, La Leonera y Gloria) siguen mostrando el aviso
`setpoint-pending`.

## Simulador

El PLC simulado lleva `REAL_IN_CABUYO[16]` hacia la consigna escrita a 2 %/s, sin ruido, y satura a
[0, 100].

Con el escenario `produccion` la consigna está encendida, igual que en producción:

```
PORT=4002 npm run dev:sim -w @ptap/api -- produccion
```

El escenario `produccion-consigna`, que la encendía solo en la simulación mientras estuvo apagada, se
retiró el 2026-11-13. El mecanismo sigue disponible para futuras consignas apagadas: un escenario
puede declarar `"consignasEncendidas": ["planta/valveN"]` y `dev:sim` arma una copia temporal del
mapping con solo ese `writable` en `true`, sin tocar `config/opc_mapping.json`. `encenderConsignas`
solo acepta señales que ya son una consigna apagada: no puede inventar un mando.

Después se ajusta la consigna desde la app y se comprueba en `GET /api/opc/sim/writes`.

## Archivos del entregable

- **Mapping y validación:**
  - `apps/api/config/opc_mapping.schema.json`
  - `apps/api/config/opc_mapping.json` (`cabuyo/valve1`, la `_nota` de `valve1Position`, la nota 57 y `stateTrusted` de `valve2State`)
  - `apps/api/scripts/validate-mapping.ts`
  - `apps/api/src/infrastructure/connectivity/mapping/opc-mapping.loader.ts`
- **Comando:**
  - `apps/api/src/modules/commands/command.dto.ts`
  - `apps/api/src/modules/commands/write.service.ts`
  - `apps/api/src/modules/commands/valve-notice.ts`
- **Snapshot:**
  - `apps/api/src/infrastructure/connectivity/pipeline/mapping.engine.ts` (publica los límites también con la consigna apagada)
  - `apps/api/src/infrastructure/connectivity/pipeline/snapshot.builder.ts`
  - `packages/shared/src/index.ts` (`SignalDto.setpoint`)
- **Simulador:**
  - `apps/api/src/infrastructure/connectivity/adapters/simulator/simulated-plc.ts`
  - `apps/api/src/infrastructure/connectivity/adapters/simulator/sim-scenario.ts` (`consignasEncendidas`, `encenderConsignas`)
  - `apps/api/scripts/dev-sim.ts`
  - `apps/api/fixtures/sim-scenarios/produccion-consigna.json` (retirado el 2026-11-13, al encenderla)
- **Tests:**
  - `apps/api/test/consigna-valvula.test.ts` (nuevo)
  - `apps/api/test/command-mapping.test.ts`
  - `apps/api/test/plantas-en-integracion.test.ts`
  - `apps/api/package.json`
- **App:**
  - `apps/mobile/services/valves.ts`
  - `apps/mobile/services/api.ts`
  - `apps/mobile/hooks/useValveSupervisor.ts`
  - `apps/mobile/components/ValveItem.tsx`
  - `apps/mobile/components/ValveConfirmDialog.tsx`
  - `apps/mobile/components/ValveSetpointDialog.tsx` (nuevo)
  - `apps/mobile/components/memo-compare.ts`
  - `apps/mobile/app/(app)/electrovalvulas.tsx`
  - `apps/mobile/services/valves.test.ts`
- **Documentación:**
  - `docs/plc/PLANTAS_NUEVAS_CABUYO_LUISA_LEONERA_GLORIA.md` (sección Fase 4)
  - `docs/CONSIGNA_VALVULA_PROPORCIONAL.md`
  - `docs/RIESGOS_CABUYO.md`
  - `docs/DATA_CATALOG.md` (regenerado)

**No correr `npm run generate:mapping`.** Es destructivo, como en la Fase 3: borraría `valve1` y el
resto de válvulas. `generate-mapping.ts` no se tocó en este entregable.
