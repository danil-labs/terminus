/**
 * El cliente del relay del teléfono (`src/lib/hosts.ts`) con un socket falso:
 * los eventos de un workspace no vinculado no llegan, diga su workspace el sobre
 * o el `payload`, y `attention` pierde las entradas de esos workspaces.
 *
 *   node --test apps/mobile/scripts/hosts.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SocketLike } from "@terminus/computers";
import type { EngineEvent } from "@terminus/protocol";
import { relayHost } from "../src/lib/hosts.ts";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send() {}
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

test("el teléfono filtra los eventos por el workspace del payload, como la ventana", async () => {
  const computer = { computer_id: "cmp_vm", name: "VM", state: "online", provider: "aws-ec2", workspaces: ["w1"] };
  const host = relayHost(computer as Parameters<typeof relayHost>[0], { endpoint: "https://computers.example", getToken: () => "jwt" }, () => new FakeSocket());
  const seen: EngineEvent[] = [];
  host.onEvents((events) => seen.push(...events));
  await new Promise((r) => setTimeout(r, 0));
  const socket = FakeSocket.all.at(-1) as FakeSocket;
  socket.readyState = 1;
  socket.onopen?.({});
  const events = [
    { name: "chat", payload: { kind: "delta", workspace: "w1", session: "a" } },
    { name: "chat", payload: { kind: "delta", workspace: "w2", session: "b" } },
    { name: "session", workspace: "w2", payload: { session: "c" } },
    { name: "attention", payload: [{ workspace: "w1", tasks: [] }, { workspace: "w2", tasks: [{ session: "b", project: "", state: "asked" }] }] },
  ];
  socket.onmessage?.({ data: JSON.stringify({ type: "events", cursor: 1, gap: false, replay: false, runtime: "rt", events }) });
  assert.deepEqual(seen, [events[0], { name: "attention", payload: [{ workspace: "w1", tasks: [] }] }]);
  host.close();
});
