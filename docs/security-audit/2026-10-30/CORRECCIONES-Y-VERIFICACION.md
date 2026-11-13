# Correcciones y verificación — 30 de octubre de 2026

Se corrigieron en el repositorio los seis defectos de aplicación, la excepción que autorizaba escrituras OPC inseguras y el problema reproducido de deepmerge. **La verificación es local; estos cambios no fueron desplegados ni configuran por sí solos el PLC.** Cloudflare quedó aplazado expresamente por el usuario; el certificado gratuito se abordará después mediante ese plugin.

El [informe original](INFORME.md), sus reproducciones y `results.json` se conservan como evidencia del estado anterior. No representan el resultado posterior a estas correcciones.

## Qué cambió y qué lo comprueba

| Hallazgo | Corrección | Evidencia actual |
|---|---|---|
| SEC-01 | El socket requiere `view_dashboard` obtenido de la cuenta vigente. Civil y roles inválidos no reciben el detalle. | `apps/api/test/gateway-security.test.ts`, `gateway-auth.test.ts`: Civil, otra planta y acceso autorizado. |
| SEC-02 | Resolver de identidad actual en el arranque completo, comprobación antes de suscripción/entrega, desconexión al vencer JWT y al cambiar estado/ámbito. Revisión de conexiones ociosas cada 30 s. Sin resolver falla cerrado. El demo continúa sin BD, pero no puede ejecutarse en producción. | Regresiones con tokens reales; reloj simulado para expiración. Integración real de Nest/Socket.IO en loopback con cuenta ficticia: primer snapshot autorizado, revocación y desconexión antes del siguiente dato. |
| SEC-03 | Checkpoint autenticado fuera de MySQL con cantidad y último sello; detección de cola borrada, tabla vacía y firmas ausentes. Falta/corrupción de checkpoint nunca significa «íntegro». Se serializan operaciones y el reemplazo de checkpoint es atómico. Reservas pendientes legítimas no producen falsas alarmas. | `apps/api/test/command-ledger.test.ts`: 20 regresiones con servicio, HMAC, filesystem temporal y frontera SQL simulada. Controlador/detector incluidos. |
| SEC-04 | Salida/cambio de cuenta cancela consultas, limpia cachés y streams. Respaldos offline aislados por usuario, rol y planta; sin hidratación previa a sesión. Generaciones invalidan escrituras/lecturas/401 tardíos y se evita logout recursivo. | 19 regresiones nuevas en `last-snapshot-store.test.ts`; 197 pruebas del móvil. Android/web usan almacenamiento simulado y lógica real; no se afirma prueba visual nativa. |
| SEC-05 | Registro nuevo/duplicado devuelve el mismo 201 y mensaje genérico; duplicados no cambian cuentas ni emiten credenciales. Registro y reenvío no esperan SMTP, evitando la señal fuerte de latencia. Usuario inexistente también realiza trabajo Argon2 en login. | Pruebas de registro/login/reenvío, incluido SMTP bloqueado. No se certifica igualdad estadística de todos los tiempos posibles. |
| SEC-06 | Se eliminan enlace/cuerpo/token de logs de consola y la impresión de contraseña demo. SMTP incompleto falla sin degradarse a consola; en producción no se permite ese transporte. Fallos de envío solo auditan resultados sanitizados. | Pruebas con credenciales sintéticas, transporte de correo simulado y ejecución del script de siembra con dependencias ficticias. |
| OT-01 | `allowInsecureWrites` ya no establece `secure=true`, tampoco en el simulador. El I/O real exige escritura habilitada y sesión autenticada/cifrada. El helper administrativo antiguo solo permite deshabilitar, nunca reactivar la excepción. | `insecure-write-regression.test.ts`: rechazo del flag y del I/O inseguro. Servidor OPC UA local real: lectura/escritura con SignAndEncrypt+usuario. Bash: sintaxis válida; habilitación antigua rechazada con exit 2 antes de leer/cambiar configuración. No se ejecutó `--revertir`. |
| DEP-01 | Copia local atribuida de deepmerge `4.3.1-ptap.1`, filtrando `__proto__`, `constructor`, `prototype` en origen y destino. Override reproducible para Expo, con licencia MIT y procedencia preservadas. | Cuatro regresiones de resolución real, contaminación de prototipo, compatibilidad y merge Expo. Instalación limpia temporal offline sin scripts y esas cuatro pruebas también aprobadas. Export web completo aprobado. |

No se afirma una corrección oficial upstream de deepmerge. Se trata de un parche local acotado; [el aviso público](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) no ofrece versión corregida al momento de la consulta. Procedencia y límites: [vendor/deepmerge](../../../vendor/deepmerge/README.md).

## Comprobaciones finales

| Comando/operación | Resultado |
|---|---|
| `npm test` | **875/875 aprobadas**: 4 dependencias, 674 API y 197 móvil. `@ptap/shared` no tiene suite propia. [Salida](tests-final.log). |
| `npm run typecheck` | Aprobado para los tres workspaces con sus configuraciones oficiales. [Salida](typecheck-remediation.log). |
| `npm run lint` | Exit 0: 0 errores; 93 advertencias API y 2 móvil. No se declara ausencia de advertencias. [Salida](lint-remediation.log). |
| ESLint de fuentes finales modificadas de auth/gateway/wiring | Aprobado. |
| `npm run build` | Aprobado: shared y API. [Salida](build-remediation.log). |
| Expo v58 `export --platform web` | Aprobado, con telemetría y carga de `.env` deshabilitadas. [Salida](web-build-remediation.log). |
| Registros Telcobras de decisión/procedencia | Válidos estructuralmente; esto no equivale a certificar producción o permisos externos. |
| `git diff --check` | Aprobado. Cambios previos del usuario conservados. |

Se observó fallo antes de corregir los comportamientos adversarios y aprobación después (ciclo rojo/verde de Superpowers). La primera ejecución amplia registró 662/667: una prueba de latencia excedió 50 ms bajo paralelismo masivo, tres expectativas del simulador seguían el mapping anterior y una escritura OPC local dependía de la excepción retirada. [Evidencia inicial](api-tests-remediation.log).

Las pruebas del simulador se alinearon con cambios existentes en el mapping (`1a98cfe`): escrituras absolutas sostenidas y confirmación del eco del canal, preservando expresamente `stateVerified=false`, exclusión de direcciones, ausencia de limpieza y pruebas de concurrencia. No se cambió el mapping productivo ni se hizo pasar un eco de comando por confirmación de movimiento físico. La prueba OPC se migró a una sesión cifrada autenticada real. Se acotó el paralelismo de archivos a dos, también en CI; se mantuvo el presupuesto de latencia de 50 ms, que pasó.

### Diagnóstico adicional que no está verde

El comando adicional `tsc -p apps/api/tsconfig.test.json --noEmit`, que no forma parte del `npm run typecheck` del proyecto, sigue devolviendo errores de tipado en fixtures/auxiliares existentes. [Salida completa](test-types-diagnostic.log). Afecta a `read-opcua-node.ts`, `audit-middleware.test.ts`, `bridge-recovery.test.ts`, `bridge.test.ts`, `commands-e2e.test.ts`, `diagnostics.test.ts`, `login.test.ts`, `rbac-e2e.test.ts`, `resolve-namespaces.test.ts`, `rest-cache-latency.test.ts`, `sim-plc.test.ts`, `valve-state-observer.test.ts` y `write-service.test.ts`. Entre ellos hay campos obligatorios omitidos en dobles, firmas de constructor antiguas y un cast de enum. No se presentan estas comprobaciones como aprobadas. Las pruebas de ejecución y la comprobación oficial de tipos de aplicación sí pasan.

## Condiciones antes de desplegar

1. **OPC UA:** coordinar con Operación `SignAndEncrypt`, identidad autenticada y confianza de certificados. Con el PLC todavía anónimo/sin cifrar, el código nuevo permite lectura pero **rechazará comandos**, aunque el flag antiguo continúe en `.env`. No se tocaron flags ni equipos reales. La exposición directa del servidor PLC requiere una comprobación y configuración OT aparte; no se declara cerrada con estas pruebas del gateway.
2. **Libro firmado:** aprovisionar un directorio persistente con permisos separados de MySQL, fijar `COMMAND_CHECKPOINT_PATH`/secreto y establecer una baseline revisada mediante la herramienta explícita. Sin ella no se firman nuevas maniobras ni se declara íntegro el libro. No se adopta automáticamente el contenido de BD. [Procedimiento concreto](COMMAND-LEDGER-OPERATIONS.md).
3. **Correo:** configurar SMTP real antes de exigir verificación de correo en producción. Los intentos de envío en segundo plano son de un solo intento y en memoria; un reinicio/fallo requiere el reenvío existente. La aprobación administrativa se conserva.
4. **Secretos ya expuestos:** revisar acceso/retención de logs anteriores y rotar credenciales demo o enlaces aún vigentes que hayan quedado allí. Eliminar la futura impresión no borra una exposición histórica. No se leyeron ni rotaron secretos reales.
5. **Cloudflare/certificado:** aplazado por indicación del usuario. Las llamadas de identificación/búsqueda fallaron con `Unknown tool`; ninguna configuración de cuenta o certificado fue alterada.

El checkpoint protege frente a un atacante con escritura en MySQL que no controla el host/clave/checkpoint. No protege un compromiso simultáneo ni un rollback coordinado de ambos almacenes. Permisos de producción, recuperación tras cortes eléctricos y despliegue real no se probaron.

La revisión automática bloqueó la eliminación de la instalación temporal de prueba con el único motivo indicado `blocked by policy`; se conserva en `C:/Users/User/AppData/Local/Temp/monitor-ptap-dep-proof-2c9a03e4c1df4f849e087abdae21b2e8`. No se afirma que esa carpeta haya sido limpiada.
