#!/usr/bin/env bash
#
# Despliegue COMPLETO de la VM, sin una sola pregunta. Corre como `xpertic_app`, sin privilegios
# propios: lo único con root es `/usr/local/sbin/ptap-web-publish`, autorizado con NOPASSWD.
#
#   USO:  bash ~/deploy-scripts/ptap-deploy.sh [rama]        (por defecto: yosh)
#         bash ~/deploy-scripts/ptap-deploy.sh --sin-web     (solo backend)
#
# Recoge en un solo sitio los cuatro tropiezos que costaron caídas de verdad:
#
#  1. **`pm2 restart --update-env` tumba la API.** Reemplaza el entorno del proceso por el del shell
#     que invoca el comando; desde SSH no interactivo ese entorno es mínimo y la API arranca pero
#     nunca escucha en el 4000, mientras `pm2 list` la reporta `online`. ~3 min de caída el
#     2026-07-31. Aquí SIEMPRE es `pm2 restart` a secas.
#  2. **`git pull` no basta.** La rama local de la VM ha seguido a `yosh` con otro nombre, y un pull
#     respondía "Already up to date" sin traer nada: todo en verde, sin desplegar. Aquí es
#     `fetch` + `reset --hard origin/<rama>`.
#  3. **Un despliegue que ELIMINA archivos deja huérfanos en `dist/`.** `tsc` compila lo que existe
#     pero no borra la salida de lo que ya no está; el 2026-08-11 quedó un `dist/modules/hmi/`
#     huérfano y el proceso arrancó sin escuchar en ningún puerto. Aquí `dist/` se borra antes.
#  4. **`npm ci` solo si cambió el lock.** Reinstalar 900 MB de dependencias en cada despliegue son
#     diez minutos regalados en una VM de 2 CPUs.
#
# Y comprueba la salud al final. Un despliegue que no verifica no es un despliegue: es una apuesta.
set -euo pipefail

REPO="/home/xpertic_app/monitor-ptap"
RAMA="yosh"
CON_WEB=1

for arg in "$@"; do
  case "$arg" in
    --sin-web) CON_WEB=0 ;;
    -*) echo "opción desconocida: $arg" >&2; exit 2 ;;
    *) RAMA="$arg" ;;
  esac
done

cd "$REPO"
echo "=== 1/6  traer $RAMA ==="
LOCK_ANTES="$(md5sum package-lock.json | cut -d' ' -f1)"
git fetch origin
git reset --hard "origin/$RAMA"
git --no-pager log --oneline -1
LOCK_DESPUES="$(md5sum package-lock.json | cut -d' ' -f1)"

echo ""
echo "=== 2/6  dependencias ==="
if [[ "$LOCK_ANTES" != "$LOCK_DESPUES" ]]; then
  echo "  package-lock.json cambió: npm ci"
  npm ci
else
  echo "  sin cambios en package-lock.json: se omite npm ci"
fi

echo ""
echo "=== 3/6  migraciones (idempotente) ==="
npm run --silent db:migrate -w @ptap/api

echo ""
echo "=== 4/6  compilar backend ==="
# Ver tropiezo 3: se borra la salida anterior antes de compilar.
rm -rf apps/api/dist packages/shared/dist
npm run --silent build

echo ""
echo "=== 5/6  reiniciar la API ==="
pm2 restart ptap-api   # JAMÁS con --update-env
pm2 save >/dev/null

# Tras el reinicio, /api/health devuelve 000 unos segundos mientras conecta el puente OPC UA. No es
# una caída: se espera y se reintenta antes de declarar nada.
echo -n "  esperando a que escuche: "
for _ in $(seq 1 20); do
  CODIGO="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:4000/api/health || true)"
  [[ "$CODIGO" == "200" ]] && break
  sleep 3
done
echo "$CODIGO"
if [[ "$CODIGO" != "200" ]]; then
  echo "  La API no respondió 200 en 60 s. NO se publica la web." >&2
  pm2 logs ptap-api --lines 20 --nostream --no-color >&2 || true
  exit 1
fi

echo ""
if [[ "$CON_WEB" -eq 1 ]]; then
  echo "=== 6/6  bundle web y publicación ==="
  # API_BASE_URL vacío = mismo origen. No hay URL horneada, así que la web solo se recompila cuando
  # cambia el código, nunca por el dominio.
  ( cd apps/mobile && API_BASE_URL= npx expo export -p web --clear )
  # La única llamada con privilegios. `-n` = no interactivo: si la regla de sudoers no está puesta,
  # falla en el momento con un mensaje claro en vez de quedarse esperando una contraseña que nadie
  # va a escribir.
  sudo -n /usr/local/sbin/ptap-web-publish
else
  echo "=== 6/6  web omitida (--sin-web) ==="
fi

echo ""
echo "=== comprobación final ==="
for RUTA in health health/db health/opc; do
  printf '  %-12s -> HTTP ' "$RUTA"
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "http://127.0.0.1:4000/api/$RUTA" || echo "sin respuesta"
done
printf '  %-12s -> ' "web"
date -r /var/www/ptap-web/index.html "+%Y-%m-%d %H:%M" 2>/dev/null || echo "no publicada"
pm2 list --no-color | grep ptap-api || true
echo ""
echo "Desplegado $(git --no-pager log --oneline -1)"
