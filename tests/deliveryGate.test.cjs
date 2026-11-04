const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const js = ts.transpileModule(fs.readFileSync("src/lib/deliveryGate.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("agy first prompt requires an empty input and its shortcuts footer", () => {
  assert.equal(typeof api.agyFirstPromptReady, "function");
  assert.equal(api.agyFirstPromptReady(["Antigravity CLI 1.5.0", "›", "────", "? for shortcuts"]), true);
  assert.equal(api.agyFirstPromptReady(["Antigravity CLI 1.5.0", "› unfinished", "? for shortcuts"]), false);
  assert.equal(api.agyFirstPromptReady(["Antigravity CLI 1.5.0", "›", "working"]), false);
  assert.equal(api.agyFirstPromptReady(["›", "? for shortcuts", "working"]), false);
});

test("tabs stay active for observed log turns or recent output and stop when idle", () => {
  assert.equal(api.tabIsActive(null, undefined), true);
  assert.equal(api.tabIsActive(100, { startedAt: 120, completedAt: null }), true);
  assert.equal(api.tabIsActive(100, { startedAt: 120, completedAt: 130 }), false);
  assert.equal(api.tabIsActive(100, undefined), false);
});

test("recent output marks every CLI tab active even with a completed Cursor turn", () => {
  for (const cli of ["claude", "codex", "cursor", "agy"]) {
    assert.equal(api.tabIsActive(null, cli === "cursor" ? { startedAt: 100, completedAt: 200 } : undefined), true, cli);
    assert.equal(api.tabIsActive(200, { startedAt: 100, completedAt: 200 }), false, cli);
  }
});

test("busy tabs and split panels retain a static ring when motion is reduced", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /animate-pulse motion-reduce:animate-none ring-2 ring-cyan-400/);
  assert.match(app, /ring-1 ring-cyan-400 shrink-0[\s\S]{0,120}animate-spin motion-reduce:animate-none/);
});

test("tab polling reflects active output for every CLI", async () => {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("setBusySessionIds")) effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  const ids = ["claude", "codex", "cursor", "agy"];
  let visible = "";
  let quiet = null;
  let tick;
  const sandbox = {
    module: { exports: null },
    useAppStore: { getState: () => ({ sessions: ids.map((id) => ({ id, cliId: id })) }) },
    apiGetSessionQuietSince: async () => quiet,
    readCursorTurn: () => ({ startedAt: 100, completedAt: 200 }),
    tabTurnRef: { current: {} }, tabIsActive: api.tabIsActive,
    setBusySessionIds: (value) => { visible = value; },
    window: { setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => {} },
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${effect}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  sandbox.module.exports();
  await new Promise(setImmediate);
  assert.equal(visible, ids.join(","));
  quiet = 200;
  tick();
  await new Promise(setImmediate);
  assert.equal(visible, "");
});

test("Claude local-command completion waits for output to settle and never overrides a running turn", async () => {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "getTurnContext") expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  let quiet = null;
  let ctx = { source: "claude-log", tokens: 10, window: null, startedAt: 50, completedAt: 200 };
  const sandbox = { module: { exports: null }, getLastSubmission: () => 100,
    apiGetSessionContext: async () => ctx, apiGetSessionQuietSince: async (_id, ms) => { assert.equal(ms, 3000); return quiet; },
    logTurnStillBusy: api.logTurnStillBusy, Date };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${expression}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const session = { id: "s", cliId: "claude" };
  assert.equal(await sandbox.module.exports(session, []), null);
  quiet = 200;
  assert.equal((await sandbox.module.exports(session, [])).completedAt, 200);
  ctx = { ...ctx, startedAt: 300, completedAt: null };
  assert.equal((await sandbox.module.exports(session, [])).completedAt, null);
});

test("a running or ambiguous Codex turn cannot be treated as idle on silence", () => {
  assert.equal(api.logTurnStillBusy("codex", { startedAt: 100, completedAt: null }), true);
  assert.equal(api.logTurnStillBusy("codex", { startedAt: 100, completedAt: 200 }), false);
  assert.equal(api.logTurnStillBusy("codex", { startedAt: null, completedAt: null }), true);
  assert.equal(api.logTurnStillBusy("codex", null), false);
});

test("no previous delivery or turn-start evidence proceeds", () => {
  assert.equal(api.deliveryGate(undefined, false, 0, 0), "proceed");
  assert.equal(api.deliveryGate({ at: 1 }, true, 0, 0), "proceed");
});

test("unconfirmed delivery never resends from the queue", () => {
  assert.equal(api.deliveryGate({ at: 1, retriedAt: 2, unconfirmed: true }, false, 9000, 20000), "stuck");
  assert.equal(api.deliveryGate({ at: 1, retriedAt: 2, unconfirmed: true }, true, 9000, 20000), "proceed");
});

test("log-less CLI (a): submitted normally then idle -> proceeds (output after the echo window seen)", () => {
  const p = { at: 1000 };
  assert.equal(api.deliveryGate(p, false, 1000 + api.ECHO_WINDOW_MS + 1, 1000 + 60000), "proceed");
  const busyThenIdle = { at: 1000 }; // 작업 중 관측 → 대기, 멈춘 뒤 진행
  assert.equal(api.deliveryGate(busyThenIdle, false, null, 1000 + 5000), "wait");
  assert.equal(api.deliveryGate(busyThenIdle, false, 1000 + 4000, 1000 + 30000), "proceed");
});

test("log-less CLI (b): unsubmitted -> Enter resent once -> stuck, next body never proceeds", () => {
  const p = { at: 1000 };
  const echoOnly = 1000 + 200; // 붙여넣기 에코만 있고 이후 출력 없음
  assert.equal(api.deliveryGate(p, false, echoOnly, 1000 + 20000), "resend");
  p.retriedAt = 1000 + 20000;
  assert.equal(api.deliveryGate(p, false, p.retriedAt + 100, p.retriedAt + api.STUCK_AFTER_MS), "wait"); // Enter 에코는 시작이 아님
  assert.equal(api.deliveryGate(p, false, p.retriedAt + 100, p.retriedAt + 1 + api.STUCK_AFTER_MS), "stuck");
});

test("busy right after delivery waits without resend or stuck", () => {
  const p = { at: 1000 };
  assert.equal(api.deliveryGate(p, false, null, 1000 + 500), "wait");
  assert.equal(p.started, undefined); // 에코 구간 출력은 시작으로 세지 않음
});

test("App gates sendToIdleTeamSession with deliveryGate and never writes the next prompt before proceed", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const g = app.indexOf("deliveryGate(pending");
  const w = app.indexOf("apiWriteToSession(session.id, prompt, true,");
  assert.ok(g > 0 && w > g);
});
