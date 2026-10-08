import assert from "node:assert/strict";
import { test } from "node:test";
import { conservarEnOrden, sessionRefresh, type SessionLists } from "../src/lib/sessionRefresh.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(projects = ["", "app"]) {
  const reads: { project: string; result: ReturnType<typeof deferred<string[]>> }[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  let lists: SessionLists<string> = {};
  const refresh = sessionRefresh<string>({
    read: (project) => {
      const result = deferred<string[]>();
      reads.push({ project, result });
      return result.promise;
    },
    apply: (update) => { lists = update(lists); },
    projects: () => projects,
    key: (row) => row,
    schedule: (run, ms) => { timers.push({ run, ms }); return timers.length; },
    cancel: () => {},
  });
  return { refresh, reads, timers, lists: () => lists };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

type Fila = { id: string; title: string };

test("una respuesta anterior se pinta aunque la más nueva no vuelva", async () => {
  const s = setup(["app"]);
  const first = s.refresh.refresh(["app"]);
  void s.refresh.refresh(["app"]);
  s.reads[0].result.resolve(["a", "b"]);
  await first;
  assert.deepEqual(s.lists(), { app: ["a", "b"] });
});

test("una respuesta anterior no pisa a una más nueva ya pintada", async () => {
  const s = setup(["app"]);
  const first = s.refresh.refresh(["app"]);
  const second = s.refresh.refresh(["app"]);
  s.reads[1].result.resolve(["nueva"]);
  await second;
  s.reads[0].result.resolve(["vieja"]);
  await first;
  assert.deepEqual(s.lists(), { app: ["nueva"] });
});

test("un fallo conserva lo que había y reintenta solo, cada vez más espaciado", async () => {
  const s = setup(["app"]);
  const first = s.refresh.refresh(["app"]);
  s.reads[0].result.resolve(["a"]);
  await first;
  const failing = s.refresh.refresh(["app"]);
  s.reads[1].result.reject(new Error("cli.error.app_unavailable"));
  await failing;
  assert.deepEqual(s.lists(), { app: ["a"] });
  assert.equal(s.timers[0].ms, 1000);
  s.timers[0].run();
  s.reads[2].result.reject(new Error("cli.error.app_unavailable"));
  await settle();
  assert.equal(s.timers[1].ms, 2000);
  s.timers[1].run();
  s.reads[3].result.resolve(["a", "b"]);
  await settle();
  assert.deepEqual(s.lists(), { app: ["a", "b"] });
  assert.equal(s.timers.length, 2);
});

// `For` de Solid reconcilia por referencia: con una fila nueva en cada lectura
// destruye y reconstruye el DOM de la lista entera, y el fundido del título se
// dispararía en cada refresco sin que el título haya cambiado.
test("la fila que no cambió conserva su objeto entre dos lecturas", async () => {
  const filas = { reads: [] as { project: string; result: ReturnType<typeof deferred<Fila[]>> }[] };
  let lists: SessionLists<Fila> = {};
  const refresh = sessionRefresh<Fila>({
    read: (project) => {
      const result = deferred<Fila[]>();
      filas.reads.push({ project, result });
      return result.promise;
    },
    apply: (update) => { lists = update(lists); },
    projects: () => ["app"],
    key: (row) => row.id,
  });
  const quieta = { id: "a", title: "sin tocar" };
  const primera = refresh.refresh(["app"]);
  filas.reads[0].result.resolve([quieta, { id: "b", title: "vieja" }]);
  await primera;
  const antes = lists.app;
  const segunda = refresh.refresh(["app"]);
  filas.reads[1].result.resolve([{ id: "a", title: "sin tocar" }, { id: "b", title: "nueva" }]);
  await segunda;
  assert.equal(lists.app[0], antes[0]);
  assert.notEqual(lists.app[1], antes[1]);
  assert.equal(lists.app[1].title, "nueva");
});

test("una fila que se va no deja su objeto en la lista", async () => {
  let lists: SessionLists<Fila> = {};
  const reads: ReturnType<typeof deferred<Fila[]>>[] = [];
  const refresh = sessionRefresh<Fila>({
    read: () => {
      const result = deferred<Fila[]>();
      reads.push(result);
      return result.promise;
    },
    apply: (update) => { lists = update(lists); },
    projects: () => ["app"],
    key: (row) => row.id,
  });
  const primera = refresh.refresh(["app"]);
  reads[0].resolve([{ id: "a", title: "a" }, { id: "b", title: "b" }]);
  await primera;
  const segunda = refresh.refresh(["app"]);
  reads[1].resolve([{ id: "b", title: "b" }]);
  await segunda;
  assert.deepEqual(lists.app.map((row) => row.id), ["b"]);
});

test("cambiar de workspace descarta respuestas y reintentos pendientes", async () => {
  const s = setup(["app"]);
  const pending = s.refresh.refresh(["app"]);
  s.refresh.reset();
  s.reads[0].result.resolve(["otro workspace"]);
  await pending;
  assert.deepEqual(s.lists(), {});
});

test("los pedidos que llegan juntos se leen una sola vez, con todas sus carpetas", async () => {
  const reads: string[] = [];
  const timers: (() => void)[] = [];
  let lists: SessionLists<string> = {};
  const refresh = sessionRefresh<string>({
    read: async (project) => { reads.push(project); return [project]; },
    apply: (update) => { lists = update(lists); },
    projects: () => ["", "app"],
    key: (row) => row,
    schedule: (run) => timers.push(run),
    cancel: () => {},
    gather: 200,
  });
  const first = refresh.gathered([""]);
  const second = refresh.gathered(["", "app"]);
  assert.deepEqual(reads, []);
  assert.equal(timers.length, 1);
  timers[0]();
  await Promise.all([first, second]);
  assert.deepEqual(reads, ["", "app"]);
  assert.deepEqual(lists, { "": [""], app: ["app"] });
});

test("cambiar de workspace suelta a quien esperaba una lectura juntada, sin leer", async () => {
  const reads: string[] = [];
  const refresh = sessionRefresh<string>({
    read: async (project) => { reads.push(project); return []; },
    apply: () => {},
    projects: () => ["app"],
    key: (row) => row,
    schedule: () => 1,
    cancel: () => {},
    gather: 200,
  });
  const waiting = refresh.gathered(["app"]);
  refresh.reset();
  await waiting;
  assert.deepEqual(reads, []);
});

test("releer un hilo conserva los mensajes iguales y no los que cambiaron en su sitio", () => {
  type Mensaje = { turno: string; text: string; questionRequestId?: string };
  const antes: Mensaje[] = [{ turno: "t1", text: "a" }, { turno: "t2", text: "b" }];
  const igual = conservarEnOrden(antes, structuredClone(antes));
  assert.equal(igual, antes);
  const leida = [{ turno: "t1", text: "a" }, { turno: "t2", text: "b", questionRequestId: "q" }, { turno: "t3", text: "c" }];
  const despues = conservarEnOrden(antes, leida);
  assert.equal(despues[0], antes[0]);
  assert.equal(despues[1].questionRequestId, "q");
  assert.equal(despues[2].text, "c");
});
