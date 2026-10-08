# Development

## Daily loop

```sh
pnpm install
pnpm dev                 # Vite only: the front in a browser, without Tauri or engine
pnpm window:build        # debug window with the front embedded
pnpm engine:start        # engine with throwaway data + window
```

The window embeds `dist/` (feature `extracted-client`, on by default), so after
changing the front run `pnpm window:build` again, then `node scripts/engine.mjs
window` to open another window against the running engine.

`scripts/engine.mjs` commands:

| Command | What it does |
|---|---|
| `download [--from <path>]` | Downloads the engine pinned in `seldon-runtime.lock` and checks its SHA-256, or copies a local binary |
| `engine` | Starts the engine with data under `.engine/lab/` and identity `ai.danil.seldon.dev` |
| `select` | Asks the engine for `status` and writes a private `selection.json` |
| `window [--window <path>]` | Opens the window against that selection |
| `start` | `engine`, `select` and `window` |
| `status`, `stop` | Engine status; stop the engine when it has no work |

All commands accept `--lab <dir>` to use another lab folder. The engine's log is
`engine.log` in the lab, the window's stderr is `window.err`.

On a machine with little memory, limit Rust parallelism:
`CARGO_BUILD_JOBS=2 pnpm window:build`.

## The engine pin

`seldon-runtime.lock` pins the engine release for each platform, keyed by Rust
target triple, as published in the release manifest `seldon-runtime.json`:

```json
"x86_64-pc-windows-msvc": { "url": "https://github.com/danil-labs/terminus/releases/download/seldon-runtime-v…/seldon-runtime-x86_64-pc-windows-msvc.exe", "sha256": "…" }
```

A platform with an empty `url` has no published engine yet; `engine.mjs
download` stops with an error that says so.

`url` may point to a bare executable or to a `.zip`/`.tar.gz` that contains
`seldon-runtime` (or `seldon-runtime.exe`). The SHA-256 is of the downloaded
file. `contract` must match the hash in
[PROVENANCE](../src-tauri/crates/engine-protocol/PROVENANCE.md); the window
refuses an engine that speaks another contract.

## Releases

Maintainers publish with a version tag:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` (`pnpm version:subir`), and update
   `release-notes/en.md` and `release-notes/es.md`.
2. Merge to `main`, tag `v<version>` and push the tag.

[`publish.yml`](../.github/workflows/publish.yml) builds, signs and publishes.
It refuses to publish while `seldon-runtime.lock` is not pinned for every
platform or the engine is not bundled (`bundle.externalBin`): an installed copy
updated to a window without its engine would not open. To test a change to the
workflow without publishing:

```sh
gh workflow run publish.yml -R danil-labs/terminus --ref <branch> -f dry_run=true
```

`node scripts/release/publish.test.mjs` (macOS or Linux, needs Ruby and jq)
runs the packaging steps of the workflow with fixtures and temporary signing
keys.

The identity of the installed app — updater public key, bundle identifier
`ai.danil.terminus` and product name — is duplicated in `publish.yml` on
purpose. Changing any of them strands installed copies; read the comments
there first.

## Line endings

`.gitattributes` checks out every text file with LF on all platforms. Generated
files and the contract hash depend on it.
