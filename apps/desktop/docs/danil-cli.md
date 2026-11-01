# CLI de Danil

`danil` es el comando principal. `dn` es la abreviación oficial del mismo CLI.
Son los únicos nombres operativos instalables. Los launchers reenvían argumentos,
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

`npx @danil-labs/terminus` resuelve el único bin del paquete,
`danil-terminus`, que instala la app. El paquete no expone un bin `terminus`
ni instala el CLI operativo. Las versiones ya publicadas no cambian con esta
implementación local.

## Compatibilidad e integración del motor

La ventana conserva `productName: Terminus`, el binario físico `terminus`,
`ai.danil.terminus`, llavero, `engine.json`, candados, pubkey, updater y nombres
de descarga. Su forwarding es un mecanismo interno de distribución: no se
instala ni anuncia ese ejecutable físico como tercer comando operativo.
El binario físico del motor también permanece en su directorio privado.
Los instaladores del host no deben añadir un wrapper `seldon-runtime` al PATH;
la conexión conserva la sintaxis existente mediante `danil danil connect`.
Con una instalación en una ruta personalizada, pasa `--data` con la carpeta
de datos que muestra el instalador. Este helper no selecciona perfiles de
`engine.json`.
Cambiar la marca visible no mueve datos ni instala otra app.
Los paquetes internos `@terminus/*` también conservan sus nombres.

Se conservan los enlaces `terminus://task`, el historial `::terminus-visual`,
RPC, headers y selectores, storage móvil, esquema `terminus-mobile` y rutas
`/terminus`. Las referencias a Terminus 0.2.74 identifican la versión anterior.

La autoridad del contexto es el motor/CLI, no el launcher. El alcance autorizado
para el motor usa exclusivamente `DANIL_CONNECTION`, `DANIL_WORKSPACE`,
`DANIL_FOLDER`, `DANIL_TASK`, `DANIL_PROFILE`, `DANIL_CLI` y
`DANIL_CREDENTIAL`. El contexto antiguo `TERMINUS_*` se rechaza explícitamente,
incluso al combinarlo con banderas, para impedir que una tarea pierda su caller
y se ejecute como persona. Una carpeta vacía es distinta de una variable ausente.
El entorno de los procesos nuevos debe filtrar también los nombres antiguos.

**La reconciliación conserva el motor de `dev`, `4e10efc24a9be6f8dbf15559f767a50fb109a0a7`.**
El contrato, sus extensiones y el manifiesto se conservan byte por byte respecto
de `dev` (`288cdf65ba223b6cf4e5a62e53af3a8d4a7c3f56`). Los launchers
no acreditan por sí solos la interfaz exclusiva `DANIL_*` del motor del PR
seldon-host #276, que permanece como integración separada. Su adopción requiere
revisión de contrato y artefactos con manifiesto y checksums para las cuatro
plataformas. Esta reconciliación no publica artefactos ni sustituye ese pin.
Se conserva la excepción explícita de `dev`: el cliente declara el contrato
`5f59d603`, mientras el motor fijado declara `93b1c32f`. El guard `contract`
registra `MOTOR_PENDIENTE`; abrir la ventana no acredita los comandos posteriores
al pin ni habilita una publicación.

## Evidencia y límites

Las pruebas del instalador usan directorios temporales y ejecutan su código
real. `cli-path` pasó 6/6 y `cli-forward` 2/2 en Linux; este último comprueba
las órdenes raíz del motor fijado y su checksum. La resolución local de npx
con el paquete de un solo bin mostró la ayuda del instalador sin instalar la app.
`pnpm verify` incluye ambas pruebas; `--no-cargo` no acredita Rust.
La evidencia del motor de compatibilidad anterior no acredita la nueva interfaz
exclusiva. Esta fase requiere sus propias pruebas de autoridad y aislamiento.
Los nombres Windows se comprueban también desde Linux, pero cmd, PowerShell y
Git Bash requieren ejecución nativa. Actualización instalada, firma y reemplazo
de ejecutables en uso requieren su propio recorrido. No se deducen de guards
ni de pruebas de frontend con IPC simulado.
