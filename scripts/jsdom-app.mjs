/**
 * El front de `dist/` montado en jsdom, con el IPC de Tauri stubeado.
 *
 * Lo comparten `mount-frontend.mjs`, que afirma que el árbol pinta, y
 * `open-task-cost.mjs`, que cuenta cuánto trabajo cuesta abrir una tarea. Un
 * arranque por guarda divergiría, y el contador dejaría de medir el árbol que el
 * otro guarda da por bueno.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
export const dist = join(raiz, "dist");

if (!existsSync(join(dist, "index.html"))) {
  console.error("No hay dist/. Corre `pnpm build` antes que este guarda.");
  process.exit(1);
}

const indice = readFileSync(join(dist, "index.html"), "utf8");
const bundle = /<script\b[^>]*\bsrc="\/assets\/([^"?]+\.js)"/.exec(indice)?.[1];
if (!bundle || !existsSync(join(dist, "assets", bundle))) {
  console.error("No está el script principal de dist/. Corre `pnpm build` antes que este guarda.");
  process.exit(1);
}

// Un chunk perezoso —mermaid— importa el módulo principal sin la query de su pasada.
// Sin propagarla, Node lo evalúa otra vez y monta una segunda app dentro de #root.
const assetsUrl = `${pathToFileURL(join(dist, "assets")).href}/`;
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    const pass = context.parentURL?.startsWith(assetsUrl) && new URL(context.parentURL).searchParams.get("v");
    if (!pass || !resolved.url.startsWith(assetsUrl) || resolved.url.includes("?")) return resolved;
    return { ...resolved, url: `${resolved.url}?v=${pass}` };
  },
});

/**
 * El HTML de `dist`, **sin sus etiquetas de recurso**.
 *
 * El `<script>` y el `<link>` se quitan porque el módulo lo carga este guarda a
 * mano; dejarlos puestos hace que jsdom los pida por HTTP a un servidor que no
 * existe y reporte **su** fallo como si fuera de la app. Lo único que hace
 * falta del documento es el `<div id="root">`, y ese se queda.
 */
const HTML = indice
  .replace(/<script\b[^>]*><\/script>/g, "")
  .replace(/<link\b[^>]*>/g, "");

/** Lo que se copió a `globalThis` en la pasada anterior, para poder pisarlo. */
let copiadas = [];

/** El arranque son promesas ya resueltas: basta con dejar correr la cola. */
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Con qué causa se emitió un evento, para atribuirle lo que dispare. */
export const causa = new AsyncLocalStorage();

/**
 * Monta el árbol una vez y devuelve qué pintó y qué lanzó.
 *
 * `entorno` decide cómo contesta `check_environment`, que es el portero de
 * `Setup`:
 *
 * - `"listo"` deja pasar a `App` directo. Es el arranque de verdad.
 * - `"falta"` lo rechaza, así que `Setup` pinta su pantalla de requisitos con
 *   el botón «Entrar de todos modos». Sirve para entrar **desde un manejador de
 *   evento**, que es lo único que hace salir la excepción: en el arranque
 *   normal sube por el `setEnv` de `Setup.revisar` y **la traga su propio
 *   `try`**, que es exactamente por qué este fallo no dejó ni un mensaje.
 */
export async function arrancar(entorno, version, respuestas, userAgent) {
  const fallos = [];
  const comandos = [];
  const storageQueries = [];
  const consola = new VirtualConsole();
  consola.on("jsdomError", (e) => fallos.push(`jsdomError: ${e.stack ?? e.message}`));
  consola.on("error", (...a) => fallos.push(`console.error: ${a.join(" ")}`));

  const dom = new JSDOM(HTML, { url: "http://localhost/", pretendToBeVisual: true, virtualConsole: consola });
  const w = dom.window;
  if (userAgent) Object.defineProperty(w.navigator, "userAgent", { value: userAgent, configurable: true });

  w.addEventListener("error", (e) => fallos.push(String(e.error?.stack ?? e.message)));
  w.addEventListener("unhandledrejection", (e) => fallos.push(String(e.reason?.stack ?? e.reason)));

  // El contrato de `@tauri-apps/api`: llama a `window.__TAURI_INTERNALS__.invoke`
  // y espera una promesa. Se define antes del módulo porque el arranque pregunta
  // en su primer `onMount`.
  // **Desuscribirse no pasa por `invoke`, y por eso hace falta esta global.**
  // `unlisten` llama a `window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`
  // **antes** de su primer `await`, así que sin ella lanza síncrono al desmontar
  // cualquier componente suscrito. No se veía mientras el chat no se desmontaba
  // nunca; con una conversación por ventana, cerrar su pestaña lo desmonta y el
  // fallo se llevaba el árbol entero por delante.
  // Suelta el manejador como Tauri (`event::unlisten_js_script`): uno que se
  // quedara aquí retendría el árbol que lo registró y el banco de memoria lo contaría como fuga.
  const callbacks = new Map();
  const events = new Map();
  let lastId = 0;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, eventId) => {
      callbacks.delete(events.get(event)?.get(eventId));
      events.get(event)?.delete(eventId);
    },
  };
  w.__TAURI_INTERNALS__ = {
    transformCallback: (callback) => { const id = ++lastId; callbacks.set(id, callback); return id; },
    convertFileSrc: (p) => p,
    // **`getCurrentWindow()` lee esto y no pasa por `invoke`.** Sin `metadata`
    // lanza al construirse, y una excepción en un `onMount` aborta la cola de
    // los que faltaban: el árbol pinta y lo que se rompe está tres pantallas más
    // allá. Aquí costó un «el chat abrió sin selector de modelo».
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    invoke: (cmd, args) => {
      comandos.push(cmd);
      if (cmd === "list_storage") {
        storageQueries.push(args.refrescar);
        return Promise.resolve({
          tareas: [], archivadas: { cuantas: 0, bytes: 0, recuperable: 0 },
          compartido: [], sueltos: [], recuperable: 0,
          bytes: args.refrescar ? 1073741824 : 0,
          medido_en: args.refrescar ? Date.now() : 1,
          aviso: null,
        });
      }
      // Los eventos de Tauri viajan por el mismo canal. Cada `listen` recibe
      // su propio id, que es con el que se desuscribe.
      if (cmd === "plugin:event|listen") {
        const eventId = ++lastId;
        events.set(args.event, (events.get(args.event) ?? new Map()).set(eventId, args.handler));
        return Promise.resolve(eventId);
      }
      if (cmd.startsWith("plugin:event|")) return Promise.resolve(1);
      if (cmd === "check_environment" && cmd in respuestas) {
        return Promise.resolve(respuestas[cmd](args));
      }
      if (cmd === "check_environment") {
        // `"mudo"` es el sondeo que nunca contesta: la app tiene que montar
        // igual. Es la única forma de fijar que no está en el camino del
        // primer pintado — un `await` que vuelva aquí no rompe nada más.
        if (entorno === "mudo") return new Promise(() => {});
        return entorno === "listo"
          ? Promise.resolve({ ready: true, blocked: false, reason: null, items: [] })
          : Promise.reject(new Error("el guarda entra a mano"));
      }
      if (cmd in respuestas) {
        const response = respuestas[cmd];
        if (response instanceof Error) return Promise.reject(response);
        return Promise.resolve(typeof response === "function" ? response(args) : response);
      }
      return Promise.reject(new Error(`sin stub: ${cmd}`));
    },
  };

  // jsdom no trae lo que sí trae el motor real. Sin esto el rojo sería del
  // guarda y no de la app, que es la peor clase de guarda que hay.
  w.matchMedia ??= (q) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
  w.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  w.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  // Asignación, no `??=`: jsdom SÍ define `scrollTo`, y lo que define lanza.
  // Va para toda ventana que se monte, no por escenario: el árbol de antes
  // conserva sus relojes, y una limpieza suya que caiga después toca la ventana
  // que sea global entonces. Parchear solo la suya deja un fallo intermitente.
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollTo ??= () => {};
  w.HTMLElement.prototype.scrollIntoView ??= () => {};

  /**
   * **El árbol se ejecuta en este proceso, no dentro de jsdom.**
   *
   * jsdom no sabe correr `<script type="module">` —no falla, lo ignora— y lo
   * que sale de `vite build` es un módulo. Así que el documento lo pone jsdom,
   * sus globales se cuelgan aquí y el módulo lo carga Node. Es lo mismo que
   * hace un runner de pruebas con entorno de navegador.
   *
   * Se copia lo que el árbol busca en el ámbito global sin nombrarlo
   * —`document`, `HTMLElement`, `getComputedStyle`— y **no se pisa lo que Node
   * ya tenía**: su `console` y sus timers son de donde salen los mensajes de
   * este guarda.
   */
  for (const clave of copiadas) globalThis[clave] = w[clave];
  for (const clave of Object.getOwnPropertyNames(w)) {
    if (clave in globalThis) continue;
    try {
      globalThis[clave] = w[clave];
      copiadas.push(clave);
    } catch {
      // Alguna propiedad de jsdom es solo de lectura. Ninguna hace falta.
    }
  }

  /**
   * **Los constructores de eventos SÍ se pisan, y sin esto el guarda inventaba
   * fallos.** Node trae sus propios `Event` y `CustomEvent` globales, así que la
   * regla de arriba —no pisar lo de Node— los dejaba puestos; el
   * `dispatchEvent` de jsdom rechaza un evento que no es el suyo con
   * `parameter 1 is not of type 'Event'`, y jsdom lo reporta como excepción **de
   * la app**.
   *
   * No es hipotético: `@kobalte/core` construye un `CustomEvent` desde el ámbito
   * global cada vez que monta el foco atrapado de un popover, así que abrir el
   * menú de modelos ya dejaba **dos** de estos en `fallos`. No se veían porque
   * nada volvía a mirar `fallos` después del arranque. Cualquier comprobación
   * nueva que lo mire —abrir la columna de artefactos, por ejemplo— habría
   * fallado por esto y habría señalado al sitio equivocado.
   */
  for (const clave of ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "InputEvent"]) {
    globalThis[clave] = w[clave];
    if (!copiadas.includes(clave)) copiadas.push(clave);
  }

  // El chat pide getComputedStyle sobre su caja en el tick en que la crea,
  // antes de insertarla (chat/paste.ts, ponScrollTop): el nodo viene del
  // documento inerte de un template, sin raíz. Un navegador contesta vacío;
  // jsdom sube hasta la raíz para heredar, lanza sobre null desde un efecto
  // y se lleva el proceso entero. Aquí contesta vacío, como el navegador.
  const estiloDe = w.getComputedStyle.bind(w);
  w.getComputedStyle = (el, pseudo) =>
    el?.ownerDocument?.documentElement
      ? estiloDe(el, pseudo)
      : new Proxy({}, { get: (_, p) => (p === "getPropertyValue" ? () => "" : "") });
  globalThis.getComputedStyle = w.getComputedStyle;
  if (!copiadas.includes("getComputedStyle")) copiadas.push("getComputedStyle");

  /**
   * **Y el almacenamiento también, que es lo mismo un piso más abajo.** Node 26
   * trae `localStorage` y `sessionStorage` de serie, pero **inertes** salvo que
   * se arranque con `--localstorage-file`; la regla de no pisar lo de Node los
   * daba por buenos y el de jsdom no llegaba a copiarse. Lo que se veía era esto,
   * y señalaba a la app:
   *
   *     El front no monta. `App` no llegó a pintarse.
   *     al evaluar el módulo: TypeError: Cannot read properties of undefined (reading 'getItem')
   *
   * Con el rastro minificado y sin nombres de archivo, o sea la peor forma de un
   * rojo que no es de la app. En Node 22 el guarda pasa: la diferencia era la
   * versión de Node de quien lo corría, no el commit.
   */
  for (const clave of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, clave, { value: w[clave], configurable: true, writable: true });
    if (!copiadas.includes(clave)) copiadas.push(clave);
  }
  globalThis.window = w;
  globalThis.document = w.document;
  // Un `import()` con dependencias anuncia sus trozos con `<link rel=modulepreload>`
  // y Vite los baja con `fetch` contra la URL de la página, que aquí no sirve nada:
  // el ECONNREFUSED sin capturar tumba el proceso. El módulo ya llega del disco.
  if (!globalThis.fetch.__jsdomApp) {
    const deNode = globalThis.fetch;
    const local = (url, opts) =>
      String(url?.url ?? url).startsWith("http://localhost/")
        ? Promise.resolve(new Response(""))
        : deNode(url, opts);
    local.__jsdomApp = true;
    globalThis.fetch = local;
  }
  // CodeMirror mide el texto con rangos, y jsdom no los mide: lanza en cada cuadro.
  w.Range.prototype.getClientRects ??= () => [];
  w.Range.prototype.getBoundingClientRect ??= () => new w.DOMRect();
  // En Node `navigator` es de solo lectura, así que asignarla no basta.
  //
  // **Y se le pone la lengua de la máquina.** Desde que la app dejó de tener una
  // preferencia global, el sistema es lo único que gobierna cuando ningún
  // workspace declara la suya — que es el caso que monta este guarda. El
  // `navigator.language` de jsdom es `en-US`, así que sin esto el árbol monta en
  // inglés.
  //
  // **Se define sobre el objeto de jsdom, no sobre una copia.** `Object.create`
  // parecía lo limpio y no sirve: sus getters comprueban la marca del objeto, así
  // que el heredado revienta con «'get userAgent' called on an object that is not
  // a valid instance of Navigator» al primer render. Viven en el prototipo, así
  // que una propiedad propia los tapa sin tocar la identidad.
  Object.defineProperty(w.navigator, "language", { value: "es-MX", configurable: true });
  Object.defineProperty(w.navigator, "languages", { value: ["es-MX", "es"], configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true, writable: true });

  /**
   * **La lengua se fija antes de montar, y sin esto el guarda depende de la
   * máquina que lo corre.**
   *
   * Lo que se afirma más abajo son literales en español —`"Pregunta algo"`,
   * `title="Con qué modelo responde"`—, y desde que el chat lee del catálogo esa
   * frase la decide `lib/i18n.ts`: primero `localStorage`, y si no hay nada,
   * `navigator.language`. El de jsdom es `en-US`, así que el árbol montaba en
   * inglés y el guarda reportaba `placeholder="Ask something"` como si el campo
   * estuviera roto. Peor que un rojo falso es lo que sería el día que jsdom
   * cambie ese default: el mismo commit pasaría o no según quién lo corre, que
   * es justo el verde que nadie puso.
   *
   * Se pone antes del `import`: el módulo resuelve la lengua **al evaluarse**
   * (`createSignal(resolver(preferencia()))`), y ponerlo después no movería nada.
   *
   * Montar en otra lengua —y con un paquete incompleto, para ejercitar el
   * respaldo por clave— es una ampliación pendiente.
   */
  w.localStorage.setItem("harness:lengua", "es");

  // La query hace que Node vuelva a evaluar el módulo en la segunda pasada; sin
  // ella devuelve el de la caché y no monta nada sobre este documento nuevo.
  await import(`${pathToFileURL(join(dist, "assets", bundle)).href}?v=${version}`).catch((e) =>
    fallos.push(`al evaluar el módulo: ${e?.stack ?? e}`),
  );
  await espera(500);

  return { w, fallos, comandos, storageQueries, emit: (event, payload) => { for (const id of [...(events.get(event)?.values() ?? [])]) callbacks.get(id)?.({ event, payload }); }, pintado: w.document.querySelector("#root")?.innerHTML ?? "" };
}
