#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { SALIDA_OMITIDO as SKIPPED_EXIT_CODE } from "./git.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "src-tauri");
const PLATFORM = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] ?? process.platform;
const OTHER_PLATFORMS =
  process.platform === "darwin"
    ? "Windows y Linux"
    : process.platform === "win32"
      ? "macOS y Linux"
      : "Windows y macOS";

const SKIP_RUST = process.argv.includes("--sin-cargo");
const rustBuild = { command: "cargo", env: process.env };

function undocumentedGuards() {
  const catalog = readFileSync(join(root, "docs/guards.md"), "utf8");
  const documented = new Set(
    catalog.split("\n").filter((line) => line.startsWith("|")).flatMap((line) =>
      [...line.matchAll(/`(scripts\/[a-z-]+\.mjs)`/g)].map((match) => match[1]),
    ),
  );
  const scheduled = new Set(
    [...steps, ...rustSteps]
      .flatMap(([, , args = []]) => args)
      .filter((argument) => typeof argument === "string")
      .map((argument) => relative(root, argument).replaceAll("\\", "/"))
      .filter((argument) => argument.startsWith("scripts/") && argument.endsWith(".mjs") && !argument.includes(".test.")),
  );
  return [
    ...[...scheduled].filter((path) => !documented.has(path)).map((path) => `Paso sin fila: ${path}`),
    ...[...documented].filter((path) => !scheduled.has(path)).map((path) => `Fila sin paso: ${path}`),
  ];
}

const rustSteps = [
  ["El motor empaquetado está en su sitio", process.execPath, [join(root, "scripts/engine.mjs"), "sidecar"], root],
  ["cargo fmt", "cargo", ["fmt", "--check", "--", "--config-path", "rustfmt.toml"], backend],
  ["cargo check", rustBuild.command, ["check", "--locked", "--all-targets"], backend],
  ["cargo clippy", rustBuild.command, ["clippy", "--locked", "--all-targets"], backend],
  ["La ventana tiene permiso para lo que se le pide", process.execPath, [join(root, "scripts/permissions.mjs")], root],
  ["cargo test", rustBuild.command, ["test", "--locked"], backend],
];

const steps = [
  ["La CLI reenvía al motor sin abrir ventana", process.execPath, ["--test", join(root, "scripts/cli-forward.test.mjs")], root],
  ["El buscador de proyectos combina repositorios sin duplicarlos", process.execPath, ["--test", "--experimental-strip-types", join(root, "scripts/project-repositories.test.ts")], root],
  ["Todo el código es revisable", process.execPath, [join(root, "scripts/reviewable.mjs")], root],
  [
    "Un guarda sin git lo dice, y no mata la cadena",
    process.execPath,
    ["--test", join(root, "scripts/tree-git.test.mjs")],
    root,
  ],
  ["Ningún proceso abre una consola en Windows", process.execPath, [join(root, "scripts/console-window.mjs")], root],
  ["Ningún proceso se espera sin plazo", process.execPath, [join(root, "scripts/processes.mjs")], root],
  ["La ventana no se construye dos veces", process.execPath, [join(root, "scripts/window.mjs")], root],
  ["Los docs no mandan a un archivo que no está", process.execPath, [join(root, "scripts/doc-paths.mjs")], root],
  ["Alguien emite lo que la interfaz escucha", process.execPath, [join(root, "scripts/bridge.mjs")], root],
  ["Ningún error del backend se aplana", process.execPath, [join(root, "scripts/service-errors.mjs")], root],
  ["Alguien invoca lo que el backend registra", process.execPath, [join(root, "scripts/commands.mjs")], root],
  ["El runtime del artefacto no se rompe en silencio", process.execPath, [join(root, "scripts/artifact.mjs")], root],
  ["La nota de la versión sale en el idioma de la app", process.execPath, ["--test", "--experimental-strip-types", join(root, "scripts/release-notes.test.ts")], root],
  ["Las tareas de la página de un agente se paginan sin separar subtareas de su padre", process.execPath, ["--test", "--experimental-strip-types", join(root, "scripts/agent-page-tasks.test.ts")], root],
  ["La búsqueda de tareas ignora acentos y encuentra varias palabras", process.execPath, ["--test", "--experimental-strip-types", join(root, "scripts/task-search.test.ts")], root],
  ["El visor conserva navegación y rechaza los canales retirados", process.execPath, ["--test", "--experimental-strip-types", join(root, "scripts/artifact-viewer.test.ts")], root],
  ["La ventana no deja salir material", process.execPath, [join(root, "scripts/csp.mjs")], root],
  ["El tema de terminal no repinta el chrome", process.execPath, [join(root, "scripts/terminal-themes.mjs")], root],
  ["El catálogo define lo que el código pide", process.execPath, [join(root, "scripts/locales.mjs")], root],
  ["Lo ya traducido no se vuelve a soldar", process.execPath, [join(root, "scripts/literals.mjs")], root],
  ["Los comentarios no crecen ni argumentan", process.execPath, [join(root, "scripts/comments.mjs")], root],
  ["Las lecturas de fuente en pruebas respetan el cupo revisado", process.execPath, [join(root, "scripts/test-policy.mjs")], root],
  ["El paquete que la app trae dice lo que sabe pedir", process.execPath, [join(root, "scripts/plugins.mjs")], root],
  ["Los iconos del árbol son los del paquete", process.execPath, [join(root, "scripts/icons.mjs"), "--check"], root],
  ["Soltar un archivo no depende de la pantalla", process.execPath, [join(root, "scripts/drop.mjs")], root],
  ["Ninguna animación infinita repinta a 60 cuadros", process.execPath, [join(root, "scripts/animations.mjs")], root],
  [
    "El disparador conserva el clic que lo abre",
    process.execPath,
    ["--test", join(root, "scripts/triggers.test.mjs")],
    root,
  ],
  [
    "Un abanico de peticiones respeta su tope",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/pool.test.ts")],
    root,
  ],
  [
    "Un fondo de chat guardado que ya no existe no pinta nada",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/chat-background.test.ts")],
    root,
  ],
  [
    "El nombre de un agente da un identificador que el backend acepta",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/agent-id.test.ts")],
    root,
  ],
  [
    "Un formateador se reusa y sigue a la lengua",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/format.test.ts")],
    root,
  ],
  [
    "Los indicadores leen las dos formas de una medida",
    process.execPath,
    ["--test", join(root, "scripts/indicators.test.mjs")],
    root,
  ],
  [
    "El hilo sigue al agente y se deja soltar",
    process.execPath,
    ["--conditions=browser", "--test", "--experimental-strip-types", join(root, "scripts/paste.test.ts")],
    root,
  ],
  [
    "Las respuestas rápidas se leen igual en la ventana y en lo que sale del chat",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/next-steps.test.ts")],
    root,
  ],
  [
    "La barra elige la fila, y el comando exacto encabeza",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/suggestions.test.ts")],
    root,
  ],
  [
    "/btw va al margen solo con el agente que lo declara, y «Pasar al hilo» no manda nada",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/side-question.test.ts")],
    root,
  ],
  [
    "El menú de la arroba propone encargados por nombre, sin chocar con el material",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/recipient-menu.test.ts")],
    root,
  ],
  [
    "Un destinatario se pinta aparte del material y se mueve con él",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/recipients.test.ts")],
    root,
  ],
  [
    "Pegar una imagen la adjunta y pegar texto no",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/clipboard.test.ts")],
    root,
  ],
  [
    "La actividad de una tarea no le roba el foco a quien escribe",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/focus.test.ts")],
    root,
  ],
  [
    "El turno reabierto conserva su orden",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/turn-order.test.ts")],
    root,
  ],
  [
    "La respuesta dice con qué modelo contestó",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/turn-model.test.ts")],
    root,
  ],
  [
    "El medidor de contexto sale con lo que el agente publica",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/context-window.test.ts")],
    root,
  ],
  [
    "La salida de un comando de barra se pinta con su comando",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/command-output.test.ts")],
    root,
  ],
  [
    "El fragmento tardío de un mensaje vuelve a su globo",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/chat-delta.test.ts")],
    root,
  ],
  [
    "El servicio que vuelve no se pinta en la pantalla",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/invoke-retry.test.ts")],
    root,
  ],
  [
    "Guardar el token de Telegram espera a una ventana saturada",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/telegram-section.test.ts")],
    root,
  ],
  [
    "Nueva tarea abre su borrador con las fuentes heredadas",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/new-task.test.ts")],
    root,
  ],
  [
    "Arrastrar una tarea la mueve, y no la abre",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/move-task.test.ts")],
    root,
  ],
  [
    "Una tarea archivada sale de la lista y no de su árbol",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/archived-tasks.test.ts")],
    root,
  ],
  [
    "El historial mantiene el orden de sus grupos de autor",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/task-authors.test.ts")],
    root,
  ],
  [
    "La rama se enseña en la fila que tiene el árbol",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/task-branch.test.ts")],
    root,
  ],
  [
    "La fila enseña el comando, no cómo se lanzó",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/step-command.test.ts")],
    root,
  ],
  [
    "Una fuente se nombra por su proveedor, no por la copia en AppData",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/source-origin.test.ts")],
    root,
  ],
  [
    "El recorte del logo conserva el cuadrado elegido",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/logo-crop.test.ts")],
    root,
  ],
  [
    "El chat no pinta un destino que ejecute",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/links.test.ts")],
    root,
  ],
  [
    "Una vista de draw.io no rompe la etiqueta que la contiene",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/drawio.test.ts")],
    root,
  ],
  [
    "Ctrl+clic o ⌘+clic en un enlace del chat lo abre fuera sin preguntar",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/link-click.test.ts")],
    root,
  ],
  [
    "El backend se pinta en la lengua de la ventana",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/prose.test.ts")],
    root,
  ],
  [
    "El selector conserva el proveedor",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/models.test.ts")],
    root,
  ],
  [
    "La franja ordena las ventanas y cede por etapas",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/limits.test.ts")],
    root,
  ],
  [
    "El markdown se parte sin cambiar lo que se ve",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/markdown.test.ts")],
    root,
  ],
  [
    "El diff numera las líneas donde están",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/diff.test.ts")],
    root,
  ],
  [
    "El diff marca la palabra que cambió y alinea los dos paneles",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/diff-words.test.ts")],
    root,
  ],
  [
    "El atajo de permisos no cicla lo que no se puede",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/modes.test.ts")],
    root,
  ],
  [
    "El árbol no esconde lo que cambió",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/tree.test.ts")],
    root,
  ],
  [
    "Un archivo tabular se lee como tabla y no como texto",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/csv.test.ts")],
    root,
  ],
  [
    "La imagen se acerca sin salirse de sus topes",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/zoom.test.ts")],
    root,
  ],
  [
    "Cada archivo lleva el icono de su formato",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/icons.test.ts")],
    root,
  ],
  [
    "Un repositorio en la nube se pinta como repositorio",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/workdir-icon.test.ts")],
    root,
  ],
  [
    "Una pestaña no se pierde al cerrar otra",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/tabs.test.ts")],
    root,
  ],
  [
    "El atajo de pestaña lee la tecla física y no choca con otro",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/tab-shortcuts.test.ts")],
    root,
  ],
  [
    "La rejilla de ventanas no se descuadra",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/panels.test.ts")],
    root,
  ],
  [
    "Abrir un hilo largo monta su final y lo de arriba llega al subir",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/thread-window.test.ts")],
    root,
  ],
  [
    "El archivo abierto se entera del turno",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/code-refresh.test.ts")],
    root,
  ],
  [
    "Un fallo al leer no vacía el panel de código",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/last-good-trees.test.ts")],
    root,
  ],
  [
    "La lista de tareas se recupera sola de un fallo",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/session-refresh.test.ts")],
    root,
  ],
  [
    "El almacenamiento refresca sin mezclar workspaces",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/storage-refresh.test.ts")],
    root,
  ],
  [
    "La capa de un sitio se enseña cuando toca",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/sites.test.ts")],
    root,
  ],
  [
    "Un fallo del proveedor dice cuál y qué hacer",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/turn-failure.test.ts")],
    root,
  ],
  [
    "El reintento de entregas no reenvía a la persona",
    process.execPath,
    ["--test", join(root, "scripts/retry-delivery-resume.test.mjs")],
    root,
  ],
  [
    "Los adjuntos salen de la caja al mandar y vuelven si falla",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/draft-attachments.test.ts")],
    root,
  ],
  [
    "La cola sale en la tarea en la que se escribió",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/queue.test.ts")],
    root,
  ],
  [
    "La tarea viva lo dice sin parar",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/turn-status.test.ts")],
    root,
  ],
  [
    "El clic derecho no ofrece recargar la ventana",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/context-menu.test.ts")],
    root,
  ],
  [
    "El riel conserva sus agentes al refrescar",
    process.execPath,
    ["--conditions=browser", "--test", "--experimental-strip-types", join(root, "scripts/sidebar-agents.test.ts")],
    root,
  ],
  [
    "Una web se pinta como una web",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/web-artifact.test.ts")],
    root,
  ],
  ["El front pasa el linter", process.execPath, [join(root, "node_modules/@biomejs/biome/bin/biome"), "lint", "src", "scripts"], root],
  ["Compila el frontend", process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-b"], root],
  [
    "Los tests TypeScript compilan de tipos",
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "scripts"), "--noEmit"],
    root,
  ],
  ["Empaqueta el frontend", process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"], root],
  ["El front monta", process.execPath, [join(root, "scripts/mount-frontend.mjs")], root],
  ["La preparación en curso deja seguir a quien llega tarde", process.execPath, ["--test", "--test-force-exit", join(root, "scripts/setup-in-flight.test.mjs")], root],
  ["La preparación no se abre con la app pintada ni se queda ciega", process.execPath, ["--test", "--test-force-exit", join(root, "scripts/setup-repair.test.mjs")], root],
  ["La franja de consumo sigue a la cuenta activa cuando cambia por cupo", process.execPath, ["--test", "--test-force-exit", join(root, "scripts/usage-active-account.test.mjs")], root],
  ["Abrir una tarea larga no cuesta más que su techo", process.execPath, [join(root, "scripts/open-task-cost.mjs")], root],
  ["Releer una tarea abierta no remonta su hilo", process.execPath, [join(root, "scripts/reread-thread.mjs")], root],
  ["Una sesión larga no deja memoria detrás", process.execPath, ["--expose-gc", join(root, "scripts/long-session.mjs")], root],
  ["Un turno no vuelve a pedir cada historial", process.execPath, [join(root, "scripts/task-history-calls.mjs")], root],
  ["Toda clase escrita pinta algo", process.execPath, [join(root, "scripts/missing-classes.mjs")], root],
  ["Todo color se invierte con el tema", process.execPath, [join(root, "scripts/theme-inversion.mjs")], root],
  ...(SKIP_RUST ? [] : rustSteps),
];

const undocumented = undocumentedGuards();
if (undocumented.length) {
  console.error("Catálogo de guardas desactualizado en docs/guards.md:");
  for (const guard of undocumented) console.error(`  ${guard}`);
  console.error("\nCorrige las filas de docs/guards.md antes de verificar.");
  process.exit(1);
}

{
  const scheduled = new Set(steps.flatMap(([, , args]) => args));
  const unscheduled = readdirSync(join(root, "scripts"))
    .filter((name) => /\.test\.(ts|mjs)$/.test(name))
    .filter((name) => !scheduled.has(join(root, "scripts", name)));
  if (unscheduled.length > 0) {
    console.error(
      `\n  Tests fuera de la cadena: ${unscheduled.join(", ")}` +
        "\n  Añádelos a la lista de pasos de verify.mjs, donde les toque.\n",
    );
    process.exit(1);
  }
}

const outputOf = (e) => [e?.stdout, e?.stderr].map((s) => (s ?? "").toString()).join("").trimEnd();

const startedAt = Date.now();
let failure = null;
const skipped = [];

for (const [name, cmd, args, cwd] of steps) {
  process.stdout.write(`  ${name.padEnd(50)}`);
  const start = Date.now();
  try {
    execFileSync(cmd, args, { cwd, env: cmd === rustBuild.command && cwd === backend && args[0] !== "fmt" ? rustBuild.env : process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(`ok   ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (e) {
    if (e?.status === SKIPPED_EXIT_CODE) {
      console.log("OMITIDO");
      skipped.push([name, outputOf(e)]);
      continue;
    }
    console.log("FALLA");
    failure = { name, cmd, args, e };
    break;
  }
}

if (failure) {
  const { name, cmd, args, e } = failure;
  console.error(`\n  Falló: ${name}`);
  console.error(`      ${[cmd, ...args].join(" ")}\n`);
  for (const [stream, output] of [["stdout", e?.stdout], ["stderr", e?.stderr]]) {
    const text = (output ?? "").toString().trimEnd();
    if (!text) continue;
    const lines = text.split("\n");
    console.error(`      ${stream}:`);
    for (const line of lines.slice(-40)) console.error(`      ${line}`);
    if (lines.length > 40) console.error(`\n  (${lines.length - 40} líneas anteriores de ${stream} — vuelve a correr ese comando solo)`);
  }
  console.error("");
  process.exit(1);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);

if (skipped.length) {
  const one = skipped.length === 1;
  const skippedCount = `${skipped.length} de ${steps.length} pasos ${one ? "NO corrió" : "NO corrieron"}`;
  console.log(`\n  Corrido en ${PLATFORM}, ${seconds}s — y ${skippedCount}: esto NO es una verificación.`);
  console.log(`  Lo que ${one ? "ese guarda caza" : "esos guardas cazan"} sigue sin comprobar:`);
  for (const [name, reason] of skipped) {
    console.log(`\n    ${name}`);
    for (const line of reason.split("\n")) console.log(`      ${line}`);
  }
  console.log("");
} else {
  console.log(`\n  Verificado en ${PLATFORM}${SKIP_RUST ? " (cadena sin Rust)" : ""}, ${seconds}s.`);
}
if (SKIP_RUST) {
  console.log("  Sin comprobar en esta corrida: cargo fmt, check, clippy y test.");
  console.log("    La ventana tiene permiso para lo que se le pide — necesita el build de Rust.\n");
} else {
  console.log(`  ${OTHER_PLATFORMS} NO se comprobó — quien revise desde ahí lo compila.\n`);
}

if (skipped.length && process.env.CI) process.exit(1);
