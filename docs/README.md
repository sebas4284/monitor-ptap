# Documentación Oficial — Monitor PTAP

Este directorio centraliza toda la documentación técnica, arquitectónica, operacional y de protocolos del sistema de telemetría y control para las 16 Plantas de Tratamiento de Agua Potable (PTAP).

---

## 1. Arquitectura y Diseño

Decisiones estructurales, contratos de datos y postura de seguridad del monorepo.

* [**DATA_CATALOG.md**](./DATA_CATALOG.md): Catálogo oficial de señales, buffers e índices por planta (generado desde el mapping).
* [**CATALOGO_ERRORES.md**](./CATALOGO_ERRORES.md): Diccionario canónico de códigos de error (`PLC-*`, `SRV-*`, `FRT-*`).
* [**architecture/backend-structure.md**](./architecture/backend-structure.md): Arquitectura modular de NestJS, separación de capas y pipeline de telemetría.
* [**architecture/backend-methods.md**](./architecture/backend-methods.md): Especificación de métodos y servicios internos.
* [**PROPUESTA_HOT_RELOAD_MAPPING.md**](./PROPUESTA_HOT_RELOAD_MAPPING.md): Estrategia de actualización en caliente del mapeo sin interrupción de telemetría.
* [**SECURITY_FINDING_P0.md**](./SECURITY_FINDING_P0.md): Hallazgo de seguridad P0 del servidor OPC UA y defensas perimetrales implementadas.
* [**SEGURIDAD_FRONTEND.md**](./SEGURIDAD_FRONTEND.md): Mecanismos de protección en cliente móvil y sesión de usuario.

---

## 2. Operaciones y Producción

Guías de despliegue, aprovisionamiento, runbooks y contingencias en el servidor.

* [**RUNBOOK_PRODUCCION.md**](./RUNBOOK_PRODUCCION.md): Manual de operación diaria, reinicio de servicios (PM2), Nginx y procedimientos de recuperación.
* [**CHECKLIST_PRODUCCION.md**](./CHECKLIST_PRODUCCION.md): Lista de chequeo previa a despliegues y verificación de endurecimiento.
* [**REQUISITOS_SERVIDOR.md**](./REQUISITOS_SERVIDOR.md): Especificaciones técnicas para aprovisionamiento de servidores y VMs.
* [**DESPLIEGUE_AUTOMATICO.md**](./DESPLIEGUE_AUTOMATICO.md): Configuración de automatización e integración continua.
* [**OPERATIONAL_VALIDATION.md**](./OPERATIONAL_VALIDATION.md): Evidencias de pruebas de resiliencia, caos, carga y prueba de inmersión (soak test 24h).
* [**INCIDENTE_CONEXION_PLC.md**](./INCIDENTE_CONEXION_PLC.md): Diagnóstico y resolución de incidencias de conectividad física.
* [**OPTIX_CLIENT_CERT_TRUST.md**](./OPTIX_CLIENT_CERT_TRUST.md): Procedimiento de firma y confianza de certificados x509 en FactoryTalk Optix.
* [**DOMINIO_AQUORA_CLOUDFLARE.md**](./DOMINIO_AQUORA_CLOUDFLARE.md): Configuración de DNS, dominios y túneles seguros.
* [**ANDROID_APK.md**](./ANDROID_APK.md): Instrucciones para compilación, firmado y distribución de la aplicación Android.
* [**operations/PRUEBAS_MANUALES_VALVULAS.md**](./operations/PRUEBAS_MANUALES_VALVULAS.md): Guía autorizada para pruebas manuales de válvulas vía API con PowerShell.

---

## 3. Protocolos, PLC y Válvulas

Semántica de control físico, mapeo de señales y comunicación industrial.

* [**PROTOCOLO_VALVULAS_VORAGINE.md**](./PROTOCOLO_VALVULAS_VORAGINE.md): Semántica verificada de mando de válvulas, asignación de bits (salida: 12/13, entrada: 2/3), sobreescritura directa en modo absoluto y señal sostenida.
* [**PROTOCOLO_TURBIEDAD.md**](./PROTOCOLO_TURBIEDAD.md): Especificación de adquisición y alarmas del sensor de turbiedad.
* [**PRUEBAS_LOCALES_VALVULAS.md**](./PRUEBAS_LOCALES_VALVULAS.md): Simulación y validación de comandos en entorno de pruebas sin PLC físico.
* [**plc/OBSERVACIONES_FASE0.md**](./plc/OBSERVACIONES_FASE0.md): Registro de inspección directa del PLC y verificación de topología.
* [**plc/PLANTAS_NUEVAS_CABUYO_LUISA_LEONERA_GLORIA.md**](./plc/PLANTAS_NUEVAS_CABUYO_LUISA_LEONERA_GLORIA.md): Procedimiento de onboarding e incorporación para las 4 plantas en integración.
* [**plc/**](./plc/): Entregables de ingeniería inversa OPC UA generados por `tools/plc-discovery` (`01_inventory.json` a `10_integration_report.md`).

---

## 4. Desarrollo y Colaboración

Instalación local, flujo de trabajo y dependencias.

* [**SETUP.md**](./SETUP.md): Puesta en marcha desde cero para nuevos desarrolladores y agentes.
* [**PENDIENTES.md**](./PENDIENTES.md): Bitácora de seguimiento de deuda técnica, decisiones pendientes y evolución.
* [**NOVEDADES.md**](./NOVEDADES.md): Changelog oficial de versiones expuesto en la app móvil (consumido en runtime).
* [**postman/**](./postman/): Colección de endpoints REST y ejemplos de payloads autorizados.

---

## 5. Informes Técnicos y de Producto

Informes ejecutivos autocontenidos y modelos complementarios.

* [**FRESCURA.md**](./FRESCURA.md) / [**frescura/**](./frescura/): Guía y modelo de 3 estados de frescura (`live`, `stable`, `frozen`).
* [**NOTIFICACIONES.md**](./NOTIFICACIONES.md) / [**notificaciones/**](./notificaciones/): Arquitectura del sistema de alertas push y notificaciones en bandeja.
* [**ROADMAP.md**](./ROADMAP.md) / [**roadmap/**](./roadmap/): Cronograma de entregas e hitos de producto.
