/**
 * Varias cuentas de Danil en la web (`src/web/accounts.ts`): la principal es la
 * de la app de Danil, las extra viven en su propio slot; una persona no se
 * repite, una sesión caducada se queda marcada, cada cuenta lista su registro
 * y la página abre la dueña del workspace pedido.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountWorkspace } from "@terminus/computers";
import {
  type Account,
  type AccountUser,
  type AuthClient,
  type ListAnswer,
  EXTRAS_KEY,
  LAST_KEY,
  addExtra,
  chooserRows,
  loadAccounts,
  ownerOf,
  pickAccount,
  readExtras,
  readListings,
  removeExtra,
  savedListings,
} from "../../src/web/accounts.ts";

function memory(seed: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function client(user: AccountUser | null, token = `t-${user?.user_id ?? "none"}`) {
  const state = { user, token, signedOut: 0, refreshes: 0, refreshOk: true };
  const c: AuthClient & { state: typeof state } = {
    state,
    user: async () => state.user,
    getToken: async () => {
      if (!state.user) throw new Error("no session");
      return state.token;
    },
    unauthorized: async () => {
      state.refreshes += 1;
      if (state.refreshOk) state.token = `${state.token}+`;
      return state.refreshOk;
    },
    signOutLocal: async () => {
      state.signedOut += 1;
      state.user = null;
    },
  };
  return c;
}

const ALBERTO = { user_id: "u-alberto", email: "alberto@danil.ai", name: "Alberto" };
const FUNDACION = { user_id: "u-fund", email: "alberto@fundacion.org", name: null };
const TECHWEEK = { user_id: "u-ytw", email: "alberto@ytw.mx", name: null };

const ws = (id: string): AccountWorkspace => ({ id, name: id.toUpperCase(), projects: [], computers: [] });

test("la principal va primero y una extra de la misma persona no se repite", async () => {
  const storage = memory({
    [EXTRAS_KEY]: [
      { slot: "s1", ...FUNDACION },
      { slot: "s2", ...ALBERTO },
    ],
  });
  const clients: Record<string, AuthClient> = { s1: client(FUNDACION), s2: client(ALBERTO) };
  const accounts = await loadAccounts({ storage, primary: client(ALBERTO), clientFor: (s) => clients[s] });
  assert.deepEqual(
    accounts.map((a) => [a.user_id, a.slot, a.signedIn]),
    [
      ["u-alberto", null, true],
      ["u-fund", "s1", true],
    ],
  );
  // La extra repetida se olvida del registro.
  assert.deepEqual(readExtras(storage).map((e) => e.slot), ["s1"]);
});

test("sin principal valen las extra; una caducada se queda marcada", async () => {
  const storage = memory({ [EXTRAS_KEY]: [{ slot: "s1", ...FUNDACION }, { slot: "s2", ...TECHWEEK }] });
  const clients: Record<string, AuthClient> = { s1: client(FUNDACION), s2: client(null) };
  const accounts = await loadAccounts({ storage, primary: client(null), clientFor: (s) => clients[s] });
  assert.deepEqual(
    accounts.map((a) => [a.user_id, a.signedIn]),
    [
      ["u-fund", true],
      ["u-ytw", false],
    ],
  );
  assert.equal(accounts[1].email, "alberto@ytw.mx");
});

test("una sesión de slot que ahora es de otra persona deja de ser esa extra", async () => {
  const storage = memory({ [EXTRAS_KEY]: [{ slot: "s1", ...FUNDACION }] });
  const accounts = await loadAccounts({ storage, primary: null, clientFor: () => client(TECHWEEK) });
  assert.deepEqual(accounts, []);
  assert.deepEqual(readExtras(storage), []);
});

test("agregar guarda la extra; repetida cierra la sesión nueva; sin sesión no guarda nada", async () => {
  const storage = memory();
  const principal: Account = { ...ALBERTO, slot: null, signedIn: true, client: client(ALBERTO) };

  const fresh = client(FUNDACION);
  assert.deepEqual(await addExtra(storage, [principal], "s1", fresh), { kind: "added", user: FUNDACION });
  assert.deepEqual(readExtras(storage), [{ ...FUNDACION, slot: "s1" }]);

  const again = client(ALBERTO);
  assert.equal((await addExtra(storage, [principal], "s2", again)).kind, "duplicate");
  assert.equal(again.state.signedOut, 1);
  assert.deepEqual(readExtras(storage).map((e) => e.slot), ["s1"]);

  assert.deepEqual(await addExtra(storage, [principal], "s3", client(null)), { kind: "no_session" });
  assert.equal(readExtras(storage).length, 1);
});

test("volver a entrar con una extra caducada reemplaza su slot viejo", async () => {
  const storage = memory({ [EXTRAS_KEY]: [{ slot: "old", ...FUNDACION }] });
  const stale: Account = { ...FUNDACION, slot: "old", signedIn: false, client: client(null) };
  assert.equal((await addExtra(storage, [stale], "new", client(FUNDACION))).kind, "added");
  assert.deepEqual(readExtras(storage), [{ ...FUNDACION, slot: "new" }]);
});

test("quitar una extra cierra su sesión aquí y olvida su lista; la principal no se quita", async () => {
  const c = client(FUNDACION);
  const storage = memory({ [EXTRAS_KEY]: [{ slot: "s1", ...FUNDACION }], "terminus.web.listing:u-fund": [ws("f1")] });
  await removeExtra(storage, { ...FUNDACION, slot: "s1", signedIn: true, client: c });
  assert.equal(c.state.signedOut, 1);
  assert.deepEqual(readExtras(storage), []);
  assert.equal(storage.getItem("terminus.web.listing:u-fund"), null);

  const p = client(ALBERTO);
  await removeExtra(storage, { ...ALBERTO, slot: null, signedIn: true, client: p });
  assert.equal(p.state.signedOut, 0);
});

test("cada cuenta lista su registro con su token; un rechazo refresca una vez; sin red usa la copia", async () => {
  const storage = memory({ "terminus.web.listing:u-ytw": [ws("y1")] });
  const a = client(ALBERTO);
  const f = client(FUNDACION);
  f.state.token = "expired";
  const y = client(TECHWEEK);
  const accounts: Account[] = [
    { ...ALBERTO, slot: null, signedIn: true, client: a },
    { ...FUNDACION, slot: "s1", signedIn: true, client: f },
    { ...TECHWEEK, slot: "s2", signedIn: true, client: y },
  ];
  const seen: string[] = [];
  const list = async (token: string): Promise<ListAnswer> => {
    seen.push(token);
    if (token === "expired") return { kind: "unauthorized" };
    if (token === "expired+") return { kind: "ok", value: [ws("f1"), ws("f2")] };
    if (token === "t-u-ytw") throw new Error("offline");
    return { kind: "ok", value: [ws("a1")] };
  };
  const listings = await readListings(storage, accounts, list);
  assert.deepEqual(listings.get("u-alberto"), { workspaces: [ws("a1")], stale: false, refused: false });
  assert.deepEqual(listings.get("u-fund")?.workspaces.map((w) => w.id), ["f1", "f2"]);
  assert.equal(f.state.refreshes, 1);
  assert.deepEqual(listings.get("u-ytw"), { workspaces: [ws("y1")], stale: true, refused: false });
  // Lo leído se guarda para la próxima vez sin red.
  assert.deepEqual(JSON.parse(storage.getItem("terminus.web.listing:u-fund") ?? "[]").map((w: AccountWorkspace) => w.id), ["f1", "f2"]);
  assert.ok(!seen.includes("t-u-alberto+"));
});

test("una extra caducada no pide nada y queda rechazada con su copia", async () => {
  const storage = memory({ "terminus.web.listing:u-fund": [ws("f1")] });
  const listings = await readListings(storage, [{ ...FUNDACION, slot: "s1", signedIn: false, client: client(null) }], async () => {
    throw new Error("should not list");
  });
  assert.deepEqual(listings.get("u-fund"), { workspaces: [ws("f1")], stale: true, refused: true });
});

test("la página abre la dueña de ?w=, si no la última, si no la principal", () => {
  const storage = memory();
  const accounts: Account[] = [
    { ...ALBERTO, slot: null, signedIn: true, client: client(ALBERTO) },
    { ...FUNDACION, slot: "s1", signedIn: true, client: client(FUNDACION) },
    { ...TECHWEEK, slot: "s2", signedIn: false, client: client(null) },
  ];
  const listings = new Map([
    ["u-alberto", { workspaces: [ws("a1")], stale: false, refused: false }],
    ["u-fund", { workspaces: [ws("f1")], stale: false, refused: false }],
    ["u-ytw", { workspaces: [ws("y1")], stale: true, refused: true }],
  ]);
  assert.equal(ownerOf("f1", listings), "u-fund");
  assert.equal(pickAccount(accounts, listings, "f1", storage).account?.user_id, "u-fund");
  assert.deepEqual(
    [pickAccount(accounts, listings, null, storage).account?.user_id, pickAccount(accounts, listings, null, storage).gone],
    ["u-alberto", false],
  );
  storage.setItem(LAST_KEY, JSON.stringify("u-fund"));
  assert.equal(pickAccount(accounts, listings, null, storage).account?.user_id, "u-fund");
  // Un workspace que ninguna cuenta tiene: abre la de siempre y lo dice.
  const gone = pickAccount(accounts, listings, "zz", storage);
  assert.deepEqual([gone.account?.user_id, gone.gone], ["u-fund", true]);
  // La dueña con la sesión caducada no se abre: se queda en una que sí entra.
  assert.equal(pickAccount(accounts, listings, "y1", storage).account?.user_id, "u-fund");
  assert.equal(pickAccount([], listings, null, storage).account, null);
});

test("sin red, la página elige con las listas guardadas", () => {
  const storage = memory({ "terminus.web.listing:u-fund": [ws("f1")] });
  const accounts: Account[] = [
    { ...ALBERTO, slot: null, signedIn: true, client: client(ALBERTO) },
    { ...FUNDACION, slot: "s1", signedIn: true, client: client(FUNDACION) },
  ];
  const saved = savedListings(storage, accounts);
  assert.deepEqual(saved.get("u-alberto"), { workspaces: [], stale: true, refused: false });
  assert.equal(pickAccount(accounts, saved, "f1", storage).account?.user_id, "u-fund");
});

test("«Elige una cuenta» ofrece abrir las que tienen sesión y volver a entrar con las caducadas", () => {
  const rows = chooserRows([
    { ...ALBERTO, slot: null, signedIn: true, client: client(ALBERTO) },
    { ...TECHWEEK, slot: "s2", signedIn: false, client: client(null) },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.email, r.action]),
    [
      ["alberto@danil.ai", "open"],
      ["alberto@ytw.mx", "sign_in_again"],
    ],
  );
});
