# Desplegar sin escribir la contraseña

> Estado: **listo para instalar**. Scripts en [`tools/vm/`](../tools/vm/), versionados con el
> repositorio. Requiere **un** comando con contraseña, una sola vez en la vida de la máquina.

## El problema

El despliegue tenía un paso que exigía una persona delante: publicar el bundle web necesita `sudo`,
y la cuenta `xpertic_app` no lo tiene sin contraseña. Todo lo demás —traer el código, migrar,
compilar, reiniciar la API— ya se podía hacer por SSH sin intervención. Resultado práctico: el
backend se desplegaba y **la web se quedaba atrás sin ningún síntoma visible**. Pasó de verdad: el
bundle publicado se quedó del 6 de agosto mientras el backend iba por el 13.

## Por qué no se guarda la contraseña, ni hasheada

Es la propuesta natural y no funciona, así que conviene dejarlo escrito para no volver a discutirlo:

- **`sudo` necesita la contraseña en claro.** Compara lo que se escribe contra el hash de
  `/etc/shadow`. Un hash no es una credencial que se pueda presentar: es el resultado de tirarla.
  No hay forma de que un script «lea el hash» y se autentique con él.
- **Guardarla reversible es peor que el problema.** Un archivo que la máquina pueda leer para
  autenticarse lo puede leer cualquier proceso comprometido de `xpertic_app`. Y no se estaría
  arriesgando una web: se estaría entregando **root sobre la VM que acciona válvulas de agua
  potable**.
- **Cifrarla no cambia nada** mientras la llave viva en la misma máquina. Solo añade un paso.

## Lo que sí se hace

Que no haga falta ninguna contraseña, porque no hay ningún secreto:

```
/usr/local/sbin/ptap-web-publish     root:root  0755   ← la única pieza con privilegios
/etc/sudoers.d/ptap-web-publish      root:root  0440   ← autoriza SOLO ese ejecutable, sin contraseña
~/deploy-scripts/ptap-deploy.sh      usuario    0755   ← el despliegue entero, sin privilegios propios
```

Tres detalles que son la diferencia entre esto y una puerta trasera:

1. **El ejecutable autorizado es propiedad de root y el usuario no puede escribirlo.** Una regla
   `NOPASSWD` sobre un script que el propio usuario puede editar *es* ser root: bastaría con
   reescribirlo. Por eso vive en `/usr/local/sbin` y no en `~/deploy-scripts`, y por eso no carga
   nada de ahí.
2. **No acepta argumentos y las rutas están fijas.** Cada parámetro sería una superficie más en algo
   que corre como root.
3. **La regla se valida con `visudo -cf` antes de instalarse.** Un `sudoers` con un error de
   sintaxis deja la máquina sin `sudo` para nadie, y recuperarla exige consola física.

**Alcance residual, dicho claro:** quien tenga la cuenta `xpertic_app` puede publicar estáticos
arbitrarios en el raíz web. Eso ya lo podía provocar editando el repositorio. Lo que **no** puede es
convertirse en root, tocar la configuración de nginx, ni leer nada que antes no leyera.

## Instalación (una vez)

```bash
ssh -i ~/.ssh/id_ed25519 xpertic_app@191.102.61.125
cd ~/monitor-ptap && git fetch origin && git reset --hard origin/yosh
sudo bash tools/vm/instalar-despliegue-sin-contrasena.sh
```

Pide la contraseña una vez y termina comprobando, con el usuario real y sin TTY, que la regla surte
efecto. Si no surtiera, lo dice y falla; no imprime un verde optimista.

## A partir de entonces

```bash
# desde la VM
bash ~/deploy-scripts/ptap-deploy.sh

# o desde tu equipo, en una línea
ssh ptap 'bash ~/deploy-scripts/ptap-deploy.sh'

# solo backend, sin recompilar la web (~4 min menos)
ssh ptap 'bash ~/deploy-scripts/ptap-deploy.sh --sin-web'
```

`ptap-deploy.sh` recoge en un solo sitio los cuatro tropiezos que costaron caídas reales:

| Tropiezo | Qué hace el script |
|---|---|
| `pm2 restart --update-env` tumba la API (~3 min de caída el 31-jul) | `pm2 restart` a secas, siempre |
| `git pull` responde «Already up to date» sin traer nada | `fetch` + `reset --hard origin/<rama>` |
| `dist/` huérfano tras borrar archivos: el proceso arranca y no escucha | borra `dist/` antes de compilar |
| `npm ci` en cada despliegue son 10 min regalados | solo si cambió `package-lock.json` |

Y **espera a que `/api/health` devuelva 200 antes de publicar la web**. Si la API no levanta, no
publica nada y vuelca los últimos 20 renglones del log. Tras un reinicio, `/api/health` responde
`000` unos segundos mientras el puente OPC UA conecta: eso no es una caída y el script lo distingue.

## Lo que deliberadamente NO se automatiza

- **Desplegar solo al detectar un commit nuevo.** Sería fácil (un temporizador que mire
  `origin/yosh`), y es exactamente lo que no conviene aquí: un `git push` no debería poder cambiar
  el comportamiento de una planta de agua potable sin que nadie decida cuándo. El disparo sigue
  siendo humano; lo que desaparece es el trámite.
- **La APK.** Recompilarla exige la cadena de Android (~6 GB, ~40 min) y una decisión de versión.
  Sigue en [`ANDROID_APK.md`](./ANDROID_APK.md).
- **Editar el mapeo no necesita nada de esto.** Las correcciones desde la app se aplican en caliente
  contra el proceso vivo, sin desplegar ni reiniciar. Ver
  [`PLAN_CONSOLA_ADMIN_1.4.0.md`](./PLAN_CONSOLA_ADMIN_1.4.0.md), fase C.
