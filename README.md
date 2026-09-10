# Terminus

A desktop agentic development environment. Terminus runs terminal agents
(Claude Code, Codex) against your organization's repositories and answers in
plain language — for the people who need those answers but don't write code.

**[terminus.danil.ai](https://terminus.danil.ai)**

## Install

Download the latest installer:

- **[Terminus-Windows-Setup.exe](https://github.com/soydanil/terminus/releases/latest/download/Terminus-Windows-Setup.exe)** — Windows 10 or 11, 64-bit
- **[Terminus-macOS.dmg](https://github.com/soydanil/terminus/releases/latest/download/Terminus-macOS.dmg)** — macOS, Apple Silicon

The app updates itself from here — you install once.

Or, if you have Node:

```
npx @soydanil/terminus
```

The Windows installer is signed by Software y Servicios Danil, S.A.P.I. de C.V.
(releases up to v0.1.25 aren't). The certificate is new, so until it builds
reputation SmartScreen may still warn the first time: **More info → Run
anyway**. The macOS installer isn't signed with an Apple certificate yet, so
macOS warns the first time: **right click → Open**. The `npx` route on macOS
avoids that dialog — the download never gets a quarantine attribute — and still
verifies the same minisign signature the app uses to update itself.

## Releases

This repository hosts the Terminus release binaries and their update manifest,
and it builds them: [`publicar.yml`](.github/workflows/publicar.yml) watches the
source repository and, when its version has no release yet, builds macOS and
Windows, signs them and publishes. Every version, with its installers and
signatures, is on the
[releases page](https://github.com/soydanil/terminus/releases).

The `npx` installer's source lives in [`npx/`](./npx).

---

Terminus is built by [Danil](https://danil.ai).
