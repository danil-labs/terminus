import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { trimNativeMenu } from "../src/lib/contextMenu.ts";

const setup = (development: boolean) => {
  const { window } = new JSDOM(
    `<button id="row">Tarea</button><input id="field"><textarea id="area"></textarea><div contenteditable="true"><span id="rich">x</span></div><p id="text">Texto</p>`,
  );
  trimNativeMenu(window as unknown as Window, development);
  const open = (id: string) => {
    const event = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    window.document.getElementById(id)!.dispatchEvent(event);
    return !event.defaultPrevented;
  };
  return { window, open };
};

test("the release window drops the native menu outside text fields", () => {
  const { open } = setup(false);
  assert.equal(open("row"), false, "a task row does not offer Reload");
  assert.equal(open("text"), false);
  assert.equal(open("field"), true, "an input keeps copy and paste");
  assert.equal(open("area"), true);
  assert.equal(open("rich"), true, "inside contenteditable too");
});

test("selected text keeps the menu so it can be copied", () => {
  const { window, open } = setup(false);
  const range = window.document.createRange();
  range.selectNodeContents(window.document.getElementById("text")!);
  window.getSelection()!.addRange(range);
  assert.equal(open("text"), true);
});
