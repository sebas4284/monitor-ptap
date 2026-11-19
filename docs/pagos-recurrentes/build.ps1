# Genera un PDF con el formato Aquora a partir del HTML de esta carpeta.
# CONFIGURAR: el nombre del HTML y del PDF en las variables $fuente y $salida.
# Toma las fuentes woff2 en base64 de un documento Aquora ya entregado y las incrusta,
# porque Chrome al imprimir no espera a las fuentes de red y sustituye por Segoe UI.

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$aqui     = Split-Path -Parent $MyInvocation.MyCommand.Path
$docs     = Split-Path -Parent $aqui
$plantilla = Join-Path $docs 'correo\INSTRUCTIVO-OUTLOOK-DESARROLLO.html'
$fuente   = Join-Path $aqui 'COBRO-SUSCRIPCIONES-PAYPAL.html'
$temporal = Join-Path $env:TEMP 'COBRO-SUSCRIPCIONES-PAYPAL.build.html'
$salida   = Join-Path $env:USERPROFILE 'Downloads\COBRO-SUSCRIPCIONES-PAYPAL.pdf'
$chrome   = 'C:\Program Files\Google\Chrome\Application\chrome.exe'

foreach ($f in @($plantilla, $fuente, $chrome)) {
  if (-not (Test-Path $f)) { throw "No existe: $f" }
}

# El primer bloque <style> de la plantilla son solo las @font-face en base64.
$htmlPlantilla = [System.IO.File]::ReadAllText($plantilla, $utf8)
$bloques = [regex]::Matches($htmlPlantilla, '(?s)<style>(.*?)</style>')
if ($bloques.Count -lt 1) { throw "No se encontro ningun bloque <style> en la plantilla" }
$fuentes = $bloques[0].Groups[1].Value
# Archivo e IBM Plex Sans son fuentes variables; Chrome headless las descarta cuando la
# @font-face declara font-stretch. Sin esa linea si se incrustan. (Los PDF Aquora previos
# cayeron a Segoe UI/Times por este motivo.)
$fuentes = [regex]::Replace($fuentes, '\s*font-stretch:\s*[^;]+;', '')
$nCaras = ([regex]::Matches($fuentes, '@font-face')).Count
if ($nCaras -lt 5) { throw "El bloque de fuentes trae solo $nCaras @font-face; se esperaban 10" }
Write-Output "Fuentes: $nCaras caras, $([int]($fuentes.Length/1KB)) KB"

$html = [System.IO.File]::ReadAllText($fuente, $utf8)
if ($html -notmatch '<!--FONTS-->') { throw "El HTML no tiene el marcador <!--FONTS-->" }
$html = $html.Replace('<!--FONTS-->', $fuentes)
[System.IO.File]::WriteAllText($temporal, $html, $utf8)

if (Test-Path $salida) { Remove-Item $salida -Force }

# Sin 2>&1 ni 2>$null: en PS 5.1 redirigir stderr de un exe nativo lo convierte en
# NativeCommandError aunque Chrome termine bien. Chrome escribe avisos de GCM en stderr.
$uri = 'file:///' + $temporal.Replace('\', '/')
& $chrome --headless=new --disable-gpu --virtual-time-budget=20000 `
          --no-pdf-header-footer --print-to-pdf="$salida" $uri | Out-Null

if (-not (Test-Path $salida)) { throw "Chrome no genero el PDF" }
$kb = [int]((Get-Item $salida).Length / 1KB)
Write-Output "PDF generado: $salida ($kb KB)"
