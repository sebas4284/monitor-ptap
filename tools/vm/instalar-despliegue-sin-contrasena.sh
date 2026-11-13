#!/usr/bin/env bash
# Retirado durante la contención de seguridad del 2026-11-02.
# No instalar publicadores ni restaurar permisos sin contraseña con esta receta.
set -euo pipefail
printf '%s\n' 'Instalador retirado: no se permite reinstalar NOPASSWD mediante esta receta.' >&2
printf '%s\n' 'El publicador requiere sudo autenticado. Consulta docs/DESPLIEGUE_AUTOMATICO.md.' >&2
exit 78
