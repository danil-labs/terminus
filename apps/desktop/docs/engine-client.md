# The window and the engine

Terminus has two processes:

- **The window** (this repository): a Tauri app with a SolidJS front. It draws
  the interface, hosts native site views, local images, dialogs, clipboard and
  the client updater.
- **The engine** (`seldon-runtime`): a proprietary binary by Danil. It owns the
  domain: workspaces, projects, tasks, agent turns, accounts, credentials and
  plugins. Its source is not in this repository. Development builds download it
  pinned by version and SHA-256 (`seldon-runtime.lock`, `scripts/engine.mjs`).

The window never runs the domain itself. Every `invoke` that is not a window
function travels to the engine over RPC1.

Las [visualizaciones del chat](chat-visuals.md) usan el selector reservado
`terminus-chat-visuals` de `tree_show`, sin agregar un comando al contrato.
La ventana captura el workspace de esa lectura mediante un header IPC local
y el proxy lo coloca en el sobre RPC1 existente. La lectura segura de archivos
y las instrucciones nativas del agente pertenecen al motor.

La [integración de GitHub](github.md) usa los comandos existentes de proveedores,
`check_environment` e `install_gh`. El motor añade `githubCli` al reporte de
entorno; la ventana anterior ignora ese inventario opcional. Su distribución
requiere actualizar el motor fijado en `seldon-runtime.lock`.

`list_providers` puede incluir `external_install_url` para proveedores cuya app
oficial se instala por separado. Onboarding y Configuración abren ese enlace,
omiten `install_provider` y vuelven a consultar la disponibilidad después de
`check_environment`. La ventana acepta respuestas sin ese campo. ZCode requiere
un motor que lo anuncie en `list_providers`; estos cambios de interfaz no actualizan
el motor fijado en `seldon-runtime.lock`.

La cuenta de Danil (Configuración → Cuenta de Danil) usa `danil_connect_start`,
`danil_connect_status`, `danil_connect_options`, `danil_disconnect` y el evento
`danil-connect` (seldon-host#66, [connector.md](https://github.com/danil-labs/seldon-host/blob/dev/docs/connector.md)). Iniciar sesión registra
esta computadora en la cuenta: con un workspace de Radiant entra sin navegador;
sin él, la ventana abre `verification_uri_complete` y la persona aprueba en
`app.danil.ai/terminus/connect`. Un motor sin estos comandos recibe `command` del
proxy y la sección lo dice. El campo editable del alta y de la página de
aprobación es el nombre de **esta computadora**, no el de la cuenta.

La persona de la cuenta (nombre, correo, foto) sale del motor:
`danil_connect_status` trae `account_name`, `avatar` (ruta de la foto guardada
en la máquina, pintada con `preview_file`) y `avatar_source`;
`danil_account_refresh`, `danil_account_set_photo` y `danil_account_remove_photo`
la vuelven a pedir o cambian la foto **en la cuenta** (seldon-host#70). El pie
de la barra lateral y la sección la muestran. La web no tiene la sesión de
máquina (`danilAccount`); con `accountProfile` (`src/web/account.ts`) lee y
cambia la misma persona en el plano de control con la sesión de Supabase.

La sincronización sigue a la sesión de Danil de esta computadora, como una
carpeta de Drive (seldon-host `feat/workspace-danil-link`): no hay otras
cuentas ni miembros. Con la sesión iniciada, todos los workspaces de esta
computadora se ven en la web y el teléfono; con la sesión cerrada, ninguno. El
motor los liga solo, los que ya existen y los nuevos. No hay interruptor por
workspace: la sección «Cuenta de Danil» tiene solo la tarjeta de la cuenta
(foto, esta computadora, «Cerrar sesión»), y `danil_workspace_link`,
`danil_workspace_unlink` y `danil_workspace_link_status` quedan en el contrato
sin interfaz (`SIN_INTERFAZ` en `scripts/guards/commands.mjs`). La web, el teléfono y
las otras computadoras vistas desde aquí solo muestran los workspaces de
`workspaces` en cada fila de `GET /v1/computers` (`@terminus/computers`,
`linkedWorkspaces`); sin el campo (un plano de control anterior) no se filtra.
El relay ya rechaza el resto con `workspace_not_linked`. La web vuelve a listar
las computadoras cada diez minutos y al volver a la pestaña, así que un
vínculo nuevo aparece sin recargar.

El fondo de los chats también es del workspace: `chat_background` se lee al
abrirlo (`lib/chat-background-engine.ts`) y Estilo lo guarda con
`set_chat_background` (patrón y velos siempre; la imagen por su copia importada,
y se quita con `choose_chat_background` sin ruta). Solo viaja la ruta de la
copia recién importada en el workspace abierto; la de otro workspace se olvida
al cambiar, y un workspace sin nada elegido vuelve al patrón por defecto. Un
motor que no conoce `set_chat_background` (`command`) recibe
`choose_chat_background` solo con esa copia, o sin ruta si la persona quitó la
imagen. La web no tiene rutas: la imagen va como `dataUrl` en
`set_chat_background` (el relay no deja pasar `import_chat_background`), con el
tope del motor, 700 KB.

Cada llamada por el relay va con el workspace que nombran sus argumentos
(`workspace`, o un `scope` de texto distinto de `pending`; `callWorkspace` en
`@terminus/computers`): el relay rechaza con `workspace_mismatch` una llamada
cuyos argumentos nombran otro workspace que el suyo.

## Contract

`src-tauri/crates/engine-protocol/commands.json` is the frozen contract: 334
commands and the events the engine emits. Its SHA-256 is recorded in
[PROVENANCE](../src-tauri/crates/engine-protocol/PROVENANCE.md); the engine
announces the same hash and the window refuses to connect to a different one
(`version_mismatch`). `phrase-keys.json` lists the catalog keys the engine sends
so the window can translate them.

Keep `commands.json` byte-exact: `.gitattributes` checks it out with LF on every
platform, and a CRLF copy has a different hash.

## Starting the engine

Opened without arguments (a double click), the window uses the engine that
ships with it: `seldon-runtime` next to the window executable, packaged as
`bundle.externalBin` on every platform. Its `--resource-dir` is the
installation's resource folder, the one Tauri's `resource_dir()` names (the
executable's folder on Windows, `Contents/Resources` on macOS), where the
bundled language packs (`lenguas/`) live. Inside an AppImage those resources
are copied to `resources/` beside the window first.

A release build uses the identity `ai.danil.terminus` and passes
`--production-identity`. Its data root is the one 0.2.74 used,
`<local data>/ai.danil.terminus`; what belongs to the window lives beside it,
in `<local data>/ai.danil.terminus-window/` (`window/`,
`selection.json`, `engine-launch.log`, `launch.lock`), never inside the data
root.

The lab uses `ai.danil.seldon.dev`: a debug build, or any build with
`TERMINUS_LAB_ROOT` (an absolute folder) or `TERMINUS_LAB_IDENTITY` (any
identity except `ai.danil.terminus`). Then everything lives under one root:

| Path under `<local data>/ai.danil.seldon.dev/` (or `TERMINUS_LAB_ROOT`) | What it is |
|---|---|
| `engine/` | the engine's `--data-dir` (its log is `engine/host.log`) |
| `resources/` | inside an AppImage, the copy of the bundled resources |
| `window/` | the window's `window_data` (log and webview storage) |
| `selection.json` | the selection the window builds |
| `engine-launch.log` | the engine's stdout and stderr when the window starts it, plus one line per launch: on Windows, whether the window and the engine are in a Job Object and whether breakaway was accepted |
| `launch.lock` | held while a window looks for or starts the engine |

`<local data>` is `%LOCALAPPDATA%` on Windows, `~/Library/Application Support`
on macOS and `$XDG_DATA_HOME` (or `~/.local/share`) on Linux. The engine always
gets that lab identity: it never reads the data or the keychain entries of
`ai.danil.terminus`. Its keychain names derive from that identity.

With the lock held, the window asks the engine named by
`engine/seldon-endpoint.json` for its `status`. If it answers, the window reuses
it; two windows share one engine. If not, the window starts the packaged
engine, waits up to 5 minutes for a descriptor written by that process while
it stays alive (a rejection or crash ends the wait at once; a startup that checks
many account files can take more than 30 seconds on a loaded machine), ten
minutes with `--adopt-existing`: adopting a real 0.2.74 root took about 25 s,
and the handoff screen shows that step meanwhile), and writes
`selection.json`. If the binary is missing, the error is
`engine_missing`; if it exits or does not answer, `engine_start_failed`. The
startup notice then names the folder with the logs and links the 0.2.74
release, whose data the engine never touched.

## Handoff from 0.2.74

On macOS, each new engine launch can hand the vault master to a signed engine
through an inherited pipe, after a noninteractive keychain read. This is gated
by the engine's `--help` advertising `--master-fd`; an older engine keeps its
existing behavior. See [the macOS QA scenarios](master-fd-qa.md) for the gates
and native validation that remains required.

Before starting the engine, the window looks at the data root. If it holds
0.2.74 data and no `seldon-authority.json`, or a 0.2.74 service answers on it,
the window opens on the handoff screen instead of the app
(`src-tauri/src/extracted/launcher.rs`, `src/features/shell/Launcher.tsx`). It
does the same when the engine refuses with `cli.error.adoption_required`
(0.2.74 opened the root again, or the app moved). After the person accepts:

1. While the 0.2.74 window is open (the parent of its service, with the same
   executable), it waits: with its window open, a stopped 0.2.74 service comes
   back. On macOS the window cannot see that parent and infers it when a
   stopped service reappears.
2. It asks each 0.2.74 service for `service stop` only when its `status` shows
   no turns; the service refuses with `task_busy` while any is live. Nothing
   is killed.
3. It waits for Git (`gc.pid`, `tmp_pack_*`), then starts the engine through
   the same search-or-start with `--adopt-existing`.

If the engine refuses, the screen shows the code, `engine-launch.log` and how
to go back to 0.2.74, which opens the same data root once the engine stops.
Inside an AppImage the engine is copied to `window/engine/` first, since the
AppImage mount disappears with the window.

With the engine running, a 0.2.74 window on the same root stays blank: it
writes `app_unavailable` to `logs/Terminus.log` every few seconds. The window
watches that file and shows a notice while it keeps growing.

## Selection

Labs and tests start the window with `--external-host <absolute path to selection.json>`.
The selection names the engine `endpoint` descriptor, the `credential` (token
file), `runtime`, `data_directory`, `contract`, `service_build` and
`window_data`, the window's own private folder (log and webview storage). The
window checks the engine's `status` against these values before opening.

Selection, credential and window folder must belong to the current user only:

- Unix: owned by the process user, mode `0600`/`0700`, a single link, opened
  without following symlinks.
- Windows: owned by the user's SID, a DACL that grants access only to that
  user, SYSTEM and Administrators, a single link and no reparse point (symlink
  or junction). A file created from an elevated session is owned by
  Administrators and is rejected.

The window's own folders (the root beside the data, `window/`) get a protected
DACL with the user alone when they inherit anything wider, as the engine does
with its private paths: `%LOCALAPPDATA%` can grant Modify to others (the Codex
sandbox gives it to `CodexSandboxUsers`). `selection.json` is created inside
and inherits only the user.

`window_data` must be separate from the engine's data directory. A startup
error is printed to stderr as a catalog key (for example
`cli.error.invalid_token`). When nobody reads stderr (a double-click launch:
no terminal, file or pipe), a native notice explains it with the `es`/`en`
catalog in the system language before the webview exists. The window title
shows the runtime, version and build that `status` reports, and changes when
the window restarts or adopts another engine.

## RPC, events and channels

`terminus-engine-client` (`src-tauri/crates/engine-client`) does not depend on
Tauri. It keeps RPC1, the 16 MiB frame limit, correlated `request_id`,
camelCase arguments and `{value}/{error}` replies. A `pending` operation is
polled with the same `request_id`; a failure after sending stays uncertain and
is not resent under another identity.

Each call captures the workspace selected by the window. `service_poll` reads
`service events` with cursor, gap and replay. An engine that refuses
connections answers `shell.service.engine_down` with detail `engine_down`,
which the front does not retry; the app shows it two seconds after the first
failed poll. `service stream start/read/cancel`
carries `clone_project`, `list_session_git` and `watch_task_tree`; the window
rebuilds only the Tauri `Channel`.

Closing the window leaves the engine running; it stops after five minutes
without clients or turns. Restarting the engine requires a new selection. A
window that started without arguments does that on its own: when `service_poll`
finds no engine, it runs the same search-or-start as at startup (at most three
times in ten minutes), swaps the client and answers `reset: true` so the front
resynchronizes. A window whose selection changed under it, because another
window already restarted the engine, takes the same path and adopts that engine.
Reusing an engine leaves `selection.json` untouched when its content is the same. Otherwise it shows `shell.service.engine_down`.

## Stream empujado

Con un motor que anuncia `push_stream_v1` en `status.service_features`
(seldon-host#52, contrato en
[push-stream-contract.md](https://github.com/danil-labs/seldon-host/blob/dev/docs/push-stream-contract.md)), el
cliente deja de abrir una conexión TCP por petición:

- Hasta cuatro conexiones persistentes para peticiones, con varias en vuelo por
  conexión, correlacionadas por `request_id`. Cada conexión nueva comprueba que
  la selección, el descriptor y la credencial no cambiaron antes de mandar el
  token, y pregunta `status` por ese mismo socket; el par de un socket abierto
  no cambia. La selección se vuelve a comprobar cada 5 s y, si cambió, se
  cierran todas las conexiones.
- Una conexión aparte para `service subscribe`, que reconecta con espera
  creciente (100 ms a 2 s) y reanuda desde su cursor. `resync_required` o un
  marco `resync` se entregan como `gap`, la misma relectura que el sondeo.
- `service_poll` espera en Rust hasta 20 s a lo empujado y devuelve `push: true`
  con los lotes en `batches`; el front los reparte en orden a los mismos oyentes
  (`src/lib/serviceEvents.ts`) y vuelve a llamar enseguida.
- `service_filter` fija las tareas cuyo flujo token a token interesa (pestañas,
  la abierta, las vivas y `liveThreads`); de las demás solo llegan inicio y fin.
  Un `catchup` reemplaza lo vivo de la tarea que pasa a verse.
- `load_history` abre una tarea con sus últimos 150 turnos (`service history`) y
  el hilo pide la página anterior al llegar arriba.

Sin la marca, la ventana sondea `service events` cada 250 ms y abre las tareas
con `load_session`, como antes; Configuración sondea así siempre.

## Live Typst view

The window serves the seven window functions of the contract: `site_open_local`,
`site_zoom` and the `typst_live_*` family (`src-tauri/src/extracted/typst_live.rs`).
For each task tree the window runs one `tinymist lsp` and shows its preview as a
native site limited to `127.0.0.1:<port>`. The engine resolves the folder, the
main file and the binary (`tree_typst_target`); the window never starts
Tinymist with a path from the webview. On Windows a Job Object kills the
Tinymist processes if the window dies.

## Updating on Windows

Windows does not overwrite a running `.exe`, but it renames one. The installer
(`src-tauri/windows/hooks.nsh`) renames `terminus.exe` and `seldon-runtime.exe`
to `old_*` and writes the new ones, so the open window and its engine keep
working. The template's step that closes Terminus only runs on a real
uninstall; an installer replacing the copy runs the uninstaller in place
(`_?=$INSTDIR`), and that run also sets the files aside. The app does not use
`downloadAndInstall`, which exits on Windows: `update_install` downloads with
the plugin's signature check and runs the installer with `/S /UPDATE`.

`update_pending` reports when this window's image was set aside and the new
`terminus.exe` is already in its place, whether the app or a manual installer
did it, and the front asks for a restart. A manual installer that finds
Terminus open shows the same notice and ends there, instead of running a second
window from its finish page. On the next start, an engine running from
`old_seldon-runtime.exe` gets `service stop`; one that refuses keeps working
and the new engine waits for the next start. Then the window deletes the
`old_*` files no one holds, retrying for a few seconds while the window it
replaces exits.

An open window does not wait for a restart either: every 15 s it checks
whether the live engine was replaced and, once that engine has no turns,
downloads or operations, asks it for `service stop`. The next `service_poll`
starts the installed engine. The update notice says how many tasks the old
engine is still running and offers to stop them and restart. A replaced engine
is one running from `old_*` on Windows, from a deleted binary or an AppImage
copy that differs from the bundled one on Linux, and from a path other than
the bundled engine on macOS. The Linux and macOS checks have not been tried on
those systems.

## Not done yet

- The engine is pinned for the four platforms and bundled on all of them. The
  published installers were tried on Windows 11, macOS 15.8 (Apple silicon)
  and Linux, updating from 0.2.74 with real data (#60). The macOS universal
  bundle carries a `lipo` of the two pinned macOS binaries.
- The engine still installs, updates and removes the Typst plugin, while the
  window runs its Tinymist. Settings stops every live view before touching the
  plugin (`typst_live_stop`); moving the plugin into the window is planned in
  seldon-host.
