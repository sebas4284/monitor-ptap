# Revisión productiva del libro y activación mediante frontera legacy

## Evidencia observada, 2026-10-31 13:07:47 UTC

La revisión inicial de 12:58:51 UTC se repitió a 13:07:47 UTC sin cambios en los
184 registros. Se ejecutó en el entorno productivo autorizado, con dependencias ya instaladas y una transacción
MySQL de sólo lectura. No se ejecutó SQL de respaldos, no se cambiaron filas,
firmas, secretos, configuración ni procesos. No se creó checkpoint productivo.

| Observación | Resultado |
|---|---:|
| Filas | 184, IDs 1–184 |
| Filas sin firma | 156, IDs 1–156 |
| Firmas existentes | 28, IDs 157–184 |
| Reservas pendientes | 0 |
| HMAC inválidos / enlaces rotos / firmas duplicadas | 0 / 0 / 0 |
| Respaldos `.sql.gz` examinados | 16, del 17 al 31 de octubre |
| Últimos cuatro respaldos | Las 184 proyecciones selladas coinciden exactamente |
| Respaldos anteriores | Subconjuntos de 174/179 filas, sin filas cambiadas ni ausentes del vivo |

Los originales de los respaldos permanecieron intactos en el host. Se analizaron
sólo el esquema y literales `VALUES` de `command_log`, con límites de tamaño y
rechazo de expresiones/formatos desconocidos. No se restauraron ni ejecutaron.
La comparación cubre los campos del sello y las firmas originales, no todas las
otras tablas ni todos los campos operativos sin sello.

Las huellas y el último HMAC exactos están en el registro operacional privado. Esta copia pública conserva los resultados agregados y el procedimiento técnico.

Esta evidencia demuestra concordancia con observaciones guardadas, y que los 28
HMAC verifican con el secreto actual. Sin checkpoint previo no demuestra ausencia
de borrados anteriores ni autenticidad de las 156 maniobras sin firma. Los
respaldos están en el mismo host: no se atribuye autenticación externa a ellos.
La API siguió activa durante la revisión; debe repetirse con productores detenidos
antes de aceptar una frontera.

## Evidencia privada preservada

Los originales completos, manifest de revisión, huellas de datos y destino exacto se preservan fuera del repositorio público. Se observaron directorios 0700 y archivos 0600 con propietario del servicio, distinto de MySQL; la prueba efectiva bajo la identidad de MySQL no estuvo disponible. No se publican filas, usuarios, claves, tokens ni huellas de los archivos privados.

## Frontera v2: qué acepta y qué conserva

El baseline v1 conserva su rechazo a históricos sin firma. La herramienta nueva
`accept-command-legacy-boundary.ts` requiere una aceptación distinta y los valores
exactos revisados: total, cantidad sin firma, cantidad firmada, último HMAC y SHA256
de todos los hechos sellados/firmas. Nunca se invoca en el arranque ni por HTTP.

La herramienta crea, sin sobrescribir, un manifest privado autenticado HMAC en
`<COMMAND_CHECKPOINT_PATH>.legacy-boundary.json`. Conserva los campos sellados de
cada fila, sus IDs exactos, firmas/NULL originales y la lista explícita de IDs sin
firma. El checkpoint v2 autentica el hash del manifest junto con cantidad y último
sello. Las nuevas maniobras continúan desde el sello revisado; ningún registro
antiguo se borra, se vuelve a firmar ni cambia de identidad. El archivo privado
completo y los respaldos originales conservan además las columnas sin sello.

Cada comprobación compara exactamente pertenencia y contenido de la frontera.
Modificar, borrar, volver a firmar, marcar `pending` una fila legacy o introducir
un ID anterior a la frontera produce anomalía. Las nuevas firmas sólo se permiten
si frontera, cadena completa y checkpoint coinciden. El manifest no cambia al
avanzar el checkpoint; ambos deben respaldarse fuera del acceso de MySQL.

La finalización del registro y su firma comparten el turno del libro y el bloqueo
del host, después de terminar el I/O físico. Dos comandos concurrentes conservan
su estado `pending` hasta su turno; no se permite ignorar otras filas ya finalizadas
sin firma. Todas las salidas posteriores a reservar, incluidos fallos de escritura
y de realimentación, pasan por este cierre. Si no hay checkpoint o bloqueo
disponible, se conserva el desenlace una vez y se devuelve firma nula, como anomalía
visible. Una finalización que no persista no permite firmar la fila aún pendiente.
También en v1, firmar comprueba la cadena completa, no sólo su cantidad y cola.

El resultado global `integra` permanece **false** porque existen 156 registros
sin firma histórica. Se agregan resultados separados:

- `legado`: total, cantidad sin firma, conservación desde aceptación y
  `autenticidad: 'no_demostrada'`.
- `desdeActivacion`: nuevas firmas y comprobación de integridad contra la frontera
  y el checkpoint externos. En la activación serán cero nuevas firmas.

La tarjeta actualizada muestra advertencia ámbar y explica el legado. El detector
no emite alertas de alteración por el mero legado sin firma ya aceptado; sí por
cambios de frontera, firmas nuevas ausentes, enlaces/HMAC rotos o pérdida de cola.
Si manifest/checkpoint no se pueden autenticar, informa verificación no disponible.
Los clientes antiguos pueden interpretar `integra=false` como alteración; publicar
la interfaz actualizada junto con la activación evita esa interpretación errónea.

## Procedimiento de aceptación explícita y activación

No ejecutar este procedimiento únicamente porque la revisión automática haya
terminado. El responsable debe aceptar explícitamente el límite: 156 registros
históricos siguen sin autenticidad demostrada; se preservan y se vigilan cambios
futuros sobre la frontera revisada. No se atribuye a firmas nuevas valor histórico.

1. Publicar/revisar el código v2 y la interfaz correspondiente, mantener un solo
   firmante y detener todos los productores/API. No accionar válvulas como prueba.
2. Repetir revisión y conservar evidencia privada con productores quietos. Si
   cambian cantidad, último sello, digest o pendientes, revisar una nueva frontera;
   no aceptar automáticamente lo que haya entonces.
3. Aprovisionar y comprobar directorio persistente 0700, propietario del servicio,
   fuera de repositorio, web, MySQL y respaldos accesibles por MySQL. Ruta propuesta:
   `<PRIVATE_CHECKPOINT_PATH>`.
   El directorio/checkpoint no existían al revisar. Comprobar que no haya enlaces
   simbólicos, ACL amplias ni archivos de evidencia preexistentes. Inyectar la
   misma ruta/secreto en el proceso administrativo y API mediante el mecanismo
   autorizado. No rotar el secreto actual.
4. Los valores de tip/digest siguientes son marcadores públicos deliberadamente inválidos; obtener los valores completos del registro privado. Sólo si el responsable aceptó exactamente esa evidencia y sigue
   coincidiendo, desde `apps/api`, con entorno explícito inyectado (la herramienta
   no lee `.env`), ejecutar:

   ```sh
   TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx scripts/accept-command-legacy-boundary.ts \
     --total=184 --unsigned=156 --count=28 \
     --tip='REVIEWED_TIP_64_HEX' \
     --facts-sha256='REVIEWED_FACTS_SHA256' \
     --accept-reviewed-legacy-boundary
   ```

   Exige `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD`,
   `COMMAND_SIGNING_SECRET`, `COMMAND_CHECKPOINT_PATH` explícitos; `DB_PORT`
   opcional. Usar el ejecutable Node v26.12.1 autorizado del servicio.
5. Conservar aceptación, manifest, checkpoint y archivos privados por separado de
   MySQL, con 0600. Reiniciar la API con mismo secreto/ruta; comprobar sin escribir
   maniobras: `verificable=true`, `integra=false`, `rotos=[]`,
   `legado={total:184,sinFirma:156,conservado:true,autenticidad:'no_demostrada'}` y
   `desdeActivacion={firmadas:0,verificable:true,integra:true}`.

Un fallo tras crear manifest y antes de crear checkpoint deja evidencia huérfana:
se bloquea el reintento, no se borra/reconstruye automáticamente. Toda pérdida,
divergencia o restauración coordinada exige revisión administrativa. La protección
no abarca compromiso simultáneo de host/secreto y MySQL, rollback de ambos almacenes,
ni durabilidad ante corte eléctrico todavía no demostrada en este host.

## Validación local

55 pruebas de firma/libro/detector aprobadas, incluyendo regresiones v1 y nuevas
pruebas de frontera, conservación de originales, cola futura, contenido/membresía,
manifest ausente/corrupto, aceptación explícita y ausencia de falsas alertas legacy.
La revisión independiente reprodujo dos defectos de la primera implementación:
bloqueo entre finalizaciones concurrentes y aceptación de una firma nueva en v1
tras alterar una fila firmada anterior. Ambas regresiones fallaron antes de la
corrección y pasaron después; se corrigió coordinación, sin ampliar excepciones
para históricos sin firma. Una ejecución ampliada de 110 pruebas de comandos,
WriteService y HTTP también pasó. Se conserva el manifest de verificación anterior
como `ledger-v2-verification-before-review-fixes.json`; el vigente identifica los
bytes corregidos en `ledger-v2-verification.json`.
4 pruebas del parser/verificador read-only aprobadas; HMAC del helper contrastado
contra la implementación real con fixture sintético. Typecheck API y móvil y build
API aprobados. Estas pruebas usan SQL simulado y archivos temporales: no afirman
activación productiva, carga real, ACL efectivas como MySQL ni cortes eléctricos.
