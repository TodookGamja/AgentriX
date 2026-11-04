const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

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
  assert.match(bridge, /session\?\.cliId === "antigravity" \|\| !needsEnterRetry/);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /s\.cliId === "antigravity" \? \[\] : deliveredByScreen/);
});

test("agy retries the full body once after the confirmation timeout", () => {
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(bridge, /AGY_FULL_BODY_RETRY_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(bridge, /session\?\.cliId === "antigravity" && !confirmed && attempt === 0[\s\S]*?data: wrapped[\s\S]*?data: "\\r"/);
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
