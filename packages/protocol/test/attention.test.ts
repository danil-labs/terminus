import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAttention } from "../src/index.ts";

test("una entrada de `attention` cambia solo su workspace", () => {
  const before = [{ workspace: "a", tasks: [1] }, { workspace: "b", tasks: [2] }];
  assert.deepEqual(mergeAttention(before, [{ workspace: "b", tasks: [] }]), [{ workspace: "a", tasks: [1] }, { workspace: "b", tasks: [] }]);
  assert.deepEqual(mergeAttention(before, [{ workspace: "c", tasks: [3] }]), [...before, { workspace: "c", tasks: [3] }]);
  assert.deepEqual(mergeAttention([], before), before, "la lista entera también vale");
});
