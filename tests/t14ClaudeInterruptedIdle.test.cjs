const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/deliveryGate.ts", "utf8");
const api = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });

test("Claude interrupted idle screen with shortcuts footer is accepted only after quiet threshold", () => {
  const ctx = { startedAt: 100, completedAt: null };
  const screen = ["Interrupted · What should Claude do instead?", "❯", "? for shortcuts"];
  assert.equal(api.claudeIdleFallback("claude", ctx, screen, 200, 30_199), false);
  assert.equal(api.claudeIdleFallback("claude", ctx, screen, 200, 30_200), true);
  assert.equal(api.claudeIdleFallback("claude", ctx, [screen[0], "❯ still typing", screen[2]], 200, 30_200), false);
  assert.equal(api.claudeIdleFallback("claude", ctx, screen, 99, 40_000), false);
});
