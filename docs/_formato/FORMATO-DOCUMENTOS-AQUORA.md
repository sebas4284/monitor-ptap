# Formato de documentos Aquora — guía para producir PDF

Cómo se hacen los PDF de entrega de este equipo (informes, roadmaps, instructivos, guías
técnicas). No es una plantilla de Word ni una herramienta: es **HTML + CSS impreso con Chrome**.

Todo lo que sigue está tomado de los seis documentos ya entregados en `docs/`.

---

## 1. Por qué HTML y no Word / pandoc / LaTeX

- El resultado es **idéntico siempre**, en cualquier máquina.
- El documento queda **versionado en git** y se regenera con un comando.
- Se controla el pixel: tablas, avisos de color, diagramas SVG, saltos de página.
- No hay dependencias raras. En esta máquina **no hay pandoc ni wkhtmltopdf**, y no hacen falta.

Se necesitan dos cosas, ambas ya instaladas:

| Herramienta | Para qué | Ruta en esta máquina |
|---|---|---|
| Google Chrome | imprimir el HTML a PDF | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Python + PyMuPDF | **verificar** el PDF resultante | `C:\Python314\python.exe` |

---

## 2. La regla que más importa: las fuentes van incrustadas

**Chrome al imprimir no espera a las fuentes de red.** Si el CSS enlaza a Google Fonts, el PDF
sale con Segoe UI y Times New Roman, y pierde toda la identidad visual.

Por eso los documentos llevan las fuentes **en base64 dentro del propio HTML**, en un bloque
`<style>` separado. Ese bloque pesa ~420 KB y es **idéntico en los seis documentos**: no hay que
regenerarlo, se copia del que ya existe. El script `build.ps1` lo hace solo.

Son 10 caras:

```
Archivo         700, 800                 → títulos
IBM Plex Sans   400, 400 itálica, 500,
                600, 700                 → cuerpo
IBM Plex Mono   400, 500, 600            → código, cifras, etiquetas
```

> **Aviso de verificación:** PyMuPDF no lista Archivo ni IBM Plex Sans por nombre porque Chrome
> las incrusta como fuentes **Type3**. Eso **no** significa que hayan fallado. Para comprobarlo
> de verdad hay que mirar los spans de texto o la imagen renderizada (ver §7).

---

## 3. Estructura del archivo

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Título del documento</title>
<style>
<!--FONTS-->        <!-- el script sustituye esto por las 10 @font-face -->
</style>
<style>
  /* ...el CSS del documento (§4)... */
</style>
</head>
<body>
  <div class="page"> ...página 1... </div>
  <div class="page"> ...página 2... </div>
</body>
</html>
```

Cada `<div class="page">` es **una hoja A4**. La clase `.avoid` sobre un bloque impide que se
parta entre páginas — se pone en tablas, tarjetas y avisos.

Para que la **portada sangre a borde** (degradado sin marco blanco) hace falta anular el margen
solo en la primera hoja:

```css
@page{size:A4;margin:11mm 13mm 9mm}
@page:first{margin:0}
```

**Escribir siempre en UTF-8** y declarar el `<meta charset>`, o las tildes y la «ñ» salen rotas.

---

## 4. El sistema visual

### Tokens de color

```css
--brand:#0F6E7C;  --brand-2:#127C8A;  --brand-ink:#0A4C56;   /* identidad Aquora */
--ink:#0E1626;    --ink-2:#3A485C;    --ink-3:#5A6B82;       /* textos */
--hair:#D6DEE9;   --hair-2:#E4EAF1;   --raised:#EEF2F7;      /* bordes y fondos */
--live:#1F9D57;   --live-bg:#E5F5EC;    /* verde: correcto, hecho, verificado */
--stable:#2563C9; --stable-bg:#E6EEFB;  /* azul: informativo */
--warn:#B4740A;   --warn-bg:#FBF0DC;    /* ámbar: cuidado */
--frozen:#DC2626; --frozen-bg:#FBE7E7;  /* rojo: crítico, bloqueado */
```

### Tipografía

| Uso | Familia |
|---|---|
| `h1`–`h4` | **Archivo** 700/800, `letter-spacing:-.014em` |
| Cuerpo | **IBM Plex Sans**, 9.8–10.5 pt, `line-height` 1.44–1.55 |
| Código, cifras, etiquetas | **IBM Plex Mono** |

### Componentes disponibles

| Clase | Qué es | Cuándo usarlo |
|---|---|---|
| `.cover` | portada a sangre con degradado, KPIs y chips | documentos largos (roadmaps, informes) |
| `.hdr` | cabecera compacta con marca | documentos cortos, y páginas interiores |
| `.cred` | ficha destacada con borde de marca (`<dl>`) | credenciales, parámetros, datos fijos |
| `.tw` + `<table>` | tabla con marco redondeado | **la herramienta principal**: comparaciones, parámetros, errores |
| `.call.ok` / `.info` / `.warn` | aviso con borde izquierdo de color | verificado / contexto / cuidado |
| `.two` + `.card` | dos columnas con tarjetas | pasos junto a su ejemplo |
| `ol.steps` | lista numerada compacta | procedimientos |
| `.pill` (`.y`, `.r`) | píldora de estado | semáforos, versiones, etiquetas |
| `.kpi` / `.kpis` | cifras grandes en rejilla | portada, resúmenes ejecutivos |
| `.bar`, `.legend` | barras y leyenda | cronogramas, roadmaps por fases |
| `<pre>` | bloque de código sobre fondo oscuro | JSON, comandos, payloads |

`plantilla-base.html` en esta misma carpeta trae todos estos componentes ya montados con
ejemplos: se copia, se borra lo que no se use y se escribe encima.

---

## 5. Cómo se genera

```powershell
# desde la carpeta del documento
.\build.ps1
```

`build.ps1` (copiar de `docs/odoo-facturas/build.ps1`) hace tres cosas:

1. Lee el bloque de fuentes de un documento ya existente y lo inyecta en `<!--FONTS-->`.
2. Escribe un HTML temporal completo en UTF-8.
3. Lo imprime con Chrome:

```
chrome --headless=new --disable-gpu --virtual-time-budget=20000
       --no-pdf-header-footer --print-to-pdf="...\Downloads\NOMBRE.pdf" "file:///..."
```

### Dos trampas de PowerShell que cuestan tiempo

- **No redirigir stderr de Chrome** (`2>$null`, `2>&1`). En PowerShell 5.1 eso convierte la
  salida en `NativeCommandError` y el script falla aunque el PDF se haya generado bien. Chrome
  escribe avisos de GCM y Google Docs en stderr; son ruido normal, se ignoran.
- **Leer los HTML con `[System.IO.File]::ReadAllText($ruta, $utf8)`**, no con `Get-Content`, que
  destroza los acentos.

---

## 6. Dónde va el PDF

A **`C:\Users\USUARIO\Downloads\`**, que es donde se recogen los entregables. El HTML fuente se
queda versionado en `docs/<tema>/` para poder regenerarlo y editarlo después.

---

## 7. Verificación — el paso que no se salta

Que Chrome termine sin error **no significa que el PDF esté bien**. En este entorno no hay
poppler; la única forma de ver el resultado es rasterizar con PyMuPDF y **mirar las imágenes**.

```python
import pymupdf, os
d = pymupdf.open(os.path.expanduser("~/Downloads/NOMBRE.pdf"))
print("paginas:", d.page_count)
for i, p in enumerate(d):
    p.get_pixmap(dpi=110).save(f"pag{i+1}.png")
```

Y en las imágenes comprobar:

- [ ] El **número de páginas** es el previsto, y no hay hoja en blanco al final.
- [ ] Los títulos salen en **Archivo** y el cuerpo en **IBM Plex Sans** (si se ve Segoe UI o
      Times New Roman, las fuentes no se incrustaron).
- [ ] Ningún bloque de código, tabla o tarjeta **partido** entre dos páginas.
- [ ] Tildes y «ñ» correctas, sin `Ã³` ni símbolos raros.
- [ ] Las páginas **no quedan medio vacías** ni apelmazadas.

**El desbordamiento es el fallo más común.** Un documento pensado para 5 páginas sale con 8
porque cada sección se pasa un poco. Se corrige compactando el CSS global —`font-size` del
`body`, `@page margin`, paddings de `.call`/`.card`/`table`— antes que recortando contenido útil.

---

## 8. Criterio de redacción

El formato acompaña a una forma de escribir que conviene mantener:

- **Poco texto.** Tablas, listas cortas y diagramas antes que párrafos.
- **Una idea por bloque**, con su título numerado (`<h3><span class="n">01</span>…`).
- **Decir lo que no se sabe.** Si algo no se pudo verificar, el documento lo dice en vez de
  aparentar certeza. Es lo que hace que el lector confíe en el resto.
- **No presentar una vía como la única** cuando hay alternativas reales.
- **Cerrar pidiendo una decisión concreta**, si el documento espera respuesta.

---

## 9. Ejemplos para copiar

| Documento | Sirve de modelo para |
|---|---|
| `docs/odoo-facturas/ODOO19-JSON2-FACTURAS.html` | guía técnica corta (5 pág.), diagrama SVG, tabla de decisión |
| `docs/correo/INSTRUCTIVO-OUTLOOK-DESARROLLO.html` | instructivo (3 pág.), fichas `.cred`, tablas de parámetros |
| `docs/roadmap/ROADMAP-AQUORA.html` | roadmap largo (16 pág.), portada con KPIs, fases |
| `docs/escalera-odoo/ESCALERA-ODOO-MAKE.html` | informe con barras y leyenda (10 pág.) |
| `docs/notificaciones/SISTEMA-NOTIFICACIONES.html` | documento técnico largo (19 pág.) |

---

## 10. Arrancar un documento nuevo

```
1. mkdir docs/<tema>
2. copiar docs/_formato/plantilla-base.html  →  docs/<tema>/NOMBRE.html
3. copiar docs/odoo-facturas/build.ps1        →  docs/<tema>/build.ps1
   (ajustar $fuente y $salida)
4. escribir el contenido
5. .\build.ps1
6. rasterizar y mirar las páginas (§7)
```
