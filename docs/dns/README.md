# Zonas DNS de `xpertic.co`

Dos archivos BIND para importar en Cloudflare. **Son excluyentes: importar los dos DUPLICA todos los
registros.**

| Archivo | Cuándo usarlo |
|---|---|
| [`office365-faltantes.bind`](./office365-faltantes.bind) | **El que se debe usar normalmente.** Solo los registros que faltan sobre lo que Cloudflare ya detecta solo en el escaneo inicial |
| [`xpertic-co-para-cloudflare.bind`](./xpertic-co-para-cloudflare.bind) | Zona **completa**. Solo si el escaneo automático de Cloudflare falló y hay que cargar todo a mano |

Contexto del dominio y del camino de TLS: [`../DOMINIO_AQUORA_CLOUDFLARE.md`](../DOMINIO_AQUORA_CLOUDFLARE.md).

> La migración de nameservers a Cloudflare quedó **bloqueada**: el dominio tiene `update prohibited`
> en GoDaddy. Producción va por Let's Encrypt directo — ver [`../PENDIENTES.md §1`](../PENDIENTES.md).
> Estos archivos se conservan por si la migración se destraba.
