/**
 * In the browser the disk is the remote computer's: an image the answer names
 * by its path arrives through `preview_file` as `data:`, and a chat visual is
 * read with `tree_show` from that computer. A file attached with the button or
 * dropped on the chat travels as bytes and the engine saves it there; only
 * images, the kinds `guardar_imagen_pegada` saves. Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const IMAGE = "/Users/ana/exchange/chart.png";
const VISUAL = "<!doctype html><meta name=\"harness-artefacto\" content=\"web\"><p>grafica viva</p>";
const answer = `Mira:\n\n![captura](${IMAGE})\n\n::terminus-visual{file="chart-1.html" title="Turnos"}\n\nListo.`;
const MAC = { computer_id: "cmp_mac", name: "MacBook Air", state: "online", provider: "self", kind: "physical" };

async function open(name) {
  const f = fleet({
    cmp_mac: {
      table: {
        ...engine,
        load_session: ({ id }) => ({ ...engine.load_session({ id }), turns: [
          { role: "user", id: "u0", at: 0, text: "hazme una gráfica" },
          { role: "agent", id: "a1", at: 1, text: answer },
        ] }),
        guardar_imagen_pegada: ({ mime }) => `/tmp/captura-1.${mime.split("/")[1]}`,
        prepare_attachments: ({ paths }) => paths,
        preview_file: ({ path }) => ({ kind: "image", data_url: path === IMAGE ? PNG : null }),
        file_size: 10,
        tree_show: ({ tree, path }) => (tree === "terminus-chat-visuals" && path === "chart-1.html"
          ? { kind: "text", text: VISUAL, bytes: new TextEncoder().encode(VISUAL).byteLength, truncated: false }
          : null),
      },
    },
  });
  const app = await boot("listo", name, {}, undefined, {}, {
    web: true,
    antes: (w) => {
      globalThis.WebSocket = f.Socket;
      // Everything is on screen: the visual reads as soon as it mounts.
      globalThis.IntersectionObserver = w.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; }
        observe(target) { setTimeout(() => this.callback([{ isIntersecting: true, target }], this), 0); }
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      };
      w.terminusWeb = { endpoint: "https://relay.test", computers: [MAC], getToken: async () => "tok" };
    },
  });
  await sleep(2500);
  const doc = app.w.document;
  const row = doc.querySelector('[data-sesion="cmp_mac~t1"]');
  assert.ok(row, "no está la fila de t1");
  row.click();
  await sleep(1500);
  const calls = (command) => f.relays.cmp_mac.calls.filter((c) => c.command === command);
  return { app, doc, calls };
}

test("la imagen y el visual de una respuesta se pintan en la web", async () => {
  const { doc, calls } = await open("web-chat-media");
  assert.ok(calls("preview_file").some((c) => c.args.path === IMAGE), "no pidió la imagen");
  assert.ok([...doc.querySelectorAll("img")].some((img) => img.getAttribute("src") === PNG), "no pintó la imagen");
  const visual = calls("tree_show").find((c) => c.args.tree === "terminus-chat-visuals");
  assert.ok(visual, "no leyó el visual");
  assert.equal(visual.workspace, "w");
  assert.ok([...doc.querySelectorAll("iframe")].some((f) => (f.getAttribute("srcdoc") ?? "").includes("grafica viva")), "no pintó el visual");
});

test("en la web se adjunta una imagen con el botón y soltándola, y otro archivo se explica", async () => {
  const { app, doc, calls } = await open("web-chat-attach");
  const w = app.w;
  const png = new w.File([new Uint8Array([137, 80, 78, 71])], "foto.png", { type: "image/png" });
  const pdf = new w.File(["%PDF"], "plan.pdf", { type: "application/pdf" });
  let picker;
  const click = w.HTMLInputElement.prototype.click;
  w.HTMLInputElement.prototype.click = function () {
    if (this.type !== "file") return click.call(this);
    picker = this;
    Object.defineProperty(this, "files", { value: [png] });
    this.onchange?.();
  };
  doc.querySelector('[aria-label="Adjuntar un archivo"]').click();
  await sleep(500);
  assert.ok(picker, "no abrió el selector del navegador");
  assert.match(picker.accept, /image\/png/);
  assert.equal(calls("guardar_imagen_pegada").length, 1);
  assert.equal(calls("guardar_imagen_pegada")[0].args.mime, "image/png");
  assert.deepEqual(calls("prepare_attachments").at(-1).args.paths, ["/tmp/captura-1.png"]);

  const drop = new w.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { types: ["Files"], files: [new w.File(["GIF89a"], "anim.gif", { type: "image/gif" }), pdf] } });
  doc.querySelector('[aria-label="Adjuntar un archivo"]').dispatchEvent(drop);
  await sleep(500);
  assert.ok(drop.defaultPrevented, "el navegador abriría el archivo");
  assert.equal(calls("guardar_imagen_pegada").at(-1).args.mime, "image/gif");
  assert.deepEqual(calls("prepare_attachments").at(-1).args.paths, ["/tmp/captura-1.gif"]);
  assert.ok(doc.body.textContent.includes("No se adjuntó: plan.pdf"), "no explicó el PDF");
});
