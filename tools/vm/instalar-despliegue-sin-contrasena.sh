#!/usr/bin/env bash
#
# LO ÚNICO QUE PIDE TU CONTRASEÑA, Y UNA SOLA VEZ EN LA VIDA DE LA MÁQUINA.
#
#   USO:  sudo bash ~/monitor-ptap/tools/vm/instalar-despliegue-sin-contrasena.sh
#
# Deja instalado el publicador con privilegios y la regla que permite invocarlo sin contraseña.
# A partir de aquí, `bash ~/deploy-scripts/ptap-deploy.sh` despliega entero sin preguntar nada.
#
# ══ POR QUÉ NO SE GUARDA LA CONTRASEÑA, NI SIQUIERA HASHEADA ══
#
# `sudo` compara la contraseña EN CLARO contra el hash de /etc/shadow. Un hash no se le puede
# «presentar» a sudo: no es una credencial, es el resultado de tirar la credencial. Para que una
# máquina se autentique sola habría que guardar algo reversible, y entonces cualquiera que lea ese
# archivo —o cualquier proceso comprometido de `xpertic_app`— tendría root sobre la VM que acciona
# las válvulas. Más riesgo, no menos.
#
# Esto consigue lo mismo sin secreto que robar: no hay contraseña guardada porque no hace falta
# ninguna. La autorización vive en /etc/sudoers.d, la aplica el núcleo del sistema, y está acotada a
# UN ejecutable concreto que este usuario no puede modificar.
set -euo pipefail

ORIGEN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USUARIO="${SUDO_USER:-xpertic_app}"
DESTINO="/usr/local/sbin/ptap-web-publish"
REGLA="/etc/sudoers.d/ptap-web-publish"

if [[ $EUID -ne 0 ]]; then
  echo "Hay que correrlo con sudo:  sudo bash $0" >&2
  exit 1
fi

echo "=== 1/4  instalando el publicador con privilegios ==="
# root:root y 0755: el usuario que lo invoca NO puede modificarlo. Es la condición que hace que la
# regla NOPASSWD no sea una puerta a root.
install -o root -g root -m 0755 "$ORIGEN/ptap-web-publish" "$DESTINO"
ls -l "$DESTINO"

echo ""
echo "=== 2/4  autorizando a $USUARIO a invocarlo sin contraseña ==="
TMP="$(mktemp)"
cat > "$TMP" <<REGLA_EOF
# Publicar el bundle web ya compilado, sin contraseña. Acotado a ESE ejecutable, que es propiedad
# de root y el usuario no puede reescribir. No da shell, no acepta argumentos y no toca la
# configuración de nginx.
$USUARIO ALL=(root) NOPASSWD: $DESTINO
REGLA_EOF

# visudo -cf ANTES de instalar: un sudoers con un error de sintaxis deja la máquina sin sudo para
# nadie, y recuperarla exige consola física. Nunca se escribe en /etc/sudoers.d sin validar antes.
visudo -cf "$TMP"
install -o root -g root -m 0440 "$TMP" "$REGLA"
rm -f "$TMP"
echo "  regla instalada en $REGLA"

echo ""
echo "=== 3/4  instalando el script de despliegue (sin privilegios) ==="
install -o "$USUARIO" -g "$USUARIO" -m 0755 "$ORIGEN/ptap-deploy.sh" "/home/$USUARIO/deploy-scripts/ptap-deploy.sh"
echo "  /home/$USUARIO/deploy-scripts/ptap-deploy.sh"

echo ""
echo "=== 4/4  comprobando que de verdad funciona sin contraseña ==="
# Se comprueba de verdad, con el usuario real y sin TTY, que es como correrá. Decir «instalado» sin
# probarlo es exactamente el tipo de verde que luego resulta ser rojo en el peor momento.
if sudo -u "$USUARIO" sudo -n -l "$DESTINO" >/dev/null 2>&1; then
  echo "  ✓ $USUARIO puede ejecutar $DESTINO sin contraseña"
else
  echo "  ✗ la regla no surtió efecto. Revisa $REGLA" >&2
  exit 1
fi

echo ""
echo "Listo. A partir de ahora, y sin volver a escribir la contraseña:"
echo ""
echo "    bash ~/deploy-scripts/ptap-deploy.sh"
echo ""
echo "Y desde tu equipo, en una sola línea:"
echo ""
echo "    ssh ptap 'bash ~/deploy-scripts/ptap-deploy.sh'"
