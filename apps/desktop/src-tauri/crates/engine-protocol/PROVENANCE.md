# Contract provenance

RPC1 and `commands.json` were derived from the Terminus engine source
(`danil-labs/harness-app`, commit `96dba061f0db4af915f6d035c8413fbd0fb430fb`,
Apache-2.0); the manifest was regenerated on
`b40d34999d140d30a0e1192ba752b2fdb860dc90`. The generator reads the engine
source and is not part of this repository.

`commands.json`: 328 commands, 303 ordinary invocations, three channels and
twenty-two window/bridge functions. Names, camelCase parameters, reference Rust
types and literal events are kept.

On 2026-10-19 the contract renamed its two concepts (317 commands, 27 events):
the CLI that runs a turn goes from `agent` to `provider` and the user agent from
`encargado` to `agent`, in command names, parameters, fields and events.
`list_agents` became `list_providers`. The code-hosting family that held that
name is now `git_host`: `list_git_hosts`, `connect_git_host`, `git_host_projects`
and the rest, the `gitHost` parameter, the `git_host` field of sources and
repositories, and `GitHostInfo`. Files on disk keep their keys; the types that
are stored and also travel cross the contract wrapped in `Wire`, which renames
their keys. There are no aliases. This copy is byte-identical to the engine's.
SHA-256:
`3e526481e7a784ca7f9bf680f59ff89729ac1e286d5519c733ac10ab8a6934d7`.

seldon-host `4e21caf` (#66) added the Danil account (321 commands, 28 events):
`danil_connect_start`, `danil_connect_status`, `danil_connect_options`,
`danil_disconnect` and the `danil-connect` event.

seldon-host dev `cb4ae57` merged three additions (328 commands, 28 events).
#69 added `danil_client_token` (no parameters) → `ClientToken`
`{token, expires_at, endpoint, computer_id}`, a ten-minute client token of the
owner account the window uses to reach the other computers. #70 added the person
of the Danil account: `danil_account_refresh`, `danil_account_set_photo`
(`{image}`) and `danil_account_remove_photo`. The `Status` of
`danil_connect_status` gains `account_name`, `avatar` and `avatar_source`, and
`get_profile` gains `display_name`, `account_name` and `avatar`; the manifest
keeps only type names, so those fields do not move the hash. #71 added the chat
background the engine remembers: `chat_background`, `choose_chat_background`
and `import_chat_background_data`, plus the
`settings.appearance.background.not_imported` key.

seldon-host `feat/workspace-danil-link` adds workspaces synced with the
computer's own Danil account and the chat background per workspace (332
commands, 28 events): `danil_workspace_link_status`, `danil_workspace_link`
(`{mode?: "owner"}`: always the machine's account) and
`danil_workspace_unlink` (each with an optional `workspace`), and
`set_chat_background` (`{preset, path, dataUrl, veil}`); `chat_background`,
`import_chat_background` and `import_chat_background_data` act on the
workspace of the envelope. There are no other accounts: no device code per
workspace and no `danil-workspace-link` event. This copy is the engine's
manifest byte for byte (seldon-host `1687dbf`).

seldon-host dev `09b5dfd` (#74) makes the workspace the account's, with the
same id on every machine (335 commands, 28 events): `materialize_workspace`,
`ensure_project` and `sync_workspace`; `add_workspace`, `create_project` and
`clone_project` take an optional `id`, and `chat_background` answers `null`
when the workspace has no background of its own. This copy is the engine's
manifest byte for byte (seldon-host dev `09b5dfd`).

seldon-host dev `7569120` (#75) clones from the relay (337 commands, 29
events): `start_project_clone` (the parameters of `clone_project` without its
channel) answers `{operation}` and clones in the background,
`project_clone_status` (`{operation}`) gives the last event of that clone or
`null`, and the `project_clone` event carries `{workspace, operation, phase,
percent, done}` plus `project` or `error` at the end. This copy is the
engine's manifest byte for byte (seldon-host dev `7569120`).

seldon-host dev `9bd80c1` (#76, #77, #79) keeps the same manifest: the engine of
a VM uses the connector's credential, removing an account waits for the CLI that
holds its home, and while the computer is signed in to Danil every workspace is
linked to the account. Pinned in `seldon-runtime.lock` as
`seldon-runtime-v0.2.73-9bd80c1`.

seldon-host `feat/danil-session-per-account` (`658cad2`) keeps one Danil
session per account on a computer, and each workspace belongs to one account
(341 commands, 30 events): `danil_sessions` → `[SessionInfo]`,
`danil_set_default_account` (`{account}`), `danil_workspace_account`
(`{workspace?}`) → `{account, email, signed_in, linked}` and
`danil_workspace_set_account` (`{workspace?, account}`, plus `error?`), and the
`danil-sessions` event. `danil_connect_start` gains `accountHint` and `add`;
`danil_disconnect`, `danil_client_token`, `danil_account_refresh` and
`danil_account_remove_photo` take an optional `account`, and
`danil_account_set_photo` `{image, account?}`. This copy is the engine's
manifest byte for byte; no `seldon-runtime` with it is published yet.

The source is `crates/engine-protocol/commands.json` in `danil-labs/seldon-host`
(here, seldon-host `658cad2` on `feat/danil-session-per-account`). The engine pinned in `seldon-runtime.lock` must
announce this same hash as its `contract`; the `contract` guard
(`scripts/guards/contract.mjs`) compares the three.

`phrase-keys.json`: the catalog keys the engine sends as `Frase` values, taken
from the engine source at `fdf4dd9863a80363a0dd7b15ea21fd6b69e1f4bd`. The 24
`providers.*` keys for GitLab, `providers.error.other_host`, and each host's
`summary` and `vocabulary` come from seldon-host `34ebefa`
(`feat/gitlab-git-host`). The eleven `danil.error.*` keys come from seldon-host
`4e21caf`; `danil.error.not_connected`, `image_too_large`,
`unsupported_image`, `unauthorized` and `unsupported` from `cb4ae57` ([connector.md](https://github.com/danil-labs/seldon-host/blob/dev/docs/connector.md)).
`settings.appearance.background.workspace_missing` comes from `1687dbf`, where
`settings.appearance.background.too_big` also became 700 KB.
`danil.error.account_not_found` comes from `658cad2`.

seldon-host `feat/onboarding-engine` (`8f32a29`, `21f5687`) and
`feat/google-drive-integration` (`b831eeb`, rebased on them) add what the
onboarding needs (354 commands, 32 events). Installs: `cancel_install`
(`{operation}`) and `install_size` (`{operation}`), with `operation` one of
`provider:<id>`, `plugin:<id>`, `tool:<id>` or `google-drive`, and the `install`
event `{operation, kind, done, bytes, failure}`; `prepare_runtime` takes an
optional `skip`, uv and Python become optional stages and `remove_tool` accepts
pnpm, bun, agent-browser, uv and python. Accounts: `list_system_sessions`,
`adopt_system_session` (`{provider}`) and `connect_api_key`
(`{provider, key}`). Google Drive through the engine's own rclone:
`google_drive_status`, `install_google_drive`, `start_google_drive_login`,
`finish_google_drive_login`, `cancel_google_drive_login`, `check_google_drive`,
`disconnect_google_drive` and `remove_google_drive`, plus the `google-drive`
event and the `settings.google_drive.*` keys. This copy is
`git show b831eeb:crates/engine-protocol/commands.json` byte for byte.

Endpoint, selection and StreamPage extend the transport; they do not convert
domain data. The token travels in RPC1 only between authenticated local
processes, read from a protected file; it is never handed to the webview.
