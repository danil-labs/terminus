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
`ef7e08807e1ed51c3f291b375abb6a803e866f510432c5a61ebb3aae8cae018e`.

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

The source is `crates/engine-protocol/commands.json` in `danil-labs/seldon-host`
(here, seldon-host `cb4ae57`). The engine pinned in `seldon-runtime.lock` must
announce this same hash as its `contract`; the `contract` guard
(`scripts/guards/contract.mjs`) compares the three.

`phrase-keys.json`: the catalog keys the engine sends as `Frase` values, taken
from the engine source at `fdf4dd9863a80363a0dd7b15ea21fd6b69e1f4bd`. The 24
`providers.*` keys for GitLab, `providers.error.other_host`, and each host's
`summary` and `vocabulary` come from seldon-host `34ebefa`
(`feat/gitlab-git-host`). The eleven `danil.error.*` keys come from seldon-host
`4e21caf`; `danil.error.not_connected`, `image_too_large`,
`unsupported_image`, `unauthorized` and `unsupported` from `cb4ae57` ([connector.md](https://github.com/danil-labs/seldon-host/blob/dev/docs/connector.md)).

Endpoint, selection and StreamPage extend the transport; they do not convert
domain data. The token travels in RPC1 only between authenticated local
processes, read from a protected file; it is never handed to the webview.
