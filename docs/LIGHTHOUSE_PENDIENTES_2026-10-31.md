# Aquora: auditoría Lighthouse pausada

> **Nota de continuidad — 2026-11-02:** este informe conserva las mediciones del
> 31 de octubre; no describe por sí solo la publicación actual. Las correcciones
> CSS/JS del 2 de noviembre ya se publicaron en la VM, según
> [su evidencia](./CSS_JS_REVIEW_2026-11-02.md). No se ha repetido Lighthouse oficial
> en esta sesión ni se da por terminado el rediseño integral. Antes de publicar
> otros cambios de esta auditoría, comparar el bundle vigente y el diff: no asumir
> que todo lo listado abajo sigue exclusivamente local. Pendientes consolidados en
> [PENDIENTES.md](./PENDIENTES.md).

Fecha: 2026-10-31. Pausada por solicitud del usuario. Cambios conservados en local, sin commit ni despliegue de esta tarea.

## Mediciones realizadas

Lighthouse mediante Chrome DevTools/ECC. Las categorías de esta herramienta no incluyen una puntuación de rendimiento; se tomó una traza separada, sin limitación de CPU o red. Móvil significa emulación web, no una prueba de la APK.

| Página y entorno | Dispositivo | Accesibilidad | Buenas prácticas | SEO |
| --- | --- | --- | --- | --- |
| Oficial /login, antes | Móvil y escritorio | 91 | 96 | 75 |
| Local /login, correcciones iniciales y servidor de vista previa | Móvil y escritorio | 100 | 100 | 100 |
| Oficial /tablero, sesión activa, antes | Móvil | 87 | 96 | 75 |
| Oficial /tablero, sesión activa, antes | Escritorio | 87 | 100 | 75 |

Los 100 locales corresponden a la versión anterior al último ajuste de accesibilidad del tablero. Ese ajuste posterior se compiló y pasó typecheck, pero aún requiere auditoría en el panel autenticado.

Traza de /login: oficial LCP 623 ms y CLS 0; local LCP 217 ms y CLS 0. Son observaciones de entornos distintos, sin throttling; no demuestran una mejora causal de rendimiento en producción.

## Cambios locales conservados

- `apps/mobile/app/+html.tsx`: idioma español, título, descripción y color del navegador; conserva nodos y atributos generados por Expo SDK 58.
- `apps/mobile/public/robots.txt`: archivo de texto válido, con exclusión de rutas internas. Esto no sustituye la autorización del backend.
- `apps/mobile/app/(auth)/login.tsx`: etiquetas y autocompletado de campos, semántica de botones y contraste de Ingresar.
- `apps/mobile/components/AppUpdateBanner.tsx`: semántica y nombre accesible del enlace de descarga.
- `apps/mobile/components/BotonSilencio.tsx`: `aria-checked` explícito para el interruptor.
- `apps/mobile/app/(app)/_layout.tsx`: contraste de cabecera y contador de notificaciones, nombre accesible coherente con el contador visible e icono decorativo oculto al lector.
- `apps/mobile/components/GaugeCard.tsx` y `FlowMeterCard.tsx`: contraste del texto de las etiquetas de fuera de rango.
- `tools/web/audit-server.cjs`: vista previa local del export en puerto 4174; solo permite GET/HEAD y únicamente reenvía al dominio oficial la consulta pública de versión. No permite autenticación ni comandos.

Compilación generada: `apps/mobile/dist-audit/` (ignorada por Git). No se instaló una dependencia nueva.

## Verificación y límites

- Exportación web de producción: correcta, 23 rutas. Última compilación posterior a los ajustes del tablero.
- Typecheck móvil: correcto, incluida la última revisión.
- Pruebas móviles: 206/206 antes de los últimos ajustes del tablero.
- Lint móvil: 0 errores, 2 advertencias en `FlowMeterCard.tsx` (importación sin uso) y `RegistroIntegridadCard.tsx` (estado desde efecto), antes de los últimos ajustes del tablero.
- El error React #418 de hidratación observado inicialmente en el login oficial no se reprodujo en la exportación local. La causa exacta y la resolución en producción siguen sin verificarse.
- No se completó la revisión visual en tres tamaños, teclado ni comparación contra una línea base visual.
- La auditoría del tablero oficial detectó además tamaño insuficiente del icono de marca y un aviso de layout shift; pendientes de investigar.
- Los informes brutos permanecen en directorios temporales `chrome-devtools-mcp-*` de Windows; no se archivaron en el repositorio y pueden caducar. Los del tablero pueden contener datos de la sesión corporativa: no publicarlos sin revisión.

## Para retomar

1. Revisar el diff propio, preservando los cambios de backend y documentación que ya estaban en curso por separado.
2. Auditar el tablero autenticado con las correcciones locales; verificar contraste, interruptores, nombre de notificaciones, imagen y estabilidad visual.
3. Repetir los checks afectados, revisar tamaño de pantalla y teclado y archivar evidencia sin credenciales ni datos personales.
4. Preparar publicación de estáticos con respaldo y comprobación de salud, sin desplegar los cambios ajenos del backend.
5. Publicar y volver a medir /login y /tablero oficiales en móvil y escritorio. Esto NO se ha hecho.

Los detalles de acceso y la evidencia operativa se conservan localmente, fuera del historial público. Revalidar permisos y estado del despliegue antes de continuar.
