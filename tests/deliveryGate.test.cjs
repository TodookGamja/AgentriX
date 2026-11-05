const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const js = ts.transpileModule(fs.readFileSync("src/lib/deliveryGate.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("Claude idle fallback requires a quiet empty prompt and permission footer", () => {
  const ctx = { startedAt: 100, completedAt: null };
  const idle = ["❯ [완료 보고] T1", "❯", "⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent"];
  assert.equal(api.claudeIdleFallback("claude", ctx, idle, 200, 30_200), true);
  assert.equal(api.claudeIdleFallback("claude", ctx, idle, 200, 30_199), false);
  assert.equal(api.claudeIdleFallback("codex", ctx, idle, 200, 30_200), false);
  assert.equal(api.claudeIdleFallback("claude", ctx, ["❯ some input", idle[2]], 200, 30_200), false);
  assert.equal(api.claudeIdleFallback("claude", ctx, [...idle, "working"], 200, 30_200), false);
  assert.equal(api.claudeIdleFallback("claude", ctx, ["❯", "Allow this action?"], 200, 30_200), false);
  assert.equal(api.claudeIdleFallback("claude", ctx, idle, 99, 40_000), false);
  assert.equal(api.claudeIdleFallback("claude", { startedAt: 100, completedAt: 150 }, idle, 200, 30_200), false);
});

test("Codex idle fallback needs an empty prompt, model footer, and quiet output", () => {
  const ctx = { startedAt: 100, completedAt: null };
  const screen = ["■ Conversation interrupted", "› Ask Codex to do anything", "GPT-6.1 Terra high · project"];
  assert.equal(api.codexInterruptedIdle("codex", ctx, screen, 200, 10_200), true);
  assert.equal(api.codexInterruptedIdle("codex", ctx, screen, 200, 10_199), false);
  assert.equal(api.codexInterruptedIdle("codex", ctx, screen, 99, 20_000), false);
  assert.equal(api.codexInterruptedIdle("claude", ctx, screen, 200, 10_200), false);
  assert.equal(api.codexInterruptedIdle("codex", ctx, ["› draft", "GPT-6.1 Terra high"], 200, 10_200), false);
  assert.equal(api.codexInterruptedIdle("codex", ctx, ["› Ask Codex to do anything", "working"], 200, 10_200), false);
  assert.equal(api.codexInterruptedIdle("codex", ctx, [...screen, "working"], 200, 10_200), false);
});

test("agy first prompt requires an empty input and its shortcuts footer", () => {
  assert.equal(typeof api.agyFirstPromptReady, "function");
  assert.equal(api.agyFirstPromptReady(["Antigravity CLI 1.5.0", "›", "────", "? for shortcuts"]), true);
  assert.equal(api.agyFirstPromptReady(["Antigravity CLI 1.5.0", "› unfinished", "? for shortcuts"]), false);
  assert.equal(api.agyFirstPromptReady(["Antigravity CLI 1.5.0", "›", "working"]), false);
  assert.equal(api.agyFirstPromptReady(["›", "? for shortcuts", "working"]), false);
});

test("tabs stay active for observed log turns or recent output and stop when idle", () => {
  assert.equal(api.tabIsActive(null, undefined), true);
  assert.equal(api.tabIsActive(100, { startedAt: 120, completedAt: null }, 150), true);
  assert.equal(api.tabIsActive(100, { startedAt: 120, completedAt: null }, 100 + 120_000), false); // 중단·고아 턴은 영영 깜빡이지 않음
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
    tabTurnRef: { current: {} }, tabOutputPrevRef: { current: new Set() }, Date, tabIsActive: api.tabIsActive,
    setBusySessionIds: (value) => { visible = value; },
    window: { setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => {} },
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${effect}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  sandbox.module.exports();
  await new Promise(setImmediate);
  assert.equal(visible, ""); // 출력 한 번(유휴 재그리기)은 응답 중이 아님
  tick();
  await new Promise(setImmediate);
  assert.equal(visible, ids.join(",")); // 두 틱 연속 출력 = 응답 중
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
  let ctx = { source: "claude-log", tokens: 10, window: null, startedAt: 50, completedAt: 200, sourceModifiedAt: Date.now() - 61_000 };
  const sandbox = { module: { exports: null }, getLastSubmission: () => 100,
    apiGetSessionContext: async () => ctx, apiGetSessionQuietSince: async (_id, ms) => { assert.ok(ms === 3000 || ms === 60000); return quiet; },
    apiGetSessionScreen: async () => ({ lines: ["❯", "⏵⏵ bypass permissions on"], rows: 2, cursorRow: 0, cursorCol: 1 }),
    AGY_IDLE_FALLBACK_MS: api.AGY_IDLE_FALLBACK_MS, idleScreenFallback: api.idleScreenFallback,
    hasPendingSessionInput: () => false, useSessionQueue: { getState: () => ({ queues: {} }) }, queueKey: () => "key", getTeamMailDeliveries: () => [],
    pendingDeliveryRef: { current: {} }, refreshTerminalScreen: async () => {}, readTerminalScreen: () => ["❯", "⏵⏵ bypass permissions on"],
    claudeIdleFallback: api.claudeIdleFallback, logTurnStillBusy: api.logTurnStillBusy, Date };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${expression}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const session = { id: "s", cliId: "claude" };
  assert.equal(await sandbox.module.exports(session, []), null);
  quiet = 200;
  assert.equal((await sandbox.module.exports(session, [])).completedAt, 200);
  ctx = { ...ctx, startedAt: 300, completedAt: null };
  assert.equal((await sandbox.module.exports(session, [])).completedAt, null);
  quiet = Date.now() - 61_000;
  assert.equal((await sandbox.module.exports(session, [])).completedAt, quiet);
  sandbox.pendingDeliveryRef.current.s = { at: 250, unconfirmed: true };
  assert.equal((await sandbox.module.exports(session, [])).completedAt, null);
  sandbox.pendingDeliveryRef.current.s = { at: 250, started: true };
  const completed = await sandbox.module.exports(session, []);
  assert.equal(api.deliveryGate(sandbox.pendingDeliveryRef.current.s, completed.completedAt > 250, quiet, Date.now()), "proceed");
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
