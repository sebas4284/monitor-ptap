# Configuración SMTP interactiva

Ejecutar únicamente después de confirmar en el proveedor el hostname SMTP, un buzón
autorizado y su contraseña. El script usa SMTP autenticado por TLS implícito en el
puerto 465, comprueba certificado y autenticación con `verify()` y no envía correo.
No permite argumentos con secretos ni desactivar la validación TLS. La contraseña
se escribe oculta directamente en la terminal del usuario; no introducirla en el chat.

En una terminal SSH interactiva del usuario `xpertic_app`, desde el repositorio:

```sh
cd /home/xpertic_app/monitor-ptap
/home/xpertic_app/.local/node-v26.12.1/bin/node tools/vm/ptap-configure-smtp.cjs
```

Tras verificar, reemplaza `.env` atómicamente con permisos 0600 y conserva un respaldo
privado `.env.bak-smtp-*` (también 0600). Los temporales `.env.bak-smtp-tmp-*` y los
respaldos están excluidos por el patrón existente `.env.bak*` del repositorio.
Rechaza archivos simbólicos, propietarios
distintos, cambios simultáneos y valores no representables de forma exacta en dotenv.
El respaldo contiene secretos: conservarlo en el servidor y aplicar la política de
retención correspondiente. No subirlo al repositorio ni compartir su contenido.

El script no reinicia PM2 ni cambia `REQUIRE_EMAIL_VERIFICATION`. Coordinar la
activación con el responsable del despliegue; comprobar la salud de la API y realizar
una prueba de entrega sólo al destinatario expresamente autorizado. `verify()` no
demuestra que el proveedor permita el remitente ni que el destinatario reciba el mensaje.

Referencias consultadas: documentación [Expo SDK58](https://docs.expo.dev/versions/v58.0.0/),
[Nodemailer10.2.0](https://github.com/nodemailer/nodemailer/blob/v10.2.0/README.md) y
código instalado de Nodemailer10.2.1 (`smtp-transport.verify`, `smtp-connection.requireTLS`).
Runtime de producción observado: Node26.12.1, Nodemailer10.2.1 y dotenv18.0.9.

Verificación sintética local:

```sh
node --test tools/vm/ptap-configure-smtp.test.cjs
```

Las comprobaciones de permisos y renombrado se ejecutan sólo en Linux.
