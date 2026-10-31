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

test("injected input updates turn tracking but not instruction history or typed buffer", () => {
  const before = api.getSubmissionVersion("inj");
  api.recordSessionInput("inj", "[역할 브리핑] 당신은 Pixel입니다\r", true);
  assert.equal(api.getSubmissionVersion("inj"), before + 1);
  assert.equal(api.getSessionInputHistory("inj").length, 0);
  assert.equal(api.hasPendingSessionInput("inj"), false);
  api.recordSessionInput("inj", "사용자 지시\r");
  assert.equal(JSON.stringify(api.getSessionInputHistory("inj")), JSON.stringify(["사용자 지시"]));
});
