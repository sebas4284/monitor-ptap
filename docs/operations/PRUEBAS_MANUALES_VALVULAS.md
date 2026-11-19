# Guía de Prueba Manual de Válvulas desde PowerShell

## Objetivo
Enviar una orden puntual autorizada de apertura/cierre a través del endpoint oficial de comandos de la API. El servidor aplica autenticación, permiso `control_valves`, alcance de planta, interlocks, idempotencia, lectura de retorno y auditoría antes/durante la escritura al PLC. Luego pueden observarse los canales OPC UA de comando (`intOut`) y estado (`intIn`).

> [!IMPORTANT]
> PowerShell **no se conecta ni escribe directamente por OPC UA al PLC**. La escritura pasa por la API existente y sus controles. No desactives ni evadas esos controles. Opera únicamente con autorización, siguiendo el procedimiento de seguridad de la planta y con personal de campo.

---

## Requisitos

- PowerShell en Windows.
- Node.js y npm instalados.
- Dependencias instaladas en la raíz del repositorio (`node_modules`).
- La API debe estar activa en el servidor/VM, conectada al PLC correspondiente, y accesible desde tu equipo por su URL HTTPS oficial.
- Una cuenta propia autorizada, con permiso `control_valves` y alcance sobre esa planta. El JWT debe emitirse por el proceso normal de autenticación.
- El nombre del target y los verbos habilitados deben estar confirmados en el mapping desplegado en el servidor para esa planta.

---

## Dónde Ejecutarlo

Para **enviar** una orden, normalmente **no** necesitas iniciar sesión en la VM. Abre PowerShell en tu PC Windows desde la carpeta local del repositorio, y el cliente se conecta por HTTPS a la URL de la API. La API que corre en la VM es la que envía la orden al PLC.

Para **leer** los canales con `read-valve-channels.ts`, el script abre una conexión OPC UA directa desde el equipo donde ejecutas PowerShell. Por tanto, tu PC necesita ruta de red autorizada al endpoint OPC UA.

---

## Métodos PowerShell para Válvulas

El repositorio incluye funciones manuales en:
[`apps/api/scripts/manual-valves.ps1`](../../apps/api/scripts/manual-valves.ps1)

Desde PowerShell, en la raíz del repositorio:

```powershell
. .\apps\api\scripts\manual-valves.ps1
$ApiBaseUrl = Read-Host 'URL HTTPS oficial de la API'
Connect-ManualValveApi -ApiBaseUrl $ApiBaseUrl
```

### Comandos disponibles:

* **Abrir válvula de entrada (`valve2`)**:
  ```powershell
  Abrir-ValvulaEntrada -PlantId voragine
  # Confirmación: EJECUTAR abrir entrada EN voragine
  ```

* **Cerrar válvula de entrada (`valve2`)**:
  ```powershell
  Cerrar-ValvulaEntrada -PlantId voragine
  # Confirmación: EJECUTAR cerrar entrada EN voragine
  ```

* **Abrir válvula de salida (`valve1`)**:
  ```powershell
  Abrir-ValvulaSalida -PlantId voragine
  # Confirmación: EJECUTAR abrir salida EN voragine
  ```

* **Cerrar válvula de salida (`valve1`)**:
  ```powershell
  Cerrar-ValvulaSalida -PlantId voragine
  # Confirmación: EJECUTAR cerrar salida EN voragine
  ```

Al terminar:
```powershell
Disconnect-ManualValveApi
```

---

## Observación de Canales OPC UA

Para observar los cambios en tiempo real mientras se ejecuta la maniobra:

```powershell
$PlantId = 'voragine'
$OpcEndpoint = Read-Host 'Endpoint OPC UA autorizado (opc.tcp://host:puerto)'
npm exec -w @ptap/api -- tsx scripts/read-valve-channels.ts $PlantId $OpcEndpoint --watch 60
```

---

## Seguridad

- El bloque de activación sí envía una orden al PLC a través del servicio oficial. No lo ejecutes contra producción sin permiso y confirmación de campo.
- No ejecutes scripts crudos OPC UA de escritura ni escribas NodeIds/bits desde PowerShell; eluden el flujo autenticado de comandos.
- Si aparece un valor inesperado, una alarma o una discrepancia entre el estado mostrado y el físico, detén la prueba y sigue el protocolo de la planta.
