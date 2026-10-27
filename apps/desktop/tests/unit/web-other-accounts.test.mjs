/**
 * Terminus in the browser with several Danil accounts (`docs/web-multi-account.md`):
 * the column shows the open account's workspaces and, under each other account,
 * its own; opening one of those reloads with its account, an expired one asks to
 * sign in again, and «Agregar cuenta» is always there. Mounts `dist-web/`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { engine, fleet } from "../helpers/fake-relay.mjs";
import { boot, sleep } from "../helpers/jsdom-app.mjs";

const API = "https://relay.test";

const until = async (check, ms = 4000) => {
  for (let waited = 0; waited < ms; waited += 50) {
    if (check()) return true;
    await sleep(50);
  }
  return false;
};

test("the column lists other accounts' workspaces and opens them with their account", async () => {
  const opened = [];
  const added = [];
  const own = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  try {
    const computers = [{ computer_id: "cmp_vm", name: "Danil VM", state: "online", provider: "aws-ec2" }];
    const f = fleet({ cmp_vm: { table: engine, state: "online" } });
    const others = [
      {
        user_id: "u-fund",
        email: "alberto@fundacion.org",
        name: null,
        extra: true,
        signedIn: true,
        stale: false,
        workspaces: [
          { id: "f1", name: "Donde Banco", logo: async () => null },
          { id: "f2", name: "Proyecto 2", logo: async () => null },
        ],
      },
      { user_id: "u-ytw", email: "alberto@ytw.mx", name: null, extra: true, signedIn: false, stale: true, workspaces: [{ id: "y1", name: "Tech Week", logo: async () => null }] },
    ];
    const app = await boot("listo", "web-other-accounts", {}, undefined, {}, {
      web: true,
      antes: (w) => {
        globalThis.WebSocket = f.Socket;
        w.terminusWeb = {
          endpoint: API,
          computers,
          getToken: async () => "tok",
          webAccounts: {
            current: { user_id: "u-alberto", email: "alberto@danil.ai", name: "Alberto", extra: false },
            others: () => others,
            open: (id) => opened.push(id),
            add: (email) => added.push(email ?? null),
            remove: async () => undefined,
          },
        };
      },
    });
    const doc = app.w.document;
    assert.ok(await until(() => doc.querySelector("[data-workspace-column]")), "the column shows even with one workspace of this account");
    const headers = () => [...doc.querySelectorAll("[data-account-header]")].map((h) => h.getAttribute("data-account-header"));
    assert.ok(await until(() => headers().length === 3), "one header per account");
    assert.deepEqual(headers(), ["u-alberto", "u-fund", "u-ytw"]);
    const tiles = [...doc.querySelectorAll("[data-other-workspace-tile]")];
    assert.deepEqual(
      tiles.map((t) => t.getAttribute("data-other-workspace-tile")),
      ["f1", "f2", "y1"],
    );
    assert.match(tiles[0].getAttribute("aria-label"), /Donde Banco · alberto@fundacion\.org/);

    tiles[1].click();
    assert.deepEqual(opened, ["f2"], "another account's workspace opens through its account");
    tiles[2].click();
    assert.deepEqual(opened, ["f2"], "an expired account does not open");
    assert.deepEqual(added, ["alberto@ytw.mx"], "it asks to sign in again with that email");
    doc.querySelector("[data-add-account]").click();
    assert.deepEqual(added, ["alberto@ytw.mx", null]);
  } finally {
    globalThis.fetch = own;
  }
});
