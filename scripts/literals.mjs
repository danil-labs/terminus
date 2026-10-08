#!/usr/bin/env node
/**
 * Texto soldado en un archivo que ya se había desoldado.
 *
 * **Es el guarda que decide si la app sigue siendo multilingüe dentro de seis
 * meses.** Sacar una pantalla al catálogo se hace una vez; volver a soldarle una
 * frase se hace cada semana, sin querer, en el arreglo de otra cosa. Y no da
 * ninguna señal: la pantalla se ve bien en español —que es la lengua de quien la
 * escribió— y se ve bien en maya salvo por ese renglón. Sin esto, la app vuelve
 * a ser monolingüe **una frase por vez**.
 *
 *   node scripts/literals.mjs
 *
 * Sale con 1 si encuentra alguna. No necesita `dist/`.
 *
 * ## Solo mira lo ya migrado, y esa es la decisión de diseño
 *
 * Un archivo entra en el alcance **cuando importa `t` de `lib/lenguas`**, no
 * antes. Mientras la migración avanza pantalla por pantalla, un guarda que
 * mirara todo el árbol daría cientos de hallazgos ciertos y no accionables, y lo
 * que se hace con un guarda así es apagarlo. Así cubre exactamente lo ya
 * migrado, y **su alcance crece solo**: cada superficie que se migra queda
 * cubierta el mismo día.
 *
 * ## Qué NO puede ver, y por eso lo imprime cada vez
 *
 * - **Los archivos que aún no se migraron.** No son un fallo: son la lista de lo
 *   que falta. Se cuentan al final para que no se pierda de vista.
 * - **El texto del backend.** `src-tauri/` está fuera: sus frases viajan como
 *   error o como campo serializado y el front las pinta crudas. Es otra fase.
 * - **Una frase mal traducida, o una clave con el texto de otra.** Eso lo ve
 *   quien lee la pantalla.
 */
import { readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { archivos } from "./git.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = join(RAIZ, "src");
const LENGUAS = join(RAIZ, "src/locales");

const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * Los atributos que la persona lee. `title` y `aria-label` cuentan: una app en
 * maya con los tooltips en español está a medias, y quien usa lector de pantalla
 * se queda con la mitad en la lengua equivocada.
 */
const ATRIBUTOS = ["placeholder", "title", "aria-label", "alt", "aria-description"];

/**
 * Lo que parece frase y no identificador.
 *
 * Pide **un espacio y tres letras seguidas**, o un carácter que solo aparece en
 * prosa (`á…ñ¿¡«»…`). Con eso quedan fuera las clases, los ids, los nombres de
 * evento y los literales de una palabra —`"ghost"`, `"sizing"`— que no son
 * texto de pantalla. Es deliberadamente estrecho: un guarda que grita de más se
 * apaga.
 */
const pareceFrase = (s) => {
  const limpio = s.trim();
  if (limpio.length < 4) return false;
  if (/^[\w.\-/#:{}[\]()$@%]+$/.test(limpio)) return false;
  if (/^https?:/.test(limpio)) return false;
  if (esListaDeClases(limpio)) return false;
  return /[áéíóúüñ¿¡«»…]/i.test(limpio) || (/\s/.test(limpio) && /[a-záéíóúñ]{3}/i.test(limpio));
};

/**
 * Una lista de clases de Tailwind, que **no es texto** y hasta aquí lo parecía.
 *
 * La regla de arriba deja fuera el identificador de una pieza —`"ghost"`,
 * `"sizing"`— porque no lleva espacios. Pero `cn()` recibe **varias en una
 * cadena**, y `"min-w-0 flex-1 truncate font-mono"` trae un espacio y tres
 * letras seguidas, así que entraba por la puerta de la prosa. No es un caso
 * raro: es como está escrito cada `cn()` del árbol.
 *
 * **Y son preexistentes**, que es lo que lo vuelve grave: la primera pantalla
 * que alguien migre estrena diez o treinta hallazgos ciertos que **no se
 * arreglan sacando nada al catálogo**. Eso es exactamente lo que apaga un
 * guarda, y lo dice su propia cabecera. El guarda nació con tres archivos
 * migrados que no usaban `cn`, así que no se vio hasta que llegó una superficie
 * de verdad: `features/chat/` le sacó **33 hallazgos y ninguno cierto**.
 *
 * Se reconocen por dos cosas que ninguna prosa junta:
 *
 * 1. **Ninguna pieza empieza por mayúscula**, y ninguna trae un carácter que
 *    Tailwind no use. Lo que hace segura esta regla es la mayúscula, no la
 *    puntuación: una utility puede llevar coma y paréntesis
 *    —`grid-cols-[16px_minmax(0,1fr)_auto]`—, así que restringir los signos
 *    solo devuelve falsos positivos. Una frase española empieza con mayúscula o
 *    termina en punto, y por ahí sigue entrando aunque no lleve ni una tilde.
 *
 *    **Los combinadores de un selector arbitrario entran por lo mismo**:
 *    `[&>:first-child>:first-child]:mt-0` es una utility y lleva `>`, y sin él
 *    en la lista el guarda reportaba una lista de clases como frase. Se
 *    descubrió el día que `ui/Markdown.tsx` importó `t` y entró en el alcance
 *    del guarda con sus `cn()` de siempre — o sea, en el primer archivo que lo
 *    tenía, no en uno raro. `<` y `=` van con él por el mismo motivo:
 *    `[&[data-abierto=true]]` es la forma de la variante de atributo.
 * 2. **Alguna pieza lleva `-`, `:` o `[`**: `text-xs`, `hover:bg-surface-muted`,
 *    `max-h-[260px]`. Es lo que separa una utility de una palabra suelta.
 *
 * El guion inicial abre la pieza porque el margen negativo se escribe así
 * —`-mt-3`, `-top-1.5`—, y sin él una lista con uno dentro se reportaba entera.
 *
 * Comprobado sobre las listas reales de `features/chat/` y de `features/code/`
 * y contra las frases que esas dos superficies acababan de sacar al catálogo,
 * incluidas las escritas sin una sola tilde: las listas se callan y las frases
 * se siguen reportando.
 *
 * **Lo que cuesta, dicho:** una frase de interfaz enteramente en minúsculas, sin
 * tildes, sin puntuación y con un guion dentro de una palabra —«modo
 * solo-lectura»— pasaría. Es más estrecho que lo que se gana: sin esto no había
 * forma de migrar una pantalla real y dejar el guarda en verde.
 */
// El guion inicial es el de una utility negativa —`-mb-px`, `-mt-2`—, y sin él
// una lista de clases que lleve una entra por la puerta de la prosa. Sigue
// pidiendo que la pieza no empiece por mayúscula, que es lo que la hace segura.
const PIEZA = /^-?!?[a-z0-9[][\w.,\-/#:{}[\]()$@%!&*+~<>=]*$/;
const esListaDeClases = (s) => {
  const piezas = s.trim().split(/\s+/);
  return (
    piezas.length > 1 &&
    piezas.every((p) => PIEZA.test(p)) &&
    piezas.some((p) => /[-:[]/.test(p))
  );
};

const migrados = [];
const pendientes = [];
const hallazgos = [];

for (const archivo of archivos(FUENTE, [".tsx"])) {
  if (archivo.startsWith(LENGUAS)) continue;
  const crudo = readFileSync(archivo, "utf8");
  const usa = /from\s+"[^"]*lib\/i18n"/.test(crudo);
  const rel = relative(RAIZ, archivo);
  if (!usa) {
    pendientes.push(rel);
    continue;
  }
  migrados.push(rel);
  const s = sinComentarios(crudo);
  const linea = (i) => s.slice(0, i).split("\n").length;

  // Nodos de texto del JSX: `>Entrar de todos modos<`
  // **Con saltos de línea dentro, a los dos lados del texto**, porque el
  // formateador deja el nodo en su propia línea y prohibirlos dejaba pasar justo
  // los botones —el primer control que alguien vuelve a soldar; comprobado con
  // un control negativo—. Lo que sí quedan fuera son
  // `;`, `=` y los paréntesis: un nodo de texto no los lleva, y sin ellos el
  // patrón se tragaba el código TS que también vive entre `>` y `<`
  // (`createSignal<X>(null); … listen<Y>(`). La barra vertical entra en esa
  // lista por lo mismo: `Promise<void | Foo>` deja `void | Promise` entre `>` y
  // `<`, y sin ella el guarda lo denunciaba como una frase sin traducir.
  for (const m of s.matchAll(/>([^<>{};=()|]*[A-Za-zÁÉÍÓÚÑáéíóúñ][^<>{};=()|]*)</g)) {
    if (pareceFrase(m[1])) hallazgos.push({ rel, linea: linea(m.index), texto: m[1].trim(), donde: "texto" });
  }
  // Atributos que se leen: `placeholder="Buscar…"`
  for (const attr of ATRIBUTOS) {
    for (const m of s.matchAll(new RegExp(`${attr}=\\{?"([^"]+)"`, "g"))) {
      if (pareceFrase(m[1])) hallazgos.push({ rel, linea: linea(m.index), texto: m[1], donde: attr });
    }
  }
  // Cadenas sueltas con prosa que no pasaron por `t(`: `return "En espera";`
  for (const m of s.matchAll(/(?<!\bt\()\s(?:"([^"\n]+)"|`([^`\n$]+)`)/g)) {
    const texto = m[1] ?? m[2];
    if (!pareceFrase(texto)) continue;
    const i = m.index;
    // `t("…")` ya se descartó por el lookbehind; aquí caen los que quedan.
    if (/\bt\(\s*$/.test(s.slice(Math.max(0, i - 8), i + 1))) continue;
    hallazgos.push({ rel, linea: linea(i), texto, donde: "cadena" });
  }
}

function noComprueba() {
  console.error(
    `\nLo que este guarda NO mira: los ${pendientes.length} .tsx que todavía no importan\n` +
      "`t` —esos no son un fallo, son la lista de lo que falta—, el texto del\n" +
      "backend en `src-tauri/`, y si una traducción dice lo que debe.",
  );
}

if (hallazgos.length === 0) {
  console.log(
    `Sin texto soldado en los ${migrados.length} archivo(s) ya migrados ` +
      `(${pendientes.length} sin migrar).`,
  );
  noComprueba();
  process.exit(0);
}

console.error(
  `\n${hallazgos.length} frase(s) soldadas en archivos que ya usan el catálogo:\n`,
);
for (const h of hallazgos) {
  console.error(`  ${h.rel}:${h.linea}  [${h.donde}]`);
  console.error(`    ${h.texto.length > 70 ? h.texto.slice(0, 70) + "…" : h.texto}`);
}
console.error(
  "\nEste archivo ya se desoldó una vez. Una frase que vuelve a entrar directa\n" +
    "se ve bien en español y deja la pantalla a medias en cualquier otra lengua,\n" +
    "sin error y sin nada en consola. Sácala al catálogo de su superficie.",
);
noComprueba();
process.exit(1);
