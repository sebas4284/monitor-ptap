export type FaqEntry = {
  titulo: string;
  queEs: string;
  herramienta: string;
  queLeer: string;
};

/** Consulta local: abrir Ayuda no realiza pruebas de red ni maniobras. */
export const FAQ: Readonly<Record<string, FaqEntry>> = {
  'NET-01': {
    titulo: 'El dispositivo no tiene red',
    queEs: 'El teléfono o computador está desconectado.',
    herramienta: 'Comprueba WiFi, datos móviles y modo avión en el dispositivo.',
    queLeer: 'El banner indica si falta red. Reconectar el dispositivo no reinicia el PLC.',
  },
  'NET-02': {
    titulo: 'La red no tiene salida a internet',
    queEs: 'Hay conexión local, pero no navegación.',
    herramienta:
      'Abre una página conocida y revisa si la red pide iniciar sesión. Contacta al proveedor si persiste.',
    queLeer: 'Si otras páginas tampoco abren, el problema es la red del dispositivo.',
  },
  'NET-03': {
    titulo: 'El servidor no responde',
    queEs: 'El dispositivo tiene internet, pero no alcanza Aquora.',
    herramienta:
      'Conserva el código y la hora y avisa al administrador. Comprueba si otros usuarios tienen el mismo fallo.',
    queLeer: 'El administrador contrasta este aviso con SRV-01; no confirma una caída del PLC.',
  },
  'PLC-01': {
    titulo: 'Sin conexión con el PLC',
    queEs:
      'El servidor no sostiene una sesión con el PLC; el código por sí solo no localiza la falla.',
    herramienta:
      'Un administrador puede usar Ajustes → Estado de conexión → Probar ruta ahora y exportar el informe.',
    queLeer:
      'Lee las sondas: rechazo es PLC-11; host vivo y timeout es PLC-12; todo inalcanzable requiere revisar ruta/VPN/planta.',
  },
  'PLC-02': {
    titulo: 'El PLC dejó de enviar datos',
    queEs: 'Hubo sesión, pero dejaron de llegar lecturas.',
    herramienta:
      'Revisa la antigüedad del tablero y pide al administrador el diagnóstico de conexión.',
    queLeer:
      'Un valor visible puede ser antiguo. No lo uses como confirmación del estado actual de la planta.',
  },
  'PLC-03': {
    titulo: 'Namespace no resuelto',
    queEs:
      'La referencia de una señal no coincide con los espacios de nombres del servidor OPC UA.',
    herramienta:
      'Escala al administrador con planta, señal y hora; Desarrollo compara el mapping con los namespaces disponibles.',
    queLeer:
      'El informe técnico identifica el namespace faltante. Un operador no debe cambiar índices para intentar recuperar datos.',
  },
  'PLC-04': {
    titulo: 'Watchdog vencido',
    queEs: 'El puente agotó el tiempo de espera de datos y trata de recuperar la suscripción.',
    herramienta: 'El administrador revisa Estado de conexión y el historial exportado.',
    queLeer:
      'Mira si el puente vuelve a Connected y si llegan lecturas nuevas, no solo si cambió el estado.',
  },
  'PLC-05': {
    titulo: 'Heartbeat sin respuesta',
    queEs: 'Fallaron varios sondeos consecutivos y el puente intenta recuperar la sesión.',
    herramienta:
      'El administrador consulta el diagnóstico y registra duración y frecuencia del corte.',
    queLeer:
      'La recuperación debe acompañarse de datos recientes; un heartbeat responde por el enlace, no por cada sensor.',
  },
  'PLC-06': {
    titulo: 'Enlace en recuperación',
    queEs: 'El cliente OPC UA perdió el canal y está intentando reconectar.',
    herramienta:
      'Espera la recuperación y registra el código si se repite; un administrador puede exportar el historial.',
    queLeer:
      'Recovering es un estado de enlace. No representa una maniobra ni confirma lecturas actuales.',
  },
  'PLC-07': {
    titulo: 'Falló el reciclaje de sesión',
    queEs: 'Un intento de reconstruir la sesión OPC UA falló.',
    herramienta:
      'El administrador revisa el historial y la recuperación automática con Desarrollo.',
    queLeer:
      'Busca transiciones posteriores y datos nuevos. El antecedente DEF-01 está documentado como corregido.',
  },
  'PLC-08': {
    titulo: 'Falta el certificado del cliente',
    queEs: 'La identidad OPC UA exige un certificado o llave que no está disponible.',
    herramienta:
      'Escala al administrador para revisar la configuración de certificados; no compartas llaves por chat.',
    queLeer:
      'El diagnóstico de arranque identifica el archivo requerido. No desactives la seguridad para resolverlo.',
  },
  'PLC-09': {
    titulo: 'Temporización OPC inválida',
    queEs: 'La configuración de vida y keepalive no cumple la relación requerida por OPC UA.',
    herramienta: 'El administrador revisa la configuración de arranque con Desarrollo.',
    queLeer:
      'El mensaje CFG-07 indica los parámetros inválidos. No es una avería física del sensor.',
  },
  'PLC-10': {
    titulo: 'Seguridad OPC no soportada',
    queEs: 'El servidor no ofrece la política, modo o endpoint solicitado.',
    herramienta:
      'El administrador contrasta la configuración con los endpoints aprobados del servidor OPC UA.',
    queLeer:
      'No cambiar a una sesión insegura como solución. Registrar la política rechazada y escalar.',
  },
  'PLC-11': {
    titulo: 'El puerto rechaza la conexión',
    queEs: 'El equipo responde, pero el puerto OPC UA no acepta conexiones.',
    herramienta: 'El administrador usa Probar ruta ahora y entrega el informe al integrador.',
    queLeer:
      'Un rechazo TCP indica equipo alcanzable y servicio cerrado o puerto cambiado; no demuestra falta de internet.',
  },
  'PLC-12': {
    titulo: 'Puerto filtrado con host vivo',
    queEs: 'El host o puerto de control responde, pero el puerto OPC UA agota la espera.',
    herramienta: 'Exporta la prueba de ruta y pide al responsable de red revisar el filtrado.',
    queLeer:
      'Timeout con control o ping vivo apunta a filtrado del puerto. No equivale a planta sin internet.',
  },
  'PLC-13': {
    titulo: 'El equipo interno no contesta',
    queEs:
      'El control del mismo host responde y el puerto reenviado devuelve un error de inalcanzable lento.',
    herramienta:
      'Entrega el informe de ruta al integrador para revisar el equipo interno y su dirección.',
    queLeer:
      'La combinación de sondas distingue un equipo interno caído de un bloqueo. No pide abrir puertos por defecto.',
  },
  'DAT-01': {
    titulo: 'Calidad de lectura no buena',
    queEs: 'El PLC marcó la lectura con calidad no buena.',
    herramienta: 'Consulta la señal y su estado; informa al integrador con planta, señal y hora.',
    queLeer: 'Aunque haya número, la calidad impide tratarlo como una medición confirmada.',
  },
  'DAT-02': {
    titulo: 'Valor inválido',
    queEs: 'No llegó un número finito y utilizable para esa señal.',
    herramienta: 'Registra el nombre de la señal y pide al administrador revisar su buffer fuente.',
    queLeer: 'Sin dato no significa cero. No reemplaces una ausencia por un valor supuesto.',
  },
  'DAT-03': {
    titulo: 'Dato viejo por pérdida de enlace',
    queEs: 'La pantalla conserva una lectura anterior mientras el puente no aporta datos actuales.',
    herramienta:
      'Consulta la antigüedad y Estado de conexión; evita decidir una maniobra solo con ese valor.',
    queLeer:
      'El estado congelado o sin conexión expresa confiabilidad, aunque siga mostrándose el último número.',
  },
  'DAT-04': {
    titulo: 'Buffer de señal ausente',
    queEs: 'No llegó el array del PLC del que sale la señal.',
    herramienta: 'Un administrador revisa los buffers crudos y exporta el diagnóstico.',
    queLeer:
      'El buffer ausente puede afectar varias señales. Escala con la planta y los nombres afectados.',
  },
  'DAT-05': {
    titulo: 'Índice fuera del buffer',
    queEs: 'El mapping pide una posición que no existe en el array recibido.',
    herramienta: 'El administrador compara buffers crudos y mapping con el integrador.',
    queLeer:
      'El tamaño real y el índice configurado explican el fallo. No elijas otro índice por aproximación.',
  },
  'DAT-06': {
    titulo: 'Tamaño de buffer inesperado',
    queEs: 'El array recibido no tiene la longitud acordada en el mapping.',
    herramienta:
      'Entrega el diagnóstico a Desarrollo e integrador para contrastar la versión del programa del PLC.',
    queLeer:
      'El cambio de tamaño puede desplazar señales; no confirma un fallo de instrumentación.',
  },
  'DAT-07': {
    titulo: 'Lectura fuera de rango físico',
    queEs: 'El valor excede el rango de validez configurado para la señal.',
    herramienta:
      'Comprueba unidad, escala y señal; reporta al integrador sin modificar límites para ocultar el aviso.',
    queLeer:
      'Aquora conserva el número y muestra la advertencia. Fuera de rango no equivale a lectura válida.',
  },
  'DAT-09': {
    titulo: 'Lectura congelada',
    queEs:
      'La última actualización superó la ventana de frescura; stable no debe ocultar datos de días.',
    herramienta:
      'Revisa la antigüedad por señal y pide comparar timestamps de origen y muestras de entrada.',
    queLeer:
      'Un valor quieto puede ser normal solo dentro de la ventana admitida. Sin hora de origen, la frescura es indeterminada.',
  },
  'AUT-01': {
    titulo: 'Correo o contraseña incorrectos',
    queEs: 'No se pudo autenticar la combinación ingresada.',
    herramienta:
      'Revisa correo, mayúsculas y teclado. Si olvidaste la contraseña, solicita el restablecimiento al administrador.',
    queLeer:
      'No hay recuperación automática por correo. El mensaje no revela si una cuenta existe.',
  },
  'AUT-02': {
    titulo: 'Cuenta pendiente o desactivada',
    queEs: 'La cuenta no está habilitada para entrar.',
    herramienta: 'Contacta al administrador e indica tu correo registrado.',
    queLeer:
      'Verificar el correo y tener aprobación son pasos distintos. No necesitas crear otra cuenta.',
  },
  'AUT-03': {
    titulo: 'La sesión dejó de ser válida',
    queEs: 'La cuenta cambió o fue desactivada mientras había una sesión abierta.',
    herramienta: 'Vuelve a iniciar sesión; si persiste, consulta al administrador.',
    queLeer: 'El servidor comprueba el estado de la cuenta en cada petición.',
  },
  'AUT-04': {
    titulo: 'Falta permiso para la acción',
    queEs: 'El rol asignado no permite esa función.',
    herramienta:
      'Consulta Ajustes → Permisos de tu rol y solicita revisión al administrador si corresponde.',
    queLeer: 'Ver un botón no concede permiso: el servidor vuelve a comprobarlo.',
  },
  'AUT-05': {
    titulo: 'Planta fuera de tu alcance',
    queEs: 'La solicitud apunta a una planta que la cuenta no puede consultar.',
    herramienta:
      'Comprueba la planta seleccionada y solicita al administrador revisar tu asignación.',
    queLeer:
      'La asignación de planta la administra el sistema; no se resuelve alterando la dirección de la página.',
  },
  'AUT-06': {
    titulo: 'Sesión vencida o token inválido',
    queEs: 'El servidor no acepta la credencial de sesión.',
    herramienta: 'Inicia sesión otra vez; si falla, registra la hora y contacta al administrador.',
    queLeer: 'La sesión tiene vencimiento. No envíes tu token ni tu contraseña en un reporte.',
  },
  'AUT-07': {
    titulo: 'El correo ya está registrado',
    queEs: 'Ya existe una cuenta con ese correo.',
    herramienta: 'Usa la cuenta existente o pide al administrador recuperar el acceso.',
    queLeer: 'Una segunda cuenta no resuelve una cuenta pendiente o desactivada.',
  },
  'AUT-08': {
    titulo: 'Demasiados intentos',
    queEs: 'El servidor limitó los intentos para proteger el acceso.',
    herramienta: 'Espera antes de volver a intentar y verifica los datos una sola vez.',
    queLeer:
      'Reintentar repetidamente no elimina el límite. Si no reconoces los intentos, avisa al administrador.',
  },
  'AUT-09': {
    titulo: 'No puedes modificar tu propia cuenta así',
    queEs: 'La acción sobre el propio rol o desactivación está bloqueada.',
    herramienta: 'Pide al responsable autorizado revisar el cambio.',
    queLeer: 'El bloqueo evita perder la administración o cambiar privilegios sin control.',
  },
  'AUT-10': {
    titulo: 'Datos de solicitud inválidos',
    queEs: 'Falta un dato requerido o su formato no es aceptado.',
    herramienta: 'Revisa los campos indicados y reintenta; si persiste, reporta pantalla y hora.',
    queLeer: 'No incluyas contraseñas ni tokens al compartir el error.',
  },
  'AUT-11': {
    titulo: 'Registro no válido',
    queEs: 'El registro no cumple los requisitos de cuenta o formato.',
    herramienta: 'Revisa correo, contraseña, nombre, teléfono y planta indicados en el formulario.',
    queLeer:
      'La contraseña exige mayúscula, minúscula y dígito. No uses datos ajenos para superar la validación.',
  },
  'AUT-12': {
    titulo: 'Correo aún sin verificar',
    queEs: 'Una cuenta no puede activarse antes de verificar su correo.',
    herramienta:
      'El usuario debe abrir el enlace de verificación; después el administrador puede aprobar la cuenta.',
    queLeer: 'Verificación de correo y activación de cuenta son dos controles distintos.',
  },
  'AUT-13': {
    titulo: 'Enlace de verificación no válido',
    queEs: 'El enlace venció, no existe o ya fue utilizado.',
    herramienta: 'Solicita un nuevo enlace desde el flujo de registro o consulta al administrador.',
    queLeer: 'Usa el enlace más reciente. No compartas enlaces de verificación de tu cuenta.',
  },
  'AUT-14': {
    titulo: 'Administrador protegido',
    queEs: 'No puedes desactivar o degradar a otro administrador desde esta pantalla.',
    herramienta: 'Escala al responsable de administración de cuentas.',
    queLeer:
      'Promover una cuenta y desactivar a otro administrador son operaciones con controles distintos.',
  },
  'REP-01': {
    titulo: 'Informe en recolección',
    queEs: 'Ya se está preparando el informe de esa planta y métrica.',
    herramienta: 'Revisa el progreso en Reportes y espera antes de solicitar el mismo informe.',
    queLeer:
      'El informe toma muestras durante su ventana. Otras métricas pueden recolectarse por separado.',
  },
  'REP-02': {
    titulo: 'Métrica de informe desconocida',
    queEs: 'La métrica pedida no está configurada para la planta.',
    herramienta: 'Revisa la planta y elige una métrica disponible en Reportes.',
    queLeer:
      'La lista depende del mapping de cada planta; una métrica de otra planta puede no existir aquí.',
  },
  'REP-03': {
    titulo: 'Informe aún no disponible',
    queEs: 'Todavía no existe un CSV listo para descargar.',
    herramienta: 'Consulta el estado de la recolección en Reportes y vuelve cuando termine.',
    queLeer:
      'Descarga el archivo terminado: una generación posterior reemplaza el anterior; no es un historial continuo.',
  },
  'CMD-01': {
    titulo: 'Destino no habilitado para escritura',
    queEs: 'La señal no tiene un mando autorizado en el mapping.',
    herramienta: 'Comprueba la válvula y escala al administrador; no intentes otro destino.',
    queLeer: 'Que exista una lectura no significa que se permita mandar sobre ella.',
  },
  'CMD-02': {
    titulo: 'Comando no disponible',
    queEs: 'La válvula no declara esa acción.',
    herramienta:
      'Usa solo las acciones que ofrece la pantalla y consulta al integrador si falta una.',
    queLeer: 'Abrir y cerrar son capacidades distintas. No todas las plantas declaran ambas.',
  },
  'CMD-03': {
    titulo: 'Escritura bloqueada por seguridad',
    queEs: 'La sesión no cumple las condiciones de seguridad para enviar mandos.',
    herramienta:
      'Avisa al administrador y conserva el código. No desactives los controles de escritura.',
    queLeer:
      'Una lectura disponible no autoriza una escritura ni demuestra que el canal sea seguro.',
  },
  'CMD-04': {
    titulo: 'Tu rol no permite este mando',
    queEs: 'La cuenta no tiene permiso para ejecutar el comando.',
    herramienta: 'Consulta los permisos en Ajustes y coordina con un operador autorizado.',
    queLeer: 'Los permisos de consulta y maniobra se controlan por separado.',
  },
  'CMD-05': {
    titulo: 'Condiciones de operación no cumplidas',
    queEs: 'El enlace o la lectura no cumple las condiciones necesarias para mandar.',
    herramienta: 'Revisa conexión y frescura de los datos; escala si no se recuperan.',
    queLeer:
      'El bloqueo evita operar con un puente desconectado o una lectura no actual. No se debe eludir.',
  },
  'CMD-06': {
    titulo: 'Hay un comando en curso',
    queEs: 'Ya se está procesando esa solicitud.',
    herramienta: 'Espera el resultado y comprueba planta y válvula antes de actuar de nuevo.',
    queLeer:
      'Repetir clics no confirma el movimiento y puede dificultar el seguimiento de la maniobra.',
  },
  'CMD-07': {
    titulo: 'Escritura sin confirmación',
    queEs: 'El read-back no confirmó el valor esperado.',
    herramienta:
      'Conserva el resultado y verifica por el procedimiento operativo autorizado antes de repetir.',
    queLeer:
      'Enviado no significa movimiento confirmado. Un resultado ámbar puede indicar ausencia de realimentación física; no supone éxito ni fallo mecánico.',
  },
  'SRV-01': {
    titulo: 'API no disponible',
    queEs: 'El backend no responde a la aplicación.',
    herramienta:
      'El administrador revisa el estado del servicio; el operador comunica NET-03 y la hora.',
    queLeer:
      'La página abierta puede conservar datos anteriores. HTTP 200 de la web no prueba salud de la API.',
  },
  'SRV-02': {
    titulo: 'Base de datos no disponible',
    queEs: 'El servicio no puede acceder a MySQL.',
    herramienta: 'Escala al administrador para revisar salud y conexión de la base de datos.',
    queLeer:
      'Puede impedir acceso, auditoría o comandos. No tomes una sesión visible como prueba de que la base funciona.',
  },
  'SRV-03': {
    titulo: 'Puerto del servicio ocupado',
    queEs: 'Otro proceso ocupa el puerto de arranque.',
    herramienta: 'Desarrollo revisa qué proceso lo utiliza antes de reiniciar servicios.',
    queLeer: 'No cierres procesos desconocidos desde el equipo del operador.',
  },
  'SRV-04': {
    titulo: 'Autenticación del canal de datos',
    queEs:
      'El canal en vivo exige una sesión válida; el catálogo registra la corrección de su autenticación.',
    herramienta:
      'Si no llegan datos tras entrar, vuelve a autenticarte y reporta la hora si persiste.',
    queLeer:
      'Este código histórico no indica por sí mismo una vulnerabilidad actual ni permite desactivar autenticación.',
  },
  'SRV-05': {
    titulo: 'Acceso a métricas rechazado',
    queEs: 'El token de monitorización no fue aceptado.',
    herramienta: 'El administrador revisa la credencial del monitor sin publicarla en informes.',
    queLeer: 'Un 401 de métricas es un control de acceso; no demuestra que el PLC esté caído.',
  },
  'SRV-06': {
    titulo: 'Fallo de base de datos durante un mando',
    queEs: 'No se pudo reservar o finalizar su registro de auditoría.',
    herramienta:
      'Reporta el identificador del comando al administrador y verifica su resultado antes de repetir.',
    queLeer: 'No supongas el estado físico de la válvula por un fallo de registro.',
  },
  'SRV-07': {
    titulo: 'El servidor no tiene internet',
    queEs: 'La sonda de salida del servidor falla aunque el dispositivo tenga conexión.',
    herramienta:
      'El administrador usa Probar ruta ahora y entrega el resultado al responsable de la red del servidor.',
    queLeer:
      'El fallo está en el lado del servidor; cambiar la red del teléfono no resuelve esa salida.',
  },
  'SRV-08': {
    titulo: 'Proceso vivo sin servicio disponible',
    queEs: 'Un proceso puede aparecer activo sin abrir el puerto de la API.',
    herramienta:
      'El administrador comprueba la respuesta real de salud y los puertos conforme al runbook.',
    queLeer:
      'El estado online del supervisor no basta. No reinicies servicios de producción por cuenta propia.',
  },
  'SRV-09': {
    titulo: 'Conectado sin entregar lecturas',
    queEs: 'Pueden entrar notificaciones OPC sin que salgan muestras hacia la aplicación.',
    herramienta:
      'El administrador compara lastNotificationAt y lastFrameEmittedAt en el diagnóstico de salud OPC.',
    queLeer:
      'Si avanza la entrada y no la salida, escala a Desarrollo. Connected o HTTP 200 no demuestran frescura.',
  },
  'FRT-01': {
    titulo: 'Canal de datos después de salir',
    queEs: 'El catálogo registra como corregido que un socket sobreviviera al cierre de sesión.',
    herramienta: 'Si observas datos tras salir, cierra la app y reporta la secuencia a Desarrollo.',
    queLeer: 'Indica si hubo cambio de usuario. No adjuntes tokens ni datos de otra cuenta.',
  },
  'FRT-02': {
    titulo: 'Referencia histórica del canal',
    queEs: 'Se corrigió un comentario que describía incorrectamente la autenticación del socket.',
    herramienta: 'Para un problema actual usa el código del banner y su hora.',
    queLeer: 'Una referencia del catálogo a un comentario antiguo no indica un incidente activo.',
  },
  'FRT-03': {
    titulo: 'Origen web del canal en vivo',
    queEs: 'El gateway controla los orígenes web permitidos; el catálogo registra la corrección.',
    herramienta:
      'Si falla solo en un navegador u origen, informa la dirección usada al administrador.',
    queLeer: 'No se deben permitir todos los orígenes para ocultar un fallo de configuración.',
  },
  'FRT-04': {
    titulo: 'Sesión guardada en el navegador',
    queEs:
      'En web la persistencia de sesión usa almacenamiento accesible al JavaScript de la aplicación.',
    herramienta:
      'Usa equipos de confianza, cierra sesión en equipos compartidos y no pegues scripts en la consola.',
    queLeer:
      'El catálogo registra un riesgo aceptado, no una infección confirmada. Reporta contenido o comportamiento inesperado.',
  },
  'CFG-01': {
    titulo: 'Falta configuración de base de datos',
    queEs: 'El arranque no dispone de variables requeridas.',
    herramienta: 'El administrador revisa la configuración privada según SETUP.',
    queLeer:
      'El nombre de la variable puede reportarse; su valor secreto no debe copiarse al informe.',
  },
  'CFG-02': {
    titulo: 'Origen web no permitido',
    queEs: 'El servidor puede responder por otros medios y rechazar el navegador por CORS.',
    herramienta:
      'Informa la dirección exacta de Aquora al administrador para contrastarla con los orígenes autorizados.',
    queLeer: 'No desactives la seguridad del navegador ni uses una allowlist abierta.',
  },
  'CFG-03': {
    titulo: 'Configuración de contraseñas inválida',
    queEs: 'El servicio de autenticación no tiene su secreto en el formato requerido.',
    herramienta: 'Escala al administrador para revisar la configuración del servidor.',
    queLeer: 'Cambiar tu contraseña repetidamente no corrige el secreto del servidor.',
  },
  'CFG-04': {
    titulo: 'Destino PLC inalcanzable',
    queEs: 'El servidor no alcanza el endpoint configurado.',
    herramienta:
      'El administrador ejecuta Probar ruta ahora y revisa VPN y destino con el integrador.',
    queLeer:
      'Compara con PLC-01 y las sondas; no cambies la dirección por una IP histórica sin comprobarla.',
  },
  'CFG-05': {
    titulo: 'Certificado OPC no confiado',
    queEs: 'El certificado del servidor necesita validación de confianza.',
    herramienta:
      'El administrador verifica su identidad y huella con el integrador antes de confiarlo.',
    queLeer:
      'No aceptar certificados desconocidos ni desactivar verificación para recuperar la conexión.',
  },
  'CFG-06': {
    titulo: 'Aceptación automática de certificados',
    queEs: 'Una configuración de desarrollo permite confiar en certificados desconocidos.',
    herramienta: 'Escala al administrador para revisar la política aprobada de producción.',
    queLeer: 'La conexión cifrada no basta si no se verifica a quién pertenece el certificado.',
  },
  'CFG-07': {
    titulo: 'Parámetros de sesión incompatibles',
    queEs: 'La configuración de lifetime y keepalive impide arrancar.',
    herramienta: 'Desarrollo contrasta los parámetros de configuración y el mensaje de arranque.',
    queLeer: 'Consulta también PLC-09; no es una alerta de nivel, presión o caudal.',
  },
  'DEF-01': {
    titulo: 'Recuperación tras fallo de sesión',
    queEs: 'Antecedente corregido de un puente que quedaba detenido en Faulted.',
    herramienta:
      'Si persiste Faulted, el administrador conserva el historial y lo escala a Desarrollo.',
    queLeer: 'La recuperación debe comprobar datos recientes además del cambio de estado.',
  },
  'DEF-02': {
    titulo: 'Recursos de conexión en reintentos',
    queEs: 'Antecedente corregido de recursos de cliente sin liberar al fallar la conexión.',
    herramienta: 'Desarrollo revisa uso de memoria y reintentos con evidencia del servidor.',
    queLeer: 'No atribuyas todo consumo de memoria a este antecedente sin medidas actuales.',
  },
  'DEF-03': {
    titulo: 'Ausencia convertida en cero',
    queEs: 'Antecedente corregido: una lectura ausente se convertía en cero.',
    herramienta:
      'Si un cero parece incoherente, reporta señal y hora y pide revisar el buffer crudo.',
    queLeer: 'Una lectura ausente y un cero medido tienen significados distintos.',
  },
  'DEF-04': {
    titulo: 'Calidad de una señal rota',
    queEs: 'Antecedente corregido de señales estructuralmente inválidas marcadas como utilizables.',
    herramienta:
      'El administrador compara valor, calidad e índice de la señal y escala inconsistencias.',
    queLeer: 'No uses una marca de calidad aislada sin comprobar si existe un valor.',
  },
  'DEF-05': {
    titulo: 'Reconexión y reciclaje simultáneos',
    queEs: 'Referencia técnica a una posible carrera de recuperación de suscripciones.',
    herramienta:
      'Desarrollo contrasta trazas y pruebas de reconexión; el operador reporta hora y duración del corte.',
    queLeer:
      'La entrada del catálogo es una hipótesis técnica; no permite diagnosticar el fallo solo desde la pantalla.',
  },
  'DEF-06': {
    titulo: 'Heartbeat durante recuperación',
    queEs: 'Referencia técnica a sondeos que pueden competir con la reconexión.',
    herramienta: 'Desarrollo revisa secuencia de estados y sondeos con el diagnóstico exportado.',
    queLeer: 'Conserva las transiciones Recovering y Connected y si llegaron datos nuevos.',
  },
  'DEF-07': {
    titulo: 'Deriva del tamaño de buffers',
    queEs: 'Referencia técnica al aviso de longitud esperada del mapping.',
    herramienta:
      'El administrador contrasta tamaño real, índice y versión del mapping con el integrador.',
    queLeer:
      'DAT-05 y DAT-06 describen el efecto en una señal; cambiar límites no corrige el array.',
  },
  'DEF-08': {
    titulo: 'Contrato compartido de datos',
    queEs: 'El catálogo registra la unificación de tipos de API y app.',
    herramienta:
      'Si la app muestra un estado desconocido, reporta su versión y código a Desarrollo.',
    queLeer: 'Un tipo de código corregido no sustituye la comprobación de versiones desplegadas.',
  },
  'DEF-09': {
    titulo: 'Volumen de logs por lectura',
    queEs: 'El catálogo registra la reducción de logs de cada snapshot.',
    herramienta: 'El administrador usa el nivel de diagnóstico conforme al runbook.',
    queLeer:
      'Menos logs por lectura no significa que no lleguen datos; compara timestamps y salud.',
  },
  'DEF-10': {
    titulo: 'Contador de reciclajes',
    queEs: 'Referencia técnica a la escalada de recuperaciones tras fallos separados.',
    herramienta: 'Desarrollo revisa contadores junto al historial de transiciones.',
    queLeer:
      'La cantidad de reintentos requiere su contexto temporal; no demuestra una falla continua.',
  },
  'DEF-11': {
    titulo: 'Suscriptores internos duplicados',
    queEs: 'Referencia técnica a limpieza de listeners al reinicializar módulos.',
    herramienta: 'Desarrollo revisa eventos duplicados y ciclo de vida de los módulos.',
    queLeer: 'No borres avisos repetidos como solución; registra sus horas e identificadores.',
  },
  'DEF-12': {
    titulo: 'Tipo numérico inesperado',
    queEs: 'Un valor puede llegar como texto numérico y convertirse a número.',
    herramienta: 'El administrador revisa el tipo del buffer con el integrador.',
    queLeer: 'La cifra visible no demuestra que el tipo de origen corresponda al mapping.',
  },
  'DEF-13': {
    titulo: 'Detalle técnico en auditoría',
    queEs: 'Referencia técnica al tratamiento de mensajes de terceros en el registro.',
    herramienta:
      'Comparte el informe solo con personal autorizado y revisa sus detalles antes de enviarlo.',
    queLeer: 'No adjuntes secretos ni información privada innecesaria al reporte de soporte.',
  },
  'DEF-14': {
    titulo: 'Muchos logs de reconexión',
    queEs: 'Una interrupción prolongada puede producir avisos repetidos de reintento.',
    herramienta: 'El administrador registra inicio, duración y transición final del corte.',
    queLeer:
      'La repetición puede corresponder al mismo incidente; no equivale a muchas fallas independientes.',
  },
  'DEF-15': {
    titulo: 'Capacidad del registro de descartes',
    queEs: 'El diagnóstico de dead-letter conserva una cantidad limitada de eventos.',
    herramienta: 'El administrador exporta la evidencia cuando detecta el problema.',
    queLeer:
      'Que un evento viejo ya no aparezca no demuestra que no ocurrió ni que quedó resuelto.',
  },
};

export function buscarFaq(query: string): [string, FaqEntry][] {
  const term = query.trim().toLocaleLowerCase('es');
  return Object.entries(FAQ).filter(([codigo, entry]) =>
    `${codigo} ${entry.titulo} ${entry.queEs} ${entry.herramienta} ${entry.queLeer}`
      .toLocaleLowerCase('es')
      .includes(term),
  );
}
