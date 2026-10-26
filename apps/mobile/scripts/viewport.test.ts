import assert from "node:assert/strict";
import { test } from "node:test";
import { pinToVisibleArea } from "../src/lib/viewport.web.ts";

test("la cabecera sigue el área visible al abrir, desplazar y cerrar el teclado", () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, pageTop: 0 });
  const browser = Object.assign(new EventTarget(), { visualViewport: viewport });
  const root = { style: { position: "", left: "", right: "", top: "", height: "100%", overflow: "" } };
  const before = { ...root.style };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: () => root } });
  let cleanup: (() => void) | undefined;
  try {
    cleanup = pinToVisibleArea();
    assert.equal(root.style.height, "800px");
    viewport.height = 430;
    viewport.pageTop = 220;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(root.style.height, "430px");
    assert.equal(root.style.position, "absolute");
    assert.equal(root.style.top, "220px");

    // El documento puede moverse sin otro evento del visualViewport.
    viewport.pageTop = 310;
    browser.dispatchEvent(new Event("scroll"));
    assert.equal(root.style.top, "310px");

    viewport.height = 800;
    viewport.pageTop = 0;
    viewport.dispatchEvent(new Event("resize"));
    assert.equal(root.style.top, "0px");
    assert.equal(root.style.height, "800px");
    cleanup();
    viewport.pageTop = 90;
    viewport.dispatchEvent(new Event("scroll"));
    browser.dispatchEvent(new Event("resize"));
    assert.deepEqual(root.style, before);
  } finally {
    cleanup?.();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
