# Frescura y conexión — guía técnica

> **El entregable es el PDF**, no este archivo: `Frescura-y-Conexion-Aquora.pdf`.
> Aquí solo está el índice y el resumen operativo.
>
> Fuente del PDF: [`frescura/FRESCURA-Y-CONEXION.html`](./frescura/FRESCURA-Y-CONEXION.html)
> — versionada y regenerable. Escrito el **2026-09-07**, con la 1.3.0 en producción.
> Es la guía que hay que darle a quien entre al proyecto y vaya a tocar el puente, el pipeline
> o el tablero.

## Cómo se regenera el PDF

```bash
chrome --headless=new --disable-gpu --virtual-time-budget=20000 --no-pdf-header-footer \
  --print-to-pdf="<destino>/Frescura-y-Conexion-Aquora.pdf" \
  "file:///<ruta>/docs/frescura/FRESCURA-Y-CONEXION.html"
```

Deben salir **16 páginas**. Fuentes incrustadas y gráficos SVG en línea: se regenera sin conexión.

## Contenido

| Parte | Secciones | Qué contiene |
|---|---|---|
| **I** | §02 – §06 | Las tres capas de estado, la máquina del puente, las cinco reglas de frescura, quién bloquea qué, y qué ve el operador |
| **II** | §07 – §09 | Socket contra REST, el mapa de archivos y de pruebas, y el árbol de diagnóstico en campo |
| **III** | §10 – §12 | Los once fallos con fecha, los huecos de cobertura, la deuda y los ocho invariantes |

## Lo que hay que saber sin leerlo

**Son dos preguntas distintas, con dos culpables distintos.** «¿El enlace está arriba?» la responde
el puente (6 estados, global). «¿El dato se mueve?» la responde la frescura (3 estados, por planta).
Y hay una tercera que costó 41 h: «¿el dato que entra llega a valer para algo?».

**Las cinco reglas de frescura**, en orden: sin sesión sana → `frozen`; sin haber visto nunca un
cambio → `stable` dentro de la ventana y `frozen` pasada; cambio hace ≤ 10 s → `live`; hace > 300 s
→ `frozen`; resto → `stable`. Parámetros: `LIVENESS_LIVE_SEC=10`, `LIVENESS_WINDOW_SEC=300`
(sobrescribible por planta con `livenessWindowSec` en el mapeo), `LIVENESS_SWEEP_MS=2000`.
Los 300 s **se midieron**: las plantas vivas cambian cada ~16 s, 6× de margen.

**Diagnóstico de «la planta no se actualiza», en tres pasos:**

```bash
curl -s http://127.0.0.1:4000/api/health/opc | jq   # 5 s — ¿los dos extremos van a la par?
curl -s .../api/diagnostics/route-check -H "Authorization: Bearer $JWT"   # 15 s — de quién es
npx tsx scripts/diagnose-freshness.ts              # 30 s, en la VM — campo vs nuestro
```

Si `lastNotificationAt` avanza y `lastFrameEmittedAt` se queda atrás, es el atasco aguas abajo:
`pm2 restart ptap-api` (**nunca** con `--update-env`).

**Los archivos que importan:** `pipeline/liveness.tracker.ts` (las reglas y el mejor comentario del
repo), `bridge/bridge-state-machine.ts`, `bridge/frame-coalescer.ts` (la bandera de las 41 h),
`connectivity.config.ts` (todos los umbrales), `modules/health/opc-health.ts`,
`apps/mobile/hooks/useSnapshot.ts` (socket + REST + respaldo local) y
`apps/mobile/components/memo-compare.ts` (**léelo antes de añadir un campo a una tarjeta**).

## Deuda que la guía deja anotada

- **Cero pruebas de interfaz en el móvil** — badge, banner, `useSnapshot` y el respaldo local sin cubrir.
- **La detección de atasco aguas abajo no está probada**, y el simulador no la implementa.
- **`lastFrameEmittedAt` no llega a Prometheus**, y el alimentador de métricas se engancha a la
  llegada de tramas: si se reproduce el atasco, las métricas se congelan en vez de delatarlo.
- **El monitor externo sigue sin montarse** (el mecanismo está listo desde julio).
- **Cinco sitios documentan estados que ya no existen** (`idle`/`stale`/`unknown`), entre ellos
  `DATA_CATALOG.md` y `architecture/backend-methods.md`, que son los dos primeros que abriría
  alguien nuevo. Detalle en §11 del PDF.
- **Campo:** KM 18 y Pichindé 25,0 días; Cascajal 22,6 — escalado al integrador, falta el contador
  de latido por sitio.

## Documentos relacionados

- [`NOTIFICACIONES.md`](./NOTIFICACIONES.md) — el otro subsistema que consume la frescura.
- [`CATALOGO_ERRORES.md`](./CATALOGO_ERRORES.md) — SRV-09, DAT-09, DEF-05/06/07/10/14.
- [`INCIDENTE_CONEXION_PLC.md`](./INCIDENTE_CONEXION_PLC.md) §8 — cómo alertar de un corte.
- [`OPERATIONAL_VALIDATION.md`](./OPERATIONAL_VALIDATION.md) §1 y §5 — caos y repetición real.
- [`PENDIENTES.md`](./PENDIENTES.md) §2b — sensores congelados en campo.
- [`RUNBOOK_PRODUCCION.md`](./RUNBOOK_PRODUCCION.md) §7 y §11.6 — `pm2` y la ruta al PLC.
