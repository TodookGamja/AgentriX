const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/deliveryGate.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });

test("agy idle fallback requires a known log, quiet PTY, empty prompt at cursor and no pending delivery", () => {
  const ctx = { source: "transcript.jsonl", startedAt: 100, completedAt: null, sourceModifiedAt: 200 };
  const screen = { lines: ["finished", "> ", "? for shortcuts"], rows: 20, cursorRow: 18, cursorCol: 2 };
  const ready = (c = ctx, s = screen, q = 200, last = 150, pending = false, now = 60_200) => api.agyIdleFallback(c, s, q, last, pending, now);
  assert.equal(ready(), true);
  assert.equal(ready(null), false);
  assert.equal(ready({ ...ctx, source: "agy:no-log" }), false);
  assert.equal(ready({ ...ctx, sourceModifiedAt: 201 }), false);
  assert.equal(ready({ ...ctx, sourceModifiedAt: null }), false);
  assert.equal(ready(ctx, screen, 200, 150, true), false);
  assert.equal(ready(ctx, screen, 200, 200), false);
  assert.equal(ready(ctx, screen, 200, 150, false, 60_199), false);
  assert.equal(ready(ctx, { ...screen, cursorRow: 17 }), false);
  assert.equal(ready(ctx, { ...screen, cursorCol: 10 }), false);
  assert.equal(ready(ctx, { ...screen, lines: ["working", "> typing", "? for shortcuts"] }), false);
  assert.equal(ready(ctx, { ...screen, lines: ["working", "> ", "running"] }), false);
  assert.equal(ready(ctx, { ...screen, lines: ["Working...", "> ", "? for shortcuts"] }), false);
});

test("ambiguous agy log can send once only on a quiet screen, and cannot auto-retry", () => {
  const screen = { lines: ["> ", "? for shortcuts"], rows: 10, cursorRow: 8, cursorCol: 2 };
  assert.equal(api.agyIdleScreen(screen, 200, 150, false, 60_200), true);
  assert.equal(api.agyIdleScreen(screen, 200, 150, true, 60_200), false);
  assert.equal(api.agyIdleScreen(screen, 200, 150, false, 60_199), false);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(app, /allowAgyRetry:\s*!\["agy:ambiguous", "agy:unavailable"\]\.includes\(ctx\.source\)/);
  assert.match(bridge, /verify\.allowAgyRetry !== false/);
  assert.match(app, /!ctx\.source\.startsWith\("agy:"\)/);
});

test("shared idle screen gate rejects pending, active and typed inputs across CLIs", () => {
  const cases = [
    ["claude", ["❯", "bypass permissions on"]],
    ["codex", ["›", "gpt-5.1-codex"]],
    ["cursor", ["→", "ready"]],
    ["antigravity", [">", "? for shortcuts"]],
  ];
  for (const [cli, lines] of cases) {
    const screen = { lines, rows: 10, cursorRow: 8, cursorCol: 1 };
    assert.equal(api.idleScreenFallback(cli, screen, 200, 150, false, 60_200), true, cli);
    assert.equal(api.idleScreenFallback(cli, screen, 200, 150, true, 60_200), false, cli);
    assert.equal(api.idleScreenFallback(cli, screen, 200, 150, false, 60_199), false, cli);
    assert.equal(api.idleScreenFallback(cli, { ...screen, lines: [lines[0] + " typed", lines[1]] }, 200, 150, false, 60_200), false, cli);
    assert.equal(api.idleScreenFallback(cli, { ...screen, rows: 11, cursorRow: 9, lines: ["Working...", ...lines] }, 200, 150, false, 60_200), false, cli);
  }
});
