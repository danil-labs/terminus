/**
 * Lo que se pega en un orquestador de esta máquina para que arranque
 * `terminus mcp serve` con su credencial (`local_orchestrator_connect`).
 */
export function snippets(o: { credential_file: string; cli: string | null }): { id: string; text: string }[] {
  const cli = o.cli ?? "terminus";
  const quoted = (v: string) => (/^[\w./:@-]+$/.test(v) ? v : JSON.stringify(v));
  return [
    { id: "claude", text: `claude mcp add danil -e TERMINUS_CREDENTIAL=${quoted(o.credential_file)} -- ${quoted(cli)} mcp serve` },
    {
      id: "hermes",
      text: ["mcp_servers:", "  danil:", `    command: ${JSON.stringify(cli)}`, "    args: [mcp, serve]", "    env:", `      TERMINUS_CREDENTIAL: ${JSON.stringify(o.credential_file)}`].join("\n"),
    },
    {
      id: "generic",
      text: JSON.stringify({ mcpServers: { danil: { command: cli, args: ["mcp", "serve"], env: { TERMINUS_CREDENTIAL: o.credential_file } } } }, null, 2),
    },
  ];
}

