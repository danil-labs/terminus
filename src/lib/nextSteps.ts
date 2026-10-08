/**
 * Las respuestas rápidas que el agente deja al final de su mensaje, dentro de
 * `<NEXT_STEPS>`, como líneas `- [ ] <mensaje>`. Se leen del texto crudo; una
 * etiqueta dentro de un bloque de código es texto. La limpieza para lo que sale
 * del chat vive en `runtime/chat/next_steps.rs` y comparte `next-steps.cases.json` con esta.
 *
 * Derivado de `traycer-next-steps.ts` (Copyright (c) 2026 Traycer AI, MIT),
 * https://github.com/traycerai/traycer. La atribución está en `CREDITS.md`.
 */

const APERTURA = "<NEXT_STEPS>";
const CIERRE_EN_LINEA = /^[\t ]*<\/NEXT_STEPS>[\t ]*$/;
const APERTURA_AL_INICIO = /^[\t ]*<NEXT_STEPS>[\t ]*/;
const CERCA = /^( {0,3})(`{3,}|~{3,})/;
const OPCION = /^[\t ]*-[\t ]*\[[\t ]*\][\t ]*:?\s*([\s\S]*?)[\t ]*$/;

export type OpcionSiguiente = { id: string; prompt: string };

export type ParteSiguiente =
  | { kind: "markdown"; id: string; markdown: string }
  | { kind: "next_steps"; id: string; prose: string; options: OpcionSiguiente[]; complete: boolean };

type Linea = { text: string; start: number; endWithNewline: number };
type Bloque = { start: number; contentStart: number; contentEnd: number; end: number; complete: boolean };

/** El mensaje partido en texto y bloques de opciones, en orden. */
export function partirSiguientes(markdown: string, streaming: boolean): ParteSiguiente[] {
  const recortado = streaming ? sinAperturaAMedias(markdown) : markdown;
  if (!recortado.includes(APERTURA)) return [{ kind: "markdown", id: "markdown:0", markdown: recortado }];
  const partes: ParteSiguiente[] = [];
  let cursor = 0;
  for (const bloque of bloques(recortado, streaming)) {
    if (bloque.start > cursor) empujarMarkdown(partes, recortado.slice(cursor, bloque.start));
    const crudo = recortado.slice(bloque.contentStart, bloque.contentEnd);
    const contenido = bloque.complete ? crudo : sinOpcionAMedias(crudo);
    const leido = leerBloque(contenido);
    if (leido === null) {
      empujarMarkdown(partes, sinLineasEnBlancoAlBorde(contenido));
    } else {
      // Solo el inicio: el final crece con cada token y remontaría los botones.
      partes.push({ kind: "next_steps", id: `next:${bloque.start}`, ...leido, complete: bloque.complete });
    }
    cursor = bloque.end;
  }
  if (cursor < recortado.length) empujarMarkdown(partes, recortado.slice(cursor));
  return partes.length === 0 ? [{ kind: "markdown", id: "markdown:0", markdown: "" }] : partes;
}

/**
 * El mensaje sin las etiquetas ni las opciones; la prosa del bloque se queda.
 * Las opciones hablan con la voz de la persona: fuera de los botones, quien
 * las lee las toma por una orden de quien contestó.
 */
export function textoSinSiguientes(markdown: string): string {
  if (!markdown.includes(APERTURA)) return markdown;
  let fuera = "";
  let cursor = 0;
  for (const bloque of bloques(markdown, false)) {
    fuera += markdown.slice(cursor, bloque.start);
    const contenido = markdown.slice(bloque.contentStart, bloque.contentEnd);
    const queda = leerBloque(contenido)?.prose ?? sinLineasEnBlancoAlBorde(contenido);
    if (queda) fuera += `${queda}\n`;
    cursor = bloque.end;
  }
  return fuera + markdown.slice(cursor);
}

/** La vista previa de un mensaje del agente; `sessions::preview_of` la calcula igual. */
export function vistaPrevia(texto: string): string {
  return resumen(textoSinSiguientes(texto));
}

/**
 * La vista previa del último mensaje con texto de la persona o del agente.
 * Solo se limpia el del agente: un bloque que pega la persona es contenido.
 */
export function vistaPreviaDelHilo(hilo: readonly { role: string; text: string; meta?: string }[]): string | undefined {
  for (let i = hilo.length - 1; i >= 0; i -= 1) {
    const m = hilo[i];
    if ((m.role !== "user" && m.role !== "agent") || m.meta) continue;
    const vista = m.role === "agent" ? vistaPrevia(m.text) : resumen(m.text);
    if (vista) return vista;
  }
  return undefined;
}

// Por caracteres y no por unidades UTF-16: así corta Rust, y un emoji no se parte.
function resumen(texto: string): string {
  return Array.from(texto.replace(/\s+/g, " ").trim()).slice(0, 180).join("").trimEnd();
}

/**
 * En qué posición del hilo mandó la persona cada texto por última vez,
 * recortado; lo que espera en la cola cuenta como mandado al final. Una opción
 * se pinta usada si su texto se mandó después del mensaje que la propuso.
 */
export function ultimaVezEnviada(
  hilo: readonly { role: string; text: string }[],
  cola: readonly string[],
): Map<string, number> {
  const vez = new Map<string, number>();
  hilo.forEach((m, i) => {
    if (m.role === "user") vez.set(m.text.trim(), i);
  });
  for (const texto of cola) vez.set(texto.trim(), Number.POSITIVE_INFINITY);
  return vez;
}

export function usadaDesde(vez: ReadonlyMap<string, number>, texto: string, desde: number): boolean {
  return (vez.get(texto) ?? -1) > desde;
}

// Mientras llega, `<NEXT_ST` al final se pintaría crudo un cuadro antes de ocultarse.
function sinAperturaAMedias(markdown: string): string {
  const inicio = markdown.lastIndexOf("\n") + 1;
  const ultima = markdown.slice(inicio).trimStart();
  if (ultima.length === 0 || ultima.length >= APERTURA.length || !APERTURA.startsWith(ultima)) return markdown;
  let cerca: string | null = null;
  for (const linea of lineas(markdown.slice(0, inicio))) cerca = siguienteCerca(cerca, linea.text);
  return cerca === null ? markdown.slice(0, inicio) : markdown;
}

// Mientras llega, `- [` al final todavía no es una opción: leída, el bloque
// entero caería a markdown un cuadro y volvería a botones con el siguiente token.
function sinOpcionAMedias(contenido: string): string {
  const inicio = contenido.lastIndexOf("\n") + 1;
  const ultima = contenido.slice(inicio);
  return OPCION.exec(ultima)?.[1].trim() ? contenido : contenido.slice(0, inicio);
}

function bloques(markdown: string, streaming: boolean): Bloque[] {
  const fuera: Bloque[] = [];
  let cerca: string | null = null;
  let abierto: number | null = null;
  let contentStart = 0;
  for (const linea of lineas(markdown)) {
    const siguiente = siguienteCerca(cerca, linea.text);
    const apertura = APERTURA_AL_INICIO.exec(linea.text);
    if (cerca === null && abierto === null && apertura !== null) {
      abierto = linea.start;
      contentStart =
        apertura[0].length >= linea.text.length ? linea.endWithNewline : linea.start + apertura[0].length;
    } else if (cerca === null && abierto !== null && CIERRE_EN_LINEA.test(linea.text)) {
      fuera.push({ start: abierto, contentStart, contentEnd: linea.start, end: linea.endWithNewline, complete: true });
      abierto = null;
    }
    cerca = siguiente;
  }
  if (abierto !== null) {
    const fin = markdown.length;
    fuera.push({ start: abierto, contentStart: Math.min(contentStart, fin), contentEnd: fin, end: fin, complete: !streaming });
  }
  return fuera;
}

function lineas(texto: string): Linea[] {
  const fuera: Linea[] = [];
  let start = 0;
  while (start < texto.length) {
    const salto = texto.indexOf("\n", start);
    const end = salto < 0 ? texto.length : salto;
    const endWithNewline = salto < 0 ? texto.length : salto + 1;
    const text = end > start && texto.charCodeAt(end - 1) === 13 ? texto.slice(start, end - 1) : texto.slice(start, end);
    fuera.push({ text, start, endWithNewline });
    start = endWithNewline;
  }
  return fuera;
}

function siguienteCerca(cerca: string | null, linea: string): string | null {
  const m = CERCA.exec(linea);
  if (m === null) return cerca;
  const marca = m[2];
  if (cerca === null) return marca;
  if (marca[0] !== cerca[0] || marca.length < cerca.length) return cerca;
  return null;
}

// Las opciones son las últimas líneas del bloque; lo de arriba es prosa.
function leerBloque(contenido: string): { prose: string; options: OpcionSiguiente[] } | null {
  const filas = contenido.replace(/\r\n?/g, "\n").split("\n");
  let i = filas.length - 1;
  while (i >= 0 && filas[i].trim().length === 0) i -= 1;
  const options: OpcionSiguiente[] = [];
  while (i >= 0) {
    if (filas[i].trim().length === 0) {
      i -= 1;
      continue;
    }
    const prompt = OPCION.exec(filas[i])?.[1].trim();
    if (!prompt) break;
    // El índice de línea no cambia mientras el texto de la última opción crece.
    options.unshift({ id: `option:${i}`, prompt });
    i -= 1;
  }
  if (options.length === 0) return null;
  return { prose: sinLineasEnBlancoAlBorde(filas.slice(0, i + 1).join("\n")), options };
}

function sinLineasEnBlancoAlBorde(texto: string): string {
  const filas = texto.replace(/\r\n?/g, "\n").split("\n");
  let a = 0;
  let b = filas.length;
  while (a < b && filas[a].trim().length === 0) a += 1;
  while (b > a && filas[b - 1].trim().length === 0) b -= 1;
  return filas.slice(a, b).join("\n");
}

function empujarMarkdown(partes: ParteSiguiente[], markdown: string) {
  if (markdown.length > 0) partes.push({ kind: "markdown", id: `markdown:${partes.length}`, markdown });
}
