/**
 * PLACEHOLDER de la única feature aún NO cableada a datos reales: las VÁLVULAS. NO son datos del
 * PLC — el canal de comandos existe pero la escritura sigue bloqueada (falta confirmar el protocolo
 * con el operador). La pantalla Válvulas muestra un aviso VISIBLE `ExampleDataBanner` para que el
 * usuario sepa que son de ejemplo (honra "el tablero nunca miente"). Se elimina cuando las válvulas
 * pasen a datos reales.
 *
 * Lo demás YA es real: tanques (services/tanks.ts) y sensores/informes (services/api.ts,
 * services/reports.ts), derivados del snapshot y del backend.
 */

export interface Valve {
  id: string;
  name: string;
  description: string;
  isOpen: boolean;
}

const BASE_VALVES: Valve[] = [
  { id: 'ev-01', name: 'EV-01', description: 'Entrada principal captación', isOpen: true },
  { id: 'ev-02', name: 'EV-02', description: 'Bypass coagulación', isOpen: false },
  { id: 'ev-03', name: 'EV-03', description: 'Filtración etapa 1', isOpen: true },
  { id: 'ev-04', name: 'EV-04', description: 'Cloración dosificación', isOpen: false },
  { id: 'ev-05', name: 'EV-05', description: 'Salida distribución', isOpen: true },
];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchValves(_plant: string): Promise<Valve[]> {
  await delay(150);
  return BASE_VALVES;
}
