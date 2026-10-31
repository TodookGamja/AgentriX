const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/miniQuotaCache.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, JSON });

const sample = {
  cliId: "claude",
  cliName: "Claude Code",
  planLabel: "Claude Pro",
  accentColor: "#f97316",
  remainPct5h: 46,
  remainPctWeekly: 74,
  resetsAt5h: "18:00",
  resetsAtWeekly: "03/01 09:00",
};

test("restores per-cli cache before global cache; rejects stale 13:50 dummy", () => {
  const store = new Map();
  store.set(
    "agentrix_mini_quota_cached",
    JSON.stringify({ ...sample, cliId: "global", remainPct5h: 10 })
  );
  store.set("agentrix_mini_quota_claude", JSON.stringify(sample));
  store.set(
    "agentrix_mini_quota_antigravity",
    JSON.stringify({ ...sample, cliId: "antigravity", resetsAt5h: "13:50" })
  );

  const getItem = (key) => store.get(key) ?? null;
  assert.deepEqual(api.restoreMiniQuotaCache(getItem, "claude"), sample);

  const stale = api.restoreMiniQuotaCache(getItem, "antigravity");
  assert.equal(stale.cliId, "global");
  assert.equal(api.parseMiniQuotaCache('{"cliId":"x","resetsAt5h":"13:50"}'), null);
  assert.equal(api.parseMiniQuotaCache("not-json"), null);
});

test("live quota gate rejects empty shell; persist writes both keys", () => {
  assert.equal(api.isLiveQuotaUsable(null), false);
  assert.equal(api.isLiveQuotaUsable({ hasOfficialQuota: false, resetsAt5h: null }), false);
  assert.equal(api.isLiveQuotaUsable({ hasOfficialQuota: true, resetsAt5h: null }), true);
  assert.equal(api.isLiveQuotaUsable({ hasOfficialQuota: false, resetsAt5h: "18:00" }), true);

  const writes = new Map();
  api.persistMiniQuotaCache((k, v) => writes.set(k, v), sample);
  assert.equal(writes.get("agentrix_mini_quota_cached"), JSON.stringify(sample));
  assert.equal(writes.get("agentrix_mini_quota_claude"), JSON.stringify(sample));
});

test("App restores cache on focus and persists only live quota", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /restoreMiniQuotaCache\(\(k\) => localStorage\.getItem\(k\), focusedCliId\)/);
  assert.match(app, /if \(isLiveQuotaUsable\(sidebarQuota\)\)/);
  assert.match(app, /persistMiniQuotaCache\(\(k, v\) => localStorage\.setItem\(k, v\), updated\)/);
  assert.match(app, /isSidebarQuotaValid = isLiveQuotaUsable\(sidebarQuota\)/);
});

test("regression: persist → restore round-trip for focused cli", () => {
  const store = new Map();
  api.persistMiniQuotaCache((k, v) => store.set(k, v), sample);
  const restored = api.restoreMiniQuotaCache((k) => store.get(k) ?? null, "claude");
  assert.deepEqual(restored, sample);
  assert.equal(api.restoreMiniQuotaCache(() => null, "claude"), null);
});

test("regression: missing per-cli falls back to global; empty store yields null", () => {
  const store = new Map();
  store.set(
    "agentrix_mini_quota_cached",
    JSON.stringify({ ...sample, cliId: "global", remainPct5h: 33 })
  );
  const fallback = api.restoreMiniQuotaCache((k) => store.get(k) ?? null, "codex");
  assert.equal(fallback.cliId, "global");
  assert.equal(fallback.remainPct5h, 33);
  assert.equal(api.restoreMiniQuotaCache(() => null, "codex"), null);
});

test("regression: 13:50 sentinel in either per-cli or global cache is discarded", () => {
  const store = new Map();
  store.set(
    "agentrix_mini_quota_claude",
    JSON.stringify({ ...sample, resetsAtWeekly: "13:50" })
  );
  store.set(
    "agentrix_mini_quota_cached",
    JSON.stringify({ ...sample, cliId: "global", resetsAt5h: "13:50" })
  );
  assert.equal(api.restoreMiniQuotaCache((k) => store.get(k) ?? null, "claude"), null);
});

test("regression: focus switch restores matching per-cli snapshot after persist", () => {
  const store = new Map();
  const claude = { ...sample, cliId: "claude", remainPct5h: 40 };
  const codex = {
    ...sample,
    cliId: "codex",
    cliName: "Codex",
    remainPct5h: 88,
    resetsAt5h: "21:00",
  };
  api.persistMiniQuotaCache((k, v) => store.set(k, v), claude);
  api.persistMiniQuotaCache((k, v) => store.set(k, v), codex);
  assert.equal(api.restoreMiniQuotaCache((k) => store.get(k) ?? null, "claude").remainPct5h, 40);
  assert.equal(api.restoreMiniQuotaCache((k) => store.get(k) ?? null, "codex").remainPct5h, 88);
  // global key last written by codex persist
  assert.equal(
    JSON.parse(store.get("agentrix_mini_quota_cached")).cliId,
    "codex"
  );
});

test("regression: corrupt per-cli JSON falls through to global when global is clean", () => {
  const store = new Map();
  store.set("agentrix_mini_quota_claude", "{not-json");
  store.set(
    "agentrix_mini_quota_cached",
    JSON.stringify({ ...sample, cliId: "global", remainPct5h: 12 })
  );
  const restored = api.restoreMiniQuotaCache((k) => store.get(k) ?? null, "claude");
  assert.equal(restored.cliId, "global");
  assert.equal(restored.remainPct5h, 12);
});
