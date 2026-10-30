/**
 * En el navegador del teléfono un doble toque sobre texto que no se edita no
 * selecciona nada (solo mantener presionado). Aquí selecciona la palabra tocada.
 */

function editable(el: Element | null): boolean {
  return !!el?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** Los límites de la palabra que contiene `offset`, o `null` si ahí hay espacio o puntuación. */
export function wordAround(text: string, offset: number): [number, number] | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  for (const { segment, index, isWordLike } of segmenter.segment(text)) {
    const end = index + segment.length;
    if (offset < index) break;
    if (isWordLike && offset <= end) return [index, end];
  }
  return null;
}

function onDoubleTap(e: MouseEvent) {
  const sel = document.getSelection();
  // Un navegador de escritorio ya lo resolvió solo.
  if (!sel || !sel.isCollapsed || editable(e.target as Element | null)) return;
  const caret = caretAt(e.clientX, e.clientY);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return;
  const parent = caret.node.parentElement;
  if (!parent || getComputedStyle(parent).userSelect === "none") return;
  const word = wordAround(caret.node.textContent ?? "", caret.offset);
  if (!word) return;
  sel.setBaseAndExtent(caret.node, word[0], caret.node, word[1]);
}

let installed = false;

export function selectWordOnDoubleTap() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("dblclick", onDoubleTap);
}
