# Rendimiento web de Aquora

La medición se hace sobre una exportación de producción, con la API local simulada. Metro (`expo start`) sirve para desarrollar y no representa el rendimiento de la versión publicada. No hace falta instalar herramientas en Windows.

## Compilar y previsualizar

En PowerShell, con el contenedor de desarrollo existente:

```powershell
docker exec -w /workspace aquora-node26-dev npm run web:build
docker exec -d -w /workspace -e HOST=0.0.0.0 aquora-node26-dev npm run web:preview
```

El segundo comando requiere que el puerto 8082 esté libre dentro del contenedor. No iniciar Metro y la previsualización a la vez. El puerto del contenedor debe publicarse **solo en 127.0.0.1**. Abrir `http://localhost:8082/login`. Tras editar código, repetir la compilación; esta previsualización no tiene recarga de desarrollo.

`export:web` genera `apps/mobile/dist-audit`, añade las fuentes WOFF2, su declaración CSS y versiones Brotli/gzip. El servidor entrega los recursos con hash como inmutables y el HTML sin caché. Registra los fragmentos de la ruta después del runtime de Metro y antes del punto de entrada, como admite el cargador de Expo. Las rutas protegidas siguen comprobando la sesión en la aplicación y en la API.

El servidor es una previsualización local. Publicar en otro alojamiento exige conservar compresión, encabezados y carga de fragmentos equivalentes; copiar únicamente el HTML no reproduce estas condiciones. No se publicó nada durante esta tarea.

## Repetir Lighthouse en Docker

Usar un contenedor temporal dedicado, sin montar el equipo ni instalar paquetes del proyecto:

```powershell
docker run -d --init --name aquora-lighthouse --network container:aquora-node26-dev --cpus 2 --memory 2g --memory-swap 3g --shm-size 512m node:26.12.1-bookworm sleep infinity
docker exec aquora-lighthouse sh -lc 'apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates && mkdir -p /audit && cd /audit && npm init -y && npm install --ignore-scripts --save-exact lighthouse@13.6.0'
docker cp tools/web/lighthouse-audit.mjs aquora-lighthouse:/audit/run.mjs
docker cp tools/web/lighthouse-ui-check.mjs aquora-lighthouse:/audit/ui-check.mjs
$env:LH_EMAIL = Read-Host 'Correo de la cuenta de prueba autorizada'
$env:LH_PASSWORD = Read-Host -MaskInput 'Contraseña de prueba'
docker exec -e LH_EMAIL -e LH_PASSWORD -e LH_REPEATS=3 -e LH_PHASE=verification aquora-lighthouse sh -lc 'cd /audit && node run.mjs'
docker exec -e LH_EMAIL -e LH_PASSWORD aquora-lighthouse sh -lc 'cd /audit && node ui-check.mjs'
docker cp aquora-lighthouse:/audit/reports/. docs/revision-visual/2026-11/lighthouse/
Remove-Item Env:LH_PASSWORD
Remove-Item Env:LH_EMAIL
docker rm -f aquora-lighthouse
```

Las herramientas del navegador provienen de las dependencias de Lighthouse. El navegador de Debian puede actualizarse: registrar siempre la versión efectiva y conservar HTML/JSON, perfil, métricas y advertencias. Ejecutar Lighthouse sin compilaciones, pruebas ni otras auditorías simultáneas. `--init` recoge los procesos hijos de Chromium.

El ejecutor usa los perfiles oficiales móvil y escritorio de Lighthouse, sin modificar sus límites de CPU/red. Cada pasada usa un proceso de Lighthouse y un perfil de Chrome nuevos. Para tablero inicia sesión mediante el formulario con la cuenta autorizada y vacía la caché HTTP antes de medir. Conserva la sesión y el respaldo local normal del usuario: no es una prueba del primer acceso sin datos persistidos. Nunca crea usuarios ni actúa sobre válvulas.

Se guardan todas las pasadas; comparar la mediana y el rango, no elegir solo la mejor. `lighthouse-ui-check.mjs` comprueba tamaños 1366/360, entrada protegida, contraseña visible/oculta, recordar sesión, recuperación guiada, filtros, navegación, historial y cierre de sesión. Captura la interfaz y falla ante errores de ejecución o peticiones HTTP fallidas.

## Fuentes y compilación

- Los colores corporativos siguen en `apps/mobile/constants/colors.ts`.
- Web usa Poppins 400/500/600 WOFF2 con caracteres latinos y símbolos de la interfaz; Android conserva los TTF originales.
- Ionicons WOFF2 contiene los 165 iconos registrados en `apps/mobile/assets/fonts/ionicons-used.json`. Un icono nuevo fuera de esa lista usa automáticamente la fuente completa; no se convierte en un carácter vacío.
- `build-fonts.py` reproduce los subconjuntos a partir de los TTF instalados de Poppins e Ionicons: `python3 build-fonts.py entrada salida ionicons-used.json`, dentro de Docker con FontTools/Brotli. Las licencias de Poppins, Ionicons y su adaptador acompañan los archivos.
- `babel-native-members.cjs` optimiza exclusivamente la forma comprobable del importador CommonJS perezoso generado por SWC. Los accesos dinámicos, desconocidos o modificados conservan el código original. Solo se activa en web. Revisarlo junto con sus pruebas al actualizar Expo o React Native Web.
- `inlineRequires` se limita a producción web. No cambia la compilación nativa ni el desarrollo.

## Verificación del código

```powershell
docker exec -w /workspace aquora-node26-dev npm run typecheck -w @ptap/mobile
docker exec -w /workspace aquora-node26-dev npm run test -w @ptap/mobile
docker exec -w /workspace aquora-node26-dev npm run test:web-tools
```

Las animaciones de pulsación y de cambios del gráfico respetan reducir movimiento. El gráfico no anima su primera lectura ni ejecuta un bucle. Se conservan los estados congelado, sin dato y error; la mejora de rendimiento no altera las lecturas ni los permisos.
