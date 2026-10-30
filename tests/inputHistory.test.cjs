const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/inputHistory.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, Date, Map });

test("stale typed buffer stops blocking team delivery after TTL", () => {
  api.recordSessionInput("s1", "abc");
  const now = Date.now();
  assert.equal(api.hasPendingSessionInput("s1", now), true);
  assert.equal(api.hasPendingSessionInput("s1", now + api.PENDING_INPUT_TTL_MS + 1), false);
  api.recordSessionInput("s1", "\r");
  assert.equal(api.hasPendingSessionInput("s1", now), false);
});
