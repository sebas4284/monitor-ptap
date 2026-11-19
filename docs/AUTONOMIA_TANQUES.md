# Autonomía individual de tanques

La estimación utiliza el descenso medido de cada tanque. No presupone que el tanque esté conectado a la válvula o al caudalímetro de salida de la planta. Una entrada, transferencia o fuga afecta la pendiente observada: esta representa **vaciado neto**, no consumo de salida aislado.

Con volumen disponible, se ajusta una pendiente en m³/h y se calcula:

`horas hasta vacío = volumen actual / velocidad de descenso del volumen`

Para el mínimo operativo, se aproxima sección constante `área = volumen / nivel` y volumen útil `máx(0, área × (nivel − mínimo))`. Su cociente con la velocidad de descenso da las horas hasta el mínimo. Sin volumen válido se usa directamente `máx(0, nivel − mínimo) / velocidad de descenso del nivel`, en m y m/h. La extrapolación por nivel y la conversión V/nivel suponen geometría aproximadamente prismática y referencia de nivel coherente; no sustituyen una curva de aforo.

El mínimo es `opMin` del mapping. Si falta y existe `opMax`, se usa el 50 % como **referencia explícita**, no como una reserva física confirmada. Sin ambos límites puede estimarse el tiempo hasta vacío, pero no el de servicio. No cambia el porcentaje de llenado (`nivel / opMax`).

Se conservan hasta 15 minutos de lecturas y se requieren al menos tres muestras distintas que cubran cinco minutos, con huecos de hasta tres minutos. Las lecturas deben ser válidas y recientes (hasta dos minutos). El ajuste exige un descenso de al menos el 1 % y R² ≥ 0,8. Son criterios iniciales de filtrado que deben calibrarse con sensores y operación reales; R² no es una probabilidad de acierto. No se proyectan series de llenado, ruido o datos obsoletos. Después de reiniciar o perder datos debe reunirse una ventana nueva.

La tarjeta distingue el tiempo al mínimo del tiempo al vacío y muestra el método utilizado. Sin evidencia suficiente indica «Sin estimación». Los avisos y la tarjeta reciben el mismo resultado. La publicación se actualiza también cuando cambia solo la autonomía.

El cálculo recorre todas las plantas configuradas y mantiene historias independientes por planta y clave de tanque. Incluye las lecturas de Soledad etiquetadas provisionalmente como San Antonio y El Quijote, conservando sus claves de origen. Esa identificación y su posible retransmisión siguen sin confirmar en la ficha del integrador; una estimación de autonomía no demuestra a qué planta pertenece un tanque. Véase [DATA_CATALOG.md](DATA_CATALOG.md), apartado «Asociación sin confirmar». No se reasignan señales ni se modifica el PLC. Las plantas todavía sin señales de tanque no reciben valores inventados.

La estimación es condicional: supone que continúa el régimen observado. No predice aperturas de válvulas, cambios futuros de demanda ni pérdidas de presión no medidas. La ventana se conserva en memoria; no se añade almacenamiento de telemetría ni dependencias.
