# Terminus

A desktop agentic development environment. Terminus runs terminal agents
(Claude Code, Codex) against your organization's repositories and answers in
plain language — for the people who need those answers but don't write code.

**[terminus.danil.ai](https://terminus.danil.ai)**

## Install

Download the latest installer:

- **[Terminus-Windows-Setup.exe](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-Windows-Setup.exe)** — Windows 10 or 11, 64-bit
- **[Terminus-macOS.dmg](https://github.com/danil-labs/terminus/releases/latest/download/Terminus-macOS.dmg)** — macOS, Apple Silicon

The coordinated universal release uses one `Terminus-macOS.dmg` for Intel and
Apple Silicon. The Intel download alias contains the same DMG, and both macOS
update entries refer to the same signed archive. Version 0.2.0 remains Apple
Silicon only until a new release is built and published.

The app updates itself from here — you install once.

Or, if you have Node:

```
npx @danil-labs/terminus
```

The Windows installer is signed by Software y Servicios Danil, S.A.P.I. de C.V.
(releases up to v0.1.25 aren't). The certificate is new, so until it builds
reputation SmartScreen may still warn the first time: **More info → Run
anyway**. The macOS installer is signed and notarized with the same company's
Developer ID (releases up to v0.1.25 aren't). The `npx` route still verifies
the same minisign signature the app uses to update itself.

## Releases

This repository hosts the Terminus release binaries and their update manifest,
and it builds them: [`publicar.yml`](.github/workflows/publicar.yml) watches the
source repository and, when its version has no release yet, builds universal macOS and
Windows, signs them and publishes. Every version, with its installers and
signatures, is on the
[releases page](https://github.com/danil-labs/terminus/releases).

The workflow requires the source change that downloads Git during setup and
removes embedded Git and sidecars. It fails before building older source.
Before publishing, both native macOS runners execute the same universal binary's
`kn --help`; this checks loading the executable, not the graphical interface.
Installation, login, an agent turn and updating still require functional QA.

The `npx` installer's source lives in [`npx/`](./npx).

## Check release packaging

On macOS or Linux with Node, pnpm, Ruby and jq:

```sh
node scripts/release.test.mjs
```

The test runs the workflow's artifact collection and manifest generation with
fixture files and temporary signing keys. It downloads Tauri CLI 2.11.4 through
pnpm, checks all three platform entries and their signatures with the npx verifier, and checks that a missing
universal DMG or a signature for the old filename is rejected. It does not build or
launch the app, notarize it, or publish a release.

---

Terminus is built by [Danil](https://danil.ai).
