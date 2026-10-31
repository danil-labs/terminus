# CLI de Danil

`danil` es el comando principal. `dn` es la abreviación oficial del mismo CLI.
`terminus` se conserva por compatibilidad. Los launchers reenvían argumentos,
entrada, salida, señales y código de salida al ejecutable seleccionado.
No crean otro motor ni otro almacén de datos.

## Instalación explícita desde este repositorio

El tooling requiere Node y un ejecutable operativo existente. Desde la raíz:

```sh
node apps/desktop/scripts/cli-path.mjs --help
```

Para instalar, usa `install --target <ejecutable-absoluto> --bin-dir
<directorio-absoluto-canónico>`. Agrega `--dry-run` para comprobar sin escribir.
El destino puede ser el ejecutable físico `terminus` junto a su motor, un CLI
independiente compatible o un AppImage ejecutable. No selecciones otro launcher.
Los launchers siguen la ruta elegida: si mueves la app, vuelve a ejecutar la
instalación con su nueva ruta.

En macOS el ejecutable instalado conserva la ruta
`/Applications/Terminus.app/Contents/MacOS/terminus`. En Windows conserva
`terminus.exe` dentro de la instalación. En Linux selecciona el AppImage o
el ejecutable del laboratorio, nunca una ruta temporal de montaje del AppImage.

El comando comprueba `danil` y `dn` en el directorio elegido y en todo el PATH.
Rechaza archivos ajenos, enlaces (también rotos) y colisiones con extensiones
Windows, sin reemplazarlos. Sólo actualiza archivos que coinciden por completo
con el formato de launcher propio. Windows recibe `.cmd` para cmd/PowerShell
y scripts sin extensión para Git Bash. Unix recibe scripts que usan `exec`.

El instalador no cambia el PATH ni perfiles del shell. El resultado JSON indica
si el directorio ya está en PATH. Si no, agrégalo mediante la configuración de
tu sistema y vuelve a abrir la terminal. Los alias o funciones definidos por el
shell no aparecen en el PATH: revísalos también en la terminal que usarás.

Para retirar únicamente los launchers propios, usa `uninstall --bin-dir
<directorio-absoluto-canónico>`, con `--dry-run` si quieres inspeccionar primero.
No retira el ejecutable ni modifica datos o credenciales.

`npx @danil-labs/terminus`, `terminus` y `danil-terminus` del paquete npm son
instaladores de la app. No instales ese paquete globalmente para obtener el
CLI operativo: su bin `terminus` puede ocultar el CLI que ya tienes.

## Compatibilidad e integración del motor

La ventana conserva `productName: Terminus`, el binario físico `terminus`,
`ai.danil.terminus`, llavero, `engine.json`, candados, pubkey, updater y nombres
de descarga. Cambiar la marca visible no mueve datos ni instala otra app.
Los paquetes internos `@terminus/*` también conservan sus nombres.

Se conservan los enlaces `terminus://task`, el historial `::terminus-visual`,
RPC, headers y selectores, storage móvil, esquema `terminus-mobile` y rutas
`/terminus`. Las referencias a Terminus 0.2.74 identifican la versión anterior.

La autoridad del contexto es el motor/CLI, no el launcher. La implementación local del
motor/CLI (`feat/danil-cli-compatible`, `36cd8661`) acepta `DANIL_CONNECTION`, `DANIL_WORKSPACE`, `DANIL_FOLDER`,
`DANIL_TASK`, `DANIL_PROFILE` y `DANIL_CLI` junto a sus equivalentes `TERMINUS_*`,
emite ambas familias y rechaza selectores contradictorios. Una carpeta vacía
es distinta de una variable ausente. Las banderas explícitas conservan prioridad.

**El motor fijado por este cliente sigue siendo `9bd80c15`.** Los launchers
ya funcionan con él, pero ese pin todavía no acredita los nuevos alias de
entorno, ayuda ni launchers de agentes del motor en desarrollo. La integración
requiere revisar el commit del motor y disponer de manifiesto y checksums de
las cuatro plataformas, además de comprobar la compatibilidad con el contrato
congelado del cliente. El dev del motor ya tenía un hash de manifiesto distinto
(`5f59d603`) al del cliente (`593c6503`) antes de esta implementación; esta rama
no modifica ninguno de esos contratos, publica artefactos ni cambia el pin.

## Evidencia y límites

Las pruebas del instalador usan directorios temporales y ejecutan su código
real. El E2E local del motor pasó 32 comprobaciones con un motor aislado y
un agente sintético; no integra ese motor en la ventana distribuida. El forwarding se comprueba en `tests/unit/cli-forward.test.mjs`.
`pnpm verify` incluye ambas pruebas; `--no-cargo` no acredita Rust.
Los nombres Windows se comprueban también desde Linux, pero cmd, PowerShell y
Git Bash requieren ejecución nativa. Actualización instalada, firma y reemplazo
de ejecutables en uso requieren su propio recorrido. No se deducen de guards
ni de pruebas de frontend con IPC simulado.
