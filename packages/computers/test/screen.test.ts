import assert from "node:assert/strict";
import { test } from "node:test";
import { SCREEN_SUBPROTOCOL, screenEnd, screenProtocols, screenUrl } from "../src/index.ts";

test("el visor va a /screen del mismo relay, con el token en el subprotocolo", () => {
  assert.equal(screenUrl("computers.danil.ai", "c_1"), "wss://computers.danil.ai/v1/computers/c_1/screen");
  assert.equal(screenUrl("https://computers-dev.danil.ai/", "a b"), "wss://computers-dev.danil.ai/v1/computers/a%20b/screen");
  assert.deepEqual(screenProtocols("t0k"), [SCREEN_SUBPROTOCOL, "bearer.t0k"]);
});

test("los cierres del relay dicen por qué no hay pantalla", () => {
  assert.equal(screenEnd(4010), "offline");
  assert.equal(screenEnd(4011), "unavailable");
  assert.equal(screenEnd(4013), "busy");
  assert.equal(screenEnd(1000), "ended");
  assert.equal(screenEnd(1006), "ended");
});
