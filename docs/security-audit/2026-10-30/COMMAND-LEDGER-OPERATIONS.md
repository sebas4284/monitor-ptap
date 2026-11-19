# Activación y recuperación del checkpoint de maniobras

El checkpoint es un archivo autenticado HMAC fuera de MySQL. Conserva cantidad,
último sello e identidad de la última maniobra, para detectar también el borrado
de toda la tabla. Una cuenta que solamente puede editar MySQL no debe poder
escribir este archivo, su directorio ni el secreto del proceso API.

`COMMAND_CHECKPOINT_PATH` selecciona un archivo persistente fuera del repositorio,
directorio público, volumen de MySQL y respaldos accesibles a la cuenta de BD.
Por defecto se usa `%LOCALAPPDATA%/monitor-ptap/command-ledger/checkpoint.json`
en Windows; sin LOCALAPPDATA, `~/.local/state/monitor-ptap/command-ledger/checkpoint.json`.
Todos los procesos firmantes deben usar el mismo archivo y el mismo secreto.
No usar discos efímeros ni archivos independientes por instancia. Para varios
hosts se requiere diseñar un almacén de confianza coordinado; no está implementado.

En POSIX se solicitan modos 0700 para el directorio y 0600 para archivos nuevos.
Estos modos no ajustan directorios preexistentes ni garantizan ACL en Windows.
Antes de producción, el administrador debe aprovisionar y comprobar permisos
del sistema operativo para la identidad del servicio y administradores de
respaldo; la identidad de MySQL no debe tener acceso. No se modificaron ni
verificaron ACL del equipo de producción durante esta corrección.

## Primer establecimiento: acción administrativa explícita

Sin checkpoint válido **no se firma y no se declara íntegro el histórico**.
El arranque nunca adopta automáticamente el contenido actual de MySQL.
Esto exige un paso de activación antes de habilitar maniobras productivas:

1. Detener los productores de maniobras y API para que el libro quede quieto.
2. Conservar una copia de evidencia del histórico; revisar firmas, cantidad y
   último sello contra evidencia independiente disponible. Antes del primer
   checkpoint no se puede demostrar que no hubo un borrado anterior: aceptar
   este límite requiere revisión humana, nunca una lectura automática de BD.
3. Proveer al proceso administrativo, desde el mecanismo autorizado de secretos,
   `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD`, `COMMAND_SIGNING_SECRET` y
   `COMMAND_CHECKPOINT_PATH`. `DB_PORT` es opcional (3306). La herramienta no
   lee `.env` y exige destino e identidad explícitos.
4. Desde `apps/api`, ejecutar con las dependencias ya instaladas:

   ```powershell
   $env:TSX_TSCONFIG_PATH='tsconfig.test.json'
   node --import tsx scripts/accept-command-ledger-baseline.ts --count=0 --tip=GENESIS --accept-reviewed-history
   ```

   Este ejemplo sirve **únicamente para un libro vacío revisado**. Para un libro
   existente sustituir `--count=0` y `--tip=GENESIS` por cantidad y último HMAC
   completo de 64 caracteres obtenidos de la evidencia revisada. La herramienta
   comprueba todas las filas y sus HMAC; no modifica MySQL, no inventa firmas
   antiguas y no reemplaza un checkpoint existente, aunque esté corrupto.
5. Conservar la aceptación y evidencia por separado. Arrancar API con la misma
   ruta/secreto y exigir `verificable=true`, `integra=true` en la comprobación.

Las filas históricas sin firma bloquean esta aceptación. Necesitan investigación
y un plan de migración revisado que preserve originales y el límite de evidencia;
esta herramienta no permite ocultarlas ni presentar firmas nuevas como antiguas.
La alternativa explícita para conservar un legado sin firma y activar sólo el
seguimiento futuro está descrita en [la revisión productiva y frontera v2](../2026-10-31/LEDGER-PRODUCTION-REVIEW.md).
Las reservas `pending` también bloquean el baseline: detener productores y
resolverlas antes de la aceptación. En verificaciones normales, una reserva
pendiente sin firma todavía no es una maniobra finalizada y no genera alarma;
una firma previamente anclada retirada y marcada pendiente sí rompe el
contador/sello del checkpoint. Una reserva que nunca se finaliza requiere
seguimiento operativo del flujo de comandos; no es un historial ya firmado.
La herramienta no fue ejecutada contra ninguna base real en esta corrección.

## Fallos y recuperación

Las firmas se ordenan por enlaces, no por ID: la terminación de dos comandos
puede ocurrir en orden distinto de su creación. Una cola serializa operaciones
en un proceso; un archivo `.lock` creado exclusivamente evita escritores
simultáneos entre procesos. Contención entre procesos devuelve firma nula o
verificación no disponible; no existe modo de continuar sin bloqueo. Usar un
único proceso firmante evita esa pérdida de disponibilidad por contención.

Un `.lock` abandonado tras una caída requiere detener los procesos y revisión
administrativa antes de retirarlo. No se eliminan bloqueos por antigüedad.
La falta de firma se conserva como anomalía; no se oculta al verificar.

Se escribe un temporal, se sincronizan sus bytes y se reemplaza el checkpoint
mediante rename en el mismo directorio, conservando el anterior hasta ese paso.
MySQL y filesystem no tienen un commit conjunto: una caída después del commit
SQL y antes del reemplazo deja una divergencia detectable. No se repara ni
restablece automáticamente desde la BD. Conservar archivo, temporales, tabla y
logs para reconstruir con evidencia independiente. El comportamiento ante
corte eléctrico, durabilidad del directorio y semántica del filesystem de
producción no se demostraron con las pruebas locales.

El detector emite notificaciones para anomalías con planta conocida, incluso
borrado total usando la identidad conservada en el checkpoint. Si el checkpoint
no puede autenticarse o leerse, registra un error de integridad no verificada;
sin una planta confiable no inventa un destinatario. Monitorizar ese error en
operación. La API devuelve `integra=false` para esta incertidumbre.

Este mecanismo no protege frente al compromiso simultáneo del host/secreto y
MySQL, ni frente a restaurar ambos a un estado anterior autenticado. Rotar el
secreto o perder el checkpoint requiere un procedimiento de recuperación
revisado; nunca borrar el archivo para aceptar de nuevo el estado de la BD.

## Verificación local realizada

Pruebas con tablas sintéticas y directorios temporales ejercitan la implementación
real de servicio, HMAC, archivos, controlador y detector; no conectan DB/PLC.
La comprobación con SQL real, ACL productivas, varios procesos reales, cortes
eléctricos y carga productiva queda pendiente para una validación autorizada.
