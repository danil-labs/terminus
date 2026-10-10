# CLI y llavero de macOS: revisión para 0.2.77

Fecha: 2026-10-10. Base de la ventana: `2417667`. Motor inspeccionado:
`4a5f05c2f4b63d472174688a839555b18bc716f8`, el fijado en
`seldon-runtime.lock`. Este informe distingue implementación, propuesta y
pruebas pendientes. No se reproduce un fallo nativo de macOS desde Windows.

## CLI: cambio implementado

En `src-tauri/src/extracted/mod.rs:28`, `open()` solo admite ausencia de
argumentos y `--external-host <archivo>`. `main.rs` reserva `--stop-engine`.
Un subcomando llega a `invalid_request`, y `launch()` llama a
`startup::show()`. En `src-tauri/src/extracted/startup.rs:18`, ese aviso puede
ser modal cuando nadie lee stderr. Esto explica el rechazo y el bloqueo de
#67/#69 al descartar la salida.

Windows tiene el mismo defecto. La revisión del usuario confirma que el dato
previo de CLI funcional correspondía a 0.2.74; `terminus.exe instances --json`
en la 0.2.76 instalada devuelve `cli.error.invalid_request`. No hay reenvío ni
shim en la base anterior: `publish.yml` empaqueta la ventana con su sidecar.
El despacho ahora se ejecuta en las tres plataformas antes de Tauri.

`src-tauri/src/cli.rs` acepta una lista explícita de subcomandos raíz y flags
globales. La fuente es `crates/existing-runtime/src/cli/args.rs` del motor
fijado: `SPECS`, `command()` y `schema()`, contrastados con `agent-context`.
Incluye `kn`, el subcomando `help`, `--help`/`-h`, `--version`/`-V` y flags
globales con valor separado o `=valor`. Una actualización del catálogo requiere
revisar esta lista. No se usa el catálogo RPC como si fuera el de la CLI.
En Unix ejecuta el `seldon-runtime` hermano del ejecutable
real mediante `CommandExt::exec`, antes de Tauri. No resuelve por PATH ni acepta
un motor alternativo por una variable nueva. Conserva argumentos como
`OsString`, entorno, stdin/stdout/stderr, PID, señales y salida del motor. No
captura salida ni crea un hijo al que haya que esperar. Si falla `exec`, escribe
el error en stderr y sale con 1, sin diálogo. Sin argumentos sigue abriendo la
ventana: es el punto de entrada del escritorio.

En Windows, un proceso de subsistema gráfico se conecta a la consola del padre
si existe. Conserva antes sus handles válidos y los restaura tras
`AttachConsole`, incluyendo pipes, archivos y NUL. Sin consola del padre sigue
usando los handles heredados. Lanza el sidecar con `CREATE_NO_WINDOW`, los tres
streams heredados explícitamente, espera su salida y devuelve su código.
No captura ni acumula salida, y no impone un plazo a comandos que observan
turnos. `no_console_window` se comparte desde `src-tauri/src/console.rs` con
las utilidades existentes; no cambia sus flags.

Referencia de handles consultada el 2026-10-10:
[AttachConsole](https://learn.microsoft.com/en-us/windows/console/attachconsole) y
[GetStdHandle](https://learn.microsoft.com/en-us/windows/console/getstdhandle).

### Entradas de ventana revisadas

| Entrada | Evidencia y despacho |
|---|---|
| Doble clic, menú Inicio y arranque normal | Sin argumentos vuelve a `app_lib::launch()`; no se conecta a una consola ni lanza la CLI. |
| `--external-host <selección>` | Entrada del laboratorio y la ventana; queda fuera de la lista de CLI. |
| `--stop-engine` | Los hooks NSIS la llaman para detener el motor antes de reemplazarlo; sigue entrando en el mismo handler. |
| Actualizador NSIS | `tauri-plugin-updater` 2.10.1, `src/updater.rs:797`, pasa los argumentos de la ventana mediante `/ARGS` al instalador; `/P` y `/UPDATE` son del instalador. Este repo no agrega argumentos de relanzamiento; los existentes conservan su ruta. |
| URLs / deep links / archivos | Cargo/configuración no declaran `tauri-plugin-deep-link`, `tauri-plugin-single-instance`, esquemas ni `fileAssociations`. URLs y rutas quedan fuera de la CLI; no se agrega soporte para abrirlas. |
| `-psn_…` de LaunchServices | Queda fuera del catálogo y conserva la ruta de ventana, al igual que otros argumentos ajenos a CLI. No se verifica aquí su tratamiento nativo en macOS. |

La clasificación distingue quién recibe la entrada; no añade nuevos handlers
de ventana. Por ejemplo, una URL no configurada puede ser rechazada por
`open()`, pero nunca se entrega al motor. Una ruta explícita `./task` no es
el subcomando `task`.

La prueba `scripts/cli-forward.test.mjs` compila el `main.rs` de producción y
sus módulos sin construir Tauri. Solo las entradas `app_lib::launch()` y
`stop_engine()` se sustituyen por marcadores para observar qué ruta se toma;
despacho, reenvío, handles y flags son los reales. Un motor de prueba compilado
comprueba argumentos con espacios y acentos, stdin, stdout/stderr, código 23,
streams redirigidos a archivos, salida descartada, 256 KiB por canal y motor
ausente. En Windows comprueba el subsistema PE gráfico del wrapper y que el
motor no reciba una consola nueva. No hay unitarias Rust ni omisiones por
plataforma. La cadena incluye esta prueba. El guard reconoce que `exec` Unix
reemplaza al llamador, sin aumentar el cupo de procesos esperados sin plazo.

## Linux: cobertura y límite de #67

El mismo despacho cubre el rechazo y el modal del AppImage: ambos ejecutables
están en `usr/bin` (el empaquetado comprueba el sidecar). Falta comprobarlo en
un AppImage real. El reenvío no copia el motor porque el comando de CLI corre
durante la vida del montaje; el arranque persistente de ventana sigue usando
`legacy::stable_engine()`.

La selección de instancia requiere distinguir dos invocaciones. En el commit fijado,
`crates/existing-runtime/src/cli/client.rs:89` selecciona `TERMINUS_CONNECTION`
o `service::standalone()` cuando no hay `--instance`. En
`crates/existing-runtime/src/cli/service/transport.rs:177`, `standalone()` exige
que `endpoint.executable` coincida con `service::executable()`. En
`crates/existing-runtime/src/cli/service/mod.rs:94`, esa función usa el archivo
`APPIMAGE` si existe, y solo en otro caso `current_exe()`. El servidor publica
esa misma identidad (`crates/existing-runtime/src/cli/server.rs:43`). El
reenvío conserva `APPIMAGE`: por tanto, se espera que el AppImage encuentre su
motor de la misma versión, incluso aunque la ventana haya copiado el sidecar
a una ruta estable (`src-tauri/src/extracted/legacy.rs:190`). Es una inferencia
de código, pendiente de prueba nativa.

La CLI copiada e invocada directamente desde un shell sin `APPIMAGE` compara
su propia ruta con la del AppImage publicada por el motor: ahí sigue la
discrepancia observada en #67. `--instance <pid>` o la conexión explícita evita
esa selección. No se elige automáticamente una instancia ajena ni se altera
el contrato congelado. Resolver también la invocación directa requiere una
regla de selección por raíz/autoridad en seldon-host.

## Llavero: recomendación, sin implementación

En el motor fijado, `crates/existing-runtime/src/secrets/vault.rs:27` define la
cuenta `boveda`; `:180` cachea la maestra en memoria y `:215` la obtiene con
`keyring::Entry::new(servicio, CUENTA).get_password()`. Valida 32 bytes en hex.
Un error de acceso no genera otra maestra, y `NoEntry` con bóvedas existentes
falla cerrado. `adoptar_maestra()` no sirve para cambiar la aplicación confiada
cuando el servicio sigue siendo `ai.danil.terminus`.

La ventana actual no lee el llavero ni transmite llaves: `engine::spawn()`
arranca el sidecar con stdin nulo y salida al log. La confianza que podría
tener la ventana nueva depende de conservar el requisito designado de la app
0.2.74; compartir nombre o Team ID no basta. La ACL real y las dos firmas
requieren inspección en la Mac. La confianza del motor tras «Always Allow»
comunicada en QA es compatible con un requisito designado estable, pero no
prueba que pueda añadirse sin autorización inicial.

| Opción | Ventaja | Coste y limitación |
|---|---|---|
| (a) Añadir el motor a la ACL desde la ventana | El motor queda autónomo; se conserva el secreto y el acceso de 0.2.74. | Leer y cambiar ACL son autorizaciones diferentes. No está demostrado que el dueño permita cambiarla sin interacción. Exige conservar las otras ACL y verificar el requisito exacto del sidecar antes de confiarlo; una ruta escribible por sí sola no basta. |
| (b) Lectura por `terminus` y descriptor privado al motor | Conserva la ACL y no concede lectura directa a otro ejecutable. | Requiere receptor nuevo, lectura no interactiva en la ventana firmada y traspaso en cada arranque/reinicio del motor. También hay que cubrir CLI sin ventana y posibles lecturas de secretos legados. |
| (c) Access group / Team ID compartido | Es una vía de compartición para el llavero de protección de datos. | No modifica automáticamente la ACL de una entrada del llavero de archivos de 0.2.74. Requiere migración, entitlements/perfiles y cambios coordinados; no resuelve por sí sola la actualización existente. |
| (d) Dar al motor el identificador de firma de `terminus`, o recrear la entrada | Podría aparentar continuidad de identidad o de confianza. | Suplantar la identidad del ejecutable evita el diseño de separación; recrear o generar una llave amenaza la continuidad de los secretos. No se recomienda. |

Recomendación: prototipar (b) con la ventana como mediadora, antes de prometer
«sin diálogo». No implementar (a) basándose solo en que la lectura funciona.
Apple distingue `kSecACLAuthorizationChangeACL`, y su herramienta de referencia
marca la actualización de acceso como una operación que puede pedir permiso.
No se toca la ACL, no se borra la entrada, no se cambia su contraseña y no se
amplía la confianza a todo el equipo ni a todas las aplicaciones.

No se añade una mitad del canal a esta ventana: el motor fijado no puede
consumirla, y no se ha validado la confianza de la ventana firmada. El encargo
permite entregar la recomendación cuando la elección segura no está demostrada.

### Trabajo concreto pendiente para seldon-host y ventana

1. Acordar una capacidad versionada de arranque, fuera del RPC congelado,
   por ejemplo `--master-key-fd <n>` en macOS. Solo el número viaja en argv.
   El receptor lee un mensaje acotado con versión y 32 bytes de llave de un
   descriptor heredado dedicado, con plazo y EOF, cierra el descriptor y
   rechaza versión, longitud o formato inválidos. No lee el llavero como
   fallback si se solicitó ese modo y el traspaso falló.
2. Inyectar esa fuente antes de la primera lectura de bóveda y alimentar el
   caché existente. Cero bytes de llave en logs, respuestas RPC, entorno,
   archivos o argumentos. Limpiar buffers temporales y mantener el acceso
   exclusivo a la memoria que contiene la maestra. Revisar también la lectura
   de entradas legadas, que pueden conservar ACL de `terminus`.
3. En la ventana, comprobar firma válida, ancla Developer ID, Team ID
   `ATG57AXYTS` e identificador `seldon-runtime` del motor realmente lanzado;
   mantener la lectura del llavero dentro del ejecutable firmado `terminus`.
   Leer con interacción deshabilitada y fallar cerrado ante acceso denegado,
   llave ausente con bóvedas existentes o formato inválido. No crear una nueva
   como consecuencia de un error de migración.
4. Crear un pipe anónimo dedicado con extremos no heredables por defecto,
   heredar únicamente el receptor en el hijo verificado, cerrar extremos
   sobrantes y escribir una vez con plazo. Incluir `engine::ensure()` al
   adoptar y al reiniciar; no transmitir nada al reutilizar un motor vivo.
   El lanzamiento con pipe no debe bloquear ni invalidar la vida independiente
   del motor al cerrar la ventana.
5. Definir el arranque autónomo por CLI y la creación de una instalación nueva:
   si el motor necesita maestra y no existe mediador, debe obtenerla mediante
   un proceso firmado `terminus` con canal privado, o fallar con una explicación.
   Nunca regresar silenciosamente a la lectura del motor para una actualización.
   El modo interno del mediador requiere autenticación del destinatario, no
   exponer un servicio genérico que entregue llaves a cualquier llamador.
6. Publicar el motor compatible, actualizar el lock y probar ambos componentes
   juntos. El canal es una propuesta de contrato, no una capacidad actual.

Fuentes consultadas el 2026-10-10:
[ACL de Apple](https://developer.apple.com/documentation/security/access-control-lists),
[SecAccessCreate](https://developer.apple.com/documentation/security/secaccesscreate(_:_:_:)),
[herramienta SecurityTool de Apple](https://github.com/apple-oss-distributions/SecurityTool/blob/main/keychain_add.c),
[grupos de acceso](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps),
[TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains).

## Escenarios E2E pendientes

Usar una Mac AWS desechable con usuario de QA, macOS 15.8 y una 0.2.74 real
firmada. Conservar un snapshot de máquina y llavero previo al «Always Allow»;
restaurar solo los datos no restaura la ACL. No usar secretos de producción.

### CLI de la aplicación firmada

1. Registrar versión/commit de la ventana, hashes de los dos ejecutables y
   `codesign -d -r-` de ambos. Ejecutar `node --test scripts/cli-forward.test.mjs`
   en el checkout: debe pasar la prueba de reenvío, sin omisiones.
2. Con `T=/Applications/Terminus.app/Contents/MacOS/terminus` y
   `S=/Applications/Terminus.app/Contents/MacOS/seldon-runtime`, comparar
   `"$T" task --help` y `"$S" task --help`, luego `instances --json`.
   Deben responder con igual formato/código y sin ventana nueva.
3. Con Python `subprocess.run([T, 'instances', '--json'], capture_output=True,
   timeout=10)`, comprobar JSON y salida antes de 10 s. Repetir con
   `stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL`: debe terminar sin
   diálogo. Repetir con `task subcomando-inexistente`: debe devolver el mismo error
   y código no cero del sidecar, sin abrir ventana.
4. Sin motor vivo, repetir `task --help` y `task subcomando-inexistente`. Los
   comandos locales no deben depender de una ventana ni bloquearse. Para los
   que sí requieren motor, aceptar el error del sidecar, nunca un modal.
5. Con ventana y motor vivos, registrar PID de `instances` y comparar
   `"$T" --instance <pid> status --json` con el sidecar. Repetir desde un turno
   de agente con su `TERMINUS_CONNECTION`: debe alcanzar su misma instancia.
6. Abrir `"$T"` sin argumentos: debe abrir el escritorio. Abrir con una selección
   de laboratorio válida mediante `--external-host`: debe abrir esa ventana.
   La CLI no cambia estas entradas reservadas.
7. En una copia desechable del bundle, retirar el sidecar y ejecutar un
   subcomando redirigido: salida 1, mensaje en stderr, sin ventana/diálogo.

En Linux repetir 2–5 sobre un AppImage firmado/real, con pipe y `/dev/null`.
Con el motor de la misma versión vivo, `AppImage status --json` sin selector
debe encontrarlo conservando `APPIMAGE`. Registrar por separado la invocación
directa de la copia estable sin esa variable: la discrepancia con la identidad
del AppImage sigue pendiente; `--instance` debe funcionar.

### Llavero: pruebas que condicionan la decisión

1. En 0.2.74 guardar una conexión de prueba y confirmar que funciona. Inspeccionar
   atributos/ACL del ítem servicio `ai.danil.terminus`, cuenta `boveda`, sin
   volcar su contenido. Registrar el requisito designado de 0.2.74.
2. Desde ese snapshot actualizar a la candidata firmada. Confirmar si la ventana
   puede leer la maestra con interacción deshabilitada y ACL intacta. Si falla,
   (b) no está acreditada y no se debe publicar como arreglo.
3. Tras implementar el canal coordinado, usar la conexión guardada: cero diálogos,
   mismo secreto utilizable y misma ACL. Cerrar la ventana, reutilizar el motor,
   detenerlo de forma normal y abrir de nuevo: debe funcionar sin nueva autorización.
   Repetir tras logout/login y actualización del sidecar firmado.
4. Bloquear el llavero, denegar acceso o introducir un sidecar firmado por otro
   equipo en una copia de QA: error explícito y acotado, sin llave nueva, sin
   borrar secretos y sin transmitir la maestra. Verificar que argv, entorno y
   logs no contienen secretos; comprobar cierres de descriptores y timeout.
5. Cubrir instalación limpia, CLI sin ventana, dos ventanas concurrentes,
   reinicio del motor y vuelta a 0.2.74. La conexión debe seguir utilizable.
   Inspeccionar otras entradas legadas para descartar diálogos posteriores.

Esta candidata arregla el despacho de CLI en las tres plataformas. El diálogo del llavero sigue pendiente
de diseño coordinado y de estas pruebas; no se declara resuelto.

## Verificación de la revisión

Windows, PowerShell. Cambio de código:
`cff17256a9ec0427daba8e160ae3b18336a5bdef`, encima de `0c2b5aa` y `197e985`,
sin push ni PR. Antes de
check/clippy se establece `$env:CARGO_BUILD_JOBS='2'`. Se compilan únicamente
los ejecutables mínimos de la prueba y se revisa el crate `terminus` con Cargo;
no se construye ni se abre la aplicación completa.

Control negativo reproducible: extraer `src-tauri/src/main.rs` de `197e985`
con `git show` a una carpeta temporal como `main.rs`, establecer
`$env:TERMINUS_CLI_TEST_MAIN` a esa ruta y ejecutar
`node --test scripts/cli-forward.test.mjs`. Código 1, resumen `pass 0`,
`fail 1`, `skipped 0`; aserción literal `0 !== 23`. El marcador de ventana
retorna 0 en esa prueba: se reproduce la ruta equivocada, no el diálogo de la
app instalada. Quitar la variable y ejecutar la misma prueba sobre producción
corregida da código 0:

```text
✔ el main de producción reenvía la CLI con pipes, archivos, salida descartada y sin consola nueva
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Se ejecuta de verdad en Windows, con un wrapper de subsistema gráfico
verificado en su cabecera PE y el motor de prueba sin consola. Los handlers
Tauri/instalador son marcadores; no acredita el escritorio ni un NSIS real.
La omisión Unix de la prueba anterior se elimina; aquí no hay unitarias Rust.

| Comando | Código y salida literal relevante |
|---|---|
| `cargo check --manifest-path src-tauri/Cargo.toml --locked -p terminus --all-targets` | 0; ``Finished `dev` profile [unoptimized + debuginfo] target(s) in 10.95s`` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -p terminus --all-targets` | 0; ``Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.16s`` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check -- --config-path src-tauri/rustfmt.toml` | 0; sin salida |
| `git diff --cached --check` | 0; sin salida |
| `node scripts/doc-paths.mjs` | 0; `Las rutas y enlaces locales de 23 documentos existen.` |

`pnpm verificar --sin-cargo` termina con 0. Resumen literal:

```text
  Verificado en Windows (cadena sin Rust), 622s.
  Sin comprobar en esta corrida: cargo fmt, check, clippy y test.
    La ventana tiene permiso para lo que se le pide — necesita el build de Rust.
```

Fmt, check y clippy se ejecutan por separado como indica la tabla. No se
ejecutan cargo test ni el guard de permisos del build nativo completo.

Ambos mantienen el aviso previo ``warning: unused import: `tauri::Emitter` ``
en `src/extracted/desktop.rs:2:5`; ese archivo no se modifica.

Quedan sin comprobar la consola interactiva real de cmd/PowerShell/Windows
Terminal, el doble clic/menú Inicio, un instalador/actualizador real y el bundle
firmado de Windows. En esa prueba posterior, comparar el sidecar y
`terminus.exe task --help`, `instances --json`, salida a archivo y salida a pipe;
deben tener los mismos streams/código y ninguna ventana nueva. Repetir el
arranque normal, `--external-host` de laboratorio y `--stop-engine` sin trabajo
vivo para observar sus handlers reales.

macOS/Linux siguen pendientes de compilación y ejecución nativa, AppImage y
aplicación firmada. Los escenarios anteriores siguen siendo el QA requerido.
El diseño y las pruebas del llavero permanecen sin implementar y sin verificar.
