# Contributing to Terminus

Thanks for helping. This repository is the Terminus window: the desktop app and
its release tooling. The engine (`seldon-runtime`) is a separate, proprietary
binary; changes to how projects, tasks, agents or accounts behave inside the
engine can't be made here, but bug reports about them are welcome as issues.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on
  the approach.
- Read [AGENTS.md](AGENTS.md): it is the working guide for this repository, for
  people and for coding agents alike.
- Set up the project as described in [README.md](README.md#build-from-source).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Make the change. Keep it focused: one concern per pull request.
3. Run the chain and make sure it passes:

   ```sh
   pnpm verificar              # full chain, including Rust
   pnpm verificar --sin-cargo  # without Rust, if you only touched the front
   ```

4. Check the change in the real window when it affects what people see
   (`pnpm window:build` and `pnpm engine:start`). Say in the pull request what
   you checked, on which platform, and what you could not check.
5. Open a pull request against `main` and fill in the template.

CI runs `verify` on every pull request. It runs with read-only permissions and
without secrets, so it works the same from a fork.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. By signing off you certify the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that
you wrote the change or otherwise have the right to submit it under the
project's license (Apache-2.0).

Add the sign-off with `-s`:

```sh
git commit -s -m "fix: keep the tab when its task is archived"
```

which appends a line with your real name and email:

```
Signed-off-by: Your Name <you@example.com>
```

To sign off commits you already made: `git rebase --signoff main`.

## Style

- Follow the existing code: naming, structure and comment density of the file
  you edit. Biome (`pnpm lint`) and `cargo fmt`/`clippy` are part of the chain.
- User-facing text goes through the catalogs in `src/locales/` (`t()`); add the
  key in both `es` and `en`. See [docs/localization.md](docs/localization.md).
- Colors and controls come from the theme tokens and `src/ui/`; see
  [docs/visual-system.md](docs/visual-system.md).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`…).

## What not to change in a pull request

- The app identity in `src-tauri/tauri.conf.json` (`identifier`, `productName`,
  updater `pubkey` and endpoint) and in `.github/workflows/publish.yml`.
  Installed copies depend on them.
- `src-tauri/crates/engine-protocol/commands.json`: it is the frozen contract
  with the engine and must stay byte-exact.
- Signing and publishing steps in `publish.yml`, unless the pull request is
  about them and a maintainer asked for it.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Security issues go
through private reporting, never public issues: see [SECURITY.md](SECURITY.md).

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
