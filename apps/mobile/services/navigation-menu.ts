import type { Permission } from '@ptap/shared';

/** Los accesos de navegación viven en el menú; la búsqueda se reserva a plantas. */
export function navigationItems(hasPermission: (permission: Permission) => boolean) {
  return [
    ...(hasPermission('view_dashboard')
      ? ([
          { name: 'Tablero', path: '/(app)/tablero', icon: 'grid-outline' },
          { name: 'Válvulas', path: '/(app)/electrovalvulas', icon: 'options-outline' },
          {
            name: 'Alertas y notificaciones',
            path: '/(app)/alertas',
            icon: 'notifications-outline',
          },
        ] as const)
      : ([{ name: 'Estado de la planta', path: '/(app)/estado', icon: 'pulse-outline' }] as const)),
    ...(hasPermission('export_data')
      ? ([
          { name: 'Informes y reportes', path: '/(app)/reportes', icon: 'document-text-outline' },
        ] as const)
      : []),
    ...(hasPermission('manage_users')
      ? ([{ name: 'Usuarios', path: '/(app)/usuarios', icon: 'people-outline' }] as const)
      : []),
  ];
}
