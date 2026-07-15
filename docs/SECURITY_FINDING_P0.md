# Hallazgo de seguridad P0 — Servidor OPC UA de PTAP expuesto sin autenticación

| Campo | Valor |
|---|---|
| **ID** | P0-OPCUA-001 |
| **Severidad** | CRÍTICA (P0) |
| **Categoría** | Exposición de infraestructura crítica (OT/ICS — agua potable) |
| **Fecha de detección** | 2026-07-12 |
| **Detectado por** | Ingeniería inversa de solo lectura (`tools/plc-discovery`), captura `output/00_endpoints.json` |
| **Componente** | Servidor OPC UA FactoryTalk Optix HMI del PLC maestro CompactLogix 1769-L27ERM-QBFC1B |
| **Estado** | **REPORTADO — pendiente de mitigación por la planta** |
| **Responsable propuesto** | Administrador OT / integrador de FactoryTalk Optix de AQUATECH |

---

## 1. Resumen ejecutivo

El servidor OPC UA que expone el PLC maestro de 13 sitios de tratamiento de agua potable es **accesible desde Internet, acepta sesiones anónimas sin cifrado, y expone todos sus tags con permiso de escritura**. En conjunto, esto significa que **cualquier persona con ruta de red hacia el servidor puede escribir en los buffers de comando que el maestro envía a los PLC locales de las plantas, sin autenticarse.**

Es un riesgo de seguridad de infraestructura crítica de severidad máxima. Existe con independencia de la calidad del software de este repositorio: el backend en desarrollo aún no escribe nada, pero la superficie de ataque ya está abierta en el propio servidor de la planta.

## 2. Evidencia

Toda la evidencia proviene de una única sesión de solo lectura (Browse/Read; nunca Write, nunca Call). Artefacto: `tools/plc-discovery/output/00_endpoints.json`.

### 2.1 Endpoint accesible por IP pública
- Endpoint solicitado y alcanzado: **`opc.tcp://181.204.165.66:59100`** (IP pública).
- El servidor se anuncia internamente como `10.10.51.225:59100` (NAT); se accede por la IP pública con `endpointMustExist: false`.
- Estado del servidor en la captura: `Running` (`FactoryTalkOptix HMI`).

### 2.2 Acepta sesión anónima y sin cifrado
El servidor publica 7 endpoints. El primero:

```
endpointUrl:        opc.tcp://10.10.51.225:59100
securityMode:       None
securityPolicyUri:  http://opcfoundation.org/UA/SecurityPolicy#None
securityLevel:      0
userTokens:         Anonymous, UserName, Certificate
```

**Se estableció una sesión real con `SecurityMode=None` + identidad `Anonymous`, al primer intento, sin credenciales** (`sessionEstablished: { securityMode: "None", identity: "Anonymous", attempts: [] }`). Con esa sesión anónima se recorrieron y leyeron **3.402 nodos**.

El servidor **sí ofrece** modos seguros (no obligatorios): `Basic256Sha256`, `Aes128_Sha256_RsaOaep` y `Aes256_Sha256_RsaPss`, en `Sign` (securityLevel 65/70/75) y `SignAndEncrypt` (securityLevel 115/120/125). Están disponibles pero **no se exigen**.

### 2.3 Todos los tags son escribibles
Todos los tags del controlador se exponen con `AccessLevel = 3` (CurrentRead + CurrentWrite). Entre ellos, los **buffers de comando** que el maestro escribe hacia los PLC locales de cada sitio:

- `INT_OUT_<SITIO>` (p. ej. `INT_OUT_VORAGINE`, `INT_OUT_SIRENA`, `INT_OUT_MONTEBELLO`, …)
- `REAL_OUT_MONTEBELLO`
- `DATOS_OUT_PTAP_SOLEDAD`

Estos buffers son el canal por el que el maestro ordena acciones a los sitios remotos (a través de instrucciones MSG de Rockwell).

## 3. Impacto

Un actor no autenticado con ruta de red hacia `181.204.165.66:59100` puede, **hoy**:

1. Leer todo el estado de proceso de los 13 sitios (fuga de información operativa).
2. **Escribir en los buffers de comando de salida** (`*_OUT_*`) sin credenciales ni cifrado.

La escritura sobre un índice de un buffer OUT puede traducirse, en el PLC local, en el accionamiento de un equipo real (electroválvula, bomba). Escribir en el índice equivocado, o con intención maliciosa, puede **alterar la operación de una planta de tratamiento de agua potable** — con consecuencias potenciales sobre continuidad del servicio y calidad del agua.

> Nota de alcance: no conocemos aún el mapa índice→equipo (falta el export L5X). Esa incertidumbre **no reduce** el riesgo: reduce la precisión de un atacante, no su capacidad de escribir.

## 4. Mitigación recomendada

Responsable: administrador OT / integrador de FactoryTalk Optix. Orden sugerido:

1. **Restricción de red (inmediato).** Cerrar el puerto `59100/tcp` al exterior. El acceso al servidor OPC UA debe ocurrir solo a través de **VPN** o de una red de gestión OT segregada. Ningún servicio OT debería ser alcanzable directamente desde Internet.
2. **Deshabilitar `None`/`Anonymous`.** Retirar los endpoints con `SecurityMode=None` y el token `Anonymous`. Exigir sesión autenticada.
3. **Forzar cifrado y firma.** Aceptar únicamente `Basic256Sha256` (o superior) con `SignAndEncrypt`. El servidor ya los ofrece (securityLevel 115/125), solo hay que hacerlos obligatorios.
4. **Autenticación fuerte.** Habilitar `UserName` con credenciales robustas y/o autenticación por **certificado de cliente** confiado en el almacén de FactoryTalk Optix. El backend (gateway) usará esta vía.
5. **Principio de mínimo privilegio en `AccessLevel`.** Cambiar a **solo lectura** todos los tags que no necesiten ser escritos por clientes externos. Restringir la escritura a los buffers de comando estrictamente necesarios, y solo para clientes autenticados y autorizados.

## 5. Impacto de la mitigación sobre el backend (este proyecto)

El adaptador OPC UA del backend (Fase 1 en adelante) está diseñado para **conmutar de `Anonymous + None` a `UserName`/`Certificate` + `SignAndEncrypt` solo cambiando variables de entorno**, sin tocar código. Además, la escritura de comandos permanece **prohibida por defecto** (`OPCUA_WRITES_ENABLED=false`) y, cuando se habilite, un guard rechazará toda escritura si la sesión no es **autenticada y cifrada**. Es decir: el endurecimiento del servidor por parte de la planta es **precondición** para habilitar el canal de comandos del backend.

## 6. Seguimiento

| Fecha | Estado | Nota |
|---|---|---|
| 2026-07-12 | REPORTADO | Hallazgo documentado a partir de la captura de descubrimiento. Pendiente de comunicación formal a la planta y de confirmación de mitigación. |
| 2026-07-14 | REPORTADO — mitigaciones del lado backend completadas (Fase 4); servidor sin cambios | El **servidor de la planta sigue sin endurecer** (sección 4 completa pendiente del administrador OT — esta fila no cambia esa responsabilidad). Del lado del **backend/gateway** se completó: (a) conmutación real y probada por `.env` a `SignAndEncrypt`+`Basic256Sha256` con identidad `username` o `certificate`, verificada de punta a punta contra un servidor OPC UA local (`apps/api/test/opcua-security-switch.test.ts`) — ver `docs/OPTIX_CLIENT_CERT_TRUST.md` para el procedimiento de confiar certificados con Optix; (b) JWT + RBAC en los endpoints del gateway (`/api/opc/*`, `/api/plants/*`, `/api/snapshots/*`) — sin token válido → 401, rol insuficiente → 403; (c) audit log en MySQL de accesos y transiciones de `BridgeStatus`; (d) `GET /api/health/opc` (503 en `Stale`/`Faulted`) y métricas Prometheus en `/metrics`; (e) `OPCUA_WRITES_ENABLED` sigue en `false` por defecto — Fase 5 (comandos) no ha comenzado. **Gap conocido y pendiente, no resuelto en esta fase:** el gateway Socket.IO (`connectivity.gateway.ts`) sigue sin autenticación — protegerlo requiere que el cliente móvil envíe el JWT en el handshake, cambio fuera del alcance de Fase 4. |

> Este documento es autosuficiente: puede entregarse al responsable OT de la planta sin contexto adicional del repositorio.
