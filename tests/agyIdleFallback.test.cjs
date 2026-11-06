const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/deliveryGate.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });

test("active transcript falls back only for a stable idle screen", () => {
  const ctx = { startedAt: 100, completedAt: null, source: "transcript.jsonl", sourceModifiedAt: 200 };
  for (const [cli, lines] of [["antigravity", ["> ", "? for shortcuts   Gemini"]], ["claude", ["❯", "? for shortcuts"]], ["codex", ["›", "gpt-5.1-codex"]], ["cursor", ["→", "ready"]]]) {
    const screen = { lines, rows: 10, cursorRow: 8, cursorCol: 1 };
    assert.equal(api.activeLogIdleFallback(cli, ctx, screen, 200, 150, false, 60_200), true, cli);
    assert.equal(api.activeLogIdleFallback(cli, { ...ctx, sourceModifiedAt: 201 }, screen, 200, 150, false, 60_200), false, cli);
    assert.equal(api.activeLogIdleFallback(cli, ctx, screen, null, 150, false, 60_200), false, cli);
    assert.equal(api.activeLogIdleFallback(cli, ctx, { ...screen, lines: ["Working...", ...lines], rows: 11, cursorRow: 9 }, 200, 150, false, 60_200), false, cli);
    assert.equal(api.activeLogIdleFallback(cli, ctx, screen, 200, 150, true, 60_200), false, cli);
  }
});

test("Codex placeholder is idle only without a working indicator", () => {
  const screen = { lines: ["› Ask Codex to do anything", "GPT-6.1 Terra medium"], rows: 10, cursorRow: 8, cursorCol: 1 };
  assert.equal(api.idleScreenFallback("codex", screen, 200, 150, false, 60_200), true);
  assert.equal(api.idleScreenFallback("codex", { ...screen, lines: ["Working (esc to interrupt)", ...screen.lines], rows: 11, cursorRow: 9 }, 200, 150, false, 60_200), false);
  assert.equal(api.idleScreenFallback("codex", { ...screen, cursorCol: 4 }, 200, 150, false, 60_200), false);
});

test("resumed agy without a transcript can fall back to a quiet idle screen", () => {
  const screen = { lines: ["> ", "? for shortcuts"], rows: 10, cursorRow: 8, cursorCol: 1 };
  assert.equal(api.agyMissingContextFallback("agy:unavailable_no_log", "agy:unavailable_no_log", screen, 200, 150, false, 60_200), true);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /session\.resumed\)\).*agyUnresolved/s);
  assert.match(app, /context_\$\{contextKind\}/);
  assert.match(app, /"lookup_failed"/);
});

test("two codex sessions without attributable logs can use a quiet idle screen", () => {
  const screen = { lines: ["›", "gpt-5.1-codex"], rows: 10, cursorRow: 8, cursorCol: 1 };
  assert.equal(api.idleScreenFallback("codex", screen, 200, 150, false, 60_200), true);
  assert.equal(api.idleScreenFallback("codex", screen, 200, 150, true, 60_200), false);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /\["claude", "codex", "cursor"\]\.includes\(session\.cliId\) && !ctx/);
  assert.match(app, /screen:\$\{session\.cliId\}:\$\{session\.id\}/);
});

test("missing agy context allows only a stable idle screen without unresolved delivery", () => {
  const screen = { lines: ["finished", "> ", "? for shortcuts"], rows: 20, cursorRow: 18, cursorCol: 2 };
  const ready = (source, latest, s = screen, pending = false) => api.agyMissingContextFallback(source, latest, s, 200, 150, pending, 60_200);
  assert.equal(ready(null, null), true);
  assert.equal(ready("agy:no-log", "agy:no-log"), true);
  assert.equal(ready("agy:unavailable_no_log", "agy:unavailable_no_log"), true);
  assert.equal(ready(null, null, { ...screen, lines: ["Working...", "> ", "? for shortcuts"] }), false);
  assert.equal(ready(null, null, screen, true), false);
  assert.equal(ready(null, "actual-transcript"), false);
});

test("quiet spinner or tool activity never qualifies as an idle prompt", () => {
  for (const [cli, prompt, footer] of [["antigravity", ">", "? for shortcuts"], ["claude", "❯", "? for shortcuts"], ["codex", "›", "gpt-5.1-codex"], ["cursor", "→", "Ready"]]) {
    for (const work of ["⠋ thinking", "Running tool..."]) {
      const screen = { lines: [work, prompt, footer], rows: 3, cursorRow: 1, cursorCol: 1 };
      assert.equal(api.idleScreenFallback(cli, screen, 200, 150, false, 60_200), false, `${cli}: ${work}`);
    }
  }
});

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
