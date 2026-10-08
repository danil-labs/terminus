# Scripts and guards

Applies [AGENTS.md](../AGENTS.md). Node programs: contract guards, existing
tests and development tools.

- `verify.mjs` lists every step and stops at the first failure. Its catalog is
  [docs/guards.md](../docs/guards.md).
- Every `*.test.ts` and `*.test.mjs` in this folder is a step of the chain, and
  every `.mjs` guard has a row in the catalog.
- A skip keeps its own exit code and is never reported as a pass.
- Baselines (`*-baseline.json`) only go down after a cleanup; they never absorb
  a regression.
- Guards that need what the engine registers read
  `src-tauri/crates/engine-protocol/commands.json` and `phrase-keys.json`.
- Resolve URL paths with `fileURLToPath`. On Windows run shims through their
  runtime: `pnpm.cmd` is not a native binary.
- `engine.mjs` downloads and runs the engine lab
  ([development](../docs/development.md)). `release/publish.test.mjs` tests the
  packaging steps of `publish.yml` and runs on macOS or Linux.
