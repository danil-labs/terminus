# Scripts and guards

Applies [AGENTS.md](../AGENTS.md). Node programs in two groups: `guards/`
holds the static contract checks that `verify.mjs` runs (each with a row in
the catalog); the rest are development tools run by hand (`engine.mjs`,
`version.mjs`, `notices.mjs`, `icons.mjs`, `phrases.mjs`). Tests live in
[tests/](../tests/AGENTS.md).

- `verify.mjs` lists every step and stops at the first failure. Its catalog is
  [docs/guards.md](../docs/guards.md).
- Every `.mjs` guard has a row in the catalog, and every `tests/unit/*.test.*`
  is a step of the chain.
- A skip keeps its own exit code and is never reported as a pass.
- Baselines (`*-baseline.json`) only go down after a cleanup; they never absorb
  a regression.
- Guards that need what the engine registers read
  `src-tauri/crates/engine-protocol/commands.json` and `phrase-keys.json`.
- Resolve URL paths with `fileURLToPath`. On Windows run shims through their
  runtime: `pnpm.cmd` is not a native binary.
- `engine.mjs` downloads and runs the engine lab
  ([development](../docs/development.md)).
