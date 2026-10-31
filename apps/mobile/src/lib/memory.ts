/**
 * La memoria de un workspace en la cuenta de Danil, para la pantalla del
 * teléfono (`src/app/memory/[workspace].tsx`). Va directo al Worker
 * (`/v1/workspaces/:id/memory/*`, cliente de `@terminus/computers`): nada pasa
 * por el relay ni por las máquinas, así que funciona con todas apagadas.
 *
 * Sin React Native: así se prueba en Node (`scripts/memory.test.ts`).
 */
import {
  type AccountWorkspace,
  type MemoryAnswer,
  type MemorySource,
  type MemoryWrite,
  conflictCopyOf,
  entriesIn,
  memoryFiles,
  parseMemoryEntry,
  readMemoryFile,
} from "@terminus/computers";

/** Un alcance de la pantalla: la memoria del workspace o la de uno de sus proyectos. */
export type MemoryScopeTab = { key: string; kind: "workspace" | "project"; project: string; name: string; dir: string };

/**
 * Los alcances que se ofrecen: el workspace primero y luego cada proyecto del
 * registro de la cuenta, en su orden. Sin registro, solo el del workspace.
 */
export function memoryScopes(workspace: AccountWorkspace | null | undefined): MemoryScopeTab[] {
  const out: MemoryScopeTab[] = [{ key: "workspace", kind: "workspace", project: "", name: "", dir: "memory/" }];
  for (const p of workspace?.projects ?? []) {
    out.push({ key: `project:${p.id}`, kind: "project", project: p.id, name: p.name || p.id, dir: `projects/${p.id}/memory/` });
  }
  return out;
}

/** Una entrada como la pinta la lista. */
export type MemoryItem = {
  path: string;
  /** El blob leído: es la `base` de una edición o un borrado. */
  oid: string;
  file: string;
  type: string | null;
  modified: string | null;
  /** El agente que la escribió (`origin.agent`); null si fue la persona. */
  agent: string | null;
  task: string | null;
  body: string;
  /** Si es la copia que dejó un conflicto, de qué entrada. */
  conflictOf: string | null;
};

export function memoryItem(path: string, oid: string, raw: string): MemoryItem {
  const parsed = parseMemoryEntry(raw);
  const copy = conflictCopyOf(path);
  return {
    path,
    oid,
    file: path.slice(path.lastIndexOf("/") + 1),
    type: parsed.type,
    modified: parsed.modified,
    agent: parsed.origin.agent ?? null,
    task: parsed.origin.task ?? null,
    body: parsed.body.trim(),
    conflictOf: copy ? copy.original.slice(copy.original.lastIndexOf("/") + 1) : null,
  };
}

/** Más nuevas primero; sin fecha, al final y por nombre. */
export function sortItems(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? "") || a.file.localeCompare(b.file));
}

/** Por qué no se pudo leer o escribir: lo que pinta la pantalla. */
export type MemoryProblem = "busy" | "disabled" | "signed_out" | "error";

export function problemOf(answer: MemoryAnswer<unknown>): MemoryProblem {
  if (answer.kind === "busy") return "busy";
  if (answer.kind === "disabled") return "disabled";
  if (answer.kind === "unauthorized") return "signed_out";
  return "error";
}

const BATCH = 6;

/** Las entradas de una carpeta de memoria, leídas de la cuenta. */
export async function loadMemory(source: MemorySource, workspace: string, dir: string): Promise<{ items: MemoryItem[] } | { problem: MemoryProblem }> {
  const listed = await memoryFiles(source, workspace);
  if (listed.kind !== "ok") return { problem: problemOf(listed) };
  const files = entriesIn(listed.value.files, dir);
  const items: MemoryItem[] = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const read = await Promise.all(files.slice(i, i + BATCH).map((f) => readMemoryFile(source, workspace, f.path, listed.value.commit ?? undefined)));
    for (const r of read) if (r.kind === "ok") items.push(memoryItem(r.value.path, r.value.oid, r.value.content));
  }
  return { items: sortItems(items) };
}

/** Lo que dice la pantalla después de guardar o borrar. */
export type MemoryOutcome =
  | { kind: "saved"; copy: string | null }
  | { kind: "deleted" }
  | { kind: "changed" }
  | { kind: "gone" }
  | { kind: "problem"; problem: MemoryProblem };

/** Traduce la respuesta de una escritura: la copia del conflicto, un borrado que no pisó, una memoria ocupada. */
export function outcomeOf(answer: MemoryAnswer<MemoryWrite>): MemoryOutcome {
  if (answer.kind === "ok") return answer.value.status === "deleted" ? { kind: "deleted" } : { kind: "saved", copy: answer.value.conflict_copy ?? null };
  if (answer.kind === "conflict") return { kind: "changed" };
  if (answer.kind === "missing") return { kind: "gone" };
  return { kind: "problem", problem: problemOf(answer) };
}

/** El nombre de archivo de una entrada nueva: sin carpetas, con `.md`; null si no sirve. */
export function entryFileName(input: string): string | null {
  const name = input.trim();
  if (!name || /[/\\]/.test(name) || name.startsWith(".")) return null;
  const file = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
  return file === "MEMORY.md" ? null : file;
}
