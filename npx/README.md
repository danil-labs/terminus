# @danil-labs/terminus

Instala **Terminus** (la app de escritorio de Danil) con un solo comando:

```bash
npx @danil-labs/terminus
```

Es un canal de distribución para desarrolladores —que ya tienen Node— adicional
al instalador `.exe` que se baja a mano desde [terminus.danil.ai](https://terminus.danil.ai).

## Qué hace

1. Detecta tu sistema operativo y arquitectura (`process.platform` / `process.arch`).
2. Lee `latest.json` de la última release pública de
   [`danil-labs/terminus`](https://github.com/danil-labs/terminus/releases/latest)
   (repo público, sin autenticación) y resuelve el instalador de tu plataforma.
3. Descarga el instalador a una carpeta temporal, con barra de progreso.
4. **Verifica su firma antes de ejecutar ni copiar nada.** Si la verificación
   falla, borra la descarga y sale con error — nunca ejecuta un binario no
   verificado.
5. En Windows lanza el instalador; en macOS descomprime la app y la deja en
   `/Applications`. A partir de ahí, la app se actualiza sola.

El comando selecciona Windows x64, Mac Apple Silicon o Mac Intel según la
entrada disponible en `latest.json`. La release v0.2.0 solo trae los dos
primeros. El workflow incorpora Intel; estará disponible cuando una release
publique `darwin-x86_64`. No hace falta cambiar el comando ni el instalador npx.
Si falta la entrada de una plataforma, incluida Linux, informa que no hay build
y termina con error.

**En macOS este canal se salta el diálogo de «desarrollador no verificado».** La
cuarentena la pone quien descarga —el navegador—, no el archivo: bajado con
`fetch` y descomprimido con `tar`, el `.app` nace sin ese atributo. El `.dmg` de
la página sí lo lleva. No es un atajo de seguridad: la firma minisign se
comprueba igual, contra la misma llave que la app usa para actualizarse, y sin
ella no se llega a copiar nada.

## Opciones

| Opción | Efecto |
|---|---|
| `-n`, `--dry-run` | Descarga y verifica, pero **no** ejecuta el instalador. |
| `-h`, `--help` | Muestra la ayuda. |

## Verificación de integridad

El nivel logrado es **firma minisign completa**, no un simple SHA-256:

- El instalador está firmado con **minisign en modo hashed** (prehash
  BLAKE2b-512 + Ed25519) — la firma que genera el updater de Tauri. La clave
  pública está embebida en la app (`tauri.conf.json` → `plugins.updater.pubkey`)
  y se copia como constante en `bin.mjs`. Es pública por diseño.
- Se verifican **las dos firmas** del archivo minisign: la del **contenido**
  (prueba que los bytes descargados son los firmados) y la del **comentario de
  confianza** (autentica el nombre del archivo firmado).
- Además se comprueba que el `keyId` de la firma coincide con el de la clave, y
  que el nombre del archivo firmado es el esperado.
- Todo con el módulo `crypto` nativo de Node — **cero dependencias**. Node 18+
  trae `blake2b512` (vía OpenSSL) y verificación Ed25519 nativa.

Como transparencia se imprime también el SHA-256 del archivo, pero la garantía
fuerte es la firma minisign, no el hash.

## Requisitos

- **Node.js 18 o superior** (usa `fetch` y Web Streams nativos).
- Sin dependencias de terceros.

## Cómo se resuelve el asset

`latest.json` es la fuente de verdad: trae la versión, la URL exacta del
artefacto firmado y su firma embebida. Se descarga y verifica **ese** artefacto
—el que la firma cubre—, no el alias de nombre estable
`Terminus-Windows-Setup.exe` (que es una copia byte a byte, pero no dependemos
de esa suposición: verificamos exactamente lo firmado).

En macOS lo que trae el manifiesto **no es el `.dmg`**: es el `.app` comprimido,
el mismo artefacto que la app usa para actualizarse sola. El `.dmg` existe para
quien baja de la página y no lleva firma minisign, así que este canal usa el que
sí la lleva. Por eso instalar aquí es descomprimir y copiar, no abrir un
instalador.

## Desarrollo / prueba local

```bash
node bin.mjs --dry-run   # descarga + verifica contra la release real, sin instalar
npm pack                 # genera el tarball para inspección
```
