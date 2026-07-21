# Incidente: se perdió el acceso al PLC maestro

**Fecha:** 2026-07-21 · **Estado:** abierto, a la espera del administrador OT de la planta
**Impacto:** el monitoreo no recibe datos de **ninguna** de las 12 plantas desde ~15:47.

> **Resumen en una línea:** el servidor OPC UA `181.204.165.66` dejó de ser alcanzable desde
> internet. Las plantas siguen operando y enviando datos al PLC maestro con normalidad; lo que se
> perdió es la **ruta de red** entre el servidor de monitoreo y ese maestro.

---

## 1. Qué se observa

La aplicación muestra "sin dato" en todas las plantas y el puente OPC UA queda en `Connecting`,
reintentando con backoff cada 30 s de forma indefinida (comportamiento correcto y esperado).

## 2. Evidencia técnica

Pruebas hechas desde el equipo de monitoreo el 2026-07-21, **sin pasar por la aplicación**
(`Test-NetConnection`, TCP crudo):

| Destino | Puerto | Resultado |
|---|---|---|
| `8.8.8.8` (internet general) | 53 | ✅ **alcanzable** |
| `181.204.165.66` (PLC maestro) | **59100** (OPC UA) | ❌ **inalcanzable** |
| `181.204.165.66` (mismo host) | 80 | ❌ **inalcanzable** |

**Dos detalles que acotan la causa:**

1. **El host completo no responde**, no solo el puerto OPC UA. Si únicamente se hubiera caído el
   servicio OPC UA, el puerto 59100 daría *conexión rechazada* y el host seguiría respondiendo en
   otros puertos.
2. **Cada intento tarda ~21 s en fallar** (timeout), no falla al instante. Un *timeout* significa
   que los paquetes salen y **nadie contesta** — típico de un cortafuegos que los descarta, de un
   host apagado o de una dirección que ya no corresponde a ese equipo. Un *rechazo* inmediato, en
   cambio, indicaría que el host está vivo pero sin nada escuchando.

La conectividad a internet del equipo de monitoreo **funciona correctamente**, así que el problema
no está en la red del monitoreo.

## 3. Descartado: no es un fallo de la aplicación

- El resto de la cadena (sesión OPC UA → parser → mapeo → calidad → snapshot → API → pantalla) se
  verificó el mismo día con el adaptador **simulador**: entrega valores correctos, en movimiento y
  con estado `EN VIVO`. Es el mismo código que se usa contra el PLC real.
- El mapeo de señales (`opc_mapping.json`) se comparó contra la versión anterior: los identificadores
  de nodo, buffers e índices están **intactos**.
- La suite automatizada del backend pasa completa.

## 4. Hipótesis (por probabilidad)

**A. Se cerró el puerto al exterior.** Es exactamente la mitigación nº 1 que este proyecto solicitó
por escrito en [`SECURITY_FINDING_P0.md`](SECURITY_FINDING_P0.md): *"cerrar el puerto 59100/tcp al
exterior; el acceso debe ocurrir solo por VPN o red OT segregada"*. Si se aplicó, el síntoma sería
**idéntico al observado**. Sería una buena noticia de seguridad que solo requiere darnos una vía de
acceso apropiada.

**B. Cambió la IP pública de la planta.** El servidor se anuncia internamente como
`10.10.51.225:59100` detrás de NAT; se accedía por la IP pública `181.204.165.66`. Si esa IP es
dinámica y rotó, el destino actual ya no es el equipo correcto.

**C. Caída del enlace a internet de la planta** o del propio equipo servidor.

## 5. Qué necesitamos del administrador OT

1. **¿Se cerró el puerto `59100/tcp` hacia internet** (o se aplicó alguna restricción de red nueva)
   el 2026-07-21 alrededor de las 15:45?
2. **¿Sigue siendo `181.204.165.66` la dirección pública** del sitio? Si cambió, ¿cuál es la nueva?
3. **Si el acceso pasa a ser por VPN**: ¿qué credenciales/perfil se nos entrega y desde qué equipo se
   permite conectar?

## 6. Qué haremos al recibir respuesta

Ningún cambio de código; solo configuración (`.env`), y el servicio se recupera solo:

| Escenario | Acción |
|---|---|
| IP pública nueva | `OPC_ENDPOINT=opc.tcp://<IP nueva>:59100` |
| Acceso por VPN a la red OT | Conectar la VPN y `OPC_ENDPOINT=opc.tcp://10.10.51.225:59100` (la dirección interna que el servidor ya anuncia) |
| Servidor caído | Ninguna acción por nuestra parte: el puente reconecta solo al volver el servicio |

**Nota:** el puente reintenta indefinidamente, así que **no hace falta reiniciar nada** cuando el
enlace se restablezca: los datos reaparecen por sí solos.

## 7. Recordatorio de seguridad

Si la hipótesis A es la correcta, conviene **no revertir** el cierre del puerto. Exponer un servidor
OT directamente a internet es el hallazgo P0 de este proyecto: hoy ese endpoint acepta sesiones
anónimas sin cifrar y con tags escribibles. La vía correcta es VPN o red segregada, no reabrir el
puerto.
