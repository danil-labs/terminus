# Terminus

A desktop agentic development environment. Terminus runs terminal agents
(Claude Code, Codex) against your organization's repositories and answers in
plain language — for the people who need those answers but don't write code.

**[terminus.danil.ai](https://terminus.danil.ai)**

## Install

Download the latest installer:

- **[Terminus-Windows-Setup.exe](https://github.com/soydanil/terminus/releases/latest/download/Terminus-Windows-Setup.exe)** — Windows 10 or 11, 64-bit
- **[Terminus-macOS.dmg](https://github.com/soydanil/terminus/releases/latest/download/Terminus-macOS.dmg)** — macOS, Apple Silicon
- **[Terminus-macOS-Intel.dmg](https://github.com/soydanil/terminus/releases/latest/download/Terminus-macOS-Intel.dmg)** — macOS, Intel (x86_64)

The app updates itself from here — you install once.

Or, if you have Node:

```
npx @soydanil/terminus
```

Neither installer is signed with a system certificate yet, so the OS warns the
first time: **More info → Run anyway** on Windows, **right click → Open** on
macOS. The `npx` route on macOS avoids that dialog — the download never gets a
quarantine attribute — and still verifies the same minisign signature the app
uses to update itself.

## Releases

This repository hosts the Terminus release binaries and their update manifest,
and it builds them: [`publicar.yml`](.github/workflows/publicar.yml) watches the
source repository and, when its version has no release yet, builds macOS
(Apple Silicon + Intel on native runners), Windows, signs them and publishes.
Every version, with its installers and
signatures, is on the
[releases page](https://github.com/soydanil/terminus/releases).

The `npx` installer's source lives in [`npx/`](./npx).

---

Terminus is built by [Danil](https://danil.ai).
