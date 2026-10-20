import assert from "node:assert/strict";
import { test } from "node:test";
import { hasLinkedWorkspaces, linkedAttention, linkedEvent, linkedListing, linkedWorkspaces, onlyLinked } from "../src/index.ts";

test("los vínculos salen de `workspaces`; sin el campo no se filtra", () => {
  assert.deepEqual([...(linkedWorkspaces({ workspaces: ["w1", "w2"] }) ?? [])], ["w1", "w2"]);
  assert.equal(linkedWorkspaces({}), null);
  assert.equal(linkedWorkspaces({ workspaces: null }), null);
  assert.equal(linkedWorkspaces({ workspaces: [] })?.size, 0);
});

test("la cuenta sin ningún workspace vinculado se distingue de un plano de control anterior", () => {
  assert.equal(hasLinkedWorkspaces([{ workspaces: [] }, { workspaces: [] }]), false);
  assert.equal(hasLinkedWorkspaces([{ workspaces: [] }, { workspaces: ["w1"] }]), true);
  assert.equal(hasLinkedWorkspaces([{ workspaces: [] }, {}]), true);
  assert.equal(hasLinkedWorkspaces([]), false);
});

test("las filas y el activo que no están vinculados se quitan", () => {
  const linked = new Set(["w1"]);
  assert.deepEqual(onlyLinked([{ id: "w1" }, { id: "w2" }], linked), [{ id: "w1" }]);
  assert.deepEqual(onlyLinked([{ id: "w1" }, { id: "w2" }], null), [{ id: "w1" }, { id: "w2" }]);
  const listing = { workspaces: [{ id: "w1", name: "Uno" }, { id: "w2", name: "Dos" }], active: "w2", extra: 1 };
  assert.deepEqual(linkedListing(listing, linked), { workspaces: [{ id: "w1", name: "Uno" }], active: null, extra: 1 });
  assert.deepEqual(linkedListing({ ...listing, active: "w1" }, linked).active, "w1");
  assert.equal(linkedListing(listing, null), listing);
  assert.equal(linkedListing(null, linked), null);
});

test("la atención y los eventos de un workspace no vinculado no llegan", () => {
  const linked = new Set(["w1"]);
  const attention = [{ workspace: "w1", tasks: [] }, { workspace: "w2", tasks: [] }];
  assert.deepEqual(linkedAttention(attention, linked), [{ workspace: "w1", tasks: [] }]);
  assert.equal(linkedAttention(attention, null), attention);
  assert.equal(linkedEvent({ workspace: "w2" }, linked), false);
  assert.equal(linkedEvent({ workspace: "w1" }, linked), true);
  assert.equal(linkedEvent({ workspace: null }, linked), true);
  assert.equal(linkedEvent({ workspace: "w2" }, null), true);
});
