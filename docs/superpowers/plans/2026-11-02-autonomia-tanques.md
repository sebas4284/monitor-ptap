# Autonomía de tanques

Objetivo: estimar autonomía individual en todas las plantas, incluso cuando no se conoce la conexión entre tanque y válvula/caudalímetro.

Diseño: no atribuir un caudal global a un tanque sin asociación hidráulica. Estimar el descenso neto de volumen o nivel mediante varias lecturas recientes. Conservar porcentaje de llenado y distinguir tiempo al mínimo operativo de tiempo al vacío. El mínimo configurado tiene prioridad; el 50 % solo es una referencia explícita si falta mínimo. Sin tendencia suficiente se muestra «Sin estimación».

Alternativas: balance de caudales requiere topología confirmada (ausente en mapping); reparto proporcional inventaría conexiones. Se elige tendencia propia por solicitud del usuario. La pendiente es vaciado neto, no consumo de salida: incluye entradas y transferencias. Es una extrapolación condicionada a que continúe el régimen observado, no garantía de servicio.

Trabajo:
- Backend: validar calidad/frescura, reunir ventana por planta/tanque, estimar pendiente y rechazar ruido, llenado y huecos. Actualizar stock cada barrido y avisos con el mismo resultado.
- Contrato y tarjeta: agregar tiempo al mínimo, método y limitación; mantener campos de vacío/50 % por compatibilidad. Invalidar memo cuando cambia cualquier dato visible.
- Verificación: sensores inválidos, volumen/nivel, pendientes independientes, reinicio/huecos, mínimo alcanzado y cobertura del mapping. Ejecutar pruebas focalizadas y typecheck.

Alcance: código local; sin cambios de PLC, instalaciones, nuevas dependencias ni publicación. Los cambios previos del usuario se preservan. Consultada documentación oficial Expo SDK 58.0.0 antes de editar. La revisión de seguridad limita lectura externa a documentación pública; no se envían datos de planta.
