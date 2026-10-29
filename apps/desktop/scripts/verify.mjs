#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { SKIPPED_EXIT_CODE, walkFiles } from "./git.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "src-tauri");
const PLATFORM = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] ?? process.platform;
const OTHER_PLATFORMS =
  process.platform === "darwin"
    ? "Windows y Linux"
    : process.platform === "win32"
      ? "macOS y Linux"
      : "Windows y macOS";

const SKIP_RUST = process.argv.includes("--no-cargo");
const rustBuild = { command: "cargo", env: process.env };

function undocumentedGuards() {
  const catalog = readFileSync(join(root, "docs/guards.md"), "utf8");
  const documented = new Set(
    catalog.split("\n").filter((line) => line.startsWith("|")).flatMap((line) =>
      [...line.matchAll(/`((?:scripts(?:\/guards)?|tests\/perf)\/[a-z-]+\.mjs)`/g)].map((match) => match[1]),
    ),
  );
  const scheduled = new Set(
    [...steps, ...rustSteps]
      .flatMap(([, , args = []]) => args)
      .filter((argument) => typeof argument === "string")
      .map((argument) => relative(root, argument).replaceAll("\\", "/"))
      .filter((argument) => (argument.startsWith("scripts/") || argument.startsWith("tests/perf/")) && argument.endsWith(".mjs") && !argument.includes(".test.")),
  );
  return [
    ...[...scheduled].filter((path) => !documented.has(path)).map((path) => `Paso sin fila: ${path}`),
    ...[...documented].filter((path) => !scheduled.has(path)).map((path) => `Fila sin paso: ${path}`),
  ];
}

const engineStep = ["El motor empaquetado está en su sitio", process.execPath, [join(root, "scripts/engine.mjs"), "sidecar"], root];
const cliStep = ["La CLI reenvía al motor sin abrir ventana", process.execPath, ["--test", join(root, "tests/unit/cli-forward.test.mjs")], root];
const rustSteps = [
  engineStep,
  ["cargo fmt", "cargo", ["fmt", "--check", "--", "--config-path", "rustfmt.toml"], backend],
  ["cargo check", rustBuild.command, ["check", "--locked", "--all-targets"], backend],
  ["cargo clippy", rustBuild.command, ["clippy", "--locked", "--all-targets"], backend],
  ["La ventana tiene permiso para lo que se le pide", process.execPath, [join(root, "scripts/guards/permissions.mjs")], root],
  ["cargo test", rustBuild.command, ["test", "--locked"], backend],
];

const steps = [
  ...(SKIP_RUST ? [] : [engineStep]),
  cliStep,
  ["El buscador de proyectos combina repositorios sin duplicarlos", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/project-repositories.test.ts")], root],
  ["Todo el código es revisable", process.execPath, [join(root, "scripts/guards/reviewable.mjs")], root],
  [
    "Un guarda sin git lo dice, y no mata la cadena",
    process.execPath,
    ["--test", join(root, "tests/unit/tree-git.test.mjs")],
    root,
  ],
  ["Ningún proceso abre una consola en Windows", process.execPath, [join(root, "scripts/guards/console-window.mjs")], root],
  ["Ningún proceso se espera sin plazo", process.execPath, [join(root, "scripts/guards/processes.mjs")], root],
  ["La ventana no se construye dos veces", process.execPath, [join(root, "scripts/guards/window.mjs")], root],
  ["Los docs no mandan a un archivo que no está", process.execPath, [join(root, "scripts/guards/doc-paths.mjs")], root],
  ["Alguien emite lo que la interfaz escucha", process.execPath, [join(root, "scripts/guards/bridge.mjs")], root],
  ["Ningún error del backend se aplana", process.execPath, [join(root, "scripts/guards/service-errors.mjs")], root],
  ["Alguien invoca lo que el backend registra", process.execPath, [join(root, "scripts/guards/commands.mjs")], root],
  ["El motor fijado habla el contrato copiado", process.execPath, [join(root, "scripts/guards/contract.mjs")], root],
  ["El runtime del artefacto no se rompe en silencio", process.execPath, [join(root, "scripts/guards/artifact.mjs")], root],
  ["Llevar trabajo a otra máquina copia por partes, sigue desde la que falló y limpia al cancelar", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/carry-work.test.ts")], root],
  ["Los visuales del chat llegan por partes y caen a tree_show con un motor anterior", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/chat-visual-parts.test.ts")], root],
  ["La foto del sidebar se guarda acotada y con espera", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/shell-cache.test.ts")], root],
  ["El panel Carpeta reintenta solo, no amontona lecturas y no tira lo último bueno", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/tree-loader.test.ts")], root],
  ["La ventana abre con la lista ligera y el arranque la confirma sin saltarse la negativa", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/early-startup.test.ts")], root],
  ["La nota de la versión sale en el idioma de la app", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/release-notes.test.ts")], root],
  ["Las tareas de la página de un agente se paginan sin separar subtareas de su padre", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/agent-page-tasks.test.ts")], root],
  ["El riel de subtareas lanzadas suelta las que ya se terminaron", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/delegated-rail.test.ts")], root],
  ["La búsqueda de tareas ignora acentos y encuentra varias palabras", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/task-search.test.ts")], root],
  ["La vista de Typst solo acompaña a un .typ, no al archivo que se abre después", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/typst-scope.test.ts")], root],
  ["El dock de agentes ordena por estado y cabe en una fila", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/agent-dock.test.ts")], root],
  ["El sidebar junta las tareas de todas las carpetas sin repetirlas", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/sidebar-tasks.test.ts")], root],
  ["El sidebar filtra por carpeta y agente y reparte en secciones o grupos", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/sidebar-view.test.ts")], root],
  ["El visor conserva navegación y rechaza los canales retirados", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/artifact-viewer.test.ts")], root],
  ["La ventana no deja salir material", process.execPath, [join(root, "scripts/guards/csp.mjs")], root],
  ["El tema de terminal no repinta el chrome", process.execPath, [join(root, "scripts/guards/terminal-themes.mjs")], root],
  ["El catálogo define lo que el código pide", process.execPath, [join(root, "scripts/guards/locales.mjs")], root],
  ["El paquete de diseño dice lo mismo que el escritorio", process.execPath, ["--experimental-strip-types", join(root, "scripts/guards/shared-design.mjs")], root],
  ["Lo ya traducido no se vuelve a soldar", process.execPath, [join(root, "scripts/guards/literals.mjs")], root],
  ["Los comentarios no crecen ni argumentan", process.execPath, [join(root, "scripts/guards/comments.mjs")], root],
  ["Las lecturas de fuente en pruebas respetan el cupo revisado", process.execPath, [join(root, "scripts/guards/test-policy.mjs")], root],
  ["Los iconos del árbol son los del paquete", process.execPath, [join(root, "scripts/icons.mjs"), "--check"], root],
  ["Soltar un archivo no depende de la pantalla", process.execPath, [join(root, "scripts/guards/drop.mjs")], root],
  ["Ninguna animación infinita repinta a 60 cuadros", process.execPath, [join(root, "scripts/guards/animations.mjs")], root],
  [
    "El disparador conserva el clic que lo abre",
    process.execPath,
    ["--test", join(root, "tests/unit/triggers.test.mjs")],
    root,
  ],
  [
    "Un abanico de peticiones respeta su tope",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/pool.test.ts")],
    root,
  ],
  [
    "Un fondo de chat guardado que ya no existe no pinta nada",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/chat-background.test.ts")],
    root,
  ],
  [
    "El fondo del chat no se borra con un motor anterior ni pasa de un workspace a otro",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/chat-background-engine.test.ts")],
    root,
  ],
  [
    "El nombre de un agente da un identificador que el backend acepta",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/agent-id.test.ts")],
    root,
  ],
  [
    "Un formateador se reusa y sigue a la lengua",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/format.test.ts")],
    root,
  ],
  [
    "Los indicadores leen las dos formas de una medida",
    process.execPath,
    ["--test", join(root, "tests/unit/indicators.test.mjs")],
    root,
  ],
  [
    "El hilo sigue al agente y se deja soltar",
    process.execPath,
    ["--conditions=browser", "--test", "--experimental-strip-types", join(root, "tests/unit/paste.test.ts")],
    root,
  ],
  [
    "Las respuestas rápidas se leen igual en la ventana y en lo que sale del chat",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/next-steps.test.ts")],
    root,
  ],
  [
    "La barra elige la fila, y el comando exacto encabeza",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/suggestions.test.ts")],
    root,
  ],
  [
    "/btw va al margen solo con el agente que lo declara, y «Pasar al hilo» no manda nada",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/side-question.test.ts")],
    root,
  ],
  [
    "Los comandos `!` quedan alineados en la caja y se corren sin la sangría",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "scripts/terminal-indent.test.ts")],
    root,
  ],
  [
    "El menú de la arroba propone encargados por nombre, sin chocar con el material",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/recipient-menu.test.ts")],
    root,
  ],
  [
    "Un destinatario se pinta aparte del material y se mueve con él",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/recipients.test.ts")],
    root,
  ],
  [
    "Pegar una imagen la adjunta y pegar texto no",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/clipboard.test.ts")],
    root,
  ],
  [
    "La actividad de una tarea no le roba el foco a quien escribe",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/focus.test.ts")],
    root,
  ],
  [
    "El turno reabierto conserva su orden",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/turn-order.test.ts")],
    root,
  ],
  [
    "La respuesta dice con qué modelo contestó",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/turn-model.test.ts")],
    root,
  ],
  [
    "El medidor de contexto sale con lo que el agente publica",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/context-window.test.ts")],
    root,
  ],
  [
    "La salida de un comando de barra se pinta con su comando",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/command-output.test.ts")],
    root,
  ],
  [
    "Lo que se le teclea a un `!` oculta las claves",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/command-input.test.ts")],
    root,
  ],
  [
    "El fragmento tardío de un mensaje vuelve a su globo",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/chat-delta.test.ts")],
    root,
  ],
  [
    "Un turno con varias subtareas y un mensaje para una de ellas no se pinta dos veces",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/chat-delegation-thread.test.ts")],
    root,
  ],
  [
    "El servicio que vuelve no se pinta en la pantalla",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/invoke-retry.test.ts")],
    root,
  ],
  [
    "Guardar el token de Telegram espera a una ventana saturada",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/telegram-section.test.ts")],
    root,
  ],
  [
    "Nueva tarea abre su borrador con las fuentes heredadas",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/new-task.test.ts")],
    root,
  ],
  [
    "Arrastrar una tarea la mueve, y no la abre",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/move-task.test.ts")],
    root,
  ],
  [
    "Una tarea archivada sale de la lista y no de su árbol",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/archived-tasks.test.ts")],
    root,
  ],
  [
    "El historial mantiene el orden de sus grupos de autor",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/task-authors.test.ts")],
    root,
  ],
  [
    "La rama se enseña en la fila que tiene el árbol",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/task-branch.test.ts")],
    root,
  ],
  [
    "La tarjeta de una tarea colorea su carpeta y afirma solo el PR confirmado",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/task-hover-card.test.ts")],
    root,
  ],
  [
    "La fila enseña el comando, no cómo se lanzó",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/step-command.test.ts")],
    root,
  ],
  [
    "Una fuente se nombra por su proveedor, no por la copia en AppData",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/source-origin.test.ts")],
    root,
  ],
  [
    "El fondo del chat se reduce por pasos de calidad y tamaño hasta 1,5 MB",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/shrink-image.test.ts")],
    root,
  ],
  [
    "En el navegador el logo y el fondo de un workspace se leen y se cambian en la cuenta",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/web-workspace-assets.test.ts")],
    root,
  ],
  [
    "El recorte del logo conserva el cuadrado elegido",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/logo-crop.test.ts")],
    root,
  ],
  [
    "El chat no pinta un destino que ejecute",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/links.test.ts")],
    root,
  ],
  [
    "Una vista de draw.io no rompe la etiqueta que la contiene",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/drawio.test.ts")],
    root,
  ],
  [
    "Ctrl+clic o ⌘+clic en un enlace del chat lo abre fuera sin preguntar",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/link-click.test.ts")],
    root,
  ],
  [
    "El backend se pinta en la lengua de la ventana",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/prose.test.ts")],
    root,
  ],
  [
    "El selector conserva el proveedor",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/models.test.ts")],
    root,
  ],
  [
    "La franja ordena las ventanas y cede por etapas",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/limits.test.ts")],
    root,
  ],
  [
    "El markdown se parte sin cambiar lo que se ve",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/markdown.test.ts")],
    root,
  ],
  [
    "Lo que se calcula por partes en streaming da lo mismo que de una vez",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/streaming-parity.test.ts")],
    root,
  ],
  [
    "Las columnas de una tabla se reparten según su texto",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/markdown-table.test.ts")],
    root,
  ],
  [
    "Las fórmulas se pintan y el dinero queda como texto",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/markdown-math.test.ts")],
    root,
  ],
  [
    "El diff numera las líneas donde están",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/diff.test.ts")],
    root,
  ],
  [
    "El diff marca la palabra que cambió y alinea los dos paneles",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/diff-words.test.ts")],
    root,
  ],
  [
    "El atajo de permisos no cicla lo que no se puede",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/modes.test.ts")],
    root,
  ],
  [
    "El árbol no esconde lo que cambió",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/tree.test.ts")],
    root,
  ],
  [
    "Un archivo tabular se lee como tabla y no como texto",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/csv.test.ts")],
    root,
  ],
  [
    "La imagen se acerca sin salirse de sus topes",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/zoom.test.ts")],
    root,
  ],
  [
    "Cada archivo lleva el icono de su formato",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/icons.test.ts")],
    root,
  ],
  [
    "Un repositorio en la nube se pinta como repositorio",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/workdir-icon.test.ts")],
    root,
  ],
  [
    "Un proyecto tiene color estable y una ubicación legible",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/project-settings.test.ts")],
    root,
  ],
  [
    "Una pestaña no se pierde al cerrar otra",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/tabs.test.ts")],
    root,
  ],
  [
    "El atajo de pestaña lee la tecla física y no choca con otro",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/tab-shortcuts.test.ts")],
    root,
  ],
  [
    "La rejilla de ventanas no se descuadra",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/panels.test.ts")],
    root,
  ],
  [
    "Las páginas del historial se juntan sin mezclar transcripciones distintas",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/push-history.test.ts")],
    root,
  ],
  [
    "Abrir un hilo largo monta su final y lo de arriba llega al subir",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/thread-window.test.ts")],
    root,
  ],
  [
    "El archivo abierto se entera del turno",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/code-refresh.test.ts")],
    root,
  ],
  [
    "Un fallo al leer no vacía el panel de código",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/last-good-trees.test.ts")],
    root,
  ],
  [
    "La lista de tareas se recupera sola de un fallo",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/session-refresh.test.ts")],
    root,
  ],
  [
    "El almacenamiento refresca sin mezclar workspaces",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/storage-refresh.test.ts")],
    root,
  ],
  [
    "La capa de un sitio se enseña cuando toca",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/sites.test.ts")],
    root,
  ],
  [
    "Un fallo del proveedor dice cuál y qué hacer",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/turn-failure.test.ts")],
    root,
  ],
  [
    "Un permiso decidido o en vuelo no se pinta como cerrado y una relectura no borra gates nuevos",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/permission-gates.test.ts")],
    root,
  ],
  [
    "El reintento de entregas no reenvía a la persona",
    process.execPath,
    ["--test", join(root, "tests/unit/retry-delivery-resume.test.mjs")],
    root,
  ],
  [
    "Los adjuntos salen de la caja al mandar y vuelven si falla",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/draft-attachments.test.ts")],
    root,
  ],
  [
    "Una imagen adjunta en esta Mac viaja como bytes a la máquina de la tarea",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/remote-attachments.test.ts")],
    root,
  ],
  [
    "La cola sale en la tarea en la que se escribió",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/queue.test.ts")],
    root,
  ],
  [
    "La tarea viva lo dice sin parar",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/turn-status.test.ts")],
    root,
  ],
  [
    "El clic derecho no ofrece recargar la ventana",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/context-menu.test.ts")],
    root,
  ],
  [
    "El riel conserva sus agentes al refrescar",
    process.execPath,
    ["--conditions=browser", "--test", "--experimental-strip-types", join(root, "tests/unit/sidebar-agents.test.ts")],
    root,
  ],
  [
    "Una web se pinta como una web",
    process.execPath,
    ["--test", "--experimental-strip-types", join(root, "tests/unit/web-artifact.test.ts")],
    root,
  ],
  ["El front pasa el linter", process.execPath, [join(root, "node_modules/@biomejs/biome/bin/biome"), "lint", "src", "scripts", "tests"], root],
  ["Compila el frontend", process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-b"], root],
  [
    "Los tests TypeScript compilan de tipos",
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(root, "tests"), "--noEmit"],
    root,
  ],
  ["Empaqueta el frontend", process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"], root],
  ["La carga inicial no pesa más que su techo", process.execPath, [join(root, "tests/perf/bundle-size.mjs")], root],
  ["El front monta", process.execPath, [join(root, "scripts/guards/mount-frontend.mjs")], root],
  ["Empaqueta la entrada del navegador", process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--mode", "web"], root],
  ["La versión del teléfono se instala como app y siempre carga lo último", process.execPath, ["--test", join(root, "tests/unit/web-phone-pwa.test.mjs")], root],
  ["En el navegador la interfaz habla con el relay", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-transport.test.mjs")], root],
  ["En el navegador la sesión de Danil elige la computadora y explica por qué no entra", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-gate.test.mjs")], root],
  ["En el navegador la app abre enseguida, sin instalador ni pantalla de preparación", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-setup.test.mjs")], root],
  ["En el navegador, un trozo que borró un despliegue recarga la página una vez", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-stale-chunk.test.mjs")], root],
  ["En el navegador una computadora apagada monta sin encenderse y despierta al mandarle algo", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-off.test.mjs")], root],
  ["En el navegador lo que el relay guardó se ve con su hora mientras la computadora está apagada", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-cached.test.mjs")], root],
  ["En el navegador un panel junta todas las computadoras y cada orden va a su máquina", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-machines.test.mjs")], root],
  ["En el navegador los workspaces de la cuenta se ven con sus máquinas dormidas", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-account-workspaces.test.mjs")], root],
  ["En el navegador la memoria de la cuenta se ve, se edita y tiene historial con las máquinas apagadas", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-memory-account.test.mjs")], root],
  ["En el navegador los spaces salen de la máquina que los guarda aunque otra duerma", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-spaces.test.mjs")], root],
  ["En el navegador con todo apagado la página abre en menos de 2 s con lo guardado de cada máquina, y una de otro contrato no la tumba", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-fleet.test.mjs")], root],
  ["En el navegador las imágenes y los visuales del chat se leen de la computadora remota", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-chat-media.test.mjs")], root],
  ["En el navegador llevar trabajo entre computadoras va sellado y en partes de 512 KiB", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-carry.test.mjs")], root],
  ["En el navegador clonar en la computadora sigue su avance, se cancela y se recupera al recargar", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-project-clone.test.mjs")], root],
  ["En el navegador el alta de una computadora gestionada no instala y conecta las cuentas de nube", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-onboarding.test.mjs")], root],
  ["La preparación en curso deja seguir a quien llega tarde", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/setup-in-flight.test.mjs")], root],
  ["La preparación no se abre con la app pintada ni se queda ciega", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/setup-repair.test.mjs")], root],
  ["La franja de consumo sigue a la cuenta activa cuando cambia por cupo", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/usage-active-account.test.mjs")], root],
  ["Con una cuenta que comparte credencial, el motivo de no poder agregar otra se ve", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/shared-credential-note.test.mjs")], root],
  ["Esperar a la versión anterior es un aviso y detenerla se confirma", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/launcher-previous.test.mjs")], root],
  ["Las cuentas de Danil entran con el navegador, se agregan y cierran sesión", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/danil-account-panel.test.mjs")], root],
  ["El alta y el pie de la barra lateral ofrecen la cuenta de Danil", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/danil-sign-in-entry.test.mjs")], root],
  ["Google Drive del alta vuelve a conectar después de desconectar", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/onboarding-drive-reconnect.test.mjs")], root],
  ["Google Drive con la app oficial se instala, espera la sesión y se deja de usar sin desinstalarla", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/onboarding-drive-desktop.test.mjs")], root],
  ["Cada workspace elige su cuenta de Danil y el pie sigue a la del abierto", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/danil-workspace-account.test.mjs")], root],
  ["La memoria del workspace se escribe y se edita como la del proyecto", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/memory-workspace-scope.test.mjs")], root],
  ["La ventana muestra el historial de la memoria de la cuenta y marca las copias de conflicto", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/memory-history-window.test.mjs")], root],
  ["La cuenta de Danil habla con el motor por danil_connect_*", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/danil-account.test.ts")], root],
  ["Cada workspace habla con su cuenta de Danil, y un motor anterior deja la cuenta única", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/danil-sessions.test.ts")], root],
  ["En el navegador la página de aprobación conecta una computadora a la cuenta", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-connect.test.mjs")], root],
  ["Una aprobación invalida su identidad sin tocar otros slots", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/web-session.test.ts")], root],
  ["El retorno de autenticación permanece dentro de Terminus", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/web-auth-return.test.ts")], root],
  ["El registro web confirma correo y conserva el destino", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-auth.test.mjs")], root],
  ["En el navegador se ve la persona de la cuenta de Danil y cambia su foto", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-account.test.mjs")], root],
  ["En el navegador se listan las computadoras de la cuenta y se renombran en su sitio", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-account-computers.test.mjs")], root],
  ["En el navegador la columna junta los workspaces de otras cuentas de Danil y abre cada uno con la suya", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-other-accounts.test.mjs")], root],
  ["En el navegador «Agregar cuenta» ofrece primero las cuentas que ya tienen sesión, como Google", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-account-chooser.test.mjs")], root],
  ["En el navegador cada clave de la cuenta dice en qué máquinas está, se quita con aviso y se cambia sellada aquí", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/web-account-credentials.test.mjs")], root],
  ["En el escritorio las claves de la cuenta pasan por el motor y el aviso sube solo las elegidas", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/desktop-account-credentials.test.mjs")], root],
  ["La página de aprobación y la compatibilidad de contrato hablan con el plano de control", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/danil-connect-web.test.ts")], root],
  ["Con el stream empujado los lotes llegan a los oyentes y el historial se pagina", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/push-stream.test.mjs"), join(root, "tests/unit/push-history.test.mjs")], root],
  ["Al enviar a otra máquina la hoja lleva el trabajo sin subir, y traerlo de vuelta lo deja en una rama de aquí", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/carry-window.test.mjs")], root],
  ["Una tarea de una máquina apagada abre y se enciende al mandarle algo", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/machine-task.test.mjs")], root],
  ["Por carpeta, una carpeta en dos máquinas es un grupo por máquina y su «+» lanza en la suya", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/sidebar-folder-machines.test.mjs")], root],
  ["El árbol de una tarea de otra máquina se lee en esa máquina", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/machine-task-tree.test.mjs")], root],
  ["La flota: la máquina sale del sobre, toda espera tiene tope y nadie contestando no es una lista vacía", process.execPath, ["--test", "--experimental-strip-types", join(root, "../../packages/fleet/test/fleet.test.ts")], root],
  ["Danil Computers: sesión con contratos, renovación del token, motor y lápidas", process.execPath, ["--test", "--experimental-strip-types", join(root, "../../packages/computers/test/computers.test.ts")], root],
  ["Danil Computers: GitHub de la cuenta por el Worker, con sus rutas y sus códigos", process.execPath, ["--test", "--experimental-strip-types", join(root, "../../packages/computers/test/github.test.ts")], root],
  ["En la web GitHub de la cuenta lo contesta el Worker, no una máquina", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/web-github-account.test.ts")], root],
  ["Con sesión de Danil la tarjeta de GitHub es la de la cuenta; sin ella, la local de siempre", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/github-account-settings.test.mjs")], root],
  ["Las credenciales de la cuenta: el cliente del Worker y el sellado TERMINUS-SECRET/1 con los vectores del motor", process.execPath, ["--test", "--experimental-strip-types", join(root, "../../packages/computers/test/credentials.test.ts"), join(root, "../../packages/computers/test/seal.test.ts")], root],
  ["Con la cuenta de Danil lo de esta computadora va nativo y primero; las otras suman su rebanada", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/machine-router.test.ts")], root],
  ["Una tarea de otra máquina en un space de la cuenta se ve en ese mismo space", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/spaces-remote-task.test.ts")], root],
  ["En la web todo es de otras máquinas: lo guardado abre ya, actuar enciende la VM y la Mac apagada lo dice", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/web-router.test.ts")], root],
  ["En la web caben varias cuentas de Danil: cada una con su sesión, sin repetirse, y la página abre la dueña del workspace", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/web-accounts.test.ts")], root],
  ["Con la cuenta de Danil el escritorio junta las tareas de todas sus computadoras", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/desktop-account-machines.test.mjs")], root],
  ["El visor espera a noVNC y libera cada conexión al cerrar o reintentar", process.execPath, ["--test", "--experimental-strip-types", join(root, "tests/unit/screen-connection.test.ts"), join(root, "../../packages/computers/test/screen.test.ts")], root],
  ["Sin el stream empujado la ventana sondea como siempre", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/push-fallback.test.mjs")], root],
  ["El mantenimiento exitoso no avisa y los fallos descartados no se repiten", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/activity-notice.test.mjs")], root],
  ["Con tareas trabajando, reiniciar o salir espera a que terminen o detiene las que nombra", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/update-wait.test.mjs")], root],
  ["Una respuesta con visual no desaparece del chat aunque el turno no se guarde o el visual no se lea", process.execPath, ["--test", "--test-force-exit", join(root, "tests/unit/chat-turn-unsaved.test.mjs")], root],
  ["Abrir una tarea larga no cuesta más que su techo", process.execPath, [join(root, "tests/perf/open-task-cost.mjs")], root],
  ["Releer una tarea abierta no remonta su hilo", process.execPath, [join(root, "tests/perf/reread-thread.mjs")], root],
  ["Una sesión larga no deja memoria detrás", process.execPath, ["--expose-gc", join(root, "tests/perf/long-session.mjs")], root],
  ["Un turno no vuelve a pedir cada historial", process.execPath, [join(root, "tests/perf/task-history-calls.mjs")], root],
  ["Una respuesta larga no cuesta más que su techo por delta", process.execPath, [join(root, "tests/perf/delta-cost.mjs")], root],
  ["El sidebar en caliente no espera al motor", process.execPath, [join(root, "tests/perf/cold-start-sidebar.mjs")], root],
  ["Toda clase escrita pinta algo", process.execPath, [join(root, "scripts/guards/missing-classes.mjs")], root],
  ["Todo color se invierte con el tema", process.execPath, [join(root, "scripts/guards/theme-inversion.mjs")], root],
  ...(SKIP_RUST ? [] : rustSteps.slice(1)),
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
  const unscheduled = [...walkFiles(join(root, "tests/unit"))]
    .filter((path) => /\.test\.(ts|mjs)$/.test(path))
    .filter((path) => !scheduled.has(path))
    .map((path) => relative(root, path));
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
  if (SKIP_RUST && name === cliStep[0]) {
    console.log("SKIPPED");
    skipped.push([name, "--no-cargo: necesita rustc y el sidecar fijado; se ejecuta en la cadena completa y verify (rust).", true]);
    continue;
  }
  const start = Date.now();
  try {
    execFileSync(cmd, args, { cwd, env: cmd === rustBuild.command && cwd === backend && args[0] !== "fmt" ? rustBuild.env : process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(`ok   ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (e) {
    if (e?.status === SKIPPED_EXIT_CODE) {
      console.log("SKIPPED");
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

if (skipped.some(([, , expected]) => !expected) && process.env.CI) process.exit(1);
