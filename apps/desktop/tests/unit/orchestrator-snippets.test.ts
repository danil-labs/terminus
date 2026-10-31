import assert from "node:assert/strict";
import test from "node:test";

import { snippets } from "../../src/features/settings/orchestratorSnippets.ts";

const base = { credential_file: "/data/orchestrators/local-0a1b2c3d4e5f/credential.json", cli: "/opt/terminus/terminus" };

test("cada configuración arranca mcp serve con la credencial de esa conexión", () => {
  const [claude, hermes, generic] = snippets(base);
  assert.equal(claude!.text, "claude mcp add danil -e TERMINUS_CREDENTIAL=/data/orchestrators/local-0a1b2c3d4e5f/credential.json -- /opt/terminus/terminus mcp serve");
  assert.match(hermes!.text, /^mcp_servers:\n  danil:\n    command: "\/opt\/terminus\/terminus"\n    args: \[mcp, serve\]\n    env:\n      TERMINUS_CREDENTIAL: "\/data\/orchestrators\/local-0a1b2c3d4e5f\/credential\.json"$/);
  assert.deepEqual(JSON.parse(generic!.text), {
    mcpServers: { danil: { command: base.cli, args: ["mcp", "serve"], env: { TERMINUS_CREDENTIAL: base.credential_file } } },
  });
});

test("una ruta con espacios sale entre comillas en la línea de Claude Code", () => {
  const [claude] = snippets({ credential_file: "/Users/ana/Library/Application Support/x/credential.json", cli: "/Applications/Terminus.app/Contents/MacOS/terminus" });
  assert.equal(
    claude!.text,
    'claude mcp add danil -e TERMINUS_CREDENTIAL="/Users/ana/Library/Application Support/x/credential.json" -- /Applications/Terminus.app/Contents/MacOS/terminus mcp serve',
  );
});

test("sin ruta del CLI se usa terminus del PATH", () => {
  assert.match(snippets({ ...base, cli: null })[0]!.text, / -- terminus mcp serve$/);
});
