# Auditoría de seguridad de Monitor PTAP — 30 de octubre de 2026

Se identificaron **seis fallos de aplicación**, reproducidos mediante lógica del código actual con dependencias simuladas. Además se verificó la existencia del bypass de seguridad OPC UA ya documentado y una dependencia con aviso público vigente. No se modificó el funcionamiento de la aplicación ni se operó el PLC.

La prioridad práctica es corregir la autorización del canal en tiempo real y comprobar con Operación si continúa activa la excepción de escritura sin cifrado.

## Alcance y evidencia

- Base: commit `ffaad3844e321825959498496282c06316fd3945`, más el árbol de trabajo presente. Los cambios previos del usuario en `docs/RUNBOOK_PRODUCCION.md` y `tools/vm/ptap-install-renewed-tls.sh` se conservaron. Este último no se ejecutó ni se examinó como parte del informe.
- Revisión dirigida: API NestJS, autenticación, permisos, Socket.IO, comandos y firmas, almacenamiento móvil/web, notificaciones, consultas SQL, rutas de archivos, configuración, despliegue, CI y lockfiles.
- Versiones del lockfile: NestJS 12.3.2, Socket.IO 4.8.4, jsonwebtoken 9.0.3, Expo 58.0.20, node-opcua 2.187.16 y deepmerge 4.3.1. Runtime local de comprobación: Node 26.12.1.
- Superpowers: investigación de causa raíz y verificación antes de concluir. Control Telcobras documentado en [decision.json](decision.json), validado con su esquema local.
- [reproduce.mjs](reproduce.mjs) lee las funciones/clases revisadas, retira imports y decoradores y elimina tipos con Node. La transformación de parámetros de constructor conserva sus asignaciones. Inyecta sockets, repositorios, entorno, reloj y almacenamiento ficticios. Usa solamente módulos incorporados de Node; no importa paquetes npm ni entrypoints de la aplicación. `vm` es un mecanismo de pruebas y **no** una frontera de seguridad.
- [results.json](results.json) conserva hashes SHA-256 de los archivos ejercitados y observaciones: **11 comprobaciones coincidentes, 0 fallos del comprobador**. Son 8 reproducciones correspondientes a 6 defectos, 2 controles negativos y 1 caso OPC condicionado. Que una reproducción coincida significa que se observó el fallo, no que esté corregido.
- No se ejecutó la suite completa ni una integración real de Nest/Socket.IO/MySQL; no se leyó `.env`, no se comprobó la VM productiva ni la exposición de puertos. No hubo conexión, descubrimiento ni escritura contra equipos reales. Las consultas externas usaron identificadores públicos de bibliotecas, sin transmitir código, lockfiles o secretos corporativos.

## Hallazgos

| ID | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| SEC-01 | Alta | Civil obtiene telemetría detallada por Socket.IO | Reproducción local |
| SEC-02 | Alta | El socket conserva permisos revocados y sigue abierto tras vencer el JWT | Dos reproducciones locales |
| SEC-03 | Alta para integridad del registro | Se pueden ocultar maniobras al verificador sin conocer la clave de firma | Dos reproducciones locales; requiere escritura en BD |
| SEC-04 | Media | El cierre de sesión conserva datos de la identidad anterior | Reproducción local y revisión de cachés |
| SEC-05 | Media | Registro público permite enumerar correos | Reproducción local |
| SEC-06 | Media, condicionada al acceso a logs | Credenciales de verificación y de cuentas demo quedan en logs | Reproducción de correo y lectura de script |
| OT-01 | Crítica si sigue activo y existe acceso a la red OT | Escritura anónima sin cifrado aceptada por excepción | Código reproducido; activación histórica documentada; producción actual no comprobada |
| DEP-01 | Baja según aviso actual | deepmerge 4.3.1 afectado por CVE-2026-93753 | Lockfile y fuentes públicas; explotación en esta app no demostrada |

### SEC-01 — El permiso de lectura detallada se pierde al pasar de HTTP a Socket.IO

**Código:** [gateway](../../../apps/api/src/infrastructure/connectivity/connectivity.gateway.ts), líneas 96–108, 141–180; [matriz de permisos](../../../packages/shared/src/index.ts), línea 606; [controlador HTTP](../../../apps/api/src/modules/plants/plants.controller.ts), línea 81.

El Civil solo tiene `view_basic_status`. El endpoint HTTP de snapshot exige `view_dashboard`, pero el gateway únicamente decide si la planta solicitada coincide con la del token. Nunca exige `view_dashboard` antes de incorporar al cliente a la sala ni antes de enviarle el snapshot completo.

Una cuenta Civil aprobada, con un token legítimo, puede usar un cliente propio para enviar `opc:subscribe` de su planta. Recibe `signals`, incluidos valores de proceso que HTTP le prohíbe consultar. La app oficial evita abrir esa suscripción para el Civil; un cliente modificado puede hacerlo igualmente. No requiere falsificar el JWT ni conocer su secreto.

**Comprobación:** `SEC-01` obtuvo un snapshot con una señal ficticia aunque `hasPermission('civil', 'view_dashboard')` devolvió `false`. `CONTROL-01` confirmó que un operador sí queda bloqueado al pedir otra planta: el defecto es el permiso de detalle, no una ausencia total de ámbito.

**Corrección propuesta:** comprobar `view_dashboard` en servidor antes de permitir la suscripción y la entrega de snapshots. Si el Civil necesita tiempo real, darle un evento/DTO básico separado. Probar Civil y roles desconocidos contra todos los eventos, además de las plantas ajenas.

### SEC-02 — Revocar la cuenta y caducar el JWT no revoca un socket establecido

**Código:** [gateway](../../../apps/api/src/infrastructure/connectivity/connectivity.gateway.ts), líneas 96–123 y 177–180; [guard HTTP](../../../apps/api/src/modules/auth/guards/jwt-auth.guard.ts), líneas 46–48.

En HTTP se consulta la cuenta actual después de validar la firma. En Socket.IO se usa directamente el rol y la planta del JWT durante el handshake. No se consulta si la cuenta sigue activa y no hay un temporizador de expiración ni una reevaluación antes de difundir los datos.

Esto produce dos ventanas distintas:

1. Una cuenta desactivada o degradada puede abrir **conexiones nuevas** con su JWT anterior mientras este siga vigente. Un token emitido cuando era admin conserva en ese canal el ámbito de todas las plantas.
2. Una conexión ya admitida puede seguir recibiendo datos **después de `exp`**, hasta que se cierre o falle. El comentario del gateway que limita el problema a «como mucho 8 h» no está respaldado por el código. La expiración se comprueba cuando se verifica el token; no desconecta automáticamente un transporte ya abierto.

**Comprobación:** `SEC-02-A` contrastó el rechazo HTTP de una cuenta ausente/inactiva con la aceptación de un nuevo socket con sus claims anteriores. `SEC-02-B` adelantó el reloj simulado más allá de `exp`: el socket establecido recibió otro snapshot y el verificador solo había sido llamado una vez. Un intento de reconexión con ese mismo token vencido sí fue rechazado.

**Corrección propuesta:** resolver la identidad vigente también al conectar el canal completo; guardar identificador y vencimiento; desconectar al caducar y al desactivar/degradar/cambiar planta. Revalidar periódicamente como respaldo. Mantener el modo de demostración separado del arranque productivo. La lógica de cierre del cliente oficial no sustituye esta comprobación del servidor.

La documentación oficial de [Socket.IO v4](https://socket.io/docs/v4/middlewares/) confirma que la autenticación de conexión no se ejecuta de nuevo por cada mensaje.

### SEC-03 — El libro de firmas puede declarar íntegro un histórico recortado

**Código:** [verificador puro](../../../apps/api/src/modules/commands/command-signature.ts), líneas 99–119; [consulta de verificación](../../../apps/api/src/modules/commands/command-signature.service.ts), líneas 103–118; [respuesta de integridad](../../../apps/api/src/modules/commands/command-signature.controller.ts), línea 40; [detector periódico](../../../apps/api/src/modules/commands/signature-integrity.detector.ts), línea 58.

Las firmas HMAC encadenadas detectan modificaciones y borrados intermedios. Sin embargo, el sistema no conserva un último sello/contador esperado fuera de la tabla examinada. Por ello, un prefijo válido sigue siendo válido: borrar las últimas maniobras no rompe ninguna fila que permanezca.

Además, la consulta omite todas las filas con `signature IS NULL`. Quien pueda modificar `command_log` puede borrar los sellos o eliminar todo el tramo final firmado. El servicio devuelve `verificable: true` y cero eslabones rotos; el controlador calcula `integra: true` y el detector no emite alerta. Se puede ocultar evidencia sin recalcular HMAC ni conocer el secreto.

**Precondición:** acceso de escritura/borrado a la tabla o compromiso de una identidad de BD con esos permisos. No se encontró ni se afirma una ruta pública que permita modificarla. Es una debilidad del control diseñado expresamente para detectar alteraciones de BD.

**Comprobación:** `CONTROL-02` detectó borrar una fila intermedia. `SEC-03-A` aceptó borrar la cola y aceptar una cadena vacía. `SEC-03-B` comprobó la consulta excluyente y la respuesta favorable con cero filas firmadas; esta última prueba usa un doble de BD, no SQL real.

**Corrección propuesta:** guardar checkpoints de último sello y cantidad en un destino de confianza separado de la tabla y sus permisos, e identificar qué filas deben tener firma. Auditar faltantes/fallos de sellado y distinguir «sin evidencia suficiente» de «íntegro». Un checkpoint en la misma tabla editable por el mismo atacante no resuelve la amenaza.

### SEC-04 — La sesión termina, pero los datos quedan disponibles en el dispositivo

**Código:** [logout](../../../apps/mobile/context/AuthContext.tsx), líneas 28–42; [respaldo persistente](../../../apps/mobile/services/last-snapshot-store.ts), líneas 21–28, 61–110 y 112–139; [QueryClient global](../../../apps/mobile/app/_layout.tsx), línea 10; [bandeja](../../../apps/mobile/hooks/useNotifications.ts), líneas 11, 55 y 78.

El logout elimina el token y el usuario, pero deja los snapshots en memoria y en `localStorage`/AsyncStorage, indexados por planta sin identidad de usuario. La siguiente sesión o la siguiente hidratación puede acceder a los valores guardados por la anterior. También permanece el QueryClient global: la bandeja usa la clave `['notifications']` para todas las cuentas y devuelve datos almacenados aun cuando su consulta queda deshabilitada.

En un equipo compartido esto retiene información del usuario anterior; entre operadores de plantas distintas, la bandeja puede mostrar datos previos durante la transición o si falla la nueva petición. La persistencia local es una vía de lectura del respaldo sin pedir permiso de nuevo al backend. No implica que las claves privadas de Android se hayan roto: es una separación insuficiente de datos entre sesiones.

**Comprobación:** `SEC-04` ejecutó el cuerpo real de logout sobre almacenamiento ficticio después de guardar una señal. Se borró el token, pero permanecieron el snapshot en memoria y su clave persistida. La transición visual de React Query se identificó por lectura del código; no se ejecutó una prueba de interfaz.

**Corrección propuesta:** cancelar consultas/streams y limpiar las cachés al salir o cambiar de identidad; aislar claves de consultas y respaldo por usuario y ámbito autorizado. Si se mantiene un modo offline, definir expresamente cómo se vuelve a autorizar el acceso y cómo se borran los datos. Expo describe [AsyncStorage de SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/async-storage/) como almacenamiento persistente sin cifrado.

### SEC-05 — Es posible averiguar qué correos tienen cuenta

**Código:** [registro público](../../../apps/api/src/modules/auth/auth.controller.ts), ruta `register`; [conflicto explícito](../../../apps/api/src/modules/auth/auth.service.ts), línea 138.

El registro responde con un conflicto y «Ese correo ya está registrado» cuando el email existe. Un visitante puede probar correos candidatos y distinguirlos de un registro nuevo sin conocer ninguna contraseña. Los límites de frecuencia reducen el volumen, pero no eliminan la señal. El login también evita el trabajo de Argon2 para usuarios inexistentes, lo que merece una medición de tiempos separada; no se cuantificó ese canal durante esta auditoría.

**Impacto:** facilitar selección de objetivos, phishing y ataques de contraseña. No inicia sesión ni evita la aprobación del administrador.

**Comprobación:** `SEC-05` reprodujo la excepción con un conflicto sintético del repositorio y verificó la declaración pública de la ruta.

**Corrección propuesta:** respuestas públicas genéricas y comportamiento comparable para cuentas nuevas/existentes, con notificación privada cuando corresponda; conservar el detalle solo en auditoría interna sin secretos.

### SEC-06 — Los logs incluyen credenciales que deben permanecer privadas

**Código:** [correo](../../../apps/api/src/modules/email/email.service.ts), líneas 24, 59–75; [siembra de demos](../../../apps/api/scripts/seed-users.ts), línea 59.

El transporte de correo predeterminado imprime el enlace completo de verificación y el cuerpo del mensaje. Incluso solicitando SMTP, si faltan host/usuario/clave se degrada a ese modo y registra el token en claro. Cualquier lector de esos logs puede usar un token aún vigente para verificar la cuenta. La aprobación administrativa sigue siendo una barrera adicional.

Separadamente, el script de siembra imprime la contraseña común de las cuatro cuentas de demo, incluida la demo administradora. Si esas cuentas están activas, un lector del registro de ejecución conoce una contraseña utilizable. No se comprobó su estado en producción ni se ejecutó la siembra.

**Comprobación:** `SEC-06` solicitó SMTP con configuración ficticia incompleta y constató el enlace/token sintético dentro del objeto enviado al logger. El segundo caso se identificó por la sentencia literal del script, sin utilizar credenciales reales.

**Corrección propuesta:** fallar de forma explícita y recuperable ante SMTP incompleto en producción; reservar transporte de consola a desarrollo y evitar registrar enlaces completos. Suprimir la impresión de contraseñas, desactivar demos y rotar credenciales/tokens expuestos según la retención y el acceso reales a logs.

### OT-01 — La excepción convierte una sesión anónima sin cifrado en autorizada para escribir

**Código:** [getWriteSecurity](../../../apps/api/src/infrastructure/connectivity/adapters/opcua/opcua-connectivity.adapter.ts), líneas 714–722; [configuración](../../../apps/api/src/infrastructure/connectivity/connectivity.config.ts), líneas 149–166; [hallazgo previo](../../../docs/SECURITY_FINDING_P0.md), entrada de 2026-08-03, línea 90.

El adaptador devuelve `secure: true` si `OPCUA_ALLOW_INSECURE_WRITES=true`, aunque la sesión sea `Anonymous + None`. Si además se habilitan escrituras y se cumplen los demás controles, WriteService acepta esa condición. El nombre `secure` mezcla una garantía criptográfica con una excepción administrativa.

El documento previo registra que Operación habilitó ambos flags. La auditoría actual demuestra que el camino de excepción continúa en el código; **no certifica que esos flags sigan activos en la VM ni que el PLC mantenga hoy la misma configuración**. Los comentarios históricos sobre actuadores desconectados y verbos disponibles tampoco se toman como estado actual.

Si el PLC acepta sesiones anónimas con permiso de escritura y un atacante logra acceso a la red OT, puede intentar hablar directamente con él, fuera del JWT, RBAC y auditoría de la app. Un adversario en posición de interceptar tráfico sin protección criptográfica también puede observarlo o alterarlo. HTTPS entre móvil y API y la doble confirmación visual no protegen ese tramo API–PLC.

**Comprobación:** `OT-01` ejercitó exclusivamente el método de política con configuración ficticia. Con None/anonymous la respuesta pasó de `secure: false` a `true` al activar la excepción. Cero escrituras reales.

**Acción propuesta:** comprobar los flags y los permisos reales del servidor con Operación; planificar SignAndEncrypt, confianza de certificados e identidad autenticada, y retirar la excepción mediante un cambio operativo coordinado. No desactivar el canal en producción a ciegas como parte de una auditoría.

### DEP-01 — Aviso vigente en deepmerge, con alcance por determinar

**Código:** [lockfile](../../../package-lock.json), línea 8400; [CI](../../../.github/workflows/ci.yml), líneas 34–37.

El lockfile contiene `deepmerge@4.3.1`, transitivo de la cadena de configuración de Expo. El aviso [GHSA-gcqx-w48m-w2h4 / CVE-2026-93753](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), actualizado el 27 de octubre de 2026, clasifica el problema como **bajo**, afecta desde 4.2.0 hasta 4.3.1 y no lista una versión corregida. Se contrastó con el [reporte en el repositorio del autor](https://github.com/TehShrike/deepmerge/issues/273).

Una combinación de objetos manipulados puede introducir propiedades heredadas en el objeto resultante si la aplicación confía en ellas. La presencia de la versión afectada no demuestra que datos de un atacante alcancen esa operación en esta aplicación ni que permita ejecución de código.

**Acción propuesta:** seguir el aviso, analizar alcanzabilidad en la cadena de configuración y mantener el procesamiento de configuración externa restringido. La CI solo bloquea niveles high/critical; por ello este aviso bajo no detiene el pipeline. No se envió el árbol corporativo a `npm audit`, no se instalaron paquetes y no se afirma que este sea el único aviso posible del lockfile.

## Orden propuesto de tratamiento

1. Verificar OT-01 con Operación y corregir SEC-01/SEC-02 en el servidor, con pruebas de Civil, cuenta desactivada, admin degradado y conexión que cruza `exp`.
2. SEC-03: añadir checkpoints de confianza y un estado explícito para evidencia incompleta. SEC-04: separar y limpiar datos por identidad.
3. SEC-05/SEC-06: cerrar enumeración y filtraciones en registros. Mantener seguimiento documentado de DEP-01.

Las propuestas anteriores no se implementaron: la entrega es el diagnóstico verificable solicitado.

## Cómo repetir las comprobaciones locales

Desde la raíz del repositorio, con Node 26.12.1 y tras revisar el comprobador:

```powershell
node docs/security-audit/2026-10-30/reproduce.mjs
```

El JSON usa `matched: true` para indicar que el comportamiento observado coincide con el documentado. Al corregir un fallo, su reproducción puede dejar de coincidir: debe convertirse entonces en una prueba de rechazo seguro dentro de la suite de la aplicación. Los controles de esta entrega no certifican ausencia de otras vulnerabilidades ni sustituyen una validación productiva autorizada.
