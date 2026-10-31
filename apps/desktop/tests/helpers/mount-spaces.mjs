/**
 * Los espacios en la ventana, montados en jsdom contra un servicio simulado
 * con estado: lo que el stub devuelve cambia con lo que la ventana le manda, y
 * cada respuesta sale clonada como del IPC. Lo llama el guarda `mount-spaces.mjs`.
 *
 * Con `TERMINUS_E2E_DIR` deja por escenario el HTML de #root y lo que la
 * ventana invocó, para mirarlo sin volver a correr.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROYECTOS = [
  { id: "pa", name: "Terminus App", kind: "folder", working_directory: "/lab/a", sources: [] },
  { id: "pb", name: "billing", kind: "folder", working_directory: "/lab/b", sources: [] },
  { id: "pc", name: "Finanzas", kind: "folder", working_directory: "/lab/c", sources: [] },
];

const rowEl = (id, folder, space, extra = {}) => ({
  id, folder, space, parent: null, title: `Tarea ${id}`, outcome: null, provider: "codex", model: null,
  refs: [], stage: null, esperando: false, updated_at: 1, created_at: 1, turns: 1, archived: false,
  chat_de_agente: false, ...extra,
});

/** Un servicio de espacios en memoria, con las reglas de `workspace/spaces.rs` que la ventana ve. */
function servicio({ spaces, filas, archivos = {}, kn = {}, trabajando = [], atencion: attention = [] }) {
  const s = { spaces, filas, archivos, kn, trabajando, lapidas: {}, llamadas: [], fallaUnaVez: new Set() };
  const liveQuestion = (id) => s.spaces.find((i) => i.id === id);
  const ref = (id) => (liveQuestion(id) ? { id, name: liveQuestion(id).name } : { id, name: s.lapidas[id] ?? null, deleted: true });
  const miembros = (id) => s.filas.filter((r) => r.space === id && !r.archived);
  const previa = (id) => ({
    space: ref(id),
    last: s.spaces.length === 1,
    tasks: miembros(id).map((r) => ({
      folder: r.folder, task: r.id, root: r.id, title: r.title,
      working: s.trabajando.includes(r.id),
      files: (s.archivos[r.id] ?? []).map((path) => ({ path, hash: `h-${path}` })),
      kn_pending: s.kn[r.id] ?? [],
    })),
  });
  const noVisto = (ahora, viewEl) => ahora.tasks.some((t) => {
    const v = viewEl.tasks.find((x) => x.folder === t.folder && x.task === t.task);
    if (!v) return true;
    return (t.working && !v.working)
      || t.files.some((f) => !v.files.some((x) => x.path === f.path && x.hash === f.hash))
      || t.kn_pending.some((p) => !v.kn_pending.includes(p));
  });
  const clon = (x) => structuredClone(x);
  const recordRejection = (cmd, fn) => (args) => {
    s.llamadas.push([cmd, clon(args ?? {})]);
    return fn(args ?? {});
  };
  s.respuestas = {
    list_projects: recordRejection("list_projects", () => clon(PROYECTOS)),
    // La barra pide las vivas y las archivadas que tiene abiertas en pestaña.
    list_live_sessions: recordRejection("list_live_sessions", ({ project, open }) =>
      clon(s.filas.filter((r) => r.folder === project && (!r.archived || (open ?? []).includes(r.id))))),
    list_spaces: recordRejection("list_spaces", () => clon(s.spaces)),
    list_workspace_attention: () => clon([{ workspace: "w", tasks: attention }]),
    create_space: recordRejection("create_space", ({ name, folders }) => {
      const i = { id: `i${s.spaces.length + 10}`, name, folders, created_at: 99, updated_at: 99 };
      s.spaces.push(i);
      return clon(i);
    }),
    rename_space: recordRejection("rename_space", ({ id, name }) => {
      liveQuestion(id).name = name;
      return clon(liveQuestion(id));
    }),
    set_space_folders: recordRejection("set_space_folders", ({ id, folders }) => {
      liveQuestion(id).folders = folders;
      return clon(liveQuestion(id));
    }),
    space_delete_preview: recordRejection("space_delete_preview", ({ id }) => clon(previa(id))),
    delete_space: recordRejection("delete_space", ({ id, seen }) => {
      const ahora = previa(id);
      if (noVisto(ahora, seen)) return { deleted: false, changed: clon(ahora), failures: [] };
      const failures = [];
      for (const r of miembros(id)) {
        if (s.fallaUnaVez.delete(r.id)) {
          failures.push({ folder: r.folder, task: r.id, error: { what: { clave: "history.error.busy" }, detail: "reservada" } });
          continue;
        }
        r.archived = true;
      }
      // La previa del servicio tras un fallo puede contar vivo un turno que ya se detuvo.
      if (failures.length > 0) {
        const vieja = previa(id);
        return { deleted: false, changed: clon({ ...vieja, tasks: vieja.tasks.map((t) => ({ ...t, working: true })) }), failures };
      }
      s.lapidas[id] = liveQuestion(id).name;
      s.spaces = s.spaces.filter((i) => i.id !== id);
      return { deleted: true, changed: null, failures: [] };
    }),
    move_task_to_space: recordRejection("move_task_to_space", ({ id, space }) => {
      s.filas.find((r) => r.id === id).space = space;
      return clon(ref(space));
    }),
    archived_tasks: recordRejection("archived_tasks", () => {
      const tasks = s.filas.filter((r) => r.archived);
      const ids = [...new Set(tasks.map((r) => r.space).filter(Boolean))];
      return clon({ tasks, spaces: ids.map(ref) });
    }),
    set_task_archived: recordRejection("set_task_archived", ({ id, archived, space }) => {
      const r = s.filas.find((x) => x.id === id);
      r.archived = archived;
      if (archived) return null;
      if (!liveQuestion(r.space)) r.space = space ?? s.spaces[0].id;
      return clon(ref(r.space));
    }),
    send_message: recordRejection("send_message", (args) => {
      if (args.session) return args.session;
      s.filas.push(rowEl("nueva", args.project || "pa", args.space ?? s.spaces[0].id, { title: "Nueva" }));
      return "nueva";
    }),
    create_project: recordRejection("create_project", () => clon(PROYECTOS[0])),
  };
  return s;
}

/** Siembra las preferencias antes de que la ventana las lea: el arranque las lee tras `workspaces_startup`. */
const sembrar = (prefs) => () => {
  for (const [k, v] of Object.entries(prefs)) globalThis.localStorage.setItem(`harness.layout.${k}`, JSON.stringify(v));
  return { workspaces: [{ id: "w", name: "Danil", context_root: null, lengua: "es" }], active: "w" };
};

const tira = (ids, activa) => ({ abiertas: ids.map((id) => ({ id, project: "pa", titulo: `Tarea ${id}` })), activa });

/** `boot` arranca con el riel agrupado por carpeta: el orden de las carpetas es lo que se mira. */
export async function spaceScenarios({ boot, sleep, withTask: WITH_TASK }) {
  const output = process.env.TERMINUS_E2E_DIR ? join(process.env.TERMINUS_E2E_DIR, "spaces") : null;
  if (output) mkdirSync(output, { recursive: true });
  const guarda = (nameText, app, s) => {
    if (!output) return;
    writeFileSync(join(output, `${nameText}.html`), app.w.document.querySelector("#root")?.innerHTML ?? "");
    writeFileSync(join(output, `${nameText}.json`), JSON.stringify({ llamadas: s.llamadas, prefs: { ...app.w.localStorage } }, null, 2));
  };
  const base = (s, prefs) => ({
    ...WITH_TASK,
    ...s.respuestas,
    // Cada espacio guarda su vista del riel; sin guardar, todas agrupan por carpeta, que es lo de omisión.
    workspaces_startup: sembrar({ ...prefs }),
    list_workspaces: () => ({ workspaces: [{ id: "w", name: "Danil", context_root: null, lengua: "es" }], active: "w" }),
    load_session: ({ id }) => ({ ...WITH_TASK.load_session, id }),
    task_history: WITH_TASK.task_history,
    save_queue: null,
  });
  const util = (app) => {
    const doc = app.w.document;
    const pressedKey = (el, key) => el.dispatchEvent(new app.w.KeyboardEvent("keydown", { key, bubbles: true }));
    return {
      doc,
      tecla: pressedKey,
      /** El disparador del menú de espacio en la franja; enseña el espacio elegido. */
      disparador: () => doc.querySelector("[data-title-bar] [data-space-menu]"),
      actual: () => doc.querySelector("[data-title-bar] [data-space-menu]")?.textContent.trim(),
      /** Abre el menú de espacio, si no lo está, y lo devuelve. */
      abrirEspacios: async () => {
        if (!doc.querySelector("[data-space-list]")) {
          doc.querySelector("[data-title-bar] [data-space-menu]").click();
          await sleep(120);
        }
        return doc.querySelector("[data-space-list]");
      },
      cerrarEspacios: async () => {
        const lista = doc.querySelector("[data-space-list]");
        if (!lista) return;
        pressedKey(lista, "Escape");
        await sleep(80);
      },
      /** Los espacios de la lista, con cuál es el elegido y la señal de cada uno. */
      espacios: async () => {
        const lista = await util(app).abrirEspacios();
        const filas = [...lista.querySelectorAll("[data-space]")].map((el) => ({
          id: el.dataset.space,
          nombre: el.textContent.trim(),
          elegido: el.getAttribute("aria-current") === "true",
          senal: el.querySelector("[data-attention-badge]")?.dataset.attentionBadge ?? null,
        }));
        await util(app).cerrarEspacios();
        return filas;
      },
      elegir: async (id) => {
        const lista = await util(app).abrirEspacios();
        lista.querySelector(`[data-space="${id}"]`).click();
      },
      /** Una entrada del menú de espacio por su texto: «Nuevo espacio», «Renombrar», «Eliminar…». */
      accion: async (textValue) => {
        const lista = await util(app).abrirEspacios();
        return [...lista.querySelectorAll("button:not([data-space])")].find((b) => b.textContent.trim() === textValue);
      },
      editorDeNombre: () => doc.querySelector('[data-title-bar] input[aria-label^="Nombre del espacio"]'),
      // Con el riel agrupado por carpeta: una cabecera por carpeta, tenga tareas o no.
      carpetasEnTareas: () =>
        [...doc.querySelectorAll("[data-folder-group]")].map((el) => el.dataset.folderGroup),
      pestanas: () => [...doc.querySelectorAll('[data-tira] [role="tab"]')].map((el) => el.textContent.trim()),
      pref: (k) => JSON.parse(app.w.localStorage.getItem(`harness.layout.${k}`) ?? "null"),
      caja: () =>
        [...doc.querySelectorAll("[data-ventana]")].find((el) => !el.classList.contains("hidden") && el.querySelector("textarea"))?.querySelector("textarea"),
      /** Elige un agente en «Filtrar y agrupar» de Personalizar; `null` es «Todos». */
      filtrarPorAgente: async (nameText) => {
        doc.querySelector("button[data-personalize]").click();
        await sleep(80);
        const groupEl = doc.querySelector('[role="menu"] [role="group"][aria-label="Agente"]');
        assert.ok(groupEl, "el menú de filtro ofrece agentes");
        // El nombre y no la nota de al lado («desinstalado»).
        [...groupEl.querySelectorAll('[role="menuitemradio"]')].find((b) => b.children[1].textContent.trim() === (nameText ?? "Todos")).click();
        await sleep(80);
        pressedKey(doc.activeElement ?? doc.body, "Escape");
        await sleep(80);
      },
      boton: (textValue) => [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === textValue),
    };
  };

  /**
   * Recién migrado: un espacio con todas las carpetas y la tira de antes.
   * Falla si la tira vieja se pierde, si se muda dos veces o si la barra y el
   * riel dejan de verse como hoy con una sola.
   */
  {
    const s = servicio({
      spaces: [{ id: "i1", name: null, folders: ["pa", "pb", "pc"], created_at: 1, updated_at: 1 }],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t2", "pb", "i1"), rowEl("t0", "pc", "i1", { archived: true })],
    });
    const app = await boot("listo", "spaces-migrated", base(s, { "pestanas.w": tira(["t1", "t2"], "t2") }));
    await sleep(400);
    const u = util(app);
    assert.equal(u.actual(), "Espacio 1", "la migrada se llama por el catálogo");
    assert.deepEqual(await u.espacios(), [{ id: "i1", nombre: "Espacio 1", elegido: true, senal: null }], "la elegida no lleva señal");
    assert.deepEqual(u.carpetasEnTareas(), ["pa", "pb", "pc"], "las carpetas del espacio, en el orden de hoy, también «pc», que solo tiene una archivada");
    assert.ok(u.doc.querySelector('[data-sidebar-group="pc"] [data-folder-empty]'), "«pc» se ve vacía");
    assert.equal(u.doc.querySelector("[data-main-folder]"), null, "ninguna carpeta es la principal");
    assert.deepEqual(u.pestanas(), ["Tarea t1", "Tarea t2"], "la tira de antes sigue abierta");
    assert.deepEqual(u.pref("pestanas.w")?.abiertas.map((p) => p.id), ["t1", "t2"], "la clave vieja se queda para un build anterior");
    assert.deepEqual(u.pref("pestanas.w.i1")?.abiertas.map((p) => p.id), ["t1", "t2"], "y la tira vive en la de la primera");
    assert.equal(s.llamadas.some(([c]) => c === "archived_tasks"), false, "Archivadas no se lee al arrancar");
    assert.equal(u.doc.querySelector("[data-archived-foot]"), null, "Archivadas ya no es un botón del pie");
    assert.equal(u.doc.querySelector("[data-archived-page]"), null, "ni una página");
    u.doc.querySelector("[data-title-bar] [data-global-search-open]").click();
    await sleep(300);
    assert.ok(u.doc.querySelector("[data-global-search]"), "la lupa de la franja abre el buscador");
    assert.equal(s.llamadas.filter(([c]) => c === "archived_tasks").length, 1, "Archivadas se lee al abrir el buscador");
    u.doc.querySelector('[data-search-chip="archived"]').click();
    await sleep(200);
    assert.ok(u.doc.querySelector('[data-search-key="archived:t0"]'), "la archivada sale con su chip");
    u.doc.querySelector('[data-search-chip="all"]').click();
    await sleep(100);
    const menu = await u.abrirEspacios();
    assert.ok(menu, "el disparador de la franja abre el menú del espacio");
    assert.deepEqual(
      [...menu.querySelectorAll("button:not([data-space])")].map((el) => el.textContent.trim()),
      ["Nuevo espacio", "Renombrar"],
      "con un solo espacio el menú crea y renombra, y no ofrece eliminar la última",
    );
    await u.cerrarEspacios();
    assert.equal(u.doc.querySelector("[data-delete-space]"), null);
    guarda("migrado", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  {
    const s = servicio({
      spaces: [
        { id: "i1", name: "Origen", folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Destino", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t2", "pb", "i2")],
    });
    const loaded = [];
    const app = await boot("listo", "task-links-across-spaces", {
      ...base(s, { "pestanas.w.i1": tira(["t1"], "t1"), "space.w": "i1" }),
      load_session: ({ id }) => {
        loaded.push(id);
        return { ...WITH_TASK.load_session, id, turns: [{ role: "assistant", text: id === "t1"
          ? "[Otra tarea](terminus://task?workspace=w&folder=pb&task=t2) [Otro workspace](terminus://task?workspace=ajeno&folder=pb&task=t2)"
          : "Destino abierto." }] };
      },
    });
    await sleep(350);
    const u = util(app);
    const link = (label) => [...u.doc.querySelectorAll('button[title="Abrir tarea"]')]
      .find((button) => button.textContent.trim() === label);
    assert.ok(link("Otra tarea"), "la respuesta del agente pinta el enlace como acción interna");
    const leidas = loaded.length;
    link("Otro workspace").click();
    await sleep(60);
    assert.equal(u.actual(), "Origen", "un enlace a otro workspace no navega");
    assert.equal(loaded.length, leidas, "otro workspace ni siquiera lee la tarea");
    assert.ok(!loaded.includes("t2"), "y la del destino sigue sin leerse");
    link("Otra tarea").click();
    await sleep(350);
    assert.equal(u.actual(), "Destino", "abrir la tarea cambia a su espacio");
    assert.deepEqual(u.pestanas(), [], "abrir por enlace no conserva una pestaña");
    assert.equal(u.doc.querySelector('[data-preview-header] [role="button"] .truncate')?.textContent, "Tarea t2", "la tarea se abre como vista temporal en su espacio");
    assert.equal(loaded.filter((id) => id === "t2").length, 2, "se comprueba que existe antes de abrirla");
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /**
   * Dos espacios con tareas cruzadas de carpeta. Falla si una tarea viva se
   * esconde, si la sin resolver desaparece de algún escritorio, si cambiar de
   * escritorio suelta lo de la otra tira o si una señal sale dos veces.
   */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [
        rowEl("t1", "pa", "i1", { agent: "ada" }), rowEl("t2", "pb", "i1"), rowEl("t3", "pb", "i2"), rowEl("t4", "pa", "i2"),
        rowEl("t5", "pc", null), rowEl("c1", "pa", null, { chat_de_agente: true, agent: "design" }),
      ],
      atencion: [{ session: "t3", project: "pb", state: "asked" }, { session: "t1", project: "pa", state: "failed" }],
    });
    const app = await boot("listo", "spaces-two", base(s, {
      "pestanas.w": tira(["t9"], "t9"),
      "pestanas.w.i1": tira(["t1"], "t1"),
      "pestanas.w.i2": tira(["t4", "t3"], "t3"),
      "space.w": "i1",
    }));
    await sleep(500);
    const u = util(app);
    assert.deepEqual(u.pref("pestanas.w")?.abiertas.map((p) => p.id), ["t9"], "una tira vieja que reaparece no se toca");
    assert.deepEqual(u.pref("pestanas.w.i1").abiertas.map((p) => p.id), ["t1"], "sin pisar la que ya había");
    assert.deepEqual(u.pestanas(), ["Tarea t1"]);
    const senales = async () => Object.fromEntries((await u.espacios()).map((e) => [e.id, e.senal]));
    // La señal de otro espacio se ve con el menú cerrado: el disparador lleva un punto.
    const puntoEnElDisparador = () => u.disparador().querySelector(".signal-dot[data-tone=\"warning\"]") !== null;
    assert.equal(puntoEnElDisparador(), true, "lo que espera en otro espacio se avisa en la franja");
    assert.deepEqual(await senales(), { i1: null, i2: "asked" }, "la otra lleva la señal de sus tareas");
    assert.deepEqual(u.carpetasEnTareas(), ["pa", "pb", "pc"], "la fijada y las que tienen tareas suyas o sin resolver");
    assert.equal(u.doc.querySelector("[data-main-folder]"), null, "ninguna carpeta es la principal");
    assert.ok(u.doc.querySelector('[data-sesion="t2"]'), "una tarea suya en una carpeta no fijada se ve");
    assert.ok(u.doc.querySelector('[data-sesion="t5"]'), "la que no se pudo resolver se ve");
    assert.equal(u.doc.querySelector('[data-sesion="t3"]'), null, "las de la otra no");
    u.caja().value = "borrador de t1";
    u.caja().dispatchEvent(new app.w.Event("input", { bubbles: true }));
    await sleep(50);
    await u.elegir("i2");
    await sleep(400);
    assert.equal(u.pref("space.w"), "i2", "el escritorio activo se recuerda por workspace");
    assert.equal(u.actual(), "Facturación");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3"], "cada escritorio tiene su tira");
    assert.deepEqual(u.carpetasEnTareas(), ["pb", "pa", "pc"], "la principal primero");
    assert.ok(u.doc.querySelector('[data-sesion="t5"]'), "la sin resolver también está aquí");
    assert.equal(u.doc.querySelector('[data-sesion="t1"]'), null);
    assert.deepEqual(await senales(), { i1: "failed", i2: null }, "la elegida pierde la señal");
    assert.ok(u.doc.querySelector('[data-sidebar-group="pb"] [data-sesion]'));
    // Volver a un escritorio monta solo la pestaña de delante, y en su celda: una
    // montada escondida gasta su lectura sin caja y reabre al final.
    const pestana = (titleText) => [...u.doc.querySelectorAll('[data-tira] [role="tab"]')].find((el) => el.textContent.trim() === titleText);
    pestana("Tarea t4").click();
    await sleep(300);
    pestana("Tarea t3").click();
    await sleep(300);
    await u.elegir("i1");
    await sleep(400);
    assert.deepEqual(u.pestanas(), ["Tarea t1"]);
    assert.equal(u.caja()?.value, "borrador de t1", "cambiar de escritorio no soltó lo de la otra tira");
    const hilosMontados = [];
    const ojo = new app.w.MutationObserver((registros) => {
      for (const r of registros) for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        const threads = [n, ...n.querySelectorAll('[data-chat-thread]')].filter((x) => x.matches('[data-chat-thread]'));
        hilosMontados.push(...threads);
      }
    });
    ojo.observe(u.doc.body, { childList: true, subtree: true });
    await u.elegir("i2");
    await sleep(400);
    ojo.disconnect();
    assert.equal(hilosMontados.length, 1, `volver a un escritorio monta solo la pestaña de delante (montó ${hilosMontados.length})`);
    assert.equal(u.doc.querySelector('[data-tira] [role="tab"][aria-selected="true"]')?.textContent.trim(), "Tarea t3");
    await u.elegir("i1");
    await sleep(400);

    // La vista del riel es de cada espacio: el filtro de uno no sale en el otro.
    await u.filtrarPorAgente("ada");
    assert.ok(u.doc.querySelector('[data-sesion="t1"]') && !u.doc.querySelector('[data-sesion="t2"]'), "el filtro por agente se aplica");
    await u.elegir("i2");
    await sleep(400);
    assert.ok(u.doc.querySelector('[data-sesion="t3"]') && u.doc.querySelector('[data-sesion="t4"]'), "otro espacio no hereda el filtro");
    // Agrupar por carpeta es lo de omisión: no cuenta como cambio, el agente sí.
    assert.equal(u.doc.querySelector("button[data-personalize]").getAttribute("aria-label"), "Personalizar");
    await u.elegir("i1");
    await sleep(400);
    assert.ok(u.doc.querySelector('[data-sesion="t1"]') && !u.doc.querySelector('[data-sesion="t2"]'), "volver al espacio recupera su filtro");
    assert.equal(u.doc.querySelector("button[data-personalize] span"), null);
    assert.equal(u.pref("sidebar.view.w.i1").agent, "ada");
    assert.equal(u.pref("sidebar.view.w.i2")?.agent ?? null, null);
    await u.filtrarPorAgente(null);
    assert.ok(u.doc.querySelector('[data-sesion="t2"]'));
    guarda("two-spaces", app, s);

    // Mover: solo a las otras, y la pestaña se va con la tarea.
    u.doc.querySelector('[data-sesion="t1"] button[aria-label="Acciones de la tarea «Tarea t1»"]').click();
    await sleep(100);
    u.doc.querySelector('[data-move-space="t1"]').click();
    await sleep(100);
    const destinos = [...u.doc.querySelectorAll('[role="menu"][aria-label="Mover a otro espacio"] [role="menuitem"]')];
    assert.deepEqual(destinos.map((b) => b.textContent.trim()), ["Facturación"], "solo lista las otras");
    destinos[0].click();
    await sleep(400);
    assert.deepEqual(s.llamadas.filter(([c]) => c === "move_task_to_space").map(([, a]) => a.space), ["i2"]);
    assert.equal(u.doc.querySelector('[data-sesion="t1"]'), null, "sale del riel de aquí");
    assert.deepEqual(u.pestanas(), [], "y su pestaña de esta tira");
    assert.deepEqual(u.pref("pestanas.w.i2").abiertas.map((p) => p.id), ["t4", "t3", "t1"], "a la tira de su escritorio");
    assert.match(u.doc.querySelector("[data-space-toast]")?.textContent ?? "", /Movida a Facturación/);
    u.boton("Ir").click();
    await sleep(400);
    assert.equal(u.pref("space.w"), "i2", "«Ir» va a su escritorio");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3", "Tarea t1"]);

    // Nueva tarea manda el escritorio delante.
    u.doc.querySelector('button[aria-label="Nueva tarea"]').click();
    await sleep(150);
    u.caja().value = "Timbrar facturas";
    u.caja().dispatchEvent(new app.w.Event("input", { bubbles: true }));
    u.caja().closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(300);
    const enviada = s.llamadas.find(([c]) => c === "send_message")?.[1];
    assert.equal(enviada?.space, "i2", "la tarea nueva nace en el escritorio activo");

    // Lo encolado lleva el escritorio de cuando se escribió, no el de cuando sale.
    app.emit("chat", { kind: "started", session: "nueva", workspace: "w" });
    await sleep(100);
    u.caja().value = "Y el complemento de pago";
    u.caja().dispatchEvent(new app.w.Event("input", { bubbles: true }));
    u.caja().closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(150);
    assert.equal(s.llamadas.filter(([c]) => c === "send_message").length, 1, "con el turno vivo se encola");
    await u.elegir("i1");
    await sleep(300);
    app.emit("chat", { kind: "done", session: "nueva", workspace: "w", ok: true });
    await sleep(800);
    const segunda = s.llamadas.filter(([c]) => c === "send_message")[1]?.[1];
    assert.equal(segunda?.session, "nueva", "la cola sale al cerrar el turno aunque se mire otro escritorio");
    assert.equal(segunda?.space, "i2", "y sale con el escritorio de cuando se escribió");
    await u.elegir("i2");
    await sleep(300);

    guarda("mover-y-abrir", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /**
   * El reparto de ventanas de un espacio, con una sola ventana. Un reparto
   * guardado de cuando había rejilla se junta en ella al volver, y lo que se
   * cambia aquí se guarda. Falla si volver a un espacio pierde pestañas de la
   * otra ventana, si el frente no es el de la que mandaba, si el reparto de uno
   * pisa el de otro o si el atajo de partir abre otra ventana.
   */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t4", "pb", "i2"), rowEl("t3", "pb", "i2")],
    });
    const partido = {
      columnas: [[{ pestanas: ["t4"], activa: "t4" }], [{ pestanas: ["t3"], activa: "t3" }]],
      anchos: [0.5, 0.5],
      altos: [1],
      activo: { col: 1, fila: 0 },
    };
    const app = await boot("listo", "spaces-reparto", base(s, {
      "pestanas.w.i1": tira(["t1"], "t1"),
      "pestanas.w.i2": tira(["t4", "t3"], "t3"),
      "panels.w.i2": partido,
      "space.w": "i2",
    }));
    await sleep(500);
    const u = util(app);
    const ventanas = () => u.doc.querySelectorAll("[data-tira]").length;
    const delante = () => u.doc.querySelector('[data-tira] [role="tab"][aria-selected="true"]')?.textContent.trim();
    const cargadas = () => u.doc.querySelectorAll("[data-chat-thread]").length;
    const partir = () => app.w.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    // Arranca en i2 con el reparto de dos columnas: vuelve junto en una ventana.
    assert.equal(ventanas(), 1, "un reparto guardado de dos ventanas abrió dos");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3"], "se perdió una pestaña de la otra ventana");
    assert.equal(delante(), "Tarea t3", "delante va la de la ventana que mandaba");
    assert.equal(cargadas(), 1, "solo se monta la de delante");
    assert.deepEqual(
      u.pref("panels.w.i2")?.columnas,
      [[{ pestanas: ["t4", "t3"], activa: "t3" }]],
      "el reparto junto se guarda en lugar del de rejilla",
    );
    // A i1: su tira. Y volver no pierde la de i2.
    await u.elegir("i1");
    await sleep(400);
    assert.equal(ventanas(), 1);
    assert.deepEqual(u.pestanas(), ["Tarea t1"]);
    assert.deepEqual(u.pref("panels.w.i2")?.columnas, [[{ pestanas: ["t4", "t3"], activa: "t3" }]], "el reparto de i1 pisó el de i2");
    await u.elegir("i2");
    await sleep(400);
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3"]);
    assert.equal(delante(), "Tarea t3");
    guarda("layout-returns", app, s);

    // Un cambio hecho aquí —otra pestaña delante— se guarda y vuelve.
    [...u.doc.querySelectorAll('[data-tira] [role="tab"]')].find((el) => el.textContent.trim() === "Tarea t4").click();
    await sleep(300);
    assert.equal(delante(), "Tarea t4");
    await u.elegir("i1");
    await sleep(300);
    await u.elegir("i2");
    await sleep(400);
    assert.equal(delante(), "Tarea t4", "el frente elegido no volvió al cambiar de espacio");
    partir();
    await sleep(200);
    assert.equal(ventanas(), 1, "el atajo de partir abrió otra ventana");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3"], "y movió pestañas");
    guarda("layout-changed", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /**
   * Lo abierto con un clic en el riel es temporal y también es del reparto.
   * Falla si al ir y volver de espacio la ventana vuelve sin ella o si
   * vuelve conservada. El reparto guardado es de rejilla y se junta.
   */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t4", "pb", "i2"), rowEl("t3", "pb", "i2"), rowEl("t5", "pb", "i2")],
    });
    const app = await boot("listo", "spaces-reparto-temporal", base(s, {
      "pestanas.w.i1": tira(["t1"], "t1"),
      "pestanas.w.i2": tira(["t4", "t3"], "t3"),
      "panels.w.i2": {
        columnas: [[{ pestanas: ["t4"], activa: "t4" }], [{ pestanas: ["t3"], activa: "t3" }]],
        anchos: [0.5, 0.5],
        altos: [1],
        activo: { col: 1, fila: 0 },
      },
      "space.w": "i2",
    }));
    await sleep(500);
    const u = util(app);
    const tiraDe = (v) => u.doc.querySelector(`[data-tira][data-ventana="${v}"]`);
    const temporal = (v, titleText) =>
      [...(tiraDe(v)?.querySelectorAll('[role="tab"]') ?? [])].find((el) => el.textContent.includes(titleText))?.closest(".italic") !== null;
    const idaYVuelta = async () => {
      await u.elegir("i1");
      await sleep(400);
      await u.elegir("i2");
      await sleep(400);
    };
    u.doc.querySelector('[data-sesion="t5"]').click();
    await sleep(300);
    assert.match(tiraDe("0,0")?.textContent ?? "", /Tarea t5/, "el clic abre la temporal en la ventana");
    assert.ok(temporal("0,0", "Tarea t5"), "abierta con un clic es temporal");
    await idaYVuelta();
    assert.equal(u.doc.querySelectorAll("[data-tira]").length, 1);
    assert.match(tiraDe("0,0")?.textContent ?? "", /Tarea t5/, "la temporal no volvió a su ventana");
    assert.ok(temporal("0,0", "Tarea t5"), "la temporal volvió conservada");
    assert.deepEqual(u.pref("panels.w.i2").columnas, [[{ pestanas: ["t4", "t3", "t5"], activa: "t5" }]]);
    guarda("layout-temporary", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /**
   * Borrar con lo que cambia mientras se mira. Falla si se manda algo que no
   * se vio, si el aviso de cambios no se enseña o no recibe el foco, si un
   * fallo sale fuera del diálogo o si la tira borrada sigue guardada.
   */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb", "pc"], created_at: 2, updated_at: 2 },
        { id: "i3", name: "Móvil", folders: ["pc"], created_at: 3, updated_at: 3 },
      ],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t3", "pb", "i2"), rowEl("t6", "pb", "i2"), rowEl("t7", "pc", "i2")],
      archivos: { t6: ["src/cobro.rs", "nuevo.txt"] },
      kn: { t7: ["notas/septiembre.md"] },
      trabajando: ["t3"],
    });
    const app = await boot("listo", "spaces-delete", base(s, {
      "pestanas.w.i2": tira(["t3"], "t3"),
      "space.w": "i2",
    }));
    await sleep(500);
    const u = util(app);
    (await u.accion("Eliminar…")).click();
    await sleep(400);
    const dialog = () => u.doc.querySelector("[data-delete-space]");
    assert.equal(dialog()?.getAttribute("role"), "alertdialog");
    assert.equal(u.doc.activeElement?.textContent.trim(), "Cancelar", "el foco empieza en Cancelar");
    const secciones = () => [...dialog().querySelectorAll("[data-delete-section]")].map((el) => [el.dataset.deleteSection, [...el.querySelectorAll("[data-delete-row]")].map((r) => r.dataset.deleteRow)]);
    assert.deepEqual(secciones(), [["working", ["t3"]], ["uncommitted", ["t6"]], ["unsaved", ["t7"]]]);
    const confirmar = () => [...dialog().querySelectorAll("button")].at(-1);
    assert.equal(confirmar().textContent.trim(), "Descartar cambios y eliminar", "con cambios sin commitear, el botón lo dice");
    guarda("borrar-con-cambios", app, s);

    s.archivos.t7 = ["informe.pdf"];
    confirmar().click();
    await sleep(300);
    const firstOne = s.llamadas.filter(([c]) => c === "delete_space")[0][1];
    assert.deepEqual(firstOne.seen.tasks.map((t) => [t.task, t.files.length]), [["t3", 0], ["t6", 2], ["t7", 0]], "se manda lo que se vio");
    assert.equal(firstOne.seen.discard, true);
    const aviso = dialog().querySelector("[data-delete-notice]");
    assert.match(aviso?.textContent ?? "", /Hay cambios nuevos desde que abriste esto/);
    assert.equal(u.doc.activeElement, aviso, "el foco va al aviso");
    assert.equal(dialog().querySelector('[data-delete-row="t7"] [data-delete-mark]')?.textContent.trim(), "cambió");
    assert.equal(dialog().querySelector('[data-delete-row="t6"] [data-delete-mark]'), null, "lo ya visto no se marca");
    assert.ok(s.spaces.some((i) => i.id === "i2"), "nada se borró");
    guarda("borrar-cambios-nuevos", app, s);

    s.fallaUnaVez.add("t6");
    confirmar().click();
    await sleep(300);
    const failures = dialog()?.querySelector("[data-delete-failures]");
    assert.match(failures?.textContent ?? "", /Hay un turno o una operación en curso/, "el fallo se lee dentro del diálogo");
    assert.equal(dialog().querySelector('[data-delete-section="working"]'), null, "tras un fallo se pinta la previa de ahora, no la que volvió");
    assert.equal(u.doc.querySelector('[data-sesion="t3"]'), null, "lo ya archivado sale del riel con el diálogo abierto");
    assert.equal(u.doc.querySelector("[data-space-toast]"), null);
    confirmar().click();
    await sleep(500);
    assert.equal(dialog(), null, "repetir continúa y termina");
    assert.deepEqual((await u.espacios()).map((e) => e.id), ["i1", "i3"], "sale del menú");
    assert.equal(u.pref("space.w"), "i1", "el escritorio pasa a la que queda");
    assert.equal(u.pref("pestanas.w.i2"), null, "y su tira se olvida");
    assert.equal(u.doc.querySelector('button[aria-label="Proyecto"]')?.textContent.trim(), "Terminus App", "la caja vacía elige la primera carpeta visible");
    assert.match(u.doc.querySelector("[data-space-toast]")?.textContent ?? "", /«Facturación» eliminado · 3 tareas archivadas/);

    // El aviso abre el buscador en Archivadas: con su espacio eliminado, la
    // fila se lee pero no se desarchiva; una archivada se retoma en una sesión nueva.
    u.boton("Ver en Archivadas").click();
    await sleep(400);
    assert.equal(u.doc.querySelector('[data-search-chip="archived"]')?.getAttribute("aria-pressed"), "true", "el aviso abre el chip de Archivadas");
    const fila7 = u.doc.querySelector('[data-search-key="archived:t7"]');
    assert.ok(fila7?.querySelector("[data-deleted-space]"), "la fila dice que su espacio se eliminó");
    assert.match(fila7.textContent, /Facturación/);
    assert.doesNotMatch(fila7.textContent, /Desarchivar/, "Archivadas no ofrece desarchivar");
    guarda("archivadas", app, s);
    assert.equal(s.llamadas.some(([c, a]) => c === "set_task_archived" && a?.archived === false), false, "nadie desarchiva");
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  {
    const legacy = [
      rowEl("old-chat", "pa", null, { chat_de_agente: true }),
      rowEl("old-thread", "pa", null, { chat_de_agente: true, agent_thread: true }),
      rowEl("old-inbox", "pa", null, { chat_de_agente: true, agent_thread: true, inbox: true }),
    ].map((row) => ({ ...row, archived: true, pinned: false, agent: "design" }));
    const s = servicio({
      spaces: [{ id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 }],
      filas: legacy,
    });
    const opened = [];
    const app = await boot("listo", "spaces-archived-agent-history", {
      ...base(s, { "space.w": "i1" }),
      load_session: ({ id }) => {
        opened.push(id);
        return { ...WITH_TASK.load_session, id };
      },
    });
    await sleep(400);
    const u = util(app);
    u.doc.querySelector("[data-global-search-open]").click();
    await sleep(300);
    u.doc.querySelector('[data-search-chip="archived"]').click();
    await sleep(200);
    for (const row of legacy) {
      assert.ok(u.doc.querySelector(`[data-search-key="archived:${row.id}"]`), "el historial antiguo archivado sigue accesible");
    }
    u.doc.querySelector('[data-search-key="archived:old-inbox"]').click();
    await sleep(300);
    assert.equal(u.doc.querySelector("[data-global-search]"), null, "elegir una archivada cierra el buscador");
    assert.ok(opened.includes("old-inbox"), "la bandeja archivada abre su conversación original");
    assert.equal(s.llamadas.some(([command, args]) => command === "set_task_archived" && args.archived === false), false);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /** Falla si un chat anterior en reposo deja a la persona sin caja y sin salida hacia su agente. */
  {
    const s = servicio({
      spaces: [{ id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 }],
      filas: [rowEl("old-chat", "pa", "i1", { chat_de_agente: true, agent: "design", title: "Design" })],
    });
    const app = await boot("listo", "spaces-previous-agent-chat", base(s, {
      "space.w": "i1",
      "pestanas.w.i1": tira(["old-chat"], "old-chat"),
    }));
    await sleep(500);
    const u = util(app);
    const titleBar = u.doc.querySelector("[data-previous-agent-chat]");
    assert.ok(titleBar, "el chat anterior pinta la barra donde iría la caja");
    assert.match(titleBar.textContent, /chat anterior de design/);
    assert.equal(u.caja(), undefined, "y no la caja");
    const seguir = [...titleBar.querySelectorAll("button")].find((b) => b.textContent.trim() === "Seguir con design");
    assert.ok(seguir, "ofrece seguir con su agente");
    seguir.click();
    await sleep(300);
    assert.equal(u.doc.querySelector("[data-previous-agent-chat]"), null, "seguir sale del chat anterior");
    assert.ok(u.caja(), "y deja una caja para escribirle");
    assert.equal(s.llamadas.some(([c]) => c === "send_message"), false, "sin mandar nada por su cuenta");
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /** Sin cambios sin guardar el botón dice cuántas se archivan. */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Landing", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t3", "pb", "i2"), rowEl("t4", "pb", "i2")],
    });
    const app = await boot("listo", "spaces-delete-clean", base(s, { "space.w": "i2" }));
    await sleep(500);
    const u = util(app);
    (await u.accion("Eliminar…")).click();
    await sleep(400);
    const botones = [...u.doc.querySelectorAll("[data-delete-space] button")];
    assert.equal(botones.at(-1).textContent.trim(), "Eliminar y archivar 2 tareas");
    assert.equal(u.doc.querySelector("[data-delete-section]"), null, "sin nada que avisar no hay secciones");
    guarda("borrar-normal", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /** El doble clic sobre el nombre de la franja lo renombra en su lugar, como el nombre de una tarea. */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t3", "pb", "i2")],
    });
    const app = await boot("listo", "spaces-rename", base(s, { "space.w": "i2" }));
    await sleep(500);
    const u = util(app);
    u.disparador().dispatchEvent(new app.w.MouseEvent("dblclick", { bubbles: true }));
    await sleep(50);
    const composer = u.editorDeNombre();
    assert.ok(composer, "el doble clic abre el nombre de la franja para escribir");
    assert.equal(u.disparador(), null, "en el lugar del disparador");
    assert.equal(composer.value, "Facturación", "con el nombre de hoy");
    composer.value = "Cobros";
    composer.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    composer.setSelectionRange(1, 3);
    app.emit("cli-changed", { workspace: "w", command: "task.send" });
    await sleep(350);
    assert.equal(u.editorDeNombre(), composer, "un refresco del CLI conserva el editor del espacio");
    assert.equal(u.doc.activeElement, composer);
    assert.equal(composer.value, "Cobros");
    assert.equal(composer.selectionStart, 1);
    assert.equal(composer.selectionEnd, 3);
    assert.equal(s.llamadas.filter(([c]) => c === "rename_space").length, 0);
    u.tecla(composer, "Enter");
    await sleep(300);
    assert.deepEqual(
      s.llamadas.filter(([c]) => c === "rename_space").map(([, a]) => a),
      [{ id: "i2", name: "Cobros" }],
    );
    assert.equal(u.editorDeNombre(), null, "Enter cierra el campo");
    assert.equal(u.actual(), "Cobros", "la franja se lee con el nombre nuevo");
    (await u.accion("Renombrar")).click();
    await sleep(300);
    const otra = u.editorDeNombre();
    assert.ok(otra, "Renombrar del menú abre el mismo campo");
    assert.equal(otra.value, "Cobros");
    assert.equal(u.doc.activeElement, otra, "y cerrar el menú no le quita el foco");
    u.tecla(otra, "Escape");
    await sleep(50);
    assert.equal(u.actual(), "Cobros", "Escape deja el nombre como estaba");
    assert.equal(s.llamadas.filter(([c]) => c === "rename_space").length, 1, "Escape no renombra");
    guarda("renombrar", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /**
   * A folder belongs to the spaces that add it. Fails if one space's rail
   * shows another's folders, or if removing it from one deletes it from the
   * workspace and it leaves the others too.
   */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa", "pc"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb", "pc"], created_at: 2, updated_at: 2 },
      ],
      // Cada carpeta lleva una tarea suya.
      filas: [rowEl("t1", "pa", "i1"), rowEl("t2", "pc", "i1"), rowEl("t3", "pb", "i2"), rowEl("t4", "pc", "i2")],
    });
    const app = await boot("listo", "spaces-folders", base(s, { "space.w": "i1" }));
    await sleep(500);
    const u = util(app);
    assert.deepEqual(u.carpetasEnTareas(), ["pa", "pc"], "the rail shows only this space's folders");
    u.doc.querySelector('button[aria-label="Acciones del proyecto «Finanzas»"]').click();
    await sleep(150);
    assert.equal(u.boton("Borrar el proyecto"), undefined, "a space does not delete the folder for everyone");
    u.boton("Quitar de este espacio").click();
    await sleep(300);
    assert.deepEqual(
      s.llamadas.filter(([c]) => c === "set_space_folders").map(([, a]) => a),
      [{ id: "i1", folders: ["pa"] }],
    );
    assert.equal(s.llamadas.some(([c]) => c === "delete_project"), false, "removing it does not delete the project");
    // El riel lista tareas, no carpetas: la tarea de «pc» que es de este espacio sigue a la vista.
    assert.ok(u.doc.querySelector('[data-sesion="t2"]'), "its task stays in this space's rail");
    await u.elegir("i2");
    await sleep(400);
    assert.deepEqual(u.carpetasEnTareas(), ["pb", "pc"], "and stays in the other one");
    guarda("carpetas-por-espacio", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }

  /**
   * The restored tab while the active-turn read is slow. Fails if it opens
   * empty until that read returns, or if the late startup open takes the
   * window back from the tab the person picked meanwhile.
   */
  {
    const s = servicio({
      spaces: [{ id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 }],
      filas: [rowEl("t1", "pa", "i1"), rowEl("t2", "pa", "i1")],
    });
    const retenidas = [];
    const app = await boot("listo", "spaces-slow-reconcile", {
      ...base(s, { "pestanas.w.i1": tira(["t1", "t2"], "t1"), "space.w": "i1" }),
      load_session: ({ id }) => ({ ...WITH_TASK.load_session, id, turns: [{ role: "assistant", text: `Respuesta de ${id}` }] }),
      list_active_turns: () => new Promise((resolve) => retenidas.push(resolve)),
    });
    await sleep(300);
    const u = util(app);
    const activa = () => u.doc.querySelector('[data-tira] [role="tab"][aria-selected="true"]')?.textContent.trim();
    assert.ok(retenidas.length > 0, "the active-turn read is still pending");
    assert.equal(activa(), "Tarea t1");
    assert.match(u.doc.body.textContent, /Respuesta de t1/, "the restored tab does not wait for the active-turn read");
    [...u.doc.querySelectorAll('[data-tira] [role="tab"]')].find((el) => el.textContent.trim() === "Tarea t2").click();
    await sleep(300);
    assert.equal(activa(), "Tarea t2");
    for (const soltar of retenidas.splice(0)) soltar([]);
    await sleep(300);
    assert.equal(activa(), "Tarea t2", "the late startup open does not take the window back");
    guarda("reconciliacion-lenta", app, s);
    assert.deepEqual(app.failures, []);
    app.w.close();
  }
}
