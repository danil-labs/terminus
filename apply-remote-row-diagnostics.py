#!/usr/bin/env python3
"""Overlay de observación para QA; no integra cambios al producto.

Uso desde un worktree desechable:
  python3 apply-remote-row-diagnostics.py --root . --apply
  pnpm window:build
  python3 apply-remote-row-diagnostics.py --root . --revert

Sin --apply imprime el diff. --ref permite inspeccionar cualquiera de las dos
bases sin cambiar el árbol. Aplicar exige HEAD exacto y fuentes sin modificar.
Buscar `remote-row:` en el window.log nativo del HOME desechable. Usa el comando
existente window_painted; no requiere inspector ni servidor adicional. Registra
IDs y metadatos DOM, nunca texto del chat. Las llamadas de diagnóstico son
observacionales, pero su IPC añade trabajo: no usar esta variante para medir
rendimiento. Mantener el overlay CSP de laboratorio existente, sin ampliarlo.
"""
import argparse
import difflib
import json
from pathlib import Path
import subprocess

BASE = "ec3d3703813d4ec92d94730ae215d5555f3bfd69"
FIX = "23d93884bd2c842e92d61e24467c7f704b967333"
PREFIX = "apps/desktop/src/"
HELPER = PREFIX + "lib/rowDiagnostics.ts"

DIAGNOSTICS = '''import { invoke } from "@tauri-apps/api/core";

let sequence = 0;
export function traceRemoteRow(tag: string, detail: Record<string, unknown> = {}) {
  void invoke("window_painted", {
    at: Math.round(performance.now()),
    source: `remote-row:${JSON.stringify({ sequence: ++sequence, tag, ...detail })}`,
  }).catch(() => {});
}
'''


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit(f"Marcador ambiguo o ausente: {old[:100]!r}")
    return text.replace(old, new, 1)


def instrument(files):
    app = files[PREFIX + "app/App.tsx"]
    app = 'import { traceRemoteRow } from "../lib/rowDiagnostics";\n' + app
    app = replace_once(app, '  const agentesEnUso = () => {', '''  createEffect(() => traceRemoteRow("state", {
    workspace: workspaceActivo(), space: escritorio(), project: project(), session: sessionId(),
    active: pestanas.active(), open: pestanas.open().map(p => p.id),
    panels: paneles.columns(), site: paneles.activeSite(),
  }));
  onMount(() => {
    const watch = (phase: string) => (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest("[data-sesion]");
      const space = target?.closest("[data-space]");
      const pointer = event as PointerEvent;
      traceRemoteRow(`dom.${phase}`, {
        type: event.type, trusted: event.isTrusted, target: target?.tagName,
        connected: target?.isConnected, row: row?.getAttribute("data-sesion"),
        space: space?.getAttribute("data-space"), pointer: pointer.pointerId,
        pointerType: pointer.pointerType, button: pointer.button,
        x: pointer.clientX, y: pointer.clientY, prevented: event.defaultPrevented,
      });
    };
    const capture = watch("capture"), bubble = watch("bubble");
    for (const event of ["pointerdown", "pointerup", "click"]) {
      document.addEventListener(event, capture, true);
      document.addEventListener(event, bubble);
    }
    onCleanup(() => {
      for (const event of ["pointerdown", "pointerup", "click"]) {
        document.removeEventListener(event, capture, true);
        document.removeEventListener(event, bubble);
      }
    });
  });
  const agentesEnUso = () => {''')
    app = replace_once(app, '      const fuera = pestanas.sync((id) => {', '''      traceRemoteRow("prune.before", {
        space: desk, open: pestanas.open().map(p => p.id),
        rows: Object.fromEntries(Object.entries(lista).map(([key, rows]) => [key, rows.map(r => r.id)])),
      });
      const fuera = pestanas.sync((id) => {''')
    app = replace_once(app, '      fuera.forEach(soltarHilo);', '''      traceRemoteRow("prune.after", { removed: fuera, open: pestanas.open().map(p => p.id) });
      fuera.forEach(soltarHilo);''')
    app = replace_once(app, '      pedidas.set(project, new Set(open));', '''      traceRemoteRow("list.return", { project, open, rows: rows.map(r => r.id) });
      pedidas.set(project, new Set(open));''')
    app = replace_once(app, '  async function abrirSesion(proyecto: string, id: string, activar = id, propagateError = false) {', '''  async function abrirSesion(proyecto: string, id: string, activar = id, propagateError = false) {
    traceRemoteRow("open.enter", { id, project: proyecto, activate: activar, space: escritorio(), stack: new Error().stack });''')
    app = replace_once(app, '    if (id === sessionId() && proyecto === project()) {', '''    traceRemoteRow("open.ensured", { id, session: sessionId(), active: pestanas.active(), open: pestanas.open().map(p => p.id) });
    if (id === sessionId() && proyecto === project()) {''')
    app = replace_once(app, '      const s = await leerTarea(proyecto, id);\n      if (!current()) return;', '''      traceRemoteRow("open.read", { id, session: sessionId(), active: pestanas.active(), open: pestanas.open().map(p => p.id) });
      const s = await leerTarea(proyecto, id);
      traceRemoteRow("open.result", { id, response: s.id, current: current(), session: sessionId(), open: pestanas.open().map(p => p.id) });
      if (!current()) return;''')
    app = replace_once(app, '  function irAlBlanco(enProyecto = project()) {', '''  function irAlBlanco(enProyecto = project()) {
    traceRemoteRow("blank", { project: enProyecto, session: sessionId(), stack: new Error().stack });''')
    app = replace_once(app, '  function cambiarEscritorio(id: string, restaurarActiva = true) {', '''  function cambiarEscritorio(id: string, restaurarActiva = true) {
    traceRemoteRow("space", { id, restore: restaurarActiva, previous: escritorio(), stack: new Error().stack });''')
    files[PREFIX + "app/App.tsx"] = app

    path = PREFIX + "features/projects/Sessions.tsx"
    rows = 'import { traceRemoteRow } from "../../lib/rowDiagnostics";\n' + files[path]
    rows = replace_once(rows, '        onOpen={() => props.onPick(c.s.id)}', '''        onOpen={() => { traceRemoteRow("hover.pick", { id: c.s.id }); props.onPick(c.s.id); }}''')
    rows = replace_once(rows, '          onClick={(e) => {\n            // El menú vive', '''          onClick={(e) => {
            traceRemoteRow("row.click", {
              id: f.s.id, contains: e.currentTarget.contains(e.target as Node),
              actions: !!(e.target as HTMLElement).closest("[data-session-actions]"),
              rename: !!(e.target as HTMLElement).closest("[data-session-rename]"), drag: fueArrastre(),
            });
            // El menú vive''')
    rows = replace_once(rows, '            if (fueArrastre()) return;\n            props.onPick(f.s.id);', '''            if (fueArrastre()) return;
            traceRemoteRow("row.pick", { id: f.s.id });
            props.onPick(f.s.id);''')
    files[path] = rows

    path = PREFIX + "features/machines/router.ts"
    router = 'import { traceRemoteRow } from "../../lib/rowDiagnostics";\n' + files[path]
    marker = '        const before = previousSlice(envelope);' if '        const before = previousSlice(envelope);' in router else '        const before = fleet.peek(envelope);'
    router = replace_once(router, marker, marker + '''
        traceRemoteRow("fan.peek", {
          machine: envelope.machine, workspace, command, project: args.project, open: args.open,
          exact: fleet.peek(envelope)?.has ?? false, has: before?.has ?? false, status: before?.status,
          rows: Array.isArray(before?.value) ? before.value.map(r => r?.id) : undefined,
        });''')
    router = replace_once(router, '        if (differs(before, slice)) notify(envelope.command);', '''        traceRemoteRow("fan.refreshed", {
          machine: envelope.machine, workspace: envelope.workspace, command: envelope.command,
          project: envelope.args?.project, open: envelope.args?.open, has: slice.has, status: slice.status,
          rows: Array.isArray(slice.value) ? slice.value.map(r => r?.id) : undefined,
        });
        if (differs(before, slice)) notify(envelope.command);''')
    files[path] = router
    files[HELPER] = DIAGNOSTICS
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--ref", help="Inspección del diff; aplicar/revertir sólo admite HEAD")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--apply", action="store_true")
    action.add_argument("--revert", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    def git(*command):
        return subprocess.check_output(["git", "-C", str(root), *command], text=True)
    head = git("rev-parse", "HEAD").strip()
    ref = git("rev-parse", args.ref or "HEAD").strip()
    if ref not in (BASE, FIX):
        raise SystemExit("Sólo admite ec3d370 o 23d9388; no adivina una base nueva.")
    if (args.apply or args.revert) and ref != head:
        raise SystemExit("Aplicar/revertir exige el mismo HEAD que --ref.")
    paths = [PREFIX + "app/App.tsx", PREFIX + "features/projects/Sessions.tsx", PREFIX + "features/machines/router.ts"]
    originals = {path: git("show", f"{ref}:{path}") for path in paths}
    changed = instrument(dict(originals))
    if args.apply or args.revert:
        expected = changed if args.revert else originals
        for path, source in expected.items():
            target = root / path
            if not target.exists() or target.read_text() != source:
                raise SystemExit(f"Fuente alterada, no se sobrescribe: {path}")
        if args.apply and (root / HELPER).exists():
            raise SystemExit(f"Ya existe {HELPER}; no se sobrescribe.")
        for path, source in (originals if args.revert else changed).items():
            (root / path).write_text(source)
        if args.revert:
            (root / HELPER).unlink()
        print(json.dumps({"ref": ref, "action": "reverted" if args.revert else "applied", "files": list(changed)}))
    else:
        for path, source in changed.items():
            print("".join(difflib.unified_diff(originals.get(path, "").splitlines(True), source.splitlines(True), fromfile="a/" + path, tofile="b/" + path)), end="")


if __name__ == "__main__":
    main()
