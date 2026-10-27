import assert from "node:assert/strict";
import { test } from "node:test";
import type { Host } from "../src/lib/hosts.ts";
import { diskUsage, storageDetail, storageSummary } from "../src/lib/storage.ts";

test("storage captures its host and workspace; offline or missing destinations never send", async () => {
  const calls: unknown[][] = [];
  let power = "on";
  const host = { power: () => power, linked: new Set(["w"]), call: async (...args: unknown[]) => {
    calls.push(args);
    return { value: { workspaces: [{ id: "w", name: "Work" }], machine_resources: { measured_at: 1, storage: [] } }, cachedAt: null };
  } } as unknown as Host;
  assert.equal((await storageSummary(host)).resources?.measured_at, 1);
  await storageDetail(host, "w");
  assert.deepEqual(calls, [["list_workspaces", null, {}], ["list_storage", "w", { refrescar: true }]]);
  await assert.rejects(storageDetail(host, "another"));
  power = "off";
  await assert.rejects(storageSummary(host));
  await assert.rejects(storageDetail(host, "w"));
  assert.equal(calls.length, 2);
});

test("disk percentages require comparable known capacity; unknown is never zero", () => {
  const disk = { id: "volume", label: "Engine data", total_bytes: 100, free_bytes: 30, available_bytes: 20, terminus_bytes: null, attribution: "unknown" as const };
  assert.deepEqual(diskUsage(disk), { used: 70, percent: 70 });
  for (const invalid of [{ total_bytes: 0 }, { total_bytes: NaN }, { free_bytes: 101 }, { available_bytes: 31 }, { free_bytes: -1 }]) assert.equal(diskUsage({ ...disk, ...invalid }), null);
});
