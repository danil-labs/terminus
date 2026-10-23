/**
 * Lo que el agente hizo en un turno, como en la ventana (`apps/desktop/src/lib/steps.ts`
 * y `features/chat/transcript.ts`): sus avances, las herramientas que usó (qué leyó,
 * qué ejecutó) y la respuesta. Sin React Native: se prueba en Node.
 */
import type { Turn, TurnTool } from "@terminus/protocol";

/** Qué clase de acto fue: decide el verbo y el ícono de la fila. */
export type StepKind = "read" | "search" | "edit" | "run" | "web" | "plan" | "other";

export type Step = { kind: StepKind; name: string; target: string | null; ok: boolean | null; running: boolean };

/** Una fila: uno o varios pasos seguidos de la misma clase, que se leen como un acto. */
export type StepRow = { kind: StepKind; steps: Step[] };

/**
 * Quién escribió un input que no es de la persona: un encargado o una tarea por
 * el CLI. Como en la ventana, va a la izquierda con su cara y su firma.
 */
export type Sender = { agent: string | null; task: string | null; provider: string | null };

export function senderOf(turn: Turn): Sender | null {
  if (turn.role !== "user" || (!turn.agent && !turn.from_task)) return null;
  return { agent: turn.agent ?? null, task: turn.from_task?.title ?? null, provider: turn.from_task?.provider ?? null };
}

/** Un renglón de la conversación. */
export type Line =
  | { key: string; kind: "message"; role: string; text: string; images: string[]; attachments: string[]; from?: Sender | null }
  /** Lo que el agente dijo antes de su respuesta, mientras trabajaba. */
  | { key: string; kind: "progress"; text: string }
  | { key: string; kind: "steps"; rows: StepRow[] }
  /** Un `!` de la persona con su salida. */
  | { key: string; kind: "shell"; command: string; output: string; exitCode: number | null };

/** Los nombres de Claude y los tipos de item de Codex, que nombran lo mismo. */
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

export const stepOf = (name: string, target: string | null, ok: boolean | null = null, running = false): Step => ({ kind: classify(name), name, target, ok, running });

/** Un comando se junta solo consigo: cada uno es su propio acto. */
const JOINABLE = new Set<StepKind>(["read", "search", "edit", "web", "plan", "other"]);

export function groupSteps(steps: readonly Step[]): StepRow[] {
  const rows: StepRow[] = [];
  for (const step of steps) {
    const last = rows.at(-1);
    if (last && last.kind === step.kind && JOINABLE.has(step.kind)) last.steps.push(step);
    else rows.push({ kind: step.kind, steps: [step] });
  }
  return rows;
}

/** El comando sin el envoltorio del shell (Codex manda `zsh -lc "…"`) ni el `cd … &&` que lo precede. */
export function bareCommand(cmd: string) {
  const wrapped = /^\S*(?:sh|bash|zsh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1\s*$/.exec(cmd.trim());
  const bare = (wrapped ? wrapped[2] : cmd).trim();
  const withCd = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*([\s\S]+)$/.exec(bare);
  return (withCd ? withCd[1] : bare).trim();
}

export const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

/** La pregunta que el agente deja escrita no es un paso que enseñar. */
const visible = (tool: TurnTool | undefined): tool is TurnTool => tool !== undefined && !tool.target?.includes(".preguntas.json");
const toStep = (tool: TurnTool) => stepOf(tool.name ?? "", tool.target ?? null, tool.ok ?? null);

/**
 * Los renglones de un turno. Con su orden registrado (`pieces`): los avances y los
 * pasos donde ocurrieron, y la respuesta (lo dicho tras la última herramienta) al
 * final; sin él, los pasos delante del texto.
 */
export function linesOfTurn(turn: Turn, key: string, images: string[]): Line[] {
  const from = senderOf(turn);
  const message = (text: string): Line => ({ key, kind: "message", role: turn.role, text, images, attachments: turn.attachments ?? [], from });
  if (turn.shell) return [{ key, kind: "shell", command: turn.text ?? "", output: turn.shell.output ?? "", exitCode: turn.shell.exit_code ?? null }];
  const tools = turn.tools ?? [];
  const pieces = turn.pieces ?? [];
  if (!pieces.length) {
    const steps = tools.filter(visible).map(toStep);
    return [...(steps.length ? [{ key: `${key}:steps`, kind: "steps", rows: groupSteps(steps) } as Line] : []), message(turn.text ?? "")];
  }
  const lastText = pieces.reduce((at, p, i) => ("text" in p ? i : at), -1);
  let firstFinal = lastText;
  while (firstFinal > 0 && "text" in pieces[firstFinal - 1]) firstFinal--;
  const answer = pieces
    .slice(firstFinal, lastText + 1)
    .map((p) => ("text" in p ? p.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
  const out: Line[] = [];
  let steps: Step[] = [];
  const flush = (i: number) => {
    if (steps.length) out.push({ key: `${key}:steps${i}`, kind: "steps", rows: groupSteps(steps) });
    steps = [];
  };
  pieces.forEach((piece, i) => {
    if ("tool" in piece) {
      const tool = tools[piece.tool];
      if (visible(tool)) steps.push(toStep(tool));
      return;
    }
    if (i >= firstFinal && i !== lastText) return;
    flush(i);
    if (i === lastText) out.push(message(answer || turn.text || ""));
    else if (piece.text.trim()) out.push({ key: `${key}:p${i}`, kind: "progress", text: piece.text.trim() });
  });
  flush(pieces.length);
  if (lastText < 0) out.push(message(turn.text ?? ""));
  return out;
}

/** Lo que llega en vivo de un turno en marcha: texto y pasos, en orden. */
export type LivePiece = { text: string } | { step: Step };

/** Un evento `chat` del turno en marcha, sobre lo que ya se ve. */
export function applyLive(live: readonly LivePiece[], event: { kind: string; text: string; target?: string | null; ok?: boolean | null; starts_message?: boolean }): readonly LivePiece[] {
  if (event.kind === "delta") {
    const last = live.at(-1);
    if (last && "text" in last && !event.starts_message) return [...live.slice(0, -1), { text: last.text + event.text }];
    return [...live, { text: event.text }];
  }
  if (event.kind === "tool") return [...live, { step: stepOf(event.text, event.target ?? null, null, true) }];
  if (event.kind === "tool_done") {
    const i = live.findLastIndex((p) => "step" in p && p.step.running && p.step.name === event.text);
    const done = (step: Step): Step => ({ ...step, running: false, ok: event.ok ?? null });
    if (i < 0) return [...live, { step: done(stepOf(event.text, event.target ?? null)) }];
    return live.map((p, j) => (j === i && "step" in p ? { step: done(p.step) } : p));
  }
  return live;
}

/** Los renglones de lo que llega en vivo: el último texto es la respuesta que se está escribiendo. */
export function linesOfLive(live: readonly LivePiece[]): Line[] {
  const out: Line[] = [];
  let steps: Step[] = [];
  const lastText = live.findLastIndex((p) => "text" in p);
  live.forEach((piece, i) => {
    if ("step" in piece) return void steps.push(piece.step);
    if (steps.length) out.push({ key: `live:steps${i}`, kind: "steps", rows: groupSteps(steps) });
    steps = [];
    if (!piece.text.trim()) return;
    out.push(i === lastText && i === live.length - 1 ? { key: "live", kind: "message", role: "agent", text: piece.text, images: [], attachments: [] } : { key: `live:p${i}`, kind: "progress", text: piece.text.trim() });
  });
  if (steps.length) out.push({ key: `live:steps${live.length}`, kind: "steps", rows: groupSteps(steps) });
  return out;
}
