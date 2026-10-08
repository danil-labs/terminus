#!/usr/bin/env node
/**
 * Que ningún archivo de código quede fuera de la revisión.
 *
 * **El defecto que lo motiva no es que la revisión falle: es que se apaga.** Un
 * byte nulo literal en `src/UsageBar.tsx` —el separador de una clave de mapa,
 * escrito crudo en vez de escapado— bastó para que git clasificara el archivo
 * como binario. Desde entonces su diff salía `Bin 19 -> 36 bytes, 0 insertions,
 * 0 deletions`, en la terminal y en GitHub: meses de cambios en `main` sin que
 * nadie pudiera leerlos. Reproducido en un repo de prueba — se añade una línea
 * de código real y el diff reporta cero cambios.
 *
 * Un defecto normal se le escapa a quien revisa. Este **desactiva la revisión**,
 * así que no espera a la segunda vez.
 *
 * ## Por qué se detecta el síntoma y no la causa
 *
 * El byte nulo es **una** de las razones por las que git llama binario a un
 * archivo; también lo hacen un `.gitattributes` mal puesto y el UTF-8 inválido.
 * Preguntarle a git qué considera binario las cubre todas; buscar el byte cubre
 * una.
 *
 * ## Y por qué no se busca con grep, que es el instinto
 *
 * **No puede verlo.** El patrón le llega a `grep` como cadena terminada en nulo,
 * así que el byte que se busca termina el patrón antes de empezar: `grep $'\0'`
 * no encuentra nada y sale como si el archivo estuviera limpio.
 * `git grep -I --files-without-match .` tampoco lo lista. El mismo byte que hace
 * el archivo invisible a la revisión lo hace invisible a la herramienta con la
 * que uno iría a buscarlo.
 *
 * Lo que sí funciona es preguntarle a git su propia pregunta: un diff contra el
 * **árbol vacío** —ese hash es constante en todo repo git— marca con `-` en
 * `--numstat` cada archivo que considera binario.
 */
import { execFileSync } from "node:child_process";

import { localizarGit, RAIZ, SALIDA_OMITIDO } from "./git.mjs";

/**
 * **Sin git no hay pregunta que hacer, y eso se dice — no se aprueba.**
 *
 * Las cuatro comprobaciones de abajo son la misma: preguntarle a git qué
 * considera binario. Sin metadata alcanzable no hay a quién preguntarle, y las
 * dos salidas honestas son quedarse callado o mentir. Se elige la primera y en
 * voz alta: `SALIDA_OMITIDO` le dice a `verify.mjs` que siga con los demás
 * guardas y que nombre este al terminar. Lo que no puede pasar —y
 * pasaba— es que la cadena entera muera aquí y nadie corra nada.
 */
const git = localizarGit();
if (!git.ok) {
  console.error("No hay metadata de git alcanzable desde este árbol.\n");
  console.error(git.motivo);
  console.error(
    "\nAsí que este guarda NO corrió, y eso no es un verde: un byte de control\n" +
      "puede estar sacando un archivo de la revisión ahora mismo y esta corrida no\n" +
      "lo vería. Se comprueba desde un clon con git, o apuntando GIT_DIR y\n" +
      "GIT_WORK_TREE a la metadata de este árbol.",
  );
  process.exit(SALIDA_OMITIDO);
}

/**
 * Cómo se invoca a git aquí: **parado en el árbol y con el entorno que lo
 * localiza**. El `cwd` explícito es lo que hace que `node scripts/reviewable.mjs` dé
 * lo mismo que dentro de `pnpm verificar` — los caminos que devuelve `ls-files`
 * son relativos a él, y `--no-index` los resuelve desde ahí.
 */
const OPCIONES = {
  cwd: RAIZ,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, ...git.entorno },
};

/** El árbol vacío. Constante en cualquier repo git, no hace falta calcularlo. */
const ARBOL_VACIO = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Lo que ES binario de verdad y tiene que seguir estándolo. */
const BINARIO_LEGITIMO =
  /\.(png|jpe?g|gif|webp|svgz|ico|icns|woff2?|ttf|otf|eot|pdf|zip|gz|tar|mp4|mov|mp3|wav|dmg|msi|exe|dll|so|dylib|a|node|wasm)$/i;

function diff(args) {
  return execFileSync("git", ["diff", "--numstat", ...args], OPCIONES);
}

/**
 * Los archivos que git todavía no rastrea.
 *
 * **No salen en ningún `git diff`**, y ahí estaba el agujero: escribir un byte
 * nulo en un archivo NUEVO y correr este guarda daba verde, porque un archivo
 * sin rastrear no está modificado respecto a nada. Se compara contra
 * `/dev/null` con `--no-index`, que es la forma de preguntarle a git por algo
 * que aún no conoce.
 */
function sinRastrear() {
  const lista = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], OPCIONES)
    .split("\n")
    .filter(Boolean);

  return lista.filter((ruta) => {
    try {
      // Con `--no-index` git sale 1 cuando hay diferencias, que aquí es
      // siempre: se compara un archivo con la nada.
      execFileSync("git", ["diff", "--numstat", "--no-index", "/dev/null", ruta], OPCIONES);
      return false;
    } catch (e) {
      return String(e.stdout ?? "").startsWith("-\t-\t");
    }
  });
}

/**
 * **Cuatro preguntas y no una.**
 *
 * El diff contra el árbol vacío mira lo **commiteado**, que es lo que llega al
 * CI. Pero escribir un byte nulo y correr este guarda antes de commitear daba
 * **verde**: en un archivo ya rastreado porque el cambio no estaba en `HEAD`, y
 * en uno nuevo porque un archivo sin rastrear no aparece en ningún diff. El
 * fallo se destapaba al hacer push, cuando ya hay un commit con el byte dentro.
 *
 * Ahora se le pregunta lo mismo al índice, al árbol de trabajo y a lo que aún
 * no rastrea, así que una corrida local ve lo que hay delante y no solo
 * lo que ya se guardó. Es el mismo criterio de siempre —preguntarle a git su
 * propia pregunta— y ninguna de las cuatro tapa a las otras.
 */
const binarios = [
  ...new Set([
    ...[diff([ARBOL_VACIO, "HEAD"]), diff(["--cached"]), diff([])]
      .join("\n")
      .split("\n")
      .map((l) => l.split("\t"))
      .filter(([add]) => add === "-")
      .map(([, , ruta]) => ruta)
      .filter(Boolean),
    ...sinRastrear(),
  ]),
];

const sospechosos = binarios.filter((r) => !BINARIO_LEGITIMO.test(r));

if (sospechosos.length === 0) {
  console.log(
    `Todo el código es revisable (${binarios.length} binarios, todos esperados).`,
  );
  process.exit(0);
}

for (const r of sospechosos) {
  console.error(`git trata este archivo como BINARIO y su diff no se puede leer — ${r}`);
}
console.error(
  "\nSu diff sale como «Bin N -> M bytes, 0 insertions, 0 deletions»: los cambios\n" +
    "existen y nadie puede revisarlos. Causas habituales, en orden de frecuencia:\n" +
    "  · un byte de control literal en el fuente (escríbelo escapado: \\u0000)\n" +
    "  · UTF-8 inválido\n" +
    "  · una regla de `.gitattributes` que lo marca binario\n" +
    "Si el archivo es binario de verdad, añade su extensión a BINARIO_LEGITIMO.",
);
process.exit(1);
