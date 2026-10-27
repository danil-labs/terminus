import assert from "node:assert/strict";
import test from "node:test";
import { authDestination, authLocation } from "../../src/web/auth/return.ts";

const origin = "https://app.danil.ai";
const base = "/terminus/";

test("auth preserves a local task or device destination, including its query", () => {
  for (const next of ["/terminus/connect?code=ABCD-EFGH&login_hint=a%40example.com", "/terminus/m/task/c/w/f/t?view=chat", "/terminus/?computer=cmp1"]) {
    assert.equal(authDestination(next, origin, base), next);
    const login = new URL(authLocation("/terminus/auth", origin, next));
    assert.equal(login.searchParams.get("next"), next);
  }
});

test("auth refuses external, malformed, escaped and recursive destinations", () => {
  for (const next of [null, "https://evil.test", "//evil.test/terminus/", "/other/", "/terminus-other/", "/terminus/../other", "/terminus/%2e%2e/other", "/terminus/auth?next=/terminus/auth", "/terminus/%61uth", "/terminus/\\evil", "/terminus/%5cevil", "/terminus/%00evil", "/terminus/%zz", "/terminus/test\n"]) {
    assert.equal(authDestination(next, origin, base), base, String(next));
  }
  assert.equal(authDestination("/custom/connect?code=ABCD-EFGH", origin, "/custom/"), "/custom/connect?code=ABCD-EFGH");
});
