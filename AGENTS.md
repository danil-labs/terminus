# Terminus: repository map

This repository holds the Terminus clients and what they share. The domain
(workspaces, tasks, agent turns, accounts) lives in the engine `seldon-runtime`,
which is not here.

| Path | What it is | Guide |
|---|---|---|
| `apps/desktop/` | The window: Tauri 2 (Rust) with a SolidJS front. The installers ship it. | [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md) |
| `apps/mobile/` | The iOS and Android app (Expo) and its development bridge. | [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md) |
| `packages/design` | Task states, marks, status words and theme colors both apps use. | — |
| `packages/protocol` | Types and allowed commands between the bridge and its clients. | — |

Read the guide of the area before editing it.

## Commands

```bash
pnpm install            # desktop and packages (pnpm workspace)
pnpm verify             # the desktop chain: guards, front build and Rust
pnpm verify --no-cargo  # the same chain without Rust
```

`pnpm <script>` at the root runs the desktop's script. `apps/mobile/` is outside
the pnpm workspace: it installs with npm from its own folder.

## Shared code

- Code both apps need goes in `packages/`, not in a copy inside one app.
- The desktop stays the source of the look: `apps/desktop/src/styles/global.css`
  and its catalogs. `packages/design` repeats what other clients need, and the
  `shared-design` guard fails when the two drift.
- Packages are TypeScript sources without a build step; imports inside them
  carry the `.ts` extension so Node can load them directly.

## Working rules

- Work goes to `dev` first, then to `main`. Commits are signed off (DCO,
  `git commit -s`) and follow Conventional Commits; see
  [CONTRIBUTING.md](CONTRIBUTING.md).
- File names and identifiers are in English; internal docs and comments are
  mostly in Spanish.
- Only `AGENTS.md` files guide agents here; there is no `CLAUDE.md`.
