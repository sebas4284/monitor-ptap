const Colors = {
  primary: '#3B82F6',
  primaryLight: '#60A5FA',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  neutral: '#64748B',
  bg: '#171C28',
  surface: '#0B0F19',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  divider: '#2A3244',
  accentInlet: '#F97316',
  accentOutlet: '#38BDF8',
  // Paleta del login "el tanque se llena" (tema oscuro). Agrupada para no chocar con los
  // tokens de arriba, que usan las demás pantallas.
  login: {
    pageBg: '#04101A',
    waterPanel: '#061827',
    field: '#0A1C2A',
    fieldBorder: '#24384A',
    fieldBorderFocus: '#2491CC',
    focusHalo: 'rgba(36,145,204,0.22)',
    waveBack: '#0B3A5C',
    waveMid: '#12608F',
    waveFront: '#2491CC',
    button: '#1C6FA0',
    buttonPressed: '#1A6390',
    buttonText: '#FFFFFF',
    text: '#F2F7FA',
    textSecondary: '#A9C0CF',
    placeholder: '#7B8C99',
    telcobrasGreen: '#88BD4C',
    linkGreen: '#A6D46E',
    brandBlue: '#2491CC',
    brandYellow: '#F3CB35',
  },
  // Colorimetría Telcobras + superficies de Aquora para el tablero. Todo color de texto de aquí
  // da ≥ 4,5:1 sobre page/panel/card (medido); el blanco sobre `blue` NO (3,5:1): los botones
  // con texto blanco usan `action`.
  brand: {
    blue: '#2491CC',
    green: '#88BD4C',
    yellow: '#F3CB35',
    gray: '#888D91',
    white: '#FFFFFF',
    black: '#000000',
    page: '#04101A',
    panel: '#061827',
    card: '#0A1C2A',
    cardBorder: '#24384A',
    action: '#1C6FA0',
    actionPressed: '#1A6390',
    text: '#F2F7FA',
    textSecondary: '#A9C0CF',
    // Entrada y salida se distinguen con icono + etiqueta + dos azules; el verde es solo "OK".
    inflow: '#7CC8F0',
    outflow: '#2491CC',
    // Selector de plantas (referencia TableroEscritorio/TableroMovil).
    selected: '#0E2D45',
    row: '#081A27',
    rowBorder: '#132A3C',
    divider: '#16293A',
    searchBorder: '#4F6A82',
    placeholder: '#7B8C99',
    link: '#7CC4EC',
    // Texto rojo sobre fondos oscuros: `Colors.danger` (#EF4444) queda en ~4,4:1 sobre `card`;
    // este da ≥ 4,5:1. El rojo de puntos y bordes sigue siendo `Colors.danger`.
    dangerText: '#FF9A9A',
  },
} as const;

export default Colors;
