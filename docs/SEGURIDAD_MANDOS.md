# Seguridad y trazabilidad del mando de válvulas

## Registro de una maniobra

El servidor obtiene la identidad de la cuenta autenticada, no del cuerpo enviado por el navegador.
Los permisos y el ámbito de planta se comprueban antes de actuar. `WriteService` valida el destino,
la orden, la seguridad del canal y los interlocks. Reserva `command_log` antes de escribir;
si falla esa reserva no se envía la orden. Los tiempos, bits y condiciones del PLC salen del mapping.

`command_log` conserva usuario, correo, rol, IP, planta, válvula, verbo, fecha, estado y valores.
`audit_log` registra el intento y la petición HTTP, incluidos los rechazos. El detalle de
`command.execute` incorpora `request` con:

- `requestId`: UUID generado por el servidor y devuelto en `X-Request-ID`. No se toma de una cabecera del cliente.
- `peerIp`: IP del extremo conectado directamente a la API, incluso si existe un proxy.
- `userAgent`: agente declarado por el navegador, limitado a 512 caracteres y sin controles.

La columna `ip` usa `req.ip`, resuelto según los proxies autorizados. Una IP identifica una conexión,
no demuestra la identidad de un equipo; varios dispositivos pueden compartir NAT. `userAgent`
se puede falsificar y sirve solo como contexto. No se registran tokens ni contraseñas.

Las firmas encadenadas y el checkpoint de maniobras conservan su formato histórico. Los nuevos
metadatos HTTP no forman parte de esa firma: no debe afirmarse que toda la auditoría está sellada.
La cuenta de base de datos, sus permisos, el secreto y el checkpoint externo requieren protección
en la VM. No se recalculan ni se aceptan firmas históricas automáticamente.

## IP detrás de un proxy

`TRUSTED_PROXY_CIDRS` está vacío por defecto: la API ignora `X-Forwarded-For` para atribuir la IP.
Si hay nginx, definir exclusivamente la IP o CIDR del proxy autorizado; por ejemplo, `127.0.0.1,::1`
solo si esa es la topología comprobada. Se rechazan conteos de saltos, nombres genéricos y redes `/0`.
No confiar en toda la red de Docker por comodidad.

En la VM debe impedirse que los clientes eludan el proxy y nginx debe sobrescribir las cabeceras
de origen correctamente. La prueba local demuestra el comportamiento del código; la cadena real
de proxies y la IP final deben comprobarse desde un cliente autorizado en la VM.

## Límite de peticiones

`POST /api/plants/:plantId/commands` tiene un límite específico por IP:
`COMMAND_RATE_LIMIT_MAX=60` dentro de `COMMAND_RATE_LIMIT_WINDOW_MS=60000`.
El exceso responde 429 y crea `command.rate_limited` con IP e identificador de petición.
Ese rechazo ocurre antes de autenticar, por lo que no se atribuye a un usuario todavía no validado.
OPTIONS no consume este cupo. El límite no cambia el sostenido de una orden ni libera salidas del PLC.

El contador es de memoria por proceso; varios procesos necesitan una decisión de limitación común
en el proxy. Calibrar el cupo según usuarios que compartan una IP. Nunca implementar reintentos
automáticos de una maniobra simplemente porque recibió 429.

## Verificación local

`test/command-http-security.test.ts` comprueba cabeceras falsificadas, proxies permitidos,
metadatos acotados y rechazo auditado por exceso. `test/commands-e2e.test.ts` comprueba
abrir/cerrar y atribución a operador, jefe y administrador con un adaptador en memoria.
Las suites de comandos, firmas, RBAC y simulación conservan sus comprobaciones independientes.
Ninguna de estas pruebas necesita PLC ni permisos para operar plantas reales.
