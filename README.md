# Terminus

Un entorno de desarrollo agéntico de escritorio. Terminus corre agentes de
terminal (Claude Code, Codex) contra los repositorios de tu organización y
responde en lenguaje llano — para quienes necesitan esas respuestas pero no
escriben código.

**[terminus.danil.ai](https://terminus.danil.ai)**

## Instalar

Descarga el instalador más reciente:

- **[Terminus-Windows-Setup.exe](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-Windows-Setup.exe)** — Windows 10 u 11, 64 bits
- **[Terminus-macOS.dmg](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-macOS.dmg)** — macOS, Apple Silicon e Intel
- **[Terminus-Linux-x86_64.AppImage](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-Linux-x86_64.AppImage)** — Linux x86_64 (Ubuntu 22.04 o posterior)

La release universal coordinada usa un solo `Terminus-macOS.dmg` para Intel y
Apple Silicon. El alias de descarga para Intel (`Terminus-macOS-Intel.dmg`)
contiene el mismo DMG, y las dos entradas de actualización de macOS apuntan al
mismo archivo firmado.

En Linux no hay nada que instalar: el AppImage es un ejecutable portátil.
Descárgalo, márcalo ejecutable y ábrelo:

```sh
chmod +x Terminus-Linux-x86_64.AppImage
./Terminus-Linux-x86_64.AppImage
```

Necesita `libfuse2` (en Ubuntu: `sudo apt install libfuse2`). Sin él, se abre con
`--appimage-extract-and-run`.

La app se actualiza sola desde aquí — se instala una vez.

O, si tienes Node:

```
npx @danil-labs/terminus
```

En Linux, `npx` deja el AppImage ya ejecutable en
`~/Applications/Terminus.AppImage` y dice cómo abrirlo. Sus mensajes salen en
español o en inglés según el idioma del sistema.

El instalador de Windows está firmado por Software y Servicios Danil, S.A.P.I.
de C.V. (las releases hasta la v0.1.25 no). El certificado es nuevo, así que
mientras no acumule reputación SmartScreen todavía puede avisar la primera vez:
**Más información → Ejecutar de todos modos**. El instalador de macOS está
firmado y notarizado con el Developer ID de la misma empresa (las releases hasta
la v0.1.25 no). La ruta `npx` verifica además la misma firma minisign que la app
usa para actualizarse.

## Releases

Este repositorio aloja los binarios de las releases de Terminus y su manifiesto
de actualización, y además los construye:
[`publish.yml`](.github/workflows/publish.yml) vigila el repositorio de origen
y, cuando su versión todavía no tiene release, construye macOS universal,
Windows y Linux, los firma y los publica. Cada versión, con sus instaladores y
firmas, está en la [página de releases](https://github.com/danil-labs/terminus/releases).

El workflow exige el cambio del código fuente que descarga Git durante la
preparación y quita el Git embebido y los sidecars. Falla antes de construir un
código fuente anterior. Antes de publicar, los dos runners nativos de macOS
ejecutan `kn --help` del mismo binario universal, y un runner de Ubuntu verifica
la firma del AppImage y ejecuta su `kn --help`; eso comprueba que el ejecutable
carga, no la interfaz gráfica. La instalación, el inicio de sesión, un turno de
agente y la actualización siguen requiriendo QA funcional.

`latest.json` lleva la nota de versión en `notes` (en inglés, o en español si la
versión no trae inglés) y, en `notes_by_locale`, una por idioma
(`{ "es": …, "en": … }`), para que la app muestre la del idioma de la persona.
El cuerpo de cada release es bilingüe: primero inglés y después español.

El código del instalador `npx` vive en [`npx/`](./npx).

## Probar el empaquetado de la release

En macOS o Linux con Node, pnpm, Ruby y jq:

```sh
node scripts/release.test.mjs
```

La prueba ejecuta la recolección de artefactos y la generación del manifiesto
del workflow con archivos de prueba y llaves de firma temporales. Descarga la
CLI de Tauri 2.11.4 con pnpm, comprueba las cuatro entradas de plataforma y sus
firmas con el verificador de `npx`, comprueba las notas por idioma y el idioma de
los mensajes de `npx`, y comprueba que se rechacen un DMG universal ausente o una
firma del nombre de archivo viejo. No construye ni abre la app, no la notariza ni
publica una release.

Para probar un cambio al workflow con todo real —builds, firmas, pruebas— sin
publicar nada, desde la rama del PR:

```sh
gh workflow run publish.yml -R danil-labs/terminus --ref <rama> -f dry_run=true
```

---

Terminus lo hace [Danil](https://danil.ai).
