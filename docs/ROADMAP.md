# Roadmap — septiembre a noviembre de 2026

> **El entregable para el cliente es el PDF**, no este archivo: `Roadmap-Aquora.pdf`.
> Aquí solo está el índice, para no tener que abrirlo cada vez que alguien pregunta qué toca esta semana.
>
> Fuente del PDF: [`roadmap/ROADMAP-AQUORA.html`](./roadmap/ROADMAP-AQUORA.html) — versionada y regenerable.
> Escrito el **2026-09-04**, con la 1.3.0 en producción y cuatro de las ocho partes de la 1.4.0 entregadas.

## Cómo se regenera el PDF

```bash
chrome --headless=new --disable-gpu --virtual-time-budget=20000 --no-pdf-header-footer \
  --print-to-pdf="<destino>/Roadmap-Aquora.pdf" \
  "file:///<ruta>/docs/roadmap/ROADMAP-AQUORA.html"
```

Deben salir **17 páginas**. Las fuentes van **incrustadas en el HTML** a propósito: al imprimir,
Chrome no espera a las que vienen de red, y el documento es autocontenido — se regenera sin conexión.
Los gráficos son SVG en línea, sin CDN ni imágenes externas.

## Semana 0 — antes de empezar, y no cabe al final

Tres pendientes de infraestructura de minutos, con sudo en la VM. Detalle en
[`PENDIENTES.md`](./PENDIENTES.md).

- [ ] Cerrar `/hmi/` — hoy responde 200 desde Internet **sin autenticación**.
- [ ] Abrir el puerto 80 en ufw — sin él **el certificado vence el 2026-10-29**, dentro de la semana 8.
- [ ] `sudo timedatectl set-ntp true`.

## Las diez secciones

| # | Sección | Semana | Alcance | Hito | De dónde sale |
|---|---|---|---|---|---|
| 1 | Revisión por planta | 07 – 11 sep | app + servidor | — | Fase A de [`PLAN_CONSOLA_ADMIN_1.4.0.md`](./PLAN_CONSOLA_ADMIN_1.4.0.md) |
| 2 | Filtros y orden en la bandeja | 14 – 18 sep | solo app | — | `PENDIENTES.md` §4b + nuevo |
| 3 | Filtros y búsqueda en el tablero | 21 – 25 sep | solo app | — | nuevo + `GUIA_ESTILO.md` §9 *(en la rama `estilos-1.4`)* |
| 4 | Ayuda y preguntas frecuentes | 28 sep – 02 oct | solo app | — | Fase B1 |
| 5 | Tutorial guiado | 05 – 09 oct | solo app | — | Fase B2 |
| 6 | Estilos y pulido visual | 12 – 16 oct | app + publicación | **v1.4.0** | rama `estilos-1.4` (tokens + `GUIA_ESTILO.md` §9) |
| 7 | Alarmas configurables | 19 – 23 oct | app + servidor + BD | — | decisión D3 de `PENDIENTES.md` §3 |
| 8 | Historial acotado | 26 – 30 oct | app + servidor + BD | **v1.5.0** | decisión D1 — **bloqueada por el cliente** |
| 9 | Deuda técnica y calidad | 02 – 06 nov | interno | — | `PENDIENTES.md` §4 + `CATALOGO_ERRORES.md` |
| 10 | Infraestructura y seguridad | 09 – 13 nov | producción | cierre | Fase C.4 + `PENDIENTES.md` §1 y §2 |

**Regla de secuencia:** una sección, una semana, una solicitud de merge verificada en local. No se
abren dos a la vez. **La sección 8 no puede empezar sin la decisión D1**; si sigue abierta el 26 de
octubre, se adelanta la 9 y la 8 se corre.

## Fuera de las diez secciones

- **Sensores congelados** en KM 18, Pichindé y Cascajal — es del integrador, no de la plataforma
  (`PENDIENTES.md` §2b).
- **Cierre por turbiedad** ([`PROTOCOLO_TURBIEDAD.md`](./PROTOCOLO_TURBIEDAD.md)) — acordado, sin
  código, y hoy imposible: ninguna planta tiene turbiedad **y** válvula de entrada a la vez.
- **D2** — formalizar por escrito que Expo web sustituye a la «Aplicación Web en React».
