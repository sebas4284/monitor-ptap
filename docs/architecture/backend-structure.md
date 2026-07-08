# Backend Structure - Fase 1

## Alcance de esta fase

Esta fase deja preparada la infraestructura del backend para comenzar desarrollo funcional, sin implementar todavia autenticacion real, JWT, base de datos, alarmas, PLC real, OPC-UA real, Modbus, MQTT, logica de negocio ni Docker funcional.

La arquitectura general se mantiene. El ajuste principal es reducir el plan anterior a cambios que resuelven problemas presentes o muy proximos, evitando carpetas vacias y modulos sin uso real.

## Decisiones revisadas

### AuditModule

No se crea en Fase 1.

Aunque la auditoria sera importante para trazabilidad industrial, un modulo completamente vacio no aporta comportamiento, contratos ni integracion real. Se documenta como modulo futuro y se crea cuando exista el primer caso de uso concreto, por ejemplo registrar comandos ejecutados, reconocimiento de alarmas o cambios de configuracion.

### packages/shared

Se mantiene un unico `packages/shared/src/index.ts` por ahora.

El archivo actual todavia contiene pocos tipos, permisos y helpers. Dividirlo en `auth/`, `telemetry/` o `plants/` seria prematuro mientras no existan suficientes contratos por dominio. La regla queda documentada: se divide cuando el volumen o los conflictos de edicion lo justifiquen, manteniendo la API publica de `@ptap/shared`.

### Carpetas domain vacias

No se crean `domain/`, `entities/`, `value-objects/` ni `repositories/` vacias dentro de cada modulo.

La convencion si queda documentada: cada modulo podra agregar esas carpetas cuando aparezca logica de negocio suficiente. Esto evita una estructura grande que parezca completa pero no contenga reglas reales.

### Framework HTTP

Las rutas y contratos deben definirse de forma independiente del framework. Mientras no se cierre la decision Express vs NestJS, el plan debe hablar de rutas HTTP, controladores/handlers y contratos, no de decoradores especificos como requisito arquitectonico.

## Tipografia de rutas API

Estas reglas aplican tanto si se implementan con NestJS como si se implementan con Express:

- Usar prefijo global `/api`.
- Evaluar `/api/v1` cuando exista necesidad real de versionado publico; no agregarlo solo por plantilla.
- Usar sustantivos en plural y minusculas: `/api/plants`, `/api/users`, `/api/telemetry`.
- Usar kebab-case para nombres compuestos: `/api/event-logs`, `/api/control-commands`.
- Evitar verbos en la ruta base; el verbo lo expresa el metodo HTTP.
- Usar identificadores como segmentos: `/api/plants/:plantId`.
- Usar subrecursos cuando exista pertenencia clara: `/api/plants/:plantId/telemetry`.
- Mantener nombres estables aunque cambie el framework interno.

Ejemplos de estilo reservado para fases futuras:

```txt
GET    /api/health
GET    /api/plants
GET    /api/plants/:plantId
GET    /api/plants/:plantId/telemetry
POST   /api/plants/:plantId/control-commands
GET    /api/alarms
PATCH  /api/alarms/:alarmId/acknowledgement
GET    /api/event-logs
```

En Fase 1 existen `GET /api/health` y `GET /api/snapshots/:plantId`. Las demas rutas quedan como convencion, no como implementacion.

## Bridge OPC-UA en NestJS

El bridge industrial vive dentro de `apps/api`, no en un `server/` independiente. La capa `src/infrastructure/connectivity` contiene los puertos de lectura, escritura y estado de protocolo, mas un adapter simulador para Fase 1.

Flujo implementado:

```txt
opc-config.json
  -> ConnectivityModule
  -> SimulatorConnectivityAdapter
  -> polling cada 5 segundos
  -> ultimo snapshot en memoria
  -> REST: GET /api/snapshots/:plantId
  -> Socket.io: opc:snapshot por sala de PTAP
  -> cliente futuro: suscripcion por PTAP
```

`opc-config.json` representa temporalmente las 8 PTAPs, sus NodeIds, indices de sensores e indices de tanques. MySQL reemplazara esta fuente en una fase posterior.

Las electroválvulas no tienen lectura real todavia: las PTAPs usan bits empaquetados en arrays INT y el mapa de bits no esta confirmado. Por eso el backend no inventa `valves` reales.

## Seguridad de contrasenas

La autenticacion real queda pendiente, pero el backend ya reserva el servicio de hashing seguro:

```txt
password plano
  -> HMAC-SHA256 con pepper secreto de 64 bytes
  -> Argon2id con salt automatico embebido
  -> password_hash + password_pepper_version
```

El pepper se carga desde variables de entorno:

```env
PASSWORD_PEPPER_CURRENT_VERSION=1
PASSWORD_PEPPER_V1_BASE64=
```

El pepper no se guarda en MySQL, no se expone al frontend y no debe versionarse con secretos reales.

## Nuevo plan de tareas minimalista

### 1. Reubicar `modules/plc` hacia `src/infrastructure/connectivity`

**Objetivo:** dejar claro que PLC, OPC-UA, Modbus, MQTT y simuladores pertenecen a infraestructura de conectividad, no a modulos de negocio.

**Por que se hace ahora:** `plc` ya existe como modulo, pero conceptualmente esta en una capa incorrecta. Corregir esa ubicacion antes de que tenga servicios, controllers o dependencias evita acoplamiento temprano.

**Por que no deberia posponerse:** si se empieza a implementar telemetria o comandos sobre `modules/plc`, luego habra que separar protocolo, lectura, escritura y reglas de negocio con mas costo.

**Costo de implementacion:** bajo. Es una reubicacion estructural con un modulo de conectividad minimo y puertos iniciales, sin adapters reales.

**Impacto futuro:** permite que `telemetry` y `commands` dependan de puertos de conectividad, no de librerias industriales concretas.

### 2. Crear `src/config`

**Objetivo:** reservar un lugar unico para configuracion de la aplicacion: puerto, entorno, prefijo API y, mas adelante, protocolo activo.

**Por que se hace ahora:** la configuracion transversal aparece desde el primer servicio real. Centralizarla evita lecturas directas de `process.env` dispersas.

**Por que no deberia posponerse:** una vez que cada modulo lea variables por su cuenta, normalizar nombres, defaults y validaciones se vuelve mas costoso.

**Costo de implementacion:** bajo. Puede empezar con archivos minimos y sin validacion avanzada.

**Impacto futuro:** facilita agregar validacion de entorno, configuracion por ambiente y seleccion de adapters sin tocar modulos de negocio.

### 3. Crear `src/common` sin subcarpetas vacias innecesarias

**Objetivo:** reservar el espacio para utilidades transversales reales del backend.

**Por que se hace ahora:** filtros, pipes, interceptors, constantes y helpers compartidos suelen aparecer pronto en una API.

**Por que no deberia posponerse:** sin una ubicacion comun, cada modulo puede empezar a crear helpers incompatibles o duplicados.

**Costo de implementacion:** bajo, siempre que no se creen arboles vacios por categoria. Se puede iniciar con `common/` y agregar subcarpetas cuando exista el primer archivo real.

**Impacto futuro:** ordena responsabilidades transversales sin convertir `common` en un cajon de logica de negocio.

### 4. Actualizar `AppModule`

**Objetivo:** reflejar la estructura aprobada: quitar la dependencia conceptual hacia `PlcModule` y registrar la conectividad desde `src/infrastructure/connectivity`.

**Por que se hace ahora:** `AppModule` es el mapa principal del backend. Debe mostrar la separacion correcta entre modulos de negocio e infraestructura.

**Por que no deberia posponerse:** mantener `PlcModule` registrado como feature module comunica una direccion equivocada al equipo.

**Costo de implementacion:** bajo. Solo cambia el registro de imports cuando se haga la reubicacion.

**Impacto futuro:** deja claro que `auth`, `users`, `plants`, `telemetry`, `alarms`, `commands` y `reports` son modulos funcionales; conectividad es soporte tecnico.

### 5. Documentar convenciones de crecimiento por modulo

**Objetivo:** definir como debe crecer un modulo cuando tenga logica real, sin crear carpetas vacias ahora.

**Por que se hace ahora:** el equipo necesita una guia comun antes de comenzar funcionalidades.

**Por que no deberia posponerse:** si cada modulo crece con una forma distinta desde el primer caso de uso, la arquitectura aprobada se diluye rapidamente.

**Costo de implementacion:** muy bajo. Es documentacion.

**Impacto futuro:** permite agregar `dto/`, `domain/`, `entities/`, `value-objects/`, `repositories/` o `infrastructure/` solo cuando resuelvan una necesidad concreta.

Convencion:

```txt
modules/<feature>/
  <feature>.module.ts
  <feature>.controller.ts      # Cuando exista API HTTP real
  <feature>.service.ts         # Cuando exista orquestacion real
  dto/                         # Cuando existan contratos HTTP propios
  domain/                      # Cuando existan reglas de negocio
  infrastructure/              # Cuando existan implementaciones tecnicas propias
```

### 6. Mantener `packages/shared` simple

**Objetivo:** conservar `packages/shared/src/index.ts` como barrel unico mientras el volumen sea bajo.

**Por que se hace ahora:** ya existe y funciona como punto comun entre mobile y API.

**Por que no deberia posponerse:** no hay nada que implementar ahora; la decision importante es evitar fragmentarlo prematuramente.

**Costo de implementacion:** nulo.

**Impacto futuro:** se puede dividir sin romper imports si se mantiene `index.ts` como API publica.

Regla de division futura:

```txt
packages/shared/src/
  index.ts
  auth/        # Cuando roles, permisos y contratos auth crezcan
  telemetry/   # Cuando existan contratos reales de sensores, tanques o lecturas
  plants/      # Cuando existan contratos propios de plantas
```

### 7. Documentar `audit` como modulo futuro

**Objetivo:** reconocer que auditoria sera necesaria, pero no crear un modulo vacio.

**Por que se hace ahora:** el alcance de Fase 1 debe dejar claro que auditoria pertenece a una fase posterior.

**Por que no deberia posponerse:** si no se documenta, puede confundirse con `reports` o `alarms` cuando aparezcan los primeros eventos.

**Costo de implementacion:** muy bajo. Solo documentacion.

**Impacto futuro:** cuando se implemente, `audit` tendra una responsabilidad clara: trazabilidad de acciones y eventos operativos, no reportes ni evaluacion de alarmas.

## Cambios excluidos de Fase 1

No se implementan ahora:

- `AuditModule` vacio.
- Division interna de `packages/shared`.
- Carpetas `domain/`, `entities/`, `value-objects/` o `repositories/` vacias por modulo.
- Adapters reales de OPC-UA, Modbus o MQTT.
- PLC real y adapters reales de OPC-UA, Modbus o MQTT.
- Base de datos.
- JWT, guards de permisos o decoradores de usuario.
- Docker funcional.

## Estado final esperado

Con este plan minimalista, la infraestructura del backend puede considerarse terminada para Fase 1 cuando existan:

- `src/infrastructure/connectivity` como lugar oficial de conectividad industrial.
- `GET /api/snapshots/:plantId` como endpoint de snapshot normalizado.
- Socket.io emitiendo `opc:snapshot` por PTAP seleccionada.
- `src/config` como punto inicial de configuracion.
- `src/common` como espacio transversal sin sobrepoblar.
- `AppModule` actualizado para reflejar la separacion entre modulos funcionales e infraestructura.
- Este documento como guia de estructura, rutas API y crecimiento por modulo.

Al completar esos puntos, el backend queda listo para comenzar desarrollo de funcionalidades sin cargar deuda innecesaria desde el inicio.
