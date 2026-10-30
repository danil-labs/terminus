/**
 * How a tool name reads in every client: Claude's names and Codex's item types
 * share one table because they name the same act. A name that is not here is
 * `other` and keeps its raw name on screen.
 */
export type StepKind = "read" | "search" | "edit" | "run" | "web" | "plan" | "other";

export function classify(name: string): StepKind {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "read";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "file_change":
      return "edit";
    case "Bash":
    case "BashOutput":
    case "KillShell":
    case "command_execution":
      return "run";
    case "Glob":
    case "Grep":
      return "search";
    case "WebFetch":
    case "WebSearch":
    case "web_search":
      return "web";
    case "TodoWrite":
    case "todo_list":
      return "plan";
    default:
      return "other";
  }
}

/** The command without its shell wrapper (Codex sends `zsh -lc "…"`) or a leading `cd … &&`; a bare `cd` stays. */
export function bareCommand(cmd: string) {
  const wrapped = /^\S*(?:sh|bash|zsh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1\s*$/.exec(cmd.trim());
  const bare = (wrapped ? wrapped[2] : cmd).trim();
  const withCd = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*([\s\S]+)$/.exec(bare);
  return (withCd ? withCd[1] : bare).trim();
}

/** The last part of a path, with either slash. */
export const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;
