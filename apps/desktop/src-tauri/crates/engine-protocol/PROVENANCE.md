# Contract provenance

RPC1 and `commands.json` were derived from the Terminus engine source
(`danil-labs/harness-app`, commit `96dba061f0db4af915f6d035c8413fbd0fb430fb`,
Apache-2.0); the manifest was regenerated on
`b40d34999d140d30a0e1192ba752b2fdb860dc90`. The generator reads the engine
source and is not part of this repository.

`commands.json`: 317 commands, 292 ordinary invocations, three channels and
twenty-two window/bridge functions. Names, camelCase parameters, reference Rust
types and literal events are kept.

On 2026-10-19 the contract renamed its two concepts (317 commands, 27 events):
the CLI that runs a turn goes from `agent` to `provider` and the user agent from
`encargado` to `agent`, in command names, parameters, fields and events.
`list_agents` became `list_providers`, and the code-hosting list that held that
name became `list_code_providers`. Files on disk keep their keys; the types that
are stored and also travel cross the contract wrapped in `Wire`, which renames
their keys. There are no aliases. This copy is byte-identical to the engine's.
SHA-256:
`c5d047b78499900738723ff3d06c8ba40b31cf15b05f7c8bc2724fada76dcf8c`.

`phrase-keys.json`: the catalog keys the engine sends as `Frase` values, taken
from the engine source at `fdf4dd9863a80363a0dd7b15ea21fd6b69e1f4bd`.

Endpoint, selection and StreamPage extend the transport; they do not convert
domain data. The token travels in RPC1 only between authenticated local
processes, read from a protected file; it is never handed to the webview.
