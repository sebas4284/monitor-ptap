<#
Manual valve commands through the authenticated PTAP API.

The script deliberately does not connect to OPC UA. The API resolves the
plant/target mapping and performs the PLC write, feedback polling, safety
interlocks, permission checks, and audit logging.

Current scope: Voragine only. Add other plants only after their per-plant
command and feedback mappings have been validated by the PLC integrator.

Usage:
  . .\apps\api\scripts\manual-valves.ps1
  Connect-ManualValveApi -ApiBaseUrl 'https://<official-api-host>'
  Abrir-ValvulaEntrada -PlantId voragine
  Cerrar-ValvulaSalida -PlantId voragine
  Disconnect-ManualValveApi
#>

$script:ManualValveApiBaseUrl = $null
$script:ManualValveToken = $null

function Connect-ManualValveApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string] $ApiBaseUrl
    )

    $ApiBaseUrl = $ApiBaseUrl.Trim().TrimEnd('/')
    if (-not ($ApiBaseUrl.StartsWith('https://') -or
        $ApiBaseUrl -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$')) {
        throw 'Usa HTTPS, o HTTP solo para localhost.'
    }

    $secureToken = Read-Host 'JWT de tu cuenta autorizada (entrada oculta)' -AsSecureString
    if ($secureToken.Length -eq 0) {
        $secureToken.Dispose()
        throw 'El token no puede estar vacio.'
    }

    Disconnect-ManualValveApi
    $script:ManualValveApiBaseUrl = $ApiBaseUrl
    $script:ManualValveToken = $secureToken
    Write-Host "Sesion de cliente configurada para $ApiBaseUrl. El JWT no se muestra."
}

function Disconnect-ManualValveApi {
    [CmdletBinding()]
    param()

    if ($null -ne $script:ManualValveToken) {
        $script:ManualValveToken.Dispose()
    }
    $script:ManualValveToken = $null
    $script:ManualValveApiBaseUrl = $null
}

function Invoke-ManualValveCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $PlantId,

        [Parameter(Mandatory)]
        [ValidateSet('entrada', 'salida')]
        [string] $ValveName,

        [Parameter(Mandatory)]
        [ValidateSet('open', 'close')]
        [string] $Action
    )

    if ($null -eq $script:ManualValveToken -or
        [string]::IsNullOrWhiteSpace($script:ManualValveApiBaseUrl)) {
        throw 'Primero ejecuta Connect-ManualValveApi.'
    }

    if ($PlantId -cne 'voragine') {
        throw "Alcance actual: solo 'voragine'. No se envio ningun comando."
    }

    # The API domain keys are stable; the masks and feedback bits stay in opc_mapping.json.
    # Voragine valve1 is outlet; valve2 is inlet. Other plants remain pending integrator validation.
    $target = switch ($ValveName) {
        'entrada' { 'valve2' }
        'salida'  { 'valve1' }
    }

    $actionEs = if ($Action -eq 'open') { 'abrir' } else { 'cerrar' }
    $confirmationPhrase = "EJECUTAR $actionEs $ValveName EN $PlantId"
    $confirmation = Read-Host "Confirma la maniobra escribiendo exactamente: $confirmationPhrase"
    if ($confirmation -cne $confirmationPhrase) {
        throw 'La confirmacion no coincide. No se envio ningun comando.'
    }

    $tokenPointer = [IntPtr]::Zero
    $plainToken = $null
    try {
        $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($script:ManualValveToken)
        $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
        $plainToken = $plainToken.Trim()
        if ($plainToken -match '[\x00-\x1F\x7F]' -or
            $plainToken -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
            throw 'El valor ingresado no tiene formato de JWT de acceso. No se envio ninguna solicitud. Ingresa el token devuelto por el inicio de sesion, no el secreto de firma del archivo .env.'
        }

        $plantSegment = [Uri]::EscapeDataString($PlantId)
        $uri = "$($script:ManualValveApiBaseUrl)/api/plants/$plantSegment/commands"
        $body = @{
            command = $Action
            target = $target
            idempotencyKey = 'manual-' + [guid]::NewGuid().ToString()
        } | ConvertTo-Json -Compress

        try {
            $result = Invoke-RestMethod `
                -Uri $uri `
                -Method Post `
                -Headers @{ Authorization = "Bearer $plainToken" } `
                -ContentType 'application/json' `
                -Body $body `
                -ErrorAction Stop
        }
        catch {
            $response = $_.Exception.Response
            if ($null -ne $response) {
                $statusCode = [int]$response.StatusCode
                $responseBody = ''
                try {
                    $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
                    try {
                        $responseBody = $reader.ReadToEnd()
                    }
                    finally {
                        $reader.Dispose()
                    }
                }
                catch {
                    $responseBody = 'No fue posible leer el cuerpo de error de la API.'
                }
                throw "La API respondio HTTP $statusCode. No reintentes automaticamente. Respuesta: $responseBody"
            }
            throw "No se pudo completar la solicitud a la API: $($_.Exception.Message)"
        }

        $result | ConvertTo-Json -Depth 10
        switch ([string]$result.status) {
            'confirmed' { Write-Host 'API: comando confirmado segun su lectura de retorno; verifica tambien en campo.' }
            'sent' { Write-Warning 'API: orden enviada, pero el feedback no confirma el movimiento. No repitas la orden.' }
            'failed' { Write-Warning 'API: la orden pudo haberse escrito, pero no se confirmo. No repitas automaticamente.' }
            'rejected' { Write-Warning 'API: el comando fue rechazado; revisa el motivo, permisos e interlocks.' }
            default { Write-Host "API: respuesta recibida para $PlantId/$ValveName ($Action)." }
        }
    }
    finally {
        if ($tokenPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        }
        $plainToken = $null
    }
}

function Abrir-ValvulaEntrada {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string] $PlantId)
    Invoke-ManualValveCommand -PlantId $PlantId -ValveName entrada -Action open
}

function Cerrar-ValvulaEntrada {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string] $PlantId)
    Invoke-ManualValveCommand -PlantId $PlantId -ValveName entrada -Action close
}

function Abrir-ValvulaSalida {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string] $PlantId)
    Invoke-ManualValveCommand -PlantId $PlantId -ValveName salida -Action open
}

function Cerrar-ValvulaSalida {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string] $PlantId)
    Invoke-ManualValveCommand -PlantId $PlantId -ValveName salida -Action close
}
