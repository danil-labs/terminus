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
| `sidecar` | Places the pinned engine in `src-tauri/binaries/` for `bundle.externalBin` (on macOS both architectures and their `lipo`); Rust builds need it, and `beforeDevCommand`, `beforeBuildCommand` and `pnpm verify` run it |
| `engine` | Starts the engine with data under `.engine/lab/` and identity `ai.danil.seldon.dev` |
| `select` | Asks the engine for `status` and writes a private `selection.json` |
| `window [--window <path>]` | Opens the window against that selection |
| `start` | `engine`, `select` and `window` |
| `status`, `stop` | Engine status; stop the engine when it has no work |

All commands accept `--lab <dir>` to use another lab folder. The engine's log is
`engine.log` in the lab, the window's stderr is `window.err`.

On a machine with little memory, limit Rust parallelism:
`CARGO_BUILD_JOBS=2 pnpm window:build`.

After `pnpm build`, `node tests/helpers/zcode-provider-ui.mjs` checks external
provider installation, account gating and retry recovery in the compiled front
with simulated IPC. It runs manually, outside `pnpm verify`, and does not check
the native window or a real ZCode account.

## The browser build

The same front runs in a browser against Danil Computers instead of the Tauri
window. `src/web/` holds only that entry: it answers the globals of
`@tauri-apps/api` with a transport over the relay session socket, so the desktop
bundle never imports it, and its phrases live in `src/locales/*/web.json`,
which the desktop catalogs leave out. `options.headers` of `invoke` reach the
transport (`x-terminus-workspace` is honored; other headers are ignored for now).

```sh
TERMINUS_WEB_SUPABASE_URL=https://<project>.supabase.co \
TERMINUS_WEB_SUPABASE_KEY=<publishable key> \
pnpm web:build      # dist-web/<base>/ plus dist-web/index.html and dist-web/_headers
pnpm web:dev        # Vite on <base>web.html with the same settings
```

`pnpm web:build` ends with `scripts/web-mobile.mjs`: the phone app
(`apps/mobile`, Expo for web) built into `dist-web/<base>m/` with the same
public settings, so it needs `npm ci` in `apps/mobile` first. A phone (small,
touch screen: `PHONE_QUERY` in `@terminus/design`) that opens `<base>` goes to
`<base>m/`; each version links to the other and the choice is kept in
`localStorage` (`terminus.web.layout`). Both share the origin, the Danil app's
Supabase session and `_headers`. A deep link under `<base>m/` that falls back to
`index.html` is passed to the phone app as `?to=`. `web:dev` serves only the
desktop version.

Build-time settings (environment variables; all are public values):

| Variable | Default | Effect |
|---|---|---|
| `TERMINUS_WEB_BASE` | `/terminus/` | Path the page is served under |
| `TERMINUS_WEB_ENDPOINT` | `https://computers.danil.ai` | Control plane and relay; added to `connect-src` as `https` and `wss` |
| `TERMINUS_WEB_SUPABASE_URL` | none | The Danil app's Supabase project; added to `connect-src` |
| `TERMINUS_WEB_SUPABASE_KEY` | none | Its publishable (anon) key |
| `TERMINUS_WEB_LOGIN` | `/` | Where to go when there is no session |
| `TERMINUS_WEB_CONNECT` | empty | Extra `connect-src` sources |

The page is served on the Danil app's origin, so it reads the Supabase session
that app stored (`supabase.auth.getSession()`); it never signs in. After a 401
from the API or a relay close 4003 it calls `refreshSession()` and, if that
fails, goes to the login. It lists the person's computers (`GET
/v1/computers`), opens the only one or the remembered one, or shows a picker
that can also start a computer; `?computer=<id>` opens that one. Opening does
not start a computer: an off one mounts as it is, with the machine-off notice.
While the relay says it is off, a read still asks it: the relay may answer
from its own copy with `cached: {updated_at}`, which the page passes through
and shows as "last synced" next to the off notice. A miss answers from the
page's last copy (`src/web/reads.ts`) or waits, and other commands wait; only the relay's
intent commands (send a message, create a task, answer a permission…) wake it. The installer screen never shows: a managed computer is prepared at
install, so `Setup` shows only the preparation's progress, or a support note
if an essential stage failed (`localSetup` in `lib/platform.ts`). Before
reconnecting the socket it asks the API again, so a missing license or a
computer that is not theirs shows a notice instead of a blind retry. A page
that sets `window.terminusWeb` before the script loads can override any of the
settings above, or give `{ endpoint, computerId, getToken }` and skip the
session and the picker.

What the window does locally (native sites, Typst live, tray, updater, local
file pickers, opening files on the host) answers with `web.desktop_only` or a
browser equivalent. `tests/unit/web-transport.test.mjs` and
`tests/unit/web-gate.test.mjs`, `tests/unit/web-setup.test.mjs`, `tests/unit/web-off.test.mjs`, `tests/unit/web-cached.test.mjs` and `tests/unit/web-onboarding.test.mjs` mount `dist-web/` against a relay simulated in
Node (`tests/helpers/fake-relay.mjs`).

`wrangler.web.toml` deploys `dist-web/` as the private assets Worker
`terminus-web` (no route, no `workers.dev`); the Danil app forwards
`/terminus/*` to it through a Service Binding. `dist-web/_headers` carries the
policy with `frame-ancestors 'none'`, and `dist-web/index.html` is the
single-page fallback for paths under the base.

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

The contract comes from seldon-host (`crates/engine-protocol/commands.json`),
copied byte for byte. Copying a newer one is not enough: the window computes
its contract from those bytes, so it refuses the pinned engine until a
`seldon-runtime` release with the same contract is published
([runtime-binary-release.md](https://github.com/danil-labs/seldon-host/blob/dev/docs/runtime-binary-release.md)) and pinned here. Until then
the `contract` guard requires the pending contract to be named in
`MOTOR_PENDIENTE`, and `publish.yml` refuses to publish.

## Releases

Maintainers publish with a version tag:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` (`pnpm version:bump`), and update
   `release-notes/en.md` and `release-notes/es.md`.
2. Merge to `main`, tag `v<version>` and push the tag.

[`publish.yml`](../../../.github/workflows/publish.yml) builds, signs and publishes.
It refuses to publish while `seldon-runtime.lock` is not pinned for every
platform or the engine is not bundled (`bundle.externalBin`): an installed copy
updated to a window without its engine would not open. To test a change to the
workflow without publishing:

```sh
gh workflow run publish.yml -R danil-labs/terminus --ref <branch> -f dry_run=true
```

A dry run spends no eSigner signatures: Windows builds without
`signCommand` and its installed files are checked for presence, not for
Authenticode. eSigner itself is only exercised by a real release.

`node tests/release/publish.test.mjs` (macOS or Linux, needs Ruby and jq)
runs the packaging steps of the workflow with fixtures and temporary signing
keys.

The identity of the installed app — updater public key, bundle identifier
`ai.danil.terminus` and product name — is duplicated in `publish.yml` on
purpose. Changing any of them strands installed copies; read the comments
there first.

## Line endings

`.gitattributes` checks out every text file with LF on all platforms. Generated
files and the contract hash depend on it.
