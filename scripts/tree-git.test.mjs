/**
 * Que `reviewable` corra donde hay git —esté donde esté— y que donde no hay lo
 * diga en vez de matar la cadena.
 *
 * **Es la diferencia entre verificar y creer que se verificó.** El guarda es el
 * paso 1 de la cadena y necesita git; una copia de trabajo del formato anterior
 * no lleva `.git` dentro, y con eso la corrida muere en el primero y ninguno de
 * los demás llega a ejecutarse.
 *
 * Los casos se montan con git de verdad sobre carpetas temporales, porque lo que
 * hay que comprobar es justo lo que una comprobación de rutas no ve: que la
 * metadata que se encuentra **conteste** sobre el árbol que se le pone delante.
 * Por eso el caso de Terminus planta un byte nulo y exige que el guarda lo cace:
 * localizar el `GIT_DIR` no sirve de nada si el diff sale del repositorio de al
 * lado.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { localizarGit, SALIDA_OMITIDO } from "./git.mjs";

const raiz = resolve(import.meta.dirname, "..");

/**
 * Git sin nada de fuera. El `.gitconfig` de quien corre esto puede traer una
 * rama por defecto, una firma o un hook, y entonces el fallo dependería de la
 * máquina.
 */
const LIMPIO = {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "guarda",
  GIT_AUTHOR_EMAIL: "guarda@example.invalid",
  GIT_COMMITTER_NAME: "guarda",
  GIT_COMMITTER_EMAIL: "guarda@example.invalid",
};

function git(args, entorno) {
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, ...LIMPIO, ...entorno },
  });
}

/**
 * Un árbol que se parece a este repositorio lo justo: los dos scripts que se
 * prueban, para que `reviewable` resuelva su raíz al árbol de la prueba y no al
 * repositorio de verdad, y un archivo de código que revisar.
 */
function arbol(dir, { conByteNulo = false } = {}) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of ["git.mjs", "reviewable.mjs"]) {
    copyFileSync(join(raiz, "scripts", f), join(dir, "scripts", f));
  }
  writeFileSync(join(dir, "codigo.ts"), "export const uno = 1;\n");
  if (conByteNulo) writeFileSync(join(dir, "sucio.ts"), "export const dos = \0 2;\n");
  return dir;
}

/** Le pone git al árbol, con la metadata donde se le diga. */
function conGit(trabajo, gitDir) {
  const entorno = gitDir ? { GIT_DIR: gitDir, GIT_WORK_TREE: trabajo } : {};
  git(["init", "-q", "--initial-branch=dev", ...(gitDir ? [] : [trabajo])], entorno);
  git(["add", "--all"], { ...entorno, GIT_DIR: gitDir ?? join(trabajo, ".git"), GIT_WORK_TREE: trabajo });
  git(["commit", "-q", "-m", "base", "--no-verify"], {
    ...entorno,
    GIT_DIR: gitDir ?? join(trabajo, ".git"),
    GIT_WORK_TREE: trabajo,
  });
  return trabajo;
}

function temporal(nombre) {
  return mkdtempSync(join(tmpdir(), `harness-${nombre}-`));
}

/** Monta la disposición de una copia de trabajo de Terminus y devuelve las dos puntas. */
function comoTerminus({ proyecto }) {
  const ws = temporal("ws");
  const sesion = "q8jj2zzg";
  const sessions = proyecto
    ? join(ws, "projects", proyecto, "sessions")
    : join(ws, "sessions");
  const trabajo = join(sessions, sesion, "work", ".repos", "harness-app");
  const control = join(ws, "control", proyecto ?? "_", sesion, "git", "harness-app");
  mkdirSync(trabajo, { recursive: true });
  mkdirSync(control, { recursive: true });
  return { trabajo, control };
}

test("un clon normal usa su propio git, sin variables de más", () => {
  const dir = conGit(arbol(temporal("clon")));
  const donde = localizarGit(dir);
  assert.equal(donde.ok, true);
  assert.equal(donde.entorno.GIT_DIR, undefined);
});

test("una tarea sin proyecto guarda su control bajo `_`, y también se encuentra", () => {
  const { trabajo, control } = comoTerminus({ proyecto: null });
  conGit(arbol(trabajo), control);
  assert.equal(localizarGit(trabajo).entorno.GIT_DIR, control);
});

test("sin git en ninguna parte no se inventa nada, y el motivo dice dónde se buscó", () => {
  const donde = localizarGit(arbol(temporal("pelado")));
  assert.equal(donde.ok, false);
  assert.match(donde.motivo, /este árbol/);
});

test("un árbol dentro de otro repositorio no hereda su git", () => {
  // Git contesta desde el de arriba, y revisar ese sería revisar otra cosa.
  const fuera = conGit(arbol(temporal("fuera")));
  const dentro = arbol(join(fuera, "anidado"));
  const donde = localizarGit(dentro);
  assert.equal(donde.ok, false);
  assert.match(donde.motivo, /es otro repositorio/);
});

/**
 * Corre el guarda con la raíz puesta en el árbol de la prueba.
 *
 * Se le quitan `GIT_DIR` y `GIT_WORK_TREE` heredados: si quien corre la prueba
 * los trae puestos, el caso «sin git» encontraría el repositorio de esa persona
 * y pasaría por la razón equivocada.
 */
function revisable(dir) {
  const entorno = { ...process.env };
  delete entorno.GIT_DIR;
  delete entorno.GIT_WORK_TREE;
  return spawnSync(process.execPath, [join(dir, "scripts", "reviewable.mjs")], {
    cwd: dir,
    encoding: "utf8",
    env: entorno,
  });
}

test("sin git el guarda se omite en voz alta, y NO sale en verde", () => {
  const r = revisable(arbol(temporal("omitido")));
  assert.equal(r.status, SALIDA_OMITIDO);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no corrió/i);
  assert.match(r.stderr, /GIT_DIR/);
});

test("con el git de la carpeta de control el guarda corre de verdad y caza el byte nulo", () => {
  const { trabajo, control } = comoTerminus({ proyecto: "vmpz3sqz" });
  conGit(arbol(trabajo, { conByteNulo: true }), control);
  const r = revisable(trabajo);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /BINARIO/);
  assert.match(r.stderr, /sucio\.ts/);
});

test("y en el mismo montaje, sin byte nulo, sale limpio", () => {
  const { trabajo, control } = comoTerminus({ proyecto: "vmpz3sqz" });
  conGit(arbol(trabajo), control);
  const r = revisable(trabajo);
  assert.equal(r.status, 0, r.stderr);
});
