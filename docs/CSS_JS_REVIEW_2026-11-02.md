# Revisión CSS y JavaScript — 2026-11-02

Se aplicaron las seis skills locales `telcobras-css-cascade`, `telcobras-css-layout`,
`telcobras-css-motion`, `telcobras-javascript-async`, `telcobras-javascript-dom` y
`telcobras-javascript-semantics`, con su control de seguridad. Se preservaron los
cambios que ya existían en el árbol de trabajo.

## Correcciones y evidencia

| Área | Problema y corrección | Verificación |
| --- | --- | --- |
| Cascada | El buscador de usuarios suprimía el foco con `outlineStyle: 'none'`. Se retiró esa regla, sin aumentar especificidad. | Chromium: antes `outline-style: none` aun con foco; después `auto`. |
| Layout | La confirmación de válvula excedía una ventana de 320 × 400, sin desplazamiento. Ahora limita su altura y permite desplazar el contenido. Los campos flexibles también permiten reducir su mínimo. | Antes: tarjeta desde −26,5 hasta 426,5 px. Después: desde 20 hasta 380 px, contenido desplazable de 497 px y área visible de 360 px. Botón Volver accesible. Buscador sin desbordamiento horizontal a 320, 768 y 1440 px. |
| Movimiento | Esqueletos, barra del tanque y cinco diálogos ignoraban reducir movimiento. Comparten ahora una suscripción a `AccessibilityInfo`; la barra detiene la animación anterior y limpia su estado si desaparece la lectura. | Pruebas de suscripción, cambio de preferencia y desmontaje. Chromium: menú con animación de 250 ms en modo normal y sin animaciones en modo reducido; Escape funciona en ambos. |
| Asincronía | La hidratación tardía de preferencias podía deshacer una edición; escrituras concurrentes podían terminar fuera de orden. Se preserva cada campo editado y se serializan las escrituras. | Promesas controladas: lectura tardía, conservación del campo no editado y almacenamiento lento. |
| DOM | Acceso y registro no enviaban desde el último campo con Enter. El campo trampa oculto seguía en el orden de tabulación. Los listeners propios de Escape duplicaban el mecanismo del Modal instalado. | Chromium: Enter pasa de correo a contraseña; dos Enter rápidos producen una sola solicitud simulada; campo trampa con `tabIndex=-1`; confirmación y menú cierran con Escape usando `onRequestClose`. |
| Semántica | Las preferencias persistidas se aceptaban mediante una aserción de tipo sin validar los grupos. Se rechazan grupos inválidos, se eliminan duplicados y se conserva un `false` elegido explícitamente. | Regresiones con `null`, JSON inválido, valores ajenos al contrato, duplicados y `false` frente a un `true` guardado. |

## Validación

- `npm run typecheck`: aprobado en API, móvil y shared antes de los cambios;
  typecheck móvil aprobado de nuevo tras las correcciones.
- `npm run lint`: sin errores; 101 advertencias previas en API y una en móvil.
  Lint móvil repetido tras las correcciones, sin errores ni advertencias nuevas.
- `npm test -w @ptap/mobile`: **253/253 aprobadas**, incluidas ocho regresiones nuevas
  en `services/ui-behavior.test.ts`, agregadas al ejecutor habitual.
- Exportación web de Expo en modo offline: aprobada, 23 rutas estáticas.
- `git diff --check`: aprobado.
- Pruebas de navegador sobre la exportación local, con API interceptada y datos
  sintéticos; no se enviaron credenciales ni comandos a la instalación real.

## Versiones y límites

Node 26.12.1, Expo 58.0.20, React 19.3.0, React Native 0.88.0 y React Native Web 0.21.4.
Se leyó la [documentación versionada de Expo 58](https://docs.expo.dev/versions/v58.0.0/).
La consulta de Context7 para React Native 0.88 no devolvió la API solicitada y las
páginas versionadas no fueron accesibles mediante la herramienta web; se contrastó
el uso de las APIs con los tipos y la implementación exactos instalados. En particular,
`react-native-web/dist/exports/Modal/ModalContent.js` gestiona Escape mediante `keyup`
y `onRequestClose` para el modal activo.

Revisión enfocada en la interfaz móvil/web y sus servicios de presentación. No es
una auditoría exhaustiva de cada archivo del monorepo ni certifica accesibilidad
completa. No se probó en dispositivos Android/iOS físicos ni se desplegaron cambios.
Permanece la advertencia previa de `RegistroIntegridadCard.tsx` sobre estado en un efecto.

## Publicación autorizada en la VM

El usuario solicitó posteriormente actualizar la VM. Publicado el 2026-11-02 a las
18:29 de Bogotá (23:29 UTC) en `https://aquora.xpertic.co`.

- Overlay explícito de 13 rutas de fuente, incluido el retiro de `useWebEscape.ts`;
  hashes del paquete, manifiesto y helper comprobados tras transferir por SSH estricto.
- Typecheck y exportación offline en la VM aprobados con sus dependencias existentes.
- Publicación web mediante el publicador root existente, con respaldo privado y rollback.
- Árbol web publicado igual al construido:
  `6ac8c2d1f90f32413ae08039516aac5c3694f8162d1091a489871ad0649fdaf0`.
- `/login`, `/register`, `/usuarios` y `/electrovalvulas`: HTTP 200.
  Los bundles de login, usuarios y electroválvulas servidos por HTTPS coinciden por SHA256.
- Salud API, base de datos y OPC aprobada. API conserva PID 85246, cero reinicios;
  hashes de API, shared y lockfile sin cambios. No se publicó una APK.
- Recibo, respaldo y evidencia operativa conservados localmente, fuera del historial público.
