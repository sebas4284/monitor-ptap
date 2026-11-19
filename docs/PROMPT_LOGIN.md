# Prompt: rediseño del login de Aquora con agua en movimiento

Vas a implementar el rediseño del login de Aquora (app Expo en apps/mobile) y a documentar
cada cambio en Notion. Lee todo este archivo antes de empezar. El archivo termina con la
línea "FIN DEL PROMPT"; si no la ves, el archivo está incompleto: detente y avísame.

## 0. Antes de tocar código
- Lee AGENTS.md y apps/mobile/CLAUDE.md. El proyecto usa Expo 56: consulta la documentación
  versionada (https://docs.expo.dev/versions/v56.0.0/) antes de escribir código de Expo.
- La referencia visual está en docs/diseno/login/Main.dc.html (escritorio, 1440 px) y
  docs/diseno/login/Movil.dc.html (celular, 390 px). Son HTML con CSS: úsalos como
  especificación de colores, medidas, textos y animaciones. NO los copies tal cual: hay que
  traducirlos a React Native (View, Text, TextInput, Pressable, Animated).
- Trabaja en una rama nueva: `git checkout -b feat/login-agua`. No hagas commit en main ni
  push sin preguntarme. Yo conozco poco Git: explícame en una línea cada comando de Git que
  ejecutes.

## 1. Notion: bitácora de cambios
Usa el servidor MCP de Notion.
1. Busca una página llamada "Aquora · Bitácora del frontend". Si no existe, créala con una
   base de datos dentro, llamada "Cambios", con estas propiedades:
   - Cambio (título)
   - Fecha (fecha)
   - Tipo (select: Diseño, Funcionalidad, Accesibilidad, Dependencia, Corrección)
   - Archivos (texto)
   - Motivo (texto)
   - Estado (select: En curso, Hecho, Revertido)
   - Commit (texto)
2. Antes de empezar, crea una entrada "Plan: rediseño del login con agua" con el plan de
   fases de la sección 3 en el cuerpo.
3. Al terminar CADA fase, crea una entrada con: qué cambió, archivos tocados, por qué, y el
   hash del commit. Si una fase falla o se revierte, regístralo también.
4. Si el MCP de Notion no responde, NO te detengas: escribe las entradas en
   docs/diseno/login/BITACORA.md con el mismo formato y avísame al final.

## 2. Especificación del diseño
Concepto: "el tanque se llena". Al cargar, el agua sube desde abajo y luego queda en
movimiento continuo. Tema oscuro.

Colores (agregar como tokens en apps/mobile/constants/colors.ts, sin borrar los que usan
otras pantallas):
- Fondo de página #04101A · panel del agua #061827 · campo #0A1C2A
- Borde de campo #24384A · borde con foco #2491CC (halo rgba(36,145,204,.22))
- Olas: #0B3A5C (fondo), #12608F (media), #2491CC (frente)
- Botón primario #1C6FA0 (hover/pressed #1A6390), texto #FFFFFF
- Texto #F2F7FA · secundario #A9C0CF · placeholder #7B8C99
- Verde Telcobras #88BD4C (punto "servidor en línea"); enlace verde #A6D46E
- Barra de marca de 3 colores bajo el título: #2491CC 55 % · #88BD4C 30 % · #F3CB35 15 %

Tipografía: Poppins 400/500/600 con expo-font (@expo-google-fonts/poppins). Campos a 16 px.

Composición:
- Escritorio/tablet (ancho >= 900 px, con useWindowDimensions): dos columnas. Izquierda:
  panel con agua, logo y frase "El agua de 12 plantas, en una sola pantalla." + "Caudal,
  presión, niveles y calidad del agua en tiempo real." Derecha: formulario de máximo 400 px,
  centrado vertical y horizontalmente.
- Celular (< 900 px): logo con ondas arriba (zona de ~330 px), olas como separador, y el
  formulario debajo con 24 px de margen lateral. Pie: "Servidor en línea · v<versión>".
- Conservar el logo actual assets/aquora-logo.png sin modificarlo.

Animaciones (con Animated de React Native y react-native-svg para las olas):
- Entrada: el agua sube (translateY de 100 % a 0) en ~2,2 s con easing suave; el formulario
  aparece con fade + subida de 16 px.
- Olas: 3 capas SVG de 200 % de ancho que se desplazan en bucle a 26 s, 17 s (en reversa) y
  11 s. El trazado debe ser periódico para que el bucle no tenga saltos.
- Logo: flota (±8 px, 6 s) y emite 3 anillos azules que crecen de 0,55 a 1,9 y se desvanecen
  (4,5 s, desfasados 1,5 s).
- Burbujas: 4 a 6 círculos que suben y se desvanecen a distintas velocidades.
- Usa useNativeDriver: true en todo lo posible. Respeta
  AccessibilityInfo.isReduceMotionEnabled(): si está activo, el agua queda quieta y visible.
- Para instalar react-native-svg usa `npx expo install react-native-svg` (no npm install).

Formulario y comportamiento (mantener la lógica actual de handleLogin y apiLogin):
- Título "Ingresa a Aquora" y subtítulo "Acceso para operadores y personal autorizado."
- Etiquetas de 14 px, peso 500. Campos de 52 px con icono a la izquierda.
- Correo: autoComplete="email", textContentType="emailAddress", returnKeyType="next" →
  pasa el foco a la contraseña. Placeholder "nombre@empresa.co".
- Contraseña: sin placeholder, autoComplete="current-password", textContentType="password",
  returnKeyType="go" → envía. Botón del ojo con área táctil de 44×44 y accessibilityLabel
  "Mostrar contraseña" / "Ocultar contraseña".
- Estados de campo: normal, foco (borde azul + halo), error (borde rojo Colors.danger +
  mensaje bajo el campo con accessibilityLiveRegion="polite"). Los errores de validación van
  junto al campo; el toast queda solo para errores de servidor o de red.
- Botón "Ingresar": en carga muestra "Ingresando…" y accessibilityState={{ busy: true }}.
- Enlace "¿Problemas para ingresar?": por ahora abre un aviso que diga que contacte al
  administrador (NO existe endpoint para recuperar contraseña).
- "¿Aún no tienes cuenta? Solicitar acceso" como enlace de texto que lleva a
  /(auth)/register, más el aviso "Las cuentas nuevas son de consulta hasta que un
  administrador las apruebe."
- Indicador "Servidor en línea": consulta GET /api/health al montar. Verde si responde,
  gris con "Sin conexión con el servidor" si no. No mostrar un estado falso.
- Mantener los <AppUpdateBanner> al final, dentro de la composición.
- En app.json cambiar userInterfaceStyle a "dark".

## 3. Fases (una entrada de Notion por fase)
1. Tokens de color y fuente Poppins.
2. Contenedor responsive (dos columnas / una columna).
3. Componente WaterBackground (olas, subida, burbujas) en components/, reutilizable.
4. Logo con ondas (components/LogoRipples.tsx).
5. Formulario: campos, estados, teclado, accesibilidad.
6. Indicador de servidor y enlaces.
7. Verificación.

## 4. Verificación (fase 7)
- `npm run typecheck` y `npm test -w @ptap/mobile` sin errores.
- Abrir con `npm run web` y revisar en 375, 768, 1024 y 1440 px.
- Probar: Enter avanza y envía, el ojo funciona, error de correo inválido bajo el campo,
  "Ingresando…" durante la carga, y movimiento reducido activado.
- Haz un commit por fase con mensajes en español, por ejemplo
  "feat(login): fondo de agua animado".
- Al final, dame un resumen: qué se hizo, qué quedó pendiente y el enlace a la página de
  Notion.

FIN DEL PROMPT
