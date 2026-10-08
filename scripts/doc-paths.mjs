#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { esteArchivo as isMain, RAIZ as ROOT, archivos as walkFiles } from "./git.mjs";

const roots = ["AGENTS.md", "README.md", "CONTRIBUTING.md", "SECURITY.md", "CREDITS.md", "NOTICE", "src/AGENTS.md", "scripts/AGENTS.md"];
const directories = ["docs", "plugins", "attacks", "src-tauri/icons", "src-tauri/crates", "npx"];
const documents = [
  ...roots,
  ...directories.flatMap((directory) =>
    [...walkFiles(join(ROOT, directory), [".md"])].map((path) => relative(ROOT, path)),
  ),
].filter((path) => path !== "docs/FRASES.md");
const sourcePath = /`((?:src|src-tauri|scripts|plugins|attacks|docs|npx|\.github)\/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\/?)`/g;
const frontendPath = /`((?:features|lib|ui|app|locales|styles)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/?)`/g;

function references() {
  const found = [];
  for (const document of documents) {
    const content = readFileSync(join(ROOT, document), "utf8");
    const seen = new Set();
    for (const [index, line] of content.split("\n").entries()) {
      for (const [pattern, prefix] of [[sourcePath, ""], [frontendPath, "src/"]]) {
        for (const [, path] of line.matchAll(pattern)) {
          if (seen.has(path)) continue;
          seen.add(path);
          found.push({ document, line: index + 1, path, candidates: [path, `${prefix}${path}`, join(dirname(document), path)] });
        }
      }
    }
    const visit = (node) => {
      if (["link", "image", "definition"].includes(node.type) && node.url) {
        const target = node.url.split(/[?#]/)[0];
        if (target && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) {
          let path;
          try {
            path = decodeURIComponent(target);
          } catch {
            path = target;
          }
          const candidate = target.startsWith("/")
            ? path.slice(1)
            : join(dirname(document), path);
          found.push({ document, line: node.position.start.line, path, candidates: [candidate] });
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(fromMarkdown(content));
  }
  return found;
}

function ignored(paths) {
  if (paths.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: ROOT,
    input: paths.join("\n"),
    encoding: "utf8",
  });
  // Sin Git solo se excluyen los generados conocidos; los enlaces siguen comprobándose.
  if (result.error) return new Set(paths.filter((path) => /^(?:src-tauri\/(?:target|gen)\/|dist\/)|^docs\/FRASES\.md$/.test(path)));
  return new Set(result.stdout.split("\n").filter(Boolean));
}

export function missingReferences() {
  const all = references();
  const generated = ignored([...new Set(all.flatMap(({ candidates }) => candidates))]);
  return all.filter(({ candidates }) =>
    !candidates.some((path) => generated.has(path) || existsSync(join(ROOT, path))),
  );
}

if (isMain(import.meta.url)) {
  const missing = missingReferences();
  for (const { document, line, path } of missing) {
    console.error(`Ruta que no existe — ${document}:${line}  ${path}`);
  }
  if (missing.length) process.exit(1);
  console.log(`Las rutas y enlaces locales de ${documents.length} documentos existen.`);
}
