import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotOf } from "../src/lib/engine.ts";
import type { Host } from "../src/lib/hosts.ts";

const picture = "data:image/png;base64,cGljdHVyZQ==";
function host(profilesAvailable = true): Host {
  return {
    id: "machine",
    async call(command: string, workspace: string, args: { project?: string; path?: string }) {
      assert.equal(workspace, "workspace");
      let value: unknown = [];
      if (command === "list_projects") value = [{ id: "folder" }];
      if (command === "list_agents") value = { agents: [{ name: "Ada" }] };
      if (command === "list_agent_profiles") {
        if (!profilesAvailable) throw new Error("old engine");
        assert.equal(args.project, "folder");
        value = { Ada: { body: "moon", avatar: "/private/avatar.png" } };
      }
      if (command === "preview_file") {
        assert.equal(args.path, "/private/avatar.png");
        value = { kind: "image", data_url: picture };
      }
      return { value, cachedAt: null };
    },
  } as unknown as Host;
}

test("la identidad de un agente conserva el cuerpo y lleva la imagen del motor, no una ruta local del teléfono", async () => {
  const snapshot = await snapshotOf(host(), "workspace");
  assert.equal(snapshot.agents[0].body, "moon");
  assert.equal(snapshot.agents[0].avatar, picture);
  assert.deepEqual(snapshot.agents[0].places, [{ host: "machine", folder: "folder", body: "moon", avatar: picture }]);
});

test("un motor sin perfiles conserva el agente y permite dibujar su cuerpo por nombre", async () => {
  const snapshot = await snapshotOf(host(false), "workspace");
  assert.equal(snapshot.agents[0].name, "Ada");
  assert.equal(snapshot.agents[0].body, null);
  assert.equal(snapshot.agents[0].avatar, null);
});
