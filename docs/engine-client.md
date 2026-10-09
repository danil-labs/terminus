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

## Selection

The window starts with `--external-host <absolute path to selection.json>`.
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

- The window does not start the engine on its own and the installer does not
  bundle it yet. Until then, `scripts/engine.mjs` starts it for development.
  Whoever starts it passes `--identity ai.danil.seldon.dev`: the engine rejects
  `ai.danil.terminus`.
- The engine is published for Windows x86_64 only; macOS and Linux have no
  pinned binary in `seldon-runtime.lock` yet.
- Seven window functions (`site_open_local`, `site_zoom` and the
  `typst_live_*` family) are in the contract but not served by the window, so
  the live Typst view does not work.
- When the engine dies, the open window shows no global notice until the next
  action fails.
