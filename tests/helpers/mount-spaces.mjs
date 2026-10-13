/**
 * Los espacios en la ventana, montados en jsdom contra un servicio simulado
 * con estado: lo que el stub devuelve cambia con lo que la ventana le manda, y
 * cada respuesta sale clonada como del IPC. Lo llama `mount-frontend.mjs`.
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

const fila = (id, folder, space, extra = {}) => ({
  id, folder, space, parent: null, title: `Tarea ${id}`, outcome: null, agent: "codex", model: null,
  refs: [], stage: null, esperando: false, updated_at: 1, created_at: 1, turns: 1, archived: false,
  chat_de_agente: false, ...extra,
});

/** Un servicio de espacios en memoria, con las reglas de `workspace/spaces.rs` que la ventana ve. */
function servicio({ spaces, filas, archivos = {}, kn = {}, trabajando = [], atencion = [] }) {
  const s = { spaces, filas, archivos, kn, trabajando, lapidas: {}, llamadas: [], fallaUnaVez: new Set() };
  const viva = (id) => s.spaces.find((i) => i.id === id);
  const ref = (id) => (viva(id) ? { id, name: viva(id).name } : { id, name: s.lapidas[id] ?? null, deleted: true });
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
  const noVisto = (ahora, vista) => ahora.tasks.some((t) => {
    const v = vista.tasks.find((x) => x.folder === t.folder && x.task === t.task);
    if (!v) return true;
    return (t.working && !v.working)
      || t.files.some((f) => !v.files.some((x) => x.path === f.path && x.hash === f.hash))
      || t.kn_pending.some((p) => !v.kn_pending.includes(p));
  });
  const clon = (x) => structuredClone(x);
  const anota = (cmd, fn) => (args) => {
    s.llamadas.push([cmd, clon(args ?? {})]);
    return fn(args ?? {});
  };
  s.respuestas = {
    list_projects: anota("list_projects", () => clon(PROYECTOS)),
    // La barra pide las vivas y las archivadas que tiene abiertas en pestaña.
    list_live_sessions: anota("list_live_sessions", ({ project, open }) =>
      clon(s.filas.filter((r) => r.folder === project && (!r.archived || (open ?? []).includes(r.id))))),
    list_spaces: anota("list_spaces", () => clon(s.spaces)),
    list_workspace_attention: () => clon([{ workspace: "w", tasks: atencion }]),
    create_space: anota("create_space", ({ name, folders }) => {
      const i = { id: `i${s.spaces.length + 10}`, name, folders, created_at: 99, updated_at: 99 };
      s.spaces.push(i);
      return clon(i);
    }),
    rename_space: anota("rename_space", ({ id, name }) => {
      viva(id).name = name;
      return clon(viva(id));
    }),
    set_space_folders: anota("set_space_folders", ({ id, folders }) => {
      viva(id).folders = folders;
      return clon(viva(id));
    }),
    space_delete_preview: anota("space_delete_preview", ({ id }) => clon(previa(id))),
    delete_space: anota("delete_space", ({ id, seen }) => {
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
      s.lapidas[id] = viva(id).name;
      s.spaces = s.spaces.filter((i) => i.id !== id);
      return { deleted: true, changed: null, failures: [] };
    }),
    move_task_to_space: anota("move_task_to_space", ({ id, space }) => {
      s.filas.find((r) => r.id === id).space = space;
      return clon(ref(space));
    }),
    archived_tasks: anota("archived_tasks", () => {
      const tasks = s.filas.filter((r) => r.archived);
      const ids = [...new Set(tasks.map((r) => r.space).filter(Boolean))];
      return clon({ tasks, spaces: ids.map(ref) });
    }),
    set_task_archived: anota("set_task_archived", ({ id, archived, space }) => {
      const r = s.filas.find((x) => x.id === id);
      r.archived = archived;
      if (archived) return null;
      if (!viva(r.space)) r.space = space ?? s.spaces[0].id;
      return clon(ref(r.space));
    }),
    send_message: anota("send_message", (args) => {
      if (args.session) return args.session;
      s.filas.push(fila("nueva", args.project || "pa", args.space ?? s.spaces[0].id, { title: "Nueva" }));
      return "nueva";
    }),
    create_project: anota("create_project", () => clon(PROYECTOS[0])),
  };
  return s;
}

/** Siembra las preferencias antes de que la ventana las lea: el arranque las lee tras `workspaces_startup`. */
const sembrar = (prefs) => () => {
  for (const [k, v] of Object.entries(prefs)) globalThis.localStorage.setItem(`harness.layout.${k}`, JSON.stringify(v));
  return { workspaces: [{ id: "w", name: "Danil", context_root: null, lengua: "es" }], active: "w" };
};

const tira = (ids, activa) => ({ abiertas: ids.map((id) => ({ id, project: "pa", titulo: `Tarea ${id}` })), activa });

export async function spaceScenarios({ arrancar, espera, CON_TAREA }) {
  const salida = process.env.TERMINUS_E2E_DIR ? join(process.env.TERMINUS_E2E_DIR, "spaces") : null;
  if (salida) mkdirSync(salida, { recursive: true });
  const guarda = (nombre, app, s) => {
    if (!salida) return;
    writeFileSync(join(salida, `${nombre}.html`), app.w.document.querySelector("#root")?.innerHTML ?? "");
    writeFileSync(join(salida, `${nombre}.json`), JSON.stringify({ llamadas: s.llamadas, prefs: { ...app.w.localStorage } }, null, 2));
  };
  const base = (s, prefs) => ({
    ...CON_TAREA,
    ...s.respuestas,
    workspaces_startup: sembrar(prefs),
    list_workspaces: () => ({ workspaces: [{ id: "w", name: "Danil", context_root: null, lengua: "es" }], active: "w" }),
    load_session: ({ id }) => ({ ...CON_TAREA.load_session, id }),
    task_history: CON_TAREA.task_history,
    save_queue: null,
  });
  const util = (app) => {
    const doc = app.w.document;
    const tecla = (el, key) => el.dispatchEvent(new app.w.KeyboardEvent("keydown", { key, bubbles: true }));
    return {
      doc,
      tecla,
      pildoras: () => [...doc.querySelectorAll("[data-space-pill]")],
      pildora: (id) => doc.querySelector(`[data-space-pill="${id}"]`),
      carpetasEnTareas: () =>
        [...doc.querySelectorAll("[data-folder-row]")].filter((el) => !el.hidden).map((el) => el.dataset.folderRow),
      pestanas: () => [...doc.querySelectorAll('[data-tira] [role="tab"]')].map((el) => el.textContent.trim()),
      pref: (k) => JSON.parse(app.w.localStorage.getItem(`harness.layout.${k}`) ?? "null"),
      caja: () =>
        [...doc.querySelectorAll("[data-ventana]")].find((el) => !el.classList.contains("hidden") && el.querySelector("textarea"))?.querySelector("textarea"),
      boton: (texto) => [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === texto),
      abrirMenu: async (id) => {
        tecla(doc.querySelector(`[data-space-actions="${id}"]`), "ArrowDown");
        await espera(120);
        return doc.querySelector(`[data-space-menu="${id}"]`);
      },
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
      filas: [fila("t1", "pa", "i1"), fila("t2", "pb", "i1"), fila("t0", "pc", "i1", { archived: true })],
    });
    const app = await arrancar("listo", "spaces-migrated", base(s, { "pestanas.w": tira(["t1", "t2"], "t2") }));
    await espera(400);
    const u = util(app);
    assert.deepEqual(u.pildoras().map((p) => p.textContent.trim()), ["Espacio 1"], "la migrada se llama por el catálogo");
    assert.equal(u.pildora("i1").dataset.selected, "true");
    assert.equal(u.pildora("i1").querySelector("[data-attention-badge]"), null, "la elegida no lleva señal");
    assert.ok(u.doc.querySelector("[data-new-space]"), "el «+» sigue a las píldoras");
    assert.deepEqual(u.carpetasEnTareas(), ["pa", "pb", "pc"], "las carpetas en el orden de hoy");
    assert.equal(u.doc.querySelector("[data-main-folder]"), null, "ninguna carpeta es la principal");
    assert.deepEqual(u.pestanas(), ["Tarea t1", "Tarea t2"], "la tira de antes sigue abierta");
    assert.deepEqual(u.pref("pestanas.w")?.abiertas.map((p) => p.id), ["t1", "t2"], "la clave vieja se queda para un build anterior");
    assert.deepEqual(u.pref("pestanas.w.i1")?.abiertas.map((p) => p.id), ["t1", "t2"], "y la tira vive en la de la primera");
    assert.equal(s.llamadas.some(([c]) => c === "archived_tasks"), false, "Archivadas no se lee al arrancar");
    // Sin cabecera en el `aside`, el pie cae en la fila que se estira y sus
    // botones se mueven con la lista.
    const riel = u.doc.querySelector("[data-archived-foot]")?.closest("aside");
    assert.ok(riel, "Archivadas vive en el riel");
    const pie = riel.lastElementChild;
    assert.ok(pie?.contains(u.doc.querySelector("[data-archived-foot]")), "Archivadas es un botón del pie, que es la última fila del riel");
    assert.deepEqual(
      [...pie.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
      ["Archivadas", "Herramientas MCP", "Configuración"],
      "Archivadas va antes que MCP y que Configuración",
    );
    const menu = await u.abrirMenu("i1");
    assert.ok(menu, "el ⋯ abre el menú del espacio");
    const eliminar = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === "Eliminar…");
    assert.equal(eliminar?.getAttribute("aria-disabled"), "true", "la última no se elimina");
    const motivo = u.doc.getElementById(eliminar.getAttribute("aria-describedby"));
    assert.match(motivo?.textContent ?? "", /Crea otro antes de eliminar este/, "y dice por qué, a la vista");
    u.tecla(eliminar, "Enter");
    await espera(120);
    assert.equal(u.doc.querySelector("[data-delete-space]"), null, "elegirla no abre el diálogo");
    guarda("migrado", app, s);
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  {
    const s = servicio({
      spaces: [
        { id: "i1", name: "Origen", folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Destino", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [fila("t1", "pa", "i1"), fila("t2", "pb", "i2")],
    });
    const loaded = [];
    const app = await arrancar("listo", "task-links-across-spaces", {
      ...base(s, { "pestanas.w.i1": tira(["t1"], "t1"), "space.w": "i1" }),
      load_session: ({ id }) => {
        loaded.push(id);
        return { ...CON_TAREA.load_session, id, turns: [{ role: "assistant", text: id === "t1"
          ? "[Otra tarea](terminus://task?workspace=w&folder=pb&task=t2) [Otro workspace](terminus://task?workspace=ajeno&folder=pb&task=t2)"
          : "Destino abierto." }] };
      },
    });
    await espera(350);
    const u = util(app);
    const link = (label) => [...u.doc.querySelectorAll('button[title="Abrir tarea"]')]
      .find((button) => button.textContent.trim() === label);
    assert.ok(link("Otra tarea"), "la respuesta del agente pinta el enlace como acción interna");
    const leidas = loaded.length;
    link("Otro workspace").click();
    await espera(60);
    assert.equal(u.pildora("i1").dataset.selected, "true", "un enlace a otro workspace no navega");
    assert.equal(loaded.length, leidas, "otro workspace ni siquiera lee la tarea");
    assert.ok(!loaded.includes("t2"), "y la del destino sigue sin leerse");
    link("Otra tarea").click();
    await espera(350);
    assert.equal(u.pildora("i2").dataset.selected, "true", "abrir la tarea cambia a su espacio");
    assert.deepEqual(u.pestanas(), ["Tarea t2"], "la tarea se abre en la tira de su espacio");
    assert.equal(loaded.filter((id) => id === "t2").length, 2, "se comprueba que existe antes de abrirla");
    assert.deepEqual(app.fallos, []);
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
        fila("t1", "pa", "i1"), fila("t2", "pb", "i1"), fila("t3", "pb", "i2"), fila("t4", "pa", "i2"),
        fila("t5", "pc", null), fila("c1", "pa", null, { chat_de_agente: true, encargado: "design" }),
      ],
      atencion: [{ session: "t3", project: "pb", state: "asked" }, { session: "t1", project: "pa", state: "failed" }],
    });
    const app = await arrancar("listo", "spaces-two", base(s, {
      "pestanas.w": tira(["t9"], "t9"),
      "pestanas.w.i1": tira(["t1"], "t1"),
      "pestanas.w.i2": tira(["t4", "t3"], "t3"),
      "space.w": "i1",
    }));
    await espera(500);
    const u = util(app);
    assert.deepEqual(u.pref("pestanas.w")?.abiertas.map((p) => p.id), ["t9"], "una tira vieja que reaparece no se toca");
    assert.deepEqual(u.pref("pestanas.w.i1").abiertas.map((p) => p.id), ["t1"], "sin pisar la que ya había");
    assert.deepEqual(u.pestanas(), ["Tarea t1"]);
    assert.equal(u.pildora("i2").querySelector("[data-attention-badge]")?.dataset.attentionBadge, "asked", "la otra lleva la señal de sus tareas");
    assert.equal(u.pildora("i1").querySelector("[data-attention-badge]"), null);
    assert.deepEqual(u.carpetasEnTareas(), ["pa", "pb", "pc"], "la fijada y las que tienen tareas suyas o sin resolver");
    assert.equal(u.doc.querySelector("[data-main-folder]"), null, "ninguna carpeta es la principal");
    assert.ok(u.doc.querySelector('[data-sesion="t2"]'), "una tarea suya en una carpeta no fijada se ve");
    assert.ok(u.doc.querySelector('[data-sesion="t5"]'), "la que no se pudo resolver se ve");
    assert.equal(u.doc.querySelector('[data-sesion="t3"]'), null, "las de la otra no");
    u.caja().value = "borrador de t1";
    u.caja().dispatchEvent(new app.w.Event("input", { bubbles: true }));
    await espera(50);
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(400);
    assert.equal(u.pref("space.w"), "i2", "el escritorio activo se recuerda por workspace");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3"], "cada escritorio tiene su tira");
    assert.deepEqual(u.carpetasEnTareas(), ["pb", "pa", "pc"], "la principal primero");
    assert.ok(u.doc.querySelector('[data-sesion="t5"]'), "la sin resolver también está aquí");
    assert.equal(u.doc.querySelector('[data-sesion="t1"]'), null);
    assert.equal(u.pildora("i1").querySelector("[data-attention-badge]")?.dataset.attentionBadge, "failed");
    assert.equal(u.pildora("i2").querySelector("[data-attention-badge]"), null, "la elegida pierde la señal");
    assert.ok(u.doc.querySelector('[data-folder-row="pb"] [data-sidebar-agents]'));
    assert.ok(u.doc.querySelector('[data-folder-row="pb"] [data-sidebar-tasks]'));
    // Volver a un escritorio monta solo la pestaña de delante, y en su celda: una
    // montada escondida gasta su lectura sin caja y reabre al final.
    const pestana = (titulo) => [...u.doc.querySelectorAll('[data-tira] [role="tab"]')].find((el) => el.textContent.trim() === titulo);
    pestana("Tarea t4").click();
    await espera(300);
    pestana("Tarea t3").click();
    await espera(300);
    u.doc.querySelector('[data-space="i1"]').click();
    await espera(400);
    assert.deepEqual(u.pestanas(), ["Tarea t1"]);
    assert.equal(u.caja()?.value, "borrador de t1", "cambiar de escritorio no soltó lo de la otra tira");
    const hilosMontados = [];
    const ojo = new app.w.MutationObserver((registros) => {
      for (const r of registros) for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        const hilos = [n, ...n.querySelectorAll('[data-chat-thread]')].filter((x) => x.matches('[data-chat-thread]'));
        hilosMontados.push(...hilos);
      }
    });
    ojo.observe(u.doc.body, { childList: true, subtree: true });
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(400);
    ojo.disconnect();
    assert.equal(hilosMontados.length, 1, `volver a un escritorio monta solo la pestaña de delante (montó ${hilosMontados.length})`);
    assert.equal(u.doc.querySelector('[data-tira] [role="tab"][aria-selected="true"]')?.textContent.trim(), "Tarea t3");
    u.doc.querySelector('[data-space="i1"]').click();
    await espera(400);
    guarda("two-spaces", app, s);

    // Mover: solo a las otras, y la pestaña se va con la tarea.
    u.doc.querySelector('[data-sesion="t1"] button[aria-label="Acciones de la tarea «Tarea t1»"]').click();
    await espera(100);
    u.doc.querySelector('[data-move-space="t1"]').click();
    await espera(100);
    const destinos = [...u.doc.querySelectorAll('[role="menu"][aria-label="Mover a otro espacio"] [role="menuitem"]')];
    assert.deepEqual(destinos.map((b) => b.textContent.trim()), ["Facturación"], "solo lista las otras");
    destinos[0].click();
    await espera(400);
    assert.deepEqual(s.llamadas.filter(([c]) => c === "move_task_to_space").map(([, a]) => a.space), ["i2"]);
    assert.equal(u.doc.querySelector('[data-sesion="t1"]'), null, "sale del riel de aquí");
    assert.deepEqual(u.pestanas(), [], "y su pestaña de esta tira");
    assert.deepEqual(u.pref("pestanas.w.i2").abiertas.map((p) => p.id), ["t4", "t3", "t1"], "a la tira de su escritorio");
    assert.match(u.doc.querySelector("[data-space-toast]")?.textContent ?? "", /Movida a Facturación/);
    u.boton("Ir").click();
    await espera(400);
    assert.equal(u.pref("space.w"), "i2", "«Ir» va a su escritorio");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3", "Tarea t1"]);

    // Nueva tarea manda el escritorio delante.
    u.doc.querySelector('button[aria-label="Nueva tarea"]').click();
    await espera(150);
    u.caja().value = "Timbrar facturas";
    u.caja().dispatchEvent(new app.w.Event("input", { bubbles: true }));
    u.caja().closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await espera(300);
    const enviada = s.llamadas.find(([c]) => c === "send_message")?.[1];
    assert.equal(enviada?.space, "i2", "la tarea nueva nace en el escritorio activo");

    // Lo encolado lleva el escritorio de cuando se escribió, no el de cuando sale.
    app.emit("chat", { kind: "started", session: "nueva", workspace: "w" });
    await espera(100);
    u.caja().value = "Y el complemento de pago";
    u.caja().dispatchEvent(new app.w.Event("input", { bubbles: true }));
    u.caja().closest("form").dispatchEvent(new app.w.Event("submit", { bubbles: true, cancelable: true }));
    await espera(150);
    assert.equal(s.llamadas.filter(([c]) => c === "send_message").length, 1, "con el turno vivo se encola");
    u.doc.querySelector('[data-space="i1"]').click();
    await espera(300);
    app.emit("chat", { kind: "done", session: "nueva", workspace: "w", ok: true });
    await espera(800);
    const segunda = s.llamadas.filter(([c]) => c === "send_message")[1]?.[1];
    assert.equal(segunda?.session, "nueva", "la cola sale al cerrar el turno aunque se mire otro escritorio");
    assert.equal(segunda?.space, "i2", "y sale con el escritorio de cuando se escribió");
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(300);

    guarda("mover-y-abrir", app, s);
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  /**
   * El reparto de ventanas de un espacio. Cambiar de espacio no lo pierde y al
   * reiniciar vuelve. Falla si volver a un espacio deja una sola ventana, si el
   * reparto de uno pisa el de otro, o si un cambio hecho aquí no se guarda.
   */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [fila("t1", "pa", "i1"), fila("t4", "pb", "i2"), fila("t3", "pb", "i2")],
    });
    const partido = {
      columnas: [[{ pestanas: ["t4"], activa: "t4" }], [{ pestanas: ["t3"], activa: "t3" }]],
      anchos: [0.5, 0.5],
      altos: [1],
      activo: { col: 1, fila: 0 },
    };
    const app = await arrancar("listo", "spaces-reparto", base(s, {
      "pestanas.w.i1": tira(["t1"], "t1"),
      "pestanas.w.i2": tira(["t4", "t3"], "t3"),
      "panels.w.i2": partido,
      "space.w": "i2",
    }));
    await espera(500);
    const u = util(app);
    const ventanas = () => u.doc.querySelectorAll("[data-tira]").length;
    const tiraDe = (v) => u.doc.querySelector(`[data-tira][data-ventana="${v}"]`);
    const partir = () => app.w.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    const juntar = () => app.w.dispatchEvent(new app.w.KeyboardEvent("keydown", { key: "d", ctrlKey: true, shiftKey: true, bubbles: true }));
    // Arranca en i2, partido como quedó: su rejilla vuelve con su tira.
    assert.equal(ventanas(), 2, "el reparto guardado no volvió al arrancar");
    assert.match(tiraDe("0,0")?.textContent ?? "", /Tarea t4/);
    assert.match(tiraDe("1,0")?.textContent ?? "", /Tarea t3/);
    assert.deepEqual(u.pref("panels.w.i2"), partido, "el reparto vuelto no se vuelve a guardar igual");
    // Cada ventana del reparto carga su tarea: no vuelve una rejilla vacía.
    const cargadas = () => u.doc.querySelectorAll('[data-chat-thread]').length;
    assert.equal(cargadas(), 2, "cada ventana del reparto debe cargar su tarea");
    // A i1: sin reparto suyo, una ventana. Y volver no pierde la de i2.
    u.doc.querySelector('[data-space="i1"]').click();
    await espera(400);
    assert.equal(ventanas(), 1, "un espacio sin reparto arranca partido");
    assert.deepEqual(u.pestanas(), ["Tarea t1"]);
    assert.equal(cargadas(), 1, "solo la ventana de i1 queda montada");
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(400);
    assert.equal(ventanas(), 2, "volver a un espacio perdió su rejilla");
    assert.match(tiraDe("1,0")?.textContent ?? "", /Tarea t3/);
    assert.equal(cargadas(), 2, "volver a un espacio no recargó sus dos ventanas");
    guarda("layout-returns", app, s);

    // Un cambio hecho aquí —juntar— también se guarda y vuelve.
    juntar();
    await espera(200);
    assert.equal(ventanas(), 1, "juntar no recogió la ventana");
    u.doc.querySelector('[data-space="i1"]').click();
    await espera(300);
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(400);
    assert.equal(ventanas(), 1, "el reparto juntado no se guardó");
    assert.deepEqual(u.pestanas(), ["Tarea t4", "Tarea t3"]);
    partir();
    await espera(200);
    assert.equal(ventanas(), 2, "partir no abrió la ventana");
    u.doc.querySelector('[data-space="i1"]').click();
    await espera(300);
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(400);
    assert.equal(ventanas(), 2, "el reparto partido no volvió al cambiar de espacio");
    guarda("layout-changed", app, s);
    assert.deepEqual(app.fallos, []);
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
      filas: [fila("t1", "pa", "i1"), fila("t3", "pb", "i2"), fila("t6", "pb", "i2"), fila("t7", "pc", "i2")],
      archivos: { t6: ["src/cobro.rs", "nuevo.txt"] },
      kn: { t7: ["notas/septiembre.md"] },
      trabajando: ["t3"],
    });
    const app = await arrancar("listo", "spaces-delete", base(s, {
      "pestanas.w.i2": tira(["t3"], "t3"),
      "space.w": "i2",
    }));
    await espera(500);
    const u = util(app);
    const menu = await u.abrirMenu("i2");
    u.tecla([...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === "Eliminar…"), "Enter");
    await espera(400);
    const dialogo = () => u.doc.querySelector("[data-delete-space]");
    assert.equal(dialogo()?.getAttribute("role"), "alertdialog");
    assert.equal(u.doc.activeElement?.textContent.trim(), "Cancelar", "el foco empieza en Cancelar");
    const secciones = () => [...dialogo().querySelectorAll("[data-delete-section]")].map((el) => [el.dataset.deleteSection, [...el.querySelectorAll("[data-delete-row]")].map((r) => r.dataset.deleteRow)]);
    assert.deepEqual(secciones(), [["working", ["t3"]], ["uncommitted", ["t6"]], ["unsaved", ["t7"]]]);
    const confirmar = () => [...dialogo().querySelectorAll("button")].at(-1);
    assert.equal(confirmar().textContent.trim(), "Descartar cambios y eliminar", "con cambios sin commitear, el botón lo dice");
    guarda("borrar-con-cambios", app, s);

    s.archivos.t7 = ["informe.pdf"];
    confirmar().click();
    await espera(300);
    const primera = s.llamadas.filter(([c]) => c === "delete_space")[0][1];
    assert.deepEqual(primera.seen.tasks.map((t) => [t.task, t.files.length]), [["t3", 0], ["t6", 2], ["t7", 0]], "se manda lo que se vio");
    assert.equal(primera.seen.discard, true);
    const aviso = dialogo().querySelector("[data-delete-notice]");
    assert.match(aviso?.textContent ?? "", /Hay cambios nuevos desde que abriste esto/);
    assert.equal(u.doc.activeElement, aviso, "el foco va al aviso");
    assert.equal(dialogo().querySelector('[data-delete-row="t7"] [data-delete-mark]')?.textContent.trim(), "cambió");
    assert.equal(dialogo().querySelector('[data-delete-row="t6"] [data-delete-mark]'), null, "lo ya visto no se marca");
    assert.ok(s.spaces.some((i) => i.id === "i2"), "nada se borró");
    guarda("borrar-cambios-nuevos", app, s);

    s.fallaUnaVez.add("t6");
    confirmar().click();
    await espera(300);
    const fallos = dialogo()?.querySelector("[data-delete-failures]");
    assert.match(fallos?.textContent ?? "", /Hay un turno o una operación en curso/, "el fallo se lee dentro del diálogo");
    assert.equal(dialogo().querySelector('[data-delete-section="working"]'), null, "tras un fallo se pinta la previa de ahora, no la que volvió");
    assert.equal(u.doc.querySelector('[data-sesion="t3"]'), null, "lo ya archivado sale del riel con el diálogo abierto");
    assert.equal(u.doc.querySelector("[data-space-toast]"), null);
    confirmar().click();
    await espera(500);
    assert.equal(dialogo(), null, "repetir continúa y termina");
    assert.deepEqual(u.pildoras().map((p) => p.dataset.spacePill), ["i1", "i3"], "sale de la barra");
    assert.equal(u.pref("space.w"), "i1", "el escritorio pasa a la que queda");
    assert.equal(u.pref("pestanas.w.i2"), null, "y su tira se olvida");
    assert.equal(u.doc.querySelector('button[aria-label="Proyecto"]')?.textContent.trim(), "Terminus App", "la caja vacía elige la primera carpeta visible");
    assert.match(u.doc.querySelector("[data-space-toast]")?.textContent ?? "", /«Facturación» eliminado · 3 tareas archivadas/);

    // En Archivadas, con su espacio eliminado, la fila se lee pero no se
    // desarchiva: una archivada se retoma en una sesión nueva.
    u.boton("Ver en Archivadas").click();
    await espera(400);
    const fila7 = u.doc.querySelector('[data-archived-row="t7"]');
    assert.ok(fila7?.querySelector("[data-deleted-space]"), "la fila dice que su espacio se eliminó");
    assert.match(fila7.textContent, /Facturación/);
    assert.doesNotMatch(fila7.textContent, /Desarchivar/, "Archivadas no ofrece desarchivar");
    guarda("archivadas", app, s);
    assert.equal(s.llamadas.some(([c, a]) => c === "set_task_archived" && a?.archived === false), false, "nadie desarchiva");
    u.doc.querySelector('[data-space="i3"]').click();
    await espera(300);
    assert.equal(u.pref("space.w"), "i3");
    assert.ok(u.doc.querySelector("[data-archived-page]"), "cambiar de escritorio deja Archivadas abierta");
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  {
    const legacy = [
      fila("old-chat", "pa", null, { chat_de_agente: true }),
      fila("old-thread", "pa", null, { chat_de_agente: true, agent_thread: true }),
      fila("old-inbox", "pa", null, { chat_de_agente: true, agent_thread: true, inbox: true }),
    ].map((row) => ({ ...row, archived: true, pinned: false, encargado: "design" }));
    const s = servicio({
      spaces: [{ id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 }],
      filas: legacy,
    });
    const opened = [];
    const app = await arrancar("listo", "spaces-archived-agent-history", {
      ...base(s, { "space.w": "i1" }),
      load_session: ({ id }) => {
        opened.push(id);
        return { ...CON_TAREA.load_session, id };
      },
    });
    await espera(400);
    const u = util(app);
    u.doc.querySelector('[data-archived-foot]').click();
    await espera(300);
    for (const row of legacy) {
      assert.ok(u.doc.querySelector(`[data-archived-row="${row.id}"]`), "el historial antiguo archivado sigue accesible");
    }
    u.doc.querySelector('[data-archived-row="old-inbox"] button').click();
    await espera(300);
    assert.ok(opened.includes("old-inbox"), "la bandeja archivada abre su conversación original");
    assert.equal(s.llamadas.some(([command, args]) => command === "set_task_archived" && args.archived === false), false);
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  /** Falla si un chat anterior en reposo deja a la persona sin caja y sin salida hacia su agente. */
  {
    const s = servicio({
      spaces: [{ id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 }],
      filas: [fila("old-chat", "pa", "i1", { chat_de_agente: true, encargado: "design", title: "Design" })],
    });
    const app = await arrancar("listo", "spaces-previous-agent-chat", base(s, {
      "space.w": "i1",
      "pestanas.w.i1": tira(["old-chat"], "old-chat"),
    }));
    await espera(500);
    const u = util(app);
    const barra = u.doc.querySelector("[data-previous-agent-chat]");
    assert.ok(barra, "el chat anterior pinta la barra donde iría la caja");
    assert.match(barra.textContent, /chat anterior de design/);
    assert.equal(u.caja(), undefined, "y no la caja");
    const seguir = [...barra.querySelectorAll("button")].find((b) => b.textContent.trim() === "Seguir con design");
    assert.ok(seguir, "ofrece seguir con su agente");
    seguir.click();
    await espera(300);
    assert.equal(u.doc.querySelector("[data-previous-agent-chat]"), null, "seguir sale del chat anterior");
    assert.ok(u.caja(), "y deja una caja para escribirle");
    assert.equal(s.llamadas.some(([c]) => c === "send_message"), false, "sin mandar nada por su cuenta");
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  /** Sin cambios sin guardar el botón dice cuántas se archivan. */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Landing", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [fila("t1", "pa", "i1"), fila("t3", "pb", "i2"), fila("t4", "pb", "i2")],
    });
    const app = await arrancar("listo", "spaces-delete-clean", base(s, { "space.w": "i2" }));
    await espera(500);
    const u = util(app);
    const menu = await u.abrirMenu("i2");
    u.tecla([...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim() === "Eliminar…"), "Enter");
    await espera(400);
    const botones = [...u.doc.querySelectorAll("[data-delete-space] button")];
    assert.equal(botones.at(-1).textContent.trim(), "Eliminar y archivar 2 tareas");
    assert.equal(u.doc.querySelector("[data-delete-section]"), null, "sin nada que avisar no hay secciones");
    guarda("borrar-normal", app, s);
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }

  /** El doble clic sobre la píldora renombra, como el nombre de una tarea. */
  {
    const s = servicio({
      spaces: [
        { id: "i1", name: null, folders: ["pa"], created_at: 1, updated_at: 1 },
        { id: "i2", name: "Facturación", folders: ["pb"], created_at: 2, updated_at: 2 },
      ],
      filas: [fila("t1", "pa", "i1"), fila("t3", "pb", "i2")],
    });
    const app = await arrancar("listo", "spaces-rename", base(s, { "space.w": "i2" }));
    await espera(500);
    const u = util(app);
    u.doc.querySelector('[data-space="i2"]').dispatchEvent(new app.w.MouseEvent("dblclick", { bubbles: true }));
    await espera(50);
    const caja = u.doc.querySelector('[data-space-pill="i2"] input');
    assert.ok(caja, "el doble clic abre el nombre de la píldora para escribir");
    assert.equal(caja.value, "Facturación", "con el nombre de hoy");
    caja.value = "Cobros";
    caja.dispatchEvent(new app.w.Event("input", { bubbles: true }));
    caja.setSelectionRange(1, 3);
    app.emit("cli-changed", { workspace: "w", command: "task.send" });
    await espera(350);
    assert.equal(u.doc.querySelector('[data-space-pill="i2"] input'), caja, "un refresco del CLI conserva el editor del espacio");
    assert.equal(u.doc.activeElement, caja);
    assert.equal(caja.value, "Cobros");
    assert.equal(caja.selectionStart, 1);
    assert.equal(caja.selectionEnd, 3);
    assert.equal(s.llamadas.filter(([c]) => c === "rename_space").length, 0);
    u.tecla(caja, "Enter");
    await espera(300);
    assert.deepEqual(
      s.llamadas.filter(([c]) => c === "rename_space").map(([, a]) => a),
      [{ id: "i2", name: "Cobros" }],
    );
    assert.match(u.pildora("i2").textContent, /Cobros/, "la píldora se lee con el nombre nuevo");
    assert.equal(u.doc.querySelector('[data-space-pill="i2"] input'), null, "Enter cierra el campo");
    guarda("renombrar", app, s);
    assert.deepEqual(app.fallos, []);
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
      filas: [fila("t3", "pb", "i2")],
    });
    const app = await arrancar("listo", "spaces-folders", base(s, { "space.w": "i1" }));
    await espera(500);
    const u = util(app);
    assert.deepEqual(u.carpetasEnTareas(), ["pa", "pc"], "the rail shows only this space's folders");
    u.doc.querySelector('button[aria-label="Acciones del proyecto «Finanzas»"]').click();
    await espera(150);
    assert.equal(u.boton("Borrar el proyecto"), undefined, "a space does not delete the folder for everyone");
    u.boton("Quitar de este espacio").click();
    await espera(300);
    assert.deepEqual(
      s.llamadas.filter(([c]) => c === "set_space_folders").map(([, a]) => a),
      [{ id: "i1", folders: ["pa"] }],
    );
    assert.equal(s.llamadas.some(([c]) => c === "delete_project"), false, "removing it does not delete the project");
    assert.deepEqual(u.carpetasEnTareas(), ["pa"], "it leaves this space's rail");
    u.doc.querySelector('[data-space="i2"]').click();
    await espera(400);
    assert.deepEqual(u.carpetasEnTareas(), ["pb", "pc"], "and stays in the other one");
    guarda("carpetas-por-espacio", app, s);
    assert.deepEqual(app.fallos, []);
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
      filas: [fila("t1", "pa", "i1"), fila("t2", "pa", "i1")],
    });
    const retenidas = [];
    const app = await arrancar("listo", "spaces-slow-reconcile", {
      ...base(s, { "pestanas.w.i1": tira(["t1", "t2"], "t1"), "space.w": "i1" }),
      load_session: ({ id }) => ({ ...CON_TAREA.load_session, id, turns: [{ role: "assistant", text: `Respuesta de ${id}` }] }),
      list_active_turns: () => new Promise((resolve) => retenidas.push(resolve)),
    });
    await espera(300);
    const u = util(app);
    const activa = () => u.doc.querySelector('[data-tira] [role="tab"][aria-selected="true"]')?.textContent.trim();
    assert.ok(retenidas.length > 0, "the active-turn read is still pending");
    assert.equal(activa(), "Tarea t1");
    assert.match(u.doc.body.textContent, /Respuesta de t1/, "the restored tab does not wait for the active-turn read");
    [...u.doc.querySelectorAll('[data-tira] [role="tab"]')].find((el) => el.textContent.trim() === "Tarea t2").click();
    await espera(300);
    assert.equal(activa(), "Tarea t2");
    for (const soltar of retenidas.splice(0)) soltar([]);
    await espera(300);
    assert.equal(activa(), "Tarea t2", "the late startup open does not take the window back");
    guarda("reconciliacion-lenta", app, s);
    assert.deepEqual(app.fallos, []);
    app.w.close();
  }
}
