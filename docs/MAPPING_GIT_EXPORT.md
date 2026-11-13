# Exportación administrativa del mapeo a Git

`POST /api/opc/mapping/git` exige JWT y `system_config`. No recibe opciones del cliente.
Está deshabilitado por defecto; este cambio no crea credenciales ni habilita la integración real.
No despliega, reinicia procesos, conecta al PLC ni cambia los overrides/runtime.

Antes de habilitarlo, el administrador debe registrar en GitHub una deploy key SSH de escritura
limitada exclusivamente a este repositorio y revisar el transporte. No se admiten tokens ni HTTPS.
La clave privada debe permanecer fuera del repositorio con permisos POSIX exactamente `0600`.
La activación en Windows se rechaza porque estos permisos no se pueden comprobar allí.

Variables administrativas (ninguna viene del body):

| Variable | Contrato |
|---|---|
| `MAPPING_GIT_ENABLED` | Ausente o distinto de `true`: deshabilitado. |
| `MAPPING_GIT_DEPLOY_KEY_CONFIRMED` | `true` sólo después de registrar y revisar la deploy key. |
| `MAPPING_GIT_REPO_PATH` | Ruta absoluta a la raíz del checkout del despliegue. |
| `MAPPING_GIT_REMOTE` | URL SSH explícita `git@github.com:propietario/repositorio.git`. |
| `MAPPING_GIT_SSH_KEY_PATH` | Ruta absoluta a la clave externa `0600`. |
| `MAPPING_GIT_SSH_LAUNCHER` | Ejecutable externo privado, administrado y revisado. |
| `MAPPING_GIT_AUTHOR_NAME` | Identidad pública del commit, sin secretos. |
| `MAPPING_GIT_AUTHOR_EMAIL` | Correo público del commit, sin secretos. |

El launcher recibe los argumentos SSH de Git y debe usar exclusivamente la clave indicada,
`IdentitiesOnly`, `BatchMode` y `StrictHostKeyChecking=yes`, con host keys previamente verificadas.
Debe fijar explícitamente su archivo de known hosts y su configuración: el entorno del proceso Git
no hereda HOME, agentes SSH ni comandos/configuración Git globales. La vinculación launcher↔clave
y los permisos de escritura exclusivos del repositorio son requisitos de revisión administrativa;
el servidor valida los archivos y sus permisos, pero no interpreta el contenido del ejecutable.
No se instala ni se genera un launcher o una clave mediante este endpoint.

La rama es fija: `yosh`. Se exige un checkout completamente limpio, sin cambios staged, untracked
ni submódulos modificados, y su HEAD debe coincidir con el de la rama remota. En un clon temporal
se comprueban el JSON base cargado por el proceso, cada parche, schema y semántica del resultado.
Sólo se escribe y añade `apps/api/config/opc_mapping.json`; no se ejecutan shells, force push,
rebase, reset, hooks locales ni `git add -A`.

El commit y push ocurren en ese clon descartable. El checkout vivo, su índice y todos los overrides
permanecen intactos incluso cuando el push falla. Tras un éxito, el siguiente despliegue normal
incorpora el JSON; hasta entonces otro intento devuelve `409 GIT_DESACTUALIZADO`. Si se pierde la
respuesta del transporte después de que el remoto aceptara el push, se debe comprobar `yosh`
antes de reintentar. El endpoint nunca borra ni marca filas de overrides como aplicadas.

Un bloqueo compartido impide editar o revertir durante la publicación en el proceso API. Un lock
de filesystem impide exportaciones simultáneas del mismo checkout en el mismo host. Esta versión
requiere una única instancia API escritora; antes de usar varias instancias sobre la misma base
se necesita exclusión distribuida también para las ediciones. Tras una terminación abrupta, el lock
`ptap-mapping-git-<sha256-ruta>.lock` puede quedar en el directorio temporal; un administrador debe
comprobar que no existe una operación viva antes de retirarlo.

Respuestas de éxito: `{ status: 'publicado', commit, branch: 'yosh' }` o
`{ status: 'sin_cambios', commit: null, branch: 'yosh' }`.
La validación devuelve `400`, conflictos/concurrencia `409`, y feature deshabilitada, configuración
incompleta o fallo Git `503`. Los errores Git no exponen stderr ni datos del transporte en la API.

Las pruebas de `apps/api/test/mapping-git.test.ts` utilizan exclusivamente repositorios temporales
y un remoto bare local. No acreditan permisos GitHub, deploy key, conectividad SSH ni producción.
