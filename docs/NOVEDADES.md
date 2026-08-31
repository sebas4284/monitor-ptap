# Novedades

Lo que cambió en cada versión de la app, **escrito para quien la usa** — no para quien la programa.
La pestaña «Novedades» de la bandeja de notificaciones lee este archivo a través de
`GET /api/app/novedades`, así que lo que se escriba aquí es lo que lee el operador en su teléfono.

Tres reglas para mantenerlo:

1. **Una entrada por versión PUBLICADA**, con el mismo texto que se le pone a
   `~/deploy-scripts/notas-version.txt` en la VM. Son las dos caras del mismo aviso: ese archivo
   viaja junto al APK y alimenta el banner de «hay versión nueva»; este alimenta el historial.
2. **La entrada se añade cuando se publica**, no cuando se escribe el código. Anunciar en la app una
   versión que nadie puede instalar todavía es la manera más rápida de que este listado deje de
   creerse.
3. **En pasado y sin jerga.** «Vuelve el mando de las electroválvulas», no «se reintroduce el
   endpoint de comando con validación de interlock».

El formato lo lee `novedades.parser.ts`: `## <versión> — <fecha>` y debajo los puntos con `-`.
Las secciones de prosa como esta se ignoran, así que se puede escribir con libertad alrededor.

---

## 1.3.0 — 2026-08-26

- Vuelve el mando de las electroválvulas, pero solo donde la planta puede obedecer de verdad: cada
  una ofrece únicamente lo que su equipo acepta, y donde no se puede accionar te dice por qué en
  lugar de dejar un botón que no hace nada.
- La barra superior pasa a ser Aquora.
- El diagnóstico de conexión ya no se equivoca al señalar culpables: distingue si el corte es de la
  red, de un cortafuegos o del equipo de la planta, y dice qué pedir en cada caso.
- El aviso de versión nueva también aparece en el tablero, no solo al entrar y en Ajustes.

## 1.2.4 — 2026-08-22

- Ahora puedes comprobar desde la app que el registro de maniobras no ha sido alterado: la bandeja
  de Notificaciones lo dice arriba del todo, y el servidor lo revisa solo cada 6 horas. Si alguna
  vez no cuadra, llega un aviso crítico a los teléfonos de esa planta.
- La autonomía del tanque deja de recalcularse por cambios pequeños: solo si el caudal de salida se
  aparta más de 0,3 l/s del de referencia.
- Se arregló el texto que se salía de las tarjetas en teléfonos estrechos.
