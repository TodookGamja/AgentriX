const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

test("a fresh agy with no log proceeds only at a quiet empty prompt", async () => {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "getTurnContext") initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer);
  const gate = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/deliveryGate.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: gate });
  let context = { source: "agy:no-log", startedAt: null, completedAt: null, tokens: 0, window: null };
  let quiet = 123;
  let lines = ["Antigravity CLI 1.5.0", ">", "────", "? for shortcuts"];
  let lastSubmit = 0;
  const sandbox = {
    module: { exports: null },
    apiGetSessionContext: async () => context,
    apiGetSessionQuietSince: async () => quiet,
    apiGetSessionScreen: async () => null,
    pendingDeliveryRef: { current: {} },
    useSessionQueue: { getState: () => ({ queues: {} }) },
    queueKey: () => "key",
    getTeamMailDeliveries: () => [],
    agyIdleScreen: gate.agyIdleScreen,
    agyMissingContextFallback: gate.agyMissingContextFallback,
    idleScreenFallback: gate.idleScreenFallback,
    agyIdleFallback: gate.agyIdleFallback,
    AGY_IDLE_FALLBACK_MS: gate.AGY_IDLE_FALLBACK_MS,
    refreshTerminalScreen: async () => {},
    readTerminalTranscript: () => lines,
    getLastSubmission: () => lastSubmit,
    hasPendingSessionInput: () => false,
    agyFirstPromptReady: gate.agyFirstPromptReady,
    logTurnStillBusy: gate.logTurnStillBusy,
    agyBootstrapRef: { current: null },
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${initializer}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const check = sandbox.module.exports;
  const session = { id: "s", cliId: "antigravity", resumed: false };
  assert.equal((await check(session, [])).completedAt, 123);
  assert.equal(await check({ ...session, resumed: true }, []), null);
  quiet = null;
  assert.equal(await check(session, []), null);
  quiet = 123;
  lines = ["> input", "? for shortcuts"];
  assert.equal(await check(session, []), null);
  lines = [">", "? for shortcuts"];
  lastSubmit = 100;
  assert.equal(await check(session, []), null);
  lastSubmit = 0;
  context = null;
  assert.equal(await check(session, []), null);
  const bootstrap = { sessionId: "s", body: "ROLE task", at: 100 };
  sandbox.agyBootstrapRef.current = bootstrap;
  sandbox.pendingDeliveryRef = { current: { s: { unconfirmed: true } } };
  sandbox.contextSourceRef = { current: {} };
  sandbox.confirmRestoredPrefix = () => true;
  sandbox.apiAgyMessageSubmitted = async () => false;
  context = { source: "actual-log", completedAt: 200 };
  assert.equal(await check(session, []), null);
  assert.equal(sandbox.agyBootstrapRef.current, bootstrap);
  sandbox.apiAgyMessageSubmitted = async () => true;
  assert.equal((await check(session, [])).source, "actual-log");
  assert.equal(sandbox.agyBootstrapRef.current, null);
  assert.equal(sandbox.contextSourceRef.current.s, "actual-log");
  assert.equal(sandbox.pendingDeliveryRef.current.s, undefined);
  context = { source: "agy:ambiguous", startedAt: null, completedAt: null, tokens: 0, window: null };
  quiet = Date.now() - 61_000;
  sandbox.apiGetSessionScreen = async () => ({ lines: [">", "? for shortcuts"], rows: 2, cursorRow: 0, cursorCol: 1 });
  assert.equal((await check(session, [])).source, "agy:ambiguous");
  assert.equal((await check(session, [])).completedAt, quiet);
  sandbox.pendingDeliveryRef.current.s = { at: quiet - 1, unconfirmed: true };
  assert.equal((await check(session, [])).completedAt, null);
  context = null;
  assert.equal(await check(session, []), null);
  delete sandbox.pendingDeliveryRef.current.s;
  assert.equal((await check(session, [])).source, "agy:unavailable");
  sandbox.apiGetSessionScreen = async () => ({ lines: ["Working...", ">", "? for shortcuts"], rows: 3, cursorRow: 1, cursorCol: 1 });
  assert.equal(await check(session, []), null);
  sandbox.readCursorTurn = () => null;
  sandbox.readTerminalScreen = () => ({ lines: ["→", "Ready"] });
  lastSubmit = 100;
  sandbox.apiGetSessionScreen = async () => ({ lines: ["→", "Ready"], rows: 2, cursorRow: 0, cursorCol: 1 });
  assert.equal((await check({ ...session, cliId: "cursor" }, [])).completedAt, quiet);
  sandbox.apiGetSessionScreen = async () => ({ lines: ["Working...", "❯", "? for shortcuts"], rows: 3, cursorRow: 1, cursorCol: 1 });
  assert.equal(await check({ ...session, cliId: "claude" }, []), null);
  assert.equal(await check({ ...session, cliId: "grok" }, []), null);
  assert.equal(await check({ ...session, cliId: "opencode" }, []), null);
});

test("simultaneous new agy sessions serialize first-delivery checks", async () => {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "sendToIdleTeamSessionRaw") initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer);
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const checks = [];
  const deadlines = [];
  class Attempt { constructor() { this.committed = false; } check() {} step() {} }
  const sandbox = {
    module: { exports: null }, crypto: { randomUUID: () => "attempt" }, DeliveryAttempt: Attempt,
    AGY_BOOTSTRAP_TTL_MS: Number(fs.readFileSync("src/App.tsx", "utf8").match(/^const AGY_BOOTSTRAP_TTL_MS = ([\d_]+);/m)[1].replace(/_/g, "")),
    SUBMISSION_UNCONFIRMED_REASON: eval(fs.readFileSync("src/App.tsx", "utf8").match(/^const SUBMISSION_UNCONFIRMED_REASON = (".*");/m)[1]),
    useAppStore: { getState: () => ({ sessions: [{ id: "one" }, { id: "two" }] }) },
    teamDeliveryLocksRef: { current: new Set() }, agyBootstrapRef: { current: null },
    optimizationRunningRef: { current: new Set() }, sendBlockReasonRef: { current: {} },
    contextSourceRef: { current: {} }, hasPendingSessionInput: () => false, getLastSubmission: () => 0,
    withDeliveryDeadline: async (_attempt, fn, ms) => { deadlines.push(ms); return fn(); },
    getTurnContext: async (session) => { checks.push(session.id); await delayed; return null; },
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${initializer}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const send = sandbox.module.exports;
  const first = send({ id: "one", cliId: "antigravity" }, "first\r");
  assert.equal(await send({ id: "two", cliId: "antigravity" }, "second\r"), false);
  assert.deepEqual(checks, ["one"]);
  assert.equal(deadlines[0], 30_000);
  release();
  assert.equal(await first, false);
  assert.equal(sandbox.agyBootstrapRef.current, null);
  assert.equal(await send({ id: "three", cliId: "claude" }, "third\r"), false);
  assert.equal(deadlines[deadlines.length - 1], 15_000);
});

test("agy recovery requires the same session, source, completed turn and matching submission", async () => {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "agyCompletedAttempt") initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer);
  const item = { id: "mail:1", attempt: { sessionId: "session", source: "log", body: "sent message", at: 100 } };
  let match = false;
  const sandbox = {
    module: { exports: null },
    useSessionQueue: { getState: () => ({ queues: { key: [item] } }) },
    queueKey: () => "key",
    apiAgyMessageSubmitted: async (_id, body, at, _claimed, source) => match && body === item.attempt.body && at === 100 && source === "log",
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${initializer}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const check = sandbox.module.exports;
  const session = { id: "session", cliId: "antigravity" };
  const completed = { source: "log", completedAt: 101 };
  assert.equal(await check(session, item.id, [], completed), false);
  match = true;
  assert.equal(await check(session, item.id, [], completed), true);
  item.attempt.source = "agy:no-log";
  assert.equal(await check(session, item.id, [], completed), true);
  for (const source of ["agy:ambiguous", "agy:unavailable", "agy:unavailable_no_log"]) {
    item.attempt.source = source;
    match = false;
    assert.equal(await check(session, item.id, [], completed), false);
    match = true;
    assert.equal(await check(session, item.id, [], completed), true);
  }
  item.attempt.source = "log";
  assert.equal(await check(session, item.id, [], { source: "other", completedAt: 101 }), false);
  assert.equal(await check(session, item.id, [], { source: "log" }), false);
  assert.equal(await check({ ...session, id: "other" }, item.id, [], completed), false);
  assert.equal(await check({ ...session, cliId: "claude" }, item.id, [], completed), false);
  item.payload = "sent message";
  delete item.attempt;
  sandbox.getTeamMailDeliveries = () => [{ id: "1", project: "project", agentId: "agent", sessionId: "session", submittedAt: 100 }];
  sandbox.apiAgyMessageSubmitted = async (_id, body) => body === "sent message";
  assert.equal(await check({ ...session, cwd: "project", agentId: "agent" }, item.id, [], completed), true);
  assert.equal(await check({ ...session, cwd: "other", agentId: "agent" }, item.id, [], completed), false);
});

test("agy does not retry Enter when submission is unconfirmed", () => {
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(bridge, /session\?\.cliId === "antigravity" \|\| verify\.allowRetry === false \|\| !needsEnterRetry/);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /s\.cliId === "antigravity" \? \[\] : deliveredByScreen/);
});

test("agy retries the full body once after the confirmation timeout", () => {
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(bridge, /AGY_FULL_BODY_RETRY_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(bridge, /session\?\.cliId === "antigravity" && verify\.allowAgyRetry !== false && !confirmed && attempt === 0[\s\S]*?data: wrapped[\s\S]*?data: "\\r"/);
  assert.match(bridge, /retry_full_body/);
});

test("unconfirmed agy deliveries cannot ACK by startedAt alone", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.equal((app.match(/unconfirmed && session\.cliId === "antigravity" && !agyConfirmed/g) ?? []).length, 2);
  assert.match(app, /const SUBMISSION_UNCONFIRMED_REASON = "입력창에 멈춤: 전달의 제출을 확인하지 못했습니다"/);
  assert.equal((app.match(/blocked\(SUBMISSION_UNCONFIRMED_REASON\)/g) ?? []).length, 2);
});

test("agy failed queue items stay unconfirmed and retain their mail reservation", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /unconfirmed: agyUnconfirmed/);
  assert.match(app, /if \(!queued\?\.unconfirmed && sendBlockReasonRef\.current\[session\.id\] !== SUBMISSION_UNCONFIRMED_REASON\) removeTeamMailDelivery/);
  assert.match(app, /sendBlockReasonRef\.current\[target\.id\] !== SUBMISSION_UNCONFIRMED_REASON/);
  assert.match(app, /sendBlockReasonRef\.current\[pmSession\.id\] !== SUBMISSION_UNCONFIRMED_REASON/);
});
