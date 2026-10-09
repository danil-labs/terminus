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
| `engine-launch.log` | the engine's stdout and stderr when the window starts it |
| `launch.lock` | held while a window looks for or starts the engine |

`<local data>` is `%LOCALAPPDATA%` on Windows, `~/Library/Application Support`
on macOS and `$XDG_DATA_HOME` (or `~/.local/share`) on Linux. The engine always
gets that lab identity: it never reads the data or the keychain entries of
`ai.danil.terminus`. Its keychain names derive from that identity.

With the lock held, the window asks the engine named by
`engine/seldon-endpoint.json` for its `status`. If it answers, the window reuses
it; two windows share one engine. If not, the window starts the packaged
engine, waits up to 30 seconds for a descriptor written by that process (ten
minutes with `--adopt-existing`: adopting a real 0.2.74 root took about 25 s,
and the handoff screen shows that step meanwhile), and writes
`selection.json`. If the binary is missing, the error is
`engine_missing`; if it exits or does not answer, `engine_start_failed`. The
startup notice then names the folder with the logs and links the 0.2.74
release, whose data the engine never touched.

## Handoff from 0.2.74

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

## Not done yet

- The engine is pinned for the four platforms and bundled on all of them, but
  only Windows has been tried from an installer. The macOS universal bundle
  carries a `lipo` of the two pinned macOS binaries.
- Seven window functions (`site_open_local`, `site_zoom` and the
  `typst_live_*` family) are in the contract but not served by the window, so
  the live Typst view does not work.
