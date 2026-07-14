/**
 * FASE 0.2 — política de resolución de namespaces.
 * La implementación vive ahora en el runtime (src/); este archivo la re-exporta
 * para el CLI y los tests. Fuente única de verdad.
 */
export {
  resolveNamespaces,
  collectNsUris,
  NamespaceNotFoundError,
} from '../src/infrastructure/connectivity/opcua/namespace-resolver';
