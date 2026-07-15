# Confiar el certificado de cliente del gateway en FactoryTalk Optix

Contexto: `docs/SECURITY_FINDING_P0.md` (el servidor acepta hoy Anonymous + `SecurityPolicy=None`).
Este documento cubre el lado del **backend** de la migración a una sesión autenticada y cifrada
(Fase 4) — cambiar el servidor sigue siendo responsabilidad del administrador OT de la planta.

## 1. Dónde vive el certificado del cliente

El backend (`OpcUaConnectivityAdapter`) usa `node-opcua`'s `OPCUACertificateManager` con
`rootFolder = apps/api/pki` (gitignored). En la **primera conexión**, si no existe, genera
automáticamente:

- Certificado: `apps/api/pki/own/certs/client_certificate.pem`
- Llave privada: `apps/api/pki/own/private/private_key.pem`

Estos archivos identifican al gateway ante cualquier servidor OPC UA que exija un canal
autenticado (`SecurityMode=Sign` o `SignAndEncrypt`), sea con identidad `username` o `certificate`.

## 2. Confiar el certificado del SERVIDOR (Optix → gateway)

Con `OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=true` (solo para el bootstrap inicial, **nunca** en
producción contra la planta), el cliente acepta automáticamente el certificado que presente el
servidor la primera vez y lo copia a `apps/api/pki/trusted/certs/`. Procedimiento recomendado:

1. Poner `OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=true` temporalmente y arrancar el backend una vez
   contra el servidor real, en una ventana de mantenimiento coordinada con la planta.
2. Verificar que el certificado que quedó en `apps/api/pki/trusted/certs/` corresponde
   efectivamente al servidor de Optix (huella/fingerprint, emisor) — no aceptarlo a ciegas.
3. Volver `OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=false`. De ahí en adelante, un certificado de
   servidor distinto (MITM, servidor equivocado, cert rotado sin aviso) cae en
   `apps/api/pki/rejected/certs/` y la conexión falla en vez de aceptarse en silencio.

## 3. Confiar el certificado del GATEWAY (gateway → Optix)

FactoryTalk Optix, del lado servidor, también exige confiar el certificado del cliente antes de
aceptar su canal seguro (comportamiento estándar OPC UA — un certificado de cliente desconocido
se rechaza salvo que el administrador lo mueva a la lista de confiables). Pasos:

1. Copiar `apps/api/pki/own/certs/client_certificate.pem` (generado en el paso 1) y entregarlo al
   administrador OT de la planta, o transferirlo directamente a la carpeta de certificados
   confiables de Optix (ubicación depende de la instalación — típicamente un directorio
   `PKI/trusted/certs` bajo la configuración del servidor OPC UA de Optix).
2. El administrador de Optix debe mover/aprobar ese certificado en su almacén de confiables.
3. Con el certificado confiado en ambos sentidos (pasos 2 y 3), la sesión con
   `OPC_SECURITY_MODE=SignAndEncrypt` puede establecerse sin `automaticallyAcceptUnknownCertificate`.

## 4. Combinación de `.env` recomendada para el estado final

```
OPC_SECURITY_MODE=SignAndEncrypt
OPC_SECURITY_POLICY=Basic256Sha256
OPC_IDENTITY=certificate        # o username, según lo que la planta emita primero (ver P0 §4)
OPC_AUTO_ACCEPT_UNKNOWN_CERTIFICATE=false
```

`OPC_IDENTITY=username` requiere además `OPC_USERNAME`/`OPC_PASSWORD` provistos por la planta.
Ambas identidades (username, certificate) fueron probadas de punta a punta contra un servidor
OPC UA local real en `apps/api/test/opcua-security-switch.test.ts` — la conmutación es enteramente
por `.env`, sin tocar código (regla 8).

## 5. Verificación

- `apps/api/pki/` nunca se commitea (contiene material privado). Confirmar que sigue en
  `.gitignore` antes de cualquier commit tras generar certificados.
- Si `apps/api/pki/own/` se borra o se mueve a otra máquina, el gateway genera un certificado
  **nuevo** en el siguiente arranque — hay que repetir el paso 3 (Optix ya no reconocerá el
  certificado anterior).
