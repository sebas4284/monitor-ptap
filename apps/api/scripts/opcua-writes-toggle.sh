#!/usr/bin/env bash
# Habilita o revierte la ESCRITURA al PLC por OPC UA en la VM de producción.
#
# ═══════════════════════════════════════════════════════════════════════════════
#  EXCEPCIÓN DE SEGURIDAD DELIBERADA — autorizada por operación el 2026-08-03
# ═══════════════════════════════════════════════════════════════════════════════
# Activa dos flags:
#
#   OPCUA_WRITES_ENABLED=true        habilita el canal de escritura
#   OPCUA_ALLOW_INSECURE_WRITES=true acepta la sesión OPC UA aunque NO esté cifrada
#                                    ni autenticada
#
# El segundo es una desviación de la regla 9, documentada en `connectivity.config.ts`.
# Existe porque el servidor OPC UA del PLC solo admite Anonymous + None (hallazgo P0,
# `docs/SECURITY_FINDING_P0.md`): con ese equipo, la primera condición de
# `security.secure` (SignAndEncrypt + identidad no anónima) es imposible de cumplir.
#
# LO QUE SE ACEPTA AL ACTIVARLO: la sesión al PLC viaja sin cifrar y sin autenticar.
# Cualquiera que alcance el PLC por red puede escribirle. La protección real pasa a ser
# perimetral (la red) más el RBAC, el interlock y la doble confirmación de la app.
#
# ESTE SCRIPT NO DISPARA NINGÚN COMANDO DE VÁLVULA: solo deja la configuración lista.
#
#   USO:      bash ~/deploy-scripts/opcua-writes-toggle.sh            (sin sudo)
#   REVERTIR: bash ~/deploy-scripts/opcua-writes-toggle.sh --revertir
set -euo pipefail

ENV="$HOME/monitor-ptap/.env"
REVERTIR=0
[[ "${1:-}" == "--revertir" ]] && REVERTIR=1

[[ -f "$ENV" ]] || { echo "No existe $ENV" >&2; exit 1; }

BAK="${ENV}.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$ENV" "$BAK"
echo "Respaldo: $BAK"
echo ""

# Se limpia cualquier variante previa (activa o comentada) antes de escribir: en dotenv
# la última aparición gana, y un duplicado vuelve el archivo impredecible.
purge() { sed -i "/^#\?OPCUA_WRITES_ENABLED=/d;/^#\?OPCUA_ALLOW_INSECURE_WRITES=/d" "$ENV"; }

if (( REVERTIR )); then
  echo "=== REVIRTIENDO: escritura al PLC DESHABILITADA ==="
  purge
  printf '\n# Escritura al PLC revertida el %s — ausente = false por default.\n' "$(date +%Y-%m-%d)" >> "$ENV"
else
  echo "=== HABILITANDO la escritura al PLC ==="
  purge
  {
    printf '\n# ── Escritura OPC UA habilitada el %s ──────────────────────\n' "$(date +%Y-%m-%d)"
    echo '# Autorizada por operación. ALLOW_INSECURE es necesario porque el PLC solo'
    echo '# admite Anonymous + None (hallazgo P0): la sesión va sin cifrar ni autenticar.'
    echo '# Revertir: bash ~/deploy-scripts/opcua-writes-toggle.sh --revertir'
    echo 'OPCUA_WRITES_ENABLED=true'
    echo 'OPCUA_ALLOW_INSECURE_WRITES=true'
  } >> "$ENV"
fi

echo ""
echo "=== estado de los flags (conteo, sin exponer el archivo) ==="
for f in OPCUA_WRITES_ENABLED OPCUA_ALLOW_INSECURE_WRITES; do
  n=$(grep -c "^${f}=true" "$ENV" || true)
  case "$n" in
    1) echo "  ${f} = true" ;;
    0) echo "  ${f} = ausente/false" ;;
    *) echo "  ${f} = ¡${n} apariciones! revisar a mano" ;;
  esac
done

echo ""
echo "=== reiniciando la API ==="
# SIN --update-env: esa bandera reemplaza el entorno del proceso por el de la sesión SSH
# (mínimo) y la API arranca pero nunca llega a escuchar en el 4000, con pm2 reportándola
# "online" igual. Costó una caída el 2026-07-31.
pm2 restart ptap-api >/dev/null
for i in $(seq 1 12); do
  sleep 5
  if ss -tln | grep -q ':4000'; then echo "  escuchando en 4000 a los $((i*5))s"; break; fi
done

echo ""
echo "=== salud ==="
for e in health health/db health/opc; do
  curl -s -o /dev/null -w "  /api/$e -> HTTP %{http_code}\n" "http://127.0.0.1/api/$e"
done

echo ""
echo "=== puente OPC UA ==="
tail -60 ~/.pm2/logs/ptap-api-out-0.log \
  | grep -oE 'BridgeStatus [A-Za-z]+ . [A-Za-z]+|NodeIds resueltos: [0-9/]+' | tail -3 | sed 's/^/  /'

echo ""
if (( REVERTIR )); then
  echo "REVERTIDO. El canal de escritura vuelve a estar cerrado."
else
  echo "═══════════════════════════════════════════════════════════════════"
  echo " ESCRITURA AL PLC HABILITADA."
  echo " No se disparó ningún comando de válvula: solo quedó la configuración."
  echo " Revertir: bash ~/deploy-scripts/opcua-writes-toggle.sh --revertir"
  echo "═══════════════════════════════════════════════════════════════════"
fi
echo "Rollback del archivo: cp $BAK $ENV && pm2 restart ptap-api"
