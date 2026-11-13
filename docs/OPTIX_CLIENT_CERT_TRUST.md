# Canal OPC UA autenticado y cifrado: preparación y confianza mutua

## Excepción de red autorizada para maniobras mapeadas

El responsable de la instalación confirmó el 2026-10-31 que la red y la conexión
actuales están autorizadas y que el acceso ya fue probado desde otro equipo. Para
esa instalación se admite una excepción explícita con usuario/contraseña. Esta
autorización administrativa **no demuestra cifrado OPC UA**: `secure` sigue siendo
`false` con `None/None`, y el fallo de la prueba cifrada sigue documentado.

La excepción exige `OPCUA_WRITES_ENABLED=true`, `OPCUA_TRUSTED_NETWORK_WRITES=true`,
`OPCUA_TRUSTED_NETWORK_APPROVAL` no vacío y `OPCUA_TRUSTED_NETWORK_ENDPOINT`
exactamente igual a `OPC_ENDPOINT`. Solo admite identidad `username`; el antiguo
`OPCUA_ALLOW_INSECURE_WRITES` sigue sin autorizar nada. Una configuración nueva
mantiene la excepción desactivada por defecto.

Los permisos, el ámbito por planta, el mapeo de destinos/verbos, los interbloqueos,
la idempotencia y el registro firmado permanecen vigentes.
Los roles `operador` y `jefe` disponen de `control_valves` por la autorización del
2026-10-31; `civil` no. Cada cuenta conserva su ámbito de planta, y el acceso a
otras plantas requiere `view_all_plants`.
El probador de canales arbitrarios sigue requiriendo una sesión cifrada, incluso
con la excepción activa.
Activar esta política no ejecuta por sí mismo órdenes de apertura o cierre. Las
pruebas de software usan dobles locales y nunca accionan la instalación.

La migración cifrada descrita a continuación sigue siendo la vía predeterminada.
No habilitar autoaceptación de certificados ni atribuir confianza criptográfica a
esta excepción de red.

El preflight del 2026-10-31 confirmó que el servidor real anuncia `SignAndEncrypt`
con `Basic256Sha256`, `Aes128_Sha256_RsaOaep` y `Aes256_Sha256_RsaPss`.
El gateway sigue configurado en producción con `None/None`; esta inspección **no**
cambió configuración, reinició procesos, envió credenciales ni escribió al PLC.
La evidencia sanitizada está en
`docs/security-audit/2026-10-30/opc-production-preflight-result.json`.

## Bloqueo comprobado

El almacén `apps/api/pki/trusted/certs` del gateway no tiene certificados del
servidor; tampoco se encontró material de confianza previo en el inventario
acotado de `apps/api`, `docs` y `tools`. Un certificado obtenido por
`GetEndpoints` es un candidato, no una verificación independiente de identidad.
Por eso no se intentó autenticar contra el servidor real.

Huella SHA-256 **observada, pendiente de confirmación independiente por OT**:

```
05:D3:44:CB:04:CD:80:E0:14:3D:A4:AB:4E:AE:12:28:10:34:96:78:44:2D:DF:9B:DC:C7:05:11:B8:28:60:CF
```

Vigencia observada: 2026-08-20 a 2029-08-19. El certificado anuncia
`DNS:IOT_RURAL`; comprobar los nombres/direcciones y la URI de aplicación en la
configuración real de Optix al verificarlo. No desactivar validaciones para
resolver discrepancias.

## Intervención necesaria del administrador OT

1. Desde la consola o proyecto autorizado de FactoryTalk Optix, exportar el
   certificado **público** del servidor. Confirmar por un canal independiente su
   huella SHA-256, vigencia, URI de aplicación y correspondencia con este servidor.
   La huella mostrada por el mismo descubrimiento de red no sirve como segundo canal.
2. Obtener el certificado público existente del gateway:
   `apps/api/pki/own/certs/client_certificate.pem`. Su huella SHA-256 observada es
   `BD:B3:8A:1A:E4:A2:1F:26:32:92:59:BC:8A:5A:7C:ED:3C:6D:E2:48:7C:31:2A:D1:0B:B7:42:52:A3:5B:F2:AC`;
   vence el 2036-07-21. Aprobar ese certificado de aplicación en el almacén de
   confianza de Optix mediante su administración autorizada. No transferir
   `apps/api/pki/own/private/private_key.pem`.
3. Confirmar que la cuenta configurada del gateway puede iniciar sesión con
   `UserName` sobre `SignAndEncrypt` y dispone de los permisos de lectura/control
   requeridos. Confiar un certificado de aplicación no concede permisos de usuario;
   no cambiar a identidad `certificate` sin una identidad de usuario emitida para ello.
4. Entregar el certificado público del servidor y la huella confirmada al
   administrador del gateway mediante el canal corporativo autorizado. No usar
   `OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=true`, ni siquiera para el arranque inicial.

La versión de Optix instalada no se identificó en este trabajo; comprobar sus
instrucciones exactas antes de modificar la planta. Rockwell documenta la
[administración de certificados y claves](https://www.rockwellautomation.com/en-mde/docs/factorytalk-optix/current/installation-guide-ditamap/manage-opc-ua-certificates-and-keys.html).
Las rutas de confianza y las pantallas dependen de esa versión y despliegue.

## Preflight concreto sin modificar producción

Ejecutar desde la raíz del repositorio con el Node ya instalado en la VM:

```sh
/home/xpertic_app/.local/node-v26.12.1/bin/node tools/vm/ptap-opc-preflight.cjs
```

El modo predeterminado hace solamente descubrimiento. No abre sesión de usuario.
Una vez que OT verifique el certificado, realizar **un** intento autenticado de
lectura segura con su archivo y huella confirmada:

```sh
/home/xpertic_app/.local/node-v26.12.1/bin/node tools/vm/ptap-opc-preflight.cjs \
  --secure-read \
  --server-cert /ruta/corporativa/servidor-verificado.pem \
  --server-sha256 HUELLA_SHA256_CONFIRMADA_POR_OT \
  --policy Aes256_Sha256_RsaPss
```

La herramienta exige huella y certificado; rechaza huellas distintas, vigencia
inválida y políticas sin cifrado. Usa el certificado/llave existentes del gateway,
un almacén temporal separado y `automaticallyAcceptUnknownCertificate=false`.
Valida el certificado, fija ese certificado al canal y sólo después envía las
credenciales existentes. Lee únicamente `ServerStatus.CurrentTime` (`ns=0;i=2258`),
cierra la sesión y elimina su almacén temporal. No modifica `.env` ni el PKI de
producción; no crea suscripciones ni ejecuta escrituras/métodos. No reintenta
contraseñas. Un fallo exige diagnóstico del estado devuelto y coordinación con
OT; no habilitar autoaceptación, Anonymous o un modo inferior para sortearlo.

Prueba local real: `node --test tools/vm/ptap-opc-preflight.test.cjs` verifica
cifrado `Aes256_Sha256_RsaPss`, rechazo de pin distinto antes de autenticar,
exactamente una autenticación y conservación del almacén original. Eso no prueba
que Optix ya confíe el certificado o acepte la cuenta real.

## Cambio final durante una ventana coordinada

Sólo después de un preflight real con `authenticated=true` y lectura `Good`:

1. Importar en `apps/api/pki/trusted/certs` el certificado público confirmado,
   manteniendo copias del material y evidencia aprobados. Si existe una CA, incluir
   cadena y CRL verificadas según la política PKI aplicable. No importar la llave
   privada del servidor ni confiar todo lo observado en la red.
2. Guardar una copia protegida de la configuración actual y aplicar:

```dotenv
OPC_SECURITY_MODE=SignAndEncrypt
OPC_SECURITY_POLICY=Aes256_Sha256_RsaPss
OPC_IDENTITY=username
OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=false
OPC_ENDPOINT_MUST_EXIST=true
OPCUA_WRITES_ENABLED=false
OPCUA_ALLOW_INSECURE_WRITES=false
```

Conservar la cuenta/secreto existentes. `Basic256Sha256` es una alternativa
anunciada si OT la exige y el preflight con `--policy Basic256Sha256` pasa; no
reducir el modo `SignAndEncrypt`.

3. Reiniciar únicamente el API de forma coordinada, verificar conexión segura,
   telemetría y auditoría. El preflight no habilita ni prueba comandos al PLC.
   Mantener las escrituras deshabilitadas hasta la aceptación operativa autorizada.
   Si falla, mantener el control bloqueado; no restablecer escrituras inseguras.

`apps/api/pki` contiene la identidad privada y debe seguir fuera de Git. No borrar
ni regenerar esa identidad: cambiarla exige volver a aprobar el gateway en Optix.
