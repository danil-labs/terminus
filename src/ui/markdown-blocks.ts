/**
 * Parte una respuesta en bloques de primer nivel para el streaming: solo el
 * último bloque cambia mientras se escribe, los anteriores son la misma cadena,
 * `Index` no los toca y su DOM y su alto quedan estables. Pasar el mensaje
 * entero a `SolidMarkdown` reconstruye todo el árbol en cada token y las
 * alturas brincan bajo el hilo que sigue al fondo.
 *
 * Se corta con reglas y no con el AST: `remark-parse` solo está como
 * dependencia transitiva de `solid-markdown`, no declarada, y pnpm no
 * garantiza esa resolución. Las reglas son conservadoras — ante la duda NO se
 * corta: un corte de más parte una lista y reinicia su numeración; uno de
 * menos solo deja un bloque más grande.
 */

/** Abre o cierra un bloque de código: ``` o ~~~, con lo que sea detrás. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** Empieza un elemento de lista: `-`, `*`, `+`, `1.`, `1)`. */
const LISTA = /^\s{0,3}([-*+]|\d{1,9}[.)])\s/;
/** Empieza una cita. */
const CITA = /^\s{0,3}>/;
/** Sigue algo que ya venía: indentado con dos espacios o con un tabulador. */
const SANGRADO = /^(\s{2,}|\t)\S/;

/** Si un trozo contiene alguna línea que abra lista. */
const esLista = (t: string) => t.split("\n").some((l) => LISTA.test(l));
const esCita = (t: string) => t.split("\n").some((l) => CITA.test(l));

/**
 * Los bloques de `texto`, en orden y sin perder nada: **volver a unirlos con
 * `"\n\n"` devuelve el original**, salvo por los saltos de más que separaban
 * unos de otros.
 *
 * Un texto vacío da una lista vacía, y uno sin líneas en blanco da un solo
 * bloque — que es lo que pasa al principio de cada respuesta.
 */
export function bloquesDeMarkdown(texto: string): string[] {
  if (texto === "") return [];
  const lineas = texto.split("\n");
  /** Los trozos crudos: lo que separa una línea en blanco fuera de un fence. */
  const trozos: string[] = [];
  let actual: string[] = [];
  let dentroDeFence = false;
  let cierre = "";

  for (const linea of lineas) {
    const fence = FENCE.exec(linea);
    if (fence) {
      if (!dentroDeFence) {
        dentroDeFence = true;
        cierre = fence[1][0];
      } else if (linea.trimStart().startsWith(cierre)) {
        // **El cierre se compara por el carácter y no por el largo.** Markdown
        // deja cerrar con al menos tantas marcas como abrió, y un ``` dentro de
        // un ~~~~ es contenido y no un cierre.
        dentroDeFence = false;
      }
      actual.push(linea);
      continue;
    }
    // Una línea en blanco **dentro** de un bloque de código es contenido suyo.
    if (linea.trim() === "" && !dentroDeFence) {
      if (actual.length > 0) trozos.push(actual.join("\n"));
      actual = [];
      continue;
    }
    actual.push(linea);
  }
  if (actual.length > 0) trozos.push(actual.join("\n"));

  // **Y se vuelven a unir los que no debían separarse.** Una lista con
  // línea en blanco entre sus elementos —una lista «suelta»— son varios trozos
  // de una sola lista: dejarlos partidos reinicia la numeración de una lista
  // ordenada y separa las viñetas con el margen de dos bloques.
  const bloques: string[] = [];
  for (const trozo of trozos) {
    const previo = bloques[bloques.length - 1];
    const primera = trozo.split("\n")[0] ?? "";
    const sigue =
      previo !== undefined &&
      (SANGRADO.test(primera) ||
        (LISTA.test(primera) && esLista(previo)) ||
        (CITA.test(primera) && esCita(previo)));
    if (sigue) bloques[bloques.length - 1] = `${previo}\n\n${trozo}`;
    else bloques.push(trozo);
  }
  return bloques;
}
