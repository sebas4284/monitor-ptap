// Puente crudo: ConnectivityAdapter seleccionado por CONNECTIVITY_PROVIDER (opcua | simulator).
// Único camino de datos vivo — los tokens del poller legado (INDUSTRIAL_READER/WRITER,
// PROTOCOL_ADAPTER) se eliminaron al retirar ese camino.
export const CONNECTIVITY_ADAPTER = Symbol('CONNECTIVITY_ADAPTER');
export const CONNECTIVITY_CONFIG = Symbol('CONNECTIVITY_CONFIG');
