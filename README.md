# Terminus

A desktop agentic development environment. Terminus runs terminal agents
(Claude Code, Codex and others) against your organization's repositories and
answers in plain language — for people who need those answers but don't write
code.

**[terminus.danil.ai](https://terminus.danil.ai)**

This repository holds the **Terminus window**: the desktop app (Tauri + SolidJS)
and its release tooling. The **engine** that runs projects, tasks and agents,
`seldon-runtime`, is a proprietary binary by Danil; it is not in this
repository and is downloaded pinned by version and SHA-256.

## Install

Download the latest installer:

- **[Terminus-Windows-Setup.exe](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-Windows-Setup.exe)** — Windows 10 or 11, 64-bit
- **[Terminus-macOS.dmg](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-macOS.dmg)** — macOS, Apple Silicon and Intel
- **[Terminus-Linux-x86_64.AppImage](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-Linux-x86_64.AppImage)** — Linux x86_64 (Ubuntu 22.04 or later)

The macOS DMG is universal. `Terminus-macOS-Intel.dmg` is an alias with the
same file.

On Linux there is nothing to install: the AppImage is a portable executable.

```sh
chmod +x Terminus-Linux-x86_64.AppImage
./Terminus-Linux-x86_64.AppImage
```

It needs `libfuse2` (Ubuntu: `sudo apt install libfuse2`). Without it, run it
with `--appimage-extract-and-run`.

The app updates itself from this repository's releases; you install it once.

Or, with Node:

```sh
npx @danil-labs/terminus
```

The Windows installer is signed by Software y Servicios Danil, S.A.P.I. de C.V.
While the certificate builds reputation, SmartScreen may warn the first time:
**More info → Run anyway**. The macOS app is signed and notarized with the same
company's Developer ID. The `npx` path also verifies the minisign signature the
app uses to update itself. Its code is in [`npx/`](npx).

## Build from source

### Requirements

- Node.js 22 or later and pnpm 10 (`corepack enable`).
- Rust 1.89 or later (`rustup update`).
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for
  your platform (WebView2 and the MSVC build tools on Windows, Xcode command
  line tools on macOS, WebKitGTK 4.1 on Linux).

### Build and run

```sh
pnpm install
pnpm window:build            # debug build of the window, frontend embedded
pnpm engine:download         # seldon-runtime pinned in seldon-runtime.lock
pnpm engine:start            # starts the engine with throwaway data and opens the window
```

`pnpm engine:start` keeps everything under `.engine/lab/`: its own data
directory, HOME and temp folder, and the engine identity `ai.danil.seldon.dev`.
It never touches the data, keychain or accounts of an installed Terminus. Stop
the engine with `pnpm engine:stop` (it also stops by itself five minutes after
the last window closes). `node scripts/engine.mjs help` lists every command.

The engine is published as a prerelease of this repository
([`seldon-runtime-v0.2.73-d6ab489`](https://github.com/danil-labs/terminus/releases/tag/seldon-runtime-v0.2.73-d6ab489)).
By downloading it you accept its [terms](https://github.com/danil-labs/terminus/releases/download/seldon-runtime-v0.2.73-d6ab489/TERMS.md). Today it is published
for **Windows x86_64 only**; on macOS and Linux `pnpm engine:download` stops
with "No seldon-runtime has been published for <platform> yet". If you have an
engine binary, use it with `node scripts/engine.mjs download --from <path>`.

The window build uses the Cargo feature `extracted-client`, which is the
default. Release installers are built by
[`publish.yml`](.github/workflows/publish.yml); see
[docs/development.md](docs/development.md) for the details.

### Verify

```sh
pnpm verificar              # every guard, the front build and Rust
pnpm verificar --sin-cargo  # the same chain without Rust
```

What each guard checks is in [docs/guards.md](docs/guards.md).

## How it fits together

The window talks to the engine over a local authenticated socket using a
frozen contract (`src-tauri/crates/engine-protocol/commands.json`). See
[docs/engine-client.md](docs/engine-client.md).

```
src/                    SolidJS front (features/, ui/, lib/, locales/)
src-tauri/              Tauri window (Rust)
  crates/engine-client  RPC client for the engine, no Tauri dependency
  crates/engine-protocol  contract: commands, events, phrase keys
plugins/lenguas/        bundled language packs
scripts/                guards, tests and dev tooling (pnpm verificar)
npx/                    the npx installer
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) (commits
need a DCO `Signed-off-by`) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

The code in this repository is licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) and [CREDITS.md](CREDITS.md) for third-party code, fonts
and generated dependency notices.

The `seldon-runtime` engine is proprietary software by Danil and is not covered
by this license. Its terms and third-party notices are published with each
engine release: [TERMS.md](https://github.com/danil-labs/terminus/releases/download/seldon-runtime-v0.2.73-d6ab489/TERMS.md) and
[THIRD-PARTY-NOTICES (Windows x86_64)](https://github.com/danil-labs/terminus/releases/download/seldon-runtime-v0.2.73-d6ab489/THIRD-PARTY-NOTICES-x86_64-pc-windows-msvc.txt)
for the version pinned in `seldon-runtime.lock`.

"Terminus", "Danil" and their logos are trademarks of Danil;
the license does not grant permission to use them. Forks must use their own
name, icons and update endpoint.

---

Terminus is made by [Danil](https://danil.ai).
