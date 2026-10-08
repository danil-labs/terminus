/**
 * Dónde está la metadata de git de este árbol, que no siempre es `.git`.
 *
 * `reviewable` es el único paso de la cadena que necesita git, y sin metadata
 * moría arrastrando a todos los que iban detrás. Aquí se busca por dos caminos:
 * el `.git` del árbol —el clon normal, el runner de Actions y la copia de
 * trabajo, que es un worktree— y, si no, la carpeta de control de la tarea, que
 * es donde vivía en las copias del formato anterior.
 *
 * **La ruta deducida no se cree.** Deducirla duplica en JavaScript una
 * disposición que define Rust (`sessions::work_dir_de`, `control_dir_de`), y una
 * segunda definición se desincroniza sin avisar; así que se le pregunta a git si
 * ese `GIT_DIR` describe de verdad este árbol y solo entonces se usa. Si la
 * disposición cambia, la comprobación falla y el guarda dice «omitido y por
 * qué». El peor caso es perder el guarda diciéndolo, nunca darlo por bueno.
 *
 * **El segundo camino se retira cuando no quede ninguna copia del formato
 * anterior**, medido y no supuesto: lo cuenta cada corrida de
 * `migration::migrate_v11`. Ver `AGENTS.md` § Un guarda que no puede correr lo
 * dice, y no se lleva a los demás.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** La raíz del repositorio, deducida de dónde está este archivo. */
export const RAIZ = resolve(import.meta.dirname, "..");

/**
 * Con qué sale un guarda que **no pudo correr**, para distinguirlo del que
 * corrió y falló. `verify.mjs` lo lee: con este código imprime `OMITIDO`,
 * sigue con el resto de la cadena y lo nombra al terminar; con cualquier otro
 * no-cero para, como siempre.
 *
 * Vive aquí porque hoy el único guarda que puede quedarse sin correr es el que
 * necesita git. Si aparece un segundo por otro motivo, esta constante se muda a
 * un módulo propio y las dos puntas la importan de ahí — lo que no puede pasar
 * es que el número se escriba dos veces.
 */
export const SALIDA_OMITIDO = 3;

/**
 * Las variables que neutralizan lo que git leería de fuera del repositorio.
 *
 * `GIT_OPTIONAL_LOCKS=0` es el que importa y no es higiene: sin él, un
 * `git diff` refresca el índice y **escribe** en el `GIT_DIR` de la app, que es
 * el mismo que la app está usando para pintar el árbol de cambios. Dos
 * escrituras a la vez sobre `index.lock` y una de las dos revienta. Con esto,
 * git contesta sin tomar el candado.
 */
const SIN_CANDADO = { GIT_OPTIONAL_LOCKS: "0" };

function mismaRuta(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Qué árbol de trabajo cree git que está mirando, o `null` si no ve ninguno.
 *
 * Se pregunta por el **árbol** y no por el `--git-dir`, porque la respuesta hay
 * que compararla con algo: un checkout dentro de otro repositorio contesta que
 * sí hay git y contesta con el de arriba, y correr `reviewable` contra ese sería
 * revisar el repositorio equivocado en silencio.
 */
function arbolDeGit(arbol, entorno) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: arbol,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ...SIN_CANDADO, ...entorno },
    }).trim();
  } catch {
    return null;
  }
}

/**
 * La carpeta de control que le tocaría a un checkout de Terminus, si este árbol
 * lo es. Es la vuelta de `development.rs::gitdir_dir` sobre las dos formas que
 * arma `workspace/sessions.rs`:
 *
 *     <ws>/projects/<proyecto>/sessions/<sesión>/work/.repos/<fuente>
 *     <ws>/sessions/<sesión>/work/.repos/<fuente>          ← tarea sin proyecto
 *
 * → `<ws>/control/<proyecto|_>/<sesión>/git/<fuente>`
 *
 * Devuelve `null` en cuanto un segmento no encaja, que es lo que pasa en un
 * clon normal y en el runner de Actions.
 */
function controlDeTerminus(arbol) {
  const fuente = basename(arbol);
  const repos = dirname(arbol);
  if (basename(repos) !== ".repos") return null;

  const work = dirname(repos);
  if (basename(work) !== "work") return null;

  const sesion = basename(dirname(work));
  const sessions = dirname(dirname(work));
  if (basename(sessions) !== "sessions") return null;

  // Encima de `sessions/` está el workspace, o el proyecto dentro de él. El
  // proyecto vacío se guarda bajo `_`, que `safe_segment` nunca devuelve.
  const arriba = dirname(sessions);
  const [ws, proyecto] =
    basename(dirname(arriba)) === "projects"
      ? [dirname(dirname(arriba)), basename(arriba)]
      : [arriba, "_"];

  const dir = join(ws, "control", proyecto, sesion, "git", fuente);
  return existsSync(dir) ? dir : null;
}

/**
 * Dónde preguntarle a git por este árbol.
 *
 * `{ ok: true, entorno, origen }` — `entorno` son las variables que hay que
 * añadirle a un `execFileSync` para que git conteste sobre **este** árbol, y
 * `origen` es la frase que explica de dónde salió.
 *
 * `{ ok: false, motivo }` — no hay metadata alcanzable, y `motivo` dice dónde se
 * buscó. Quien llama tiene que salir con [`SALIDA_OMITIDO`] y decirlo: dar el
 * guarda por bueno aquí es exactamente el fallo que este módulo existe para
 * quitar de en medio.
 */
export function localizarGit(arbol = RAIZ) {
  // 1. El árbol trae su git, o quien invoca ya puso `GIT_DIR` a mano. Es el
  //    caso del clon normal y el del runner de Actions, y no cuesta nada.
  const suyo = arbolDeGit(arbol, {});
  if (suyo && mismaRuta(suyo, arbol)) {
    return { ok: true, entorno: { ...SIN_CANDADO }, origen: "el árbol tiene su propio git" };
  }

  // 2. Una copia de trabajo de Terminus: la metadata está fuera del árbol.
  const control = controlDeTerminus(arbol);
  if (control) {
    const entorno = { ...SIN_CANDADO, GIT_DIR: control, GIT_WORK_TREE: arbol };
    if (mismaRuta(arbolDeGit(arbol, entorno) ?? "", arbol)) {
      return { ok: true, entorno, origen: `la carpeta de control de la tarea (${control})` };
    }
  }

  // Sin el binario no hay nada que buscar, y decir «no hay `.git`» mandaría a
  // mirar el sitio equivocado.
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    return { ok: false, motivo: "  · no hay un `git` que ejecutar en el PATH." };
  }

  const buscado = [
    suyo
      ? `  · este árbol — git contesta, pero sobre ${suyo}, que es otro repositorio`
      : "  · este árbol — no hay `.git` ni `GIT_DIR` en el entorno",
    control
      ? `  · ${control} — existe, pero git no la reconoce como el git de este árbol`
      : "  · la carpeta de control de Terminus — este árbol no es una copia de trabajo suya",
  ];
  return { ok: false, motivo: `Buscada en dos sitios:\n${buscado.join("\n")}` };
}

// ------------------------------------------------- helpers de toda la carpeta

/**
 * Los archivos bajo `dir`, recursivo, filtrados por extensión.
 *
 * **Una sola copia**, que es la única forma de que la próxima corrección llegue
 * a todos: repartida por `scripts/` acumuló ocho versiones con cuatro firmas, y
 * dos de ellas cargaban defectos ya arreglados en las demás — el `.pathname` que
 * revienta en Windows y el orden de `withFileTypes` a medias.
 */
export function* archivos(dir, exts = null) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* archivos(p, exts);
    else if (!exts || exts.includes(extname(p))) yield p;
  }
}

/**
 * Si el módulo que pregunta es el que se está ejecutando directamente.
 *
 * `pathToFileURL` y no `` `file://${argv}` `` interpolado: la interpolación
 * cruda no percent-encoda, así que fallaba con espacios o no-ASCII en la ruta
 * — en `signing.mjs`, justo el archivo que documenta cómo los espacios rompen el
 * runner de firma.
 */
export function esteArchivo(url, argv1 = process.argv[1]) {
  return Boolean(argv1) && url === pathToFileURL(argv1).href;
}
