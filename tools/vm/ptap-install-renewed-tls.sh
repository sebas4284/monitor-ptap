#!/usr/bin/env bash
# Instala solo el certificado renovado; conserva nginx y el firewall existentes.
set -euo pipefail
[[ $EUID -eq 0 && $# -eq 0 ]] || { echo 'Ejecutar con sudo y sin argumentos.' >&2; exit 1; }
DOMAIN=aquora.xpertic.co
SRC=/home/xpertic_app/letsencrypt/config/live/aquora.xpertic.co
DEST=/etc/ssl/ptap
echo 'Esperando el certificado DNS renovado (hasta 30 minutos)...'
READY=0
for ((i=0; i<120; i++)); do
  if openssl x509 -in "$SRC/fullchain.pem" -checkend 86400 -noout >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 15
done
[[ $READY -eq 1 ]] || { echo 'La renovacion DNS sigue pendiente; no se cambio nginx.' >&2; exit 1; }
openssl x509 -in "$SRC/fullchain.pem" -noout -checkhost "$DOMAIN"
CERT_KEY=$(openssl x509 -in "$SRC/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
PRIVATE_KEY=$(openssl pkey -in "$SRC/privkey.pem" -pubout -outform DER | sha256sum)
[[ "$CERT_KEY" == "$PRIVATE_KEY" ]] || { echo 'Certificado y llave no corresponden.' >&2; exit 1; }
nginx -t
BACKUP=$(mktemp -d /etc/ssl/ptap/backup-XXXXXXXX)
cp -p "$DEST/fullchain.pem" "$DEST/privkey.pem" "$BACKUP/"
rollback() {
  cp -p "$BACKUP/fullchain.pem" "$BACKUP/privkey.pem" "$DEST/"
  nginx -t && systemctl reload nginx
}
trap rollback ERR
install -o root -g root -m 0644 "$SRC/fullchain.pem" "$DEST/fullchain.pem"
install -o root -g root -m 0600 "$SRC/privkey.pem" "$DEST/privkey.pem"
nginx -t
systemctl reload nginx
# reload retorna antes de que los nuevos workers acepten conexiones. Durante ese
# intervalo puede seguir sirviendose el certificado anterior: reintentar sin
# desactivar TLS antes de decidir que hace falta revertir.
TLS_OK=0
for ((i=0; i<10; i++)); do
  if curl --fail --silent --show-error --max-time 3 \
    --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health"; then
    TLS_OK=1
    break
  fi
  sleep 1
done
[[ $TLS_OK -eq 1 ]] || { echo 'HTTPS no verifico tras la recarga; revirtiendo.' >&2; false; }
trap - ERR
openssl x509 -in "$DEST/fullchain.pem" -noout -dates -issuer
echo "TLS instalado; respaldo: $BACKUP. Firewall y configuracion nginx sin cambios."
