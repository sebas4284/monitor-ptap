# Sistema de notificaciones — informe técnico

> **El entregable es el PDF**, no este archivo: `Sistema-Notificaciones-Aquora.pdf`.
> Aquí solo está el índice y el resumen, para no abrir 21 páginas cada vez que alguien
> pregunta cómo avisa la plataforma.
>
> Fuente del PDF: [`notificaciones/SISTEMA-NOTIFICACIONES.html`](./notificaciones/SISTEMA-NOTIFICACIONES.html)
> — versionada y regenerable. Escrito el **2026-09-07**, con la 1.3.0 en producción.

## Cómo se regenera el PDF

```bash
chrome --headless=new --disable-gpu --virtual-time-budget=20000 --no-pdf-header-footer \
  --print-to-pdf="<destino>/Sistema-Notificaciones-Aquora.pdf" \
  "file:///<ruta>/docs/notificaciones/SISTEMA-NOTIFICACIONES.html"
```

Deben salir **21 páginas**. Las fuentes van **incrustadas en el HTML** y los gráficos son SVG en
línea: se regenera sin conexión. El bloque de `<style>` final es un ajuste de densidad propio de
este documento —es más denso que el roadmap— sin el cual cada sección derrama un párrafo a una
página nueva.

## Contenido

| Parte | Secciones | Qué contiene |
|---|---|---|
| **I** | §02 – §06 | La tubería de un aviso, el catálogo de los 7 tipos, las 4 capas, preferencias y entrega |
| **II** | §07 – §09 | Cronología de los defectos de agosto, los 5 principios que quedaron, estado y deuda |
| **III** | §10 – §14 | Techo de las reglas, dónde encaja la IA y dónde no, costo, riesgos y plan |

## Lo que hay que saber sin leerlo

- **7 tipos de aviso**, 3 gravedades, 5 detectores. Todo el catálogo está en §03 con sus umbrales.
- **No hay servidor de push.** El dispositivo pregunta cada ~15 min; la entrega es «lo mejor
  posible» y está documentada como tal. En web las notificaciones siguen **bloqueadas** por HTTPS.
- **Las tres reglas que no se tocan:** silenciar no borra; las maniobras de válvula y el aviso de
  libro de firmas roto no se pueden callar por ningún camino; la preferencia es lista negra, no
  lista blanca.
- **La señal de retroalimentación ya se está grabando** desde el 2026-08-21 (silencios y tiempos
  hasta la lectura) y nadie la lee. Es el argumento central de la Parte III.
- **Recomendación:** la fase A de §14 —informe semanal fuera de línea, ~2 días, sin tocar la app ni
  el servidor— **antes de la semana del 19 de octubre**, porque es la entrada que la sección 7 del
  roadmap («alarmas configurables») necesita para no elegir umbrales a ojo.

## Documentos relacionados

- [`ROADMAP.md`](./ROADMAP.md) — secciones 2 (filtros en la bandeja) y 7 (alarmas configurables).
- [`PENDIENTES.md`](./PENDIENTES.md) — §4b (parámetros y volumen), §3 decisión D3, §2b (integrador).
- [`CATALOGO_ERRORES.md`](./CATALOGO_ERRORES.md) — SRV-09, DAT-09, DEF-07 y DEF-14.
- [`RUNBOOK_PRODUCCION.md`](./RUNBOOK_PRODUCCION.md) §5 — ámbito por planta en los tres canales.
