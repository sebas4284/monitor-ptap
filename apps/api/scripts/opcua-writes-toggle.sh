#!/usr/bin/env bash
# Legacy administrative helper: only disable writes, never authorize plaintext sessions.
# Enablement requires authenticated SignAndEncrypt configured and reviewed with Operations.
# This file does not issue valve commands. Do not run against production without coordination.
set -euo pipefail

if [[ $# -ne 1 || "$1" != "--revertir" ]]; then
  echo "La habilitación insegura fue retirada. Configure SignAndEncrypt e identidad autenticada" >&2
  echo "con Operación antes de habilitar OPCUA_WRITES_ENABLED. Este script solo admite --revertir." >&2
  exit 2
fi

ENV_FILE="$HOME/monitor-ptap/.env"
[[ -f "$ENV_FILE" ]] || { echo "No existe $ENV_FILE" >&2; exit 1; }
BACKUP="${ENV_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$ENV_FILE" "$BACKUP"
echo "Respaldo: $BACKUP"

# Remove all prior active/commented variants. The default is writes disabled.
sed -i '/^#\?OPCUA_WRITES_ENABLED=/d;/^#\?OPCUA_ALLOW_INSECURE_WRITES=/d' "$ENV_FILE"
printf '\n# Escritura OPC UA deshabilitada el %s.\nOPCUA_WRITES_ENABLED=false\n' "$(date +%Y-%m-%d)" >> "$ENV_FILE"

echo "=== reiniciando API con escrituras deshabilitadas ==="
# Keep the existing PM2 environment; do not replace it with the SSH session environment.
pm2 restart ptap-api >/dev/null
for attempt in $(seq 1 12); do
  sleep 5
  if ss -tln | grep -q ':4000'; then
    echo "Escuchando en 4000 a los $((attempt * 5))s"
    break
  fi
done
for route in health health/db health/opc; do
  curl -s -o /dev/null -w "  /api/$route -> HTTP %{http_code}\n" "http://127.0.0.1/api/$route"
done
echo "Escritura deshabilitada en configuración; confirmar el estado del proceso con Operación."
echo "No se emitió ningún comando de válvula. El respaldo puede contener la configuración insegura anterior."
