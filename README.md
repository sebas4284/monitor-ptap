# Monitor PTAP

Monitor PTAP es un sistema para visualizar el estado de una planta de tratamiento de agua desde app movil, web y servicios backend. Esta fase reorganiza el proyecto como monorepo sin cambiar el comportamiento actual de la app: los datos siguen siendo simulados y la conexion real con PLC queda para una fase posterior.

## Orden Del Proyecto

```txt
monitor-ptap/
  apps/
    mobile/              # App Expo: Android, iOS y web
    api/                 # Backend NestJS inicial
  packages/
    shared/              # Roles, permisos y tipos compartidos
  docs/                  # Documentacion tecnica y funcional
  infra/                 # Docker, base de datos, proxy y despliegue futuro
  package.json           # Scripts y workspaces del monorepo
  tsconfig.base.json     # Configuracion TypeScript comun
  eslint.config.js       # Linting comun
  prettier.config.cjs    # Formato comun
```

## Division De Responsabilidades

- `apps/mobile`: contiene la app Expo actual. Aqui van pantallas, rutas, componentes visuales, hooks, servicios de cliente y assets.
- `apps/api`: contiene el servidor central. Aqui iran autenticacion, usuarios, plantas, telemetria, conexion PLC, alarmas, comandos y reportes.
- `packages/shared`: contiene contratos comunes entre frontend y backend. La regla de oro es no duplicar roles, permisos ni tipos compartidos: ambos lados deben importarlos desde `@ptap/shared`.
- `docs`: guarda decisiones, manuales, arquitectura, API y notas de integracion con PLC.
- `infra`: queda reservado para Docker, base de datos, proxy, scripts de despliegue y configuracion operacional.

## Comandos Principales

```bash
npm install
npm run dev:mobile
npm run dev:api
npm run lint
npm run typecheck
```

Tambien puedes iniciar la version web de la app movil con:

```bash
npm run web -w @ptap/mobile
```

## Guia Para Nuevos Desarrolladores

- Pantallas moviles: crear rutas en `apps/mobile/app`.
- Componentes reutilizables de la app: crear archivos en `apps/mobile/components`.
- Servicios de cliente o consumo de API: usar `apps/mobile/services`.
- Modulos backend: crear cada dominio en `apps/api/src/modules`.
- Tipos, roles y permisos compartidos: agregar en `packages/shared/src/index.ts`.
- Documentacion tecnica: agregar en `docs`.

## Estado Actual

- La app movil/web mantiene login mock, roles, sensores, tanques, electrovalvulas y reportes simulados.
- El backend NestJS expone `GET /api/health`.
- PLC, base de datos, WebSocket, alarmas reales, notificaciones y deploy quedan fuera de esta Fase 1.
