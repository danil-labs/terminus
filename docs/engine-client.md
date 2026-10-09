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

## Contract

`src-tauri/crates/engine-protocol/commands.json` is the frozen contract: 316
commands (291 domain invocations, three channels and 22 window/bridge
functions) and the events the engine emits. Its SHA-256 is recorded in
[PROVENANCE](../src-tauri/crates/engine-protocol/PROVENANCE.md); the engine
announces the same hash and the window refuses to connect to a different one
(`version_mismatch`). `phrase-keys.json` lists the catalog keys the engine sends
so the window can translate them.

Keep `commands.json` byte-exact: `.gitattributes` checks it out with LF on every
platform, and a CRLF copy has a different hash.

## Starting the engine

Opened without arguments (a double click), the window uses the engine that
ships with it: `seldon-runtime` next to the window executable, packaged as a
Windows `externalBin`. Everything lives under one root in the user's local
data folder, apart from `ai.danil.terminus`:

| Path under `<local data>/ai.danil.seldon.dev/` | What it is |
|---|---|
| `engine/` | the engine's `--data-dir` (its log is `engine/host.log`) |
| `resources/` | the engine's `--resource-dir` |
| `window/` | the window's `window_data` (log and webview storage) |
| `selection.json` | the selection the window builds |
| `engine-launch.log` | the engine's stdout and stderr when the window starts it, plus one line per launch saying whether the window and the engine are in a Job Object and whether breakaway was refused |
| `launch.lock` | held while a window looks for or starts the engine |

`<local data>` is `%LOCALAPPDATA%` on Windows, `~/Library/Application Support`
on macOS and `$XDG_DATA_HOME` (or `~/.local/share`) on Linux. The engine always
gets `--identity ai.danil.seldon.dev`: it never reads the data or the keychain
entries of `ai.danil.terminus`. Its keychain names derive from that identity.

With the lock held, the window asks the engine named by
`engine/seldon-endpoint.json` for its `status`. If it answers, the window reuses
it; two windows share one engine. If not, the window starts the packaged
engine, waits up to 30 seconds for a descriptor written by that process, and
writes `selection.json`. If the binary is missing, the error is
`engine_missing`; if it exits or does not answer, `engine_start_failed`. The
startup notice then names the folder with the logs and links the 0.2.74
release, whose data the engine never touched.

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

`window_data` must be separate from the engine's data directory. A startup
error is printed to stderr as a catalog key (for example
`cli.error.invalid_token`). When nobody reads stderr (a double-click launch:
no terminal, file or pipe), a native notice explains it with the `es`/`en`
catalog in the system language before the webview exists. The window title
shows the runtime, version and build that `status` reports.

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
without clients or turns. Restarting the engine requires a new selection.

## Not done yet

- Only the Windows installer bundles the engine. On macOS and Linux the
  window still needs `scripts/engine.mjs` and `--external-host`.
- A window whose engine dies does not restart it yet; it shows
  `shell.service.engine_down`.
- The engine is published for Windows x86_64 only; macOS and Linux have no
  pinned binary in `seldon-runtime.lock` yet.
- Seven window functions (`site_open_local`, `site_zoom` and the
  `typst_live_*` family) are in the contract but not served by the window, so
  the live Typst view does not work.
