# Riesgos abiertos de Cabuyo

Integración de Cabuyo (Fase 3) y consigna de la válvula de salida (Fase 4). Fuente: la ficha del
integrador del PLC (Brayan Grueso, Telcobras, 2026-11-09/10) y el trabajo del 2026-11-10/11.

Se actualiza cada vez que se cierra un riesgo o aparece uno nuevo.

| # | Riesgo | Estado | Mitigación actual | Pendiente | Responsable |
|---|---|---|---|---|---|
| 1 | **La palabra `INT_OUT_CABUYO[1]` la usa otro equipo.** La consigna se escribe en absoluto, sobre la palabra completa. | Abierto. Protección parcial. | Antes de escribir se lee la palabra. Si contiene un valor fuera de 0–100 (p. ej. 257), se rechaza con `409 SETPOINT_WORD_IN_USE`, sin escribir y con auditoría. **No detecta** un otro uso que deje valores entre 0 y 100. | El integrador confirma por escrito que `INT_OUT_CABUYO[1]` es de uso exclusivo de la consigna. | Integrador |
| 2 | **Choque con la HMI en `INT_OUT_CABUYO[0]`.** La válvula de entrada (`valve2`) va como orden **sostenida**: la app deja puesto el bit 2 o el 3. En La Vorágine ese mismo esquema chocó con la HMI (2026-10-23): si se cerraba desde la HMI, el PLC seguía viendo «abrir» desde la app. | Abierto. | `bitmask`: solo se tocan los bits 2/3 y se respetan los demás. El verbo contrario apaga el bit opuesto en la misma escritura. Nunca quedan los dos puestos. | El integrador confirma si la HMI manda por los mismos bits. Si es así, pasar `valve2` a pulso con realimentación (`pulse.feedback`), como La Vorágine. | Integrador / equipo |
| 3 | **Tolerancia y rampa provisionales.** La consigna se confirma con la apertura a ±2 % en 120 s. Son cifras puestas por nosotros, no del integrador. | Abierto. | Si la apertura no llega, el resultado es `sent` / `SENT_POSITION_PENDING` (ámbar), nunca `failed`. No hay rollback. El PLC satura fuera de 0–100, y además Aquora rechaza antes. | Del integrador: tolerancia aceptable, tiempo de recorrido 0–100 % (fija el `timeoutMs`) y rampa permitida. | Integrador |
| 4 | **`stateTrusted: true` en `valve2State` sin prueba en campo.** La app juzga la válvula de entrada por `INT_IN_CABUYO[1]` (abierta 1, cerrada 2, falla 16), según la palabra del integrador. | Abierto. | El read-back del mando sigue en `stateVerified: false`: la orden responde `sent`, no `confirmed`. Si palabra y caudal discrepan, la app lo marca como `disagreement`. | Prueba en campo con Aquora: abrir y cerrar, y comprobar la palabra y el caudal. | Equipo + Operación |
| 5 | **DN/ER/TO pendientes.** La `connection` de Cabuyo está `unmapped` (`MSG_READ_CABUYO` sin los GUID de done/error/timeout). | Abierto. | La frescura se juzga por la regla general (`live`/`stable`/`frozen` según cambien los datos). Sin la conexión mapeada, el interlock no ve si la MSG falla, solo si los datos dejan de moverse. | Pedir al integrador los GUID de DN/ER/TO de la MSG primaria y mapearlos. | Integrador |
| 6 | **GUID copiados a mano.** Los 6 NodeId de Cabuyo salieron de la ficha, sin lectura del PLC real. | Abierto. Verificar al desplegar. | Validados contra el emulador local (`optix-local`): 44/44 NodeIds resueltos, ninguno `faulted`. Eso prueba que el mapping es coherente, **no** que los GUID sean los del PLC real. | Al desplegar, revisar en el log del backend «NodeIds resueltos: N/N (faulted: 0)» y que no aparezca `BadNodeIdUnknown` en Cabuyo. Si se puede, hacer un browse de solo lectura (`ReadOnlySession`) por la VPN antes de desplegar. | Quien despliegue |
| 7 | **Test inestable de web push.** `apps/mobile/services/web-push-registration.test.ts` falla de vez en cuando (2 de 10 corridas con la CPU cargada). | Diagnosticado. Sin arreglar. | Ninguna. Afecta solo al test, no a la app. | En el fixture, `login()` arma el JWT con `exp: Date.now()`. Si cambia el segundo entre los dos `login()`, las dos pestañas tienen tokens distintos y la primera no envía la petición. Arreglo: un `exp` fijo en el fixture. | Equipo |
| 8 | **`npm run generate:mapping` es destructivo.** Regenera `opc_mapping.json` desde cero: borra las válvulas (incluida la consigna) y devuelve el nsUri a `AQUATECH`. | Abierto (conocido). | Está advertido en la ficha, en `CONSIGNA_VALVULA_PROPORCIONAL.md` y aquí. `generate-mapping.ts` ya conoce los sitios de Cabuyo, pero no sus válvulas. | No correrlo. Si hace falta regenerar, reponer a mano las válvulas y la consigna, y revisar el diff entero. | Equipo |
| 9 | **Consigna apagada hasta la autorización.** La consigna estuvo apagada (`writable: false`) a la espera de Operación. | **Cerrado el 2026-11-13:** autorizada por Operación, `writable: true`. | Mientras estuvo apagada, el backend rechazaba `setpoint` con `404 TARGET_NOT_WRITABLE` y la app mostraba «Consigna pendiente de autorización de Operación». Siguen abiertos los riesgos 1 y 3: la primera orden real, con Operación presente. | Cómo apagarla si hiciera falta: `docs/CONSIGNA_VALVULA_PROPORCIONAL.md`. | Operación |

## Cómo se cierra un riesgo

1. Se hace lo que dice «Pendiente» (entrega del integrador, prueba en campo, arreglo).
2. Se actualiza el mapping, la ficha o el doc que corresponda.
3. Aquí se mueve la fila a «Cerrados», con la fecha y quién lo cerró.

## Cerrados

(ninguno todavía)
