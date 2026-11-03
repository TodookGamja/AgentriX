const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/sessionWriteQueue.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
vm.runInNewContext(js, { exports: moduleExports, Promise, Map });
const { queueSessionWrite } = moduleExports;

test("chat clears before waiting for delivery and restores failed drafts", () => {
  const source = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  const send = source.slice(source.indexOf("const handleSendChatPrompt"), source.indexOf("const handleQueuePrompt"));
  assert.ok(send.indexOf('setPromptText("")') < send.indexOf("await onBroadcastToProject"));
  assert.match(send, /catch \(error\)[\s\S]*setPromptText\(\(current\)/);
  assert.match(send, /setAttachments\(\(current\)/);
});

test("serializes writes per session and continues after a failed write", async () => {
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queueSessionWrite("a", async () => { events.push("start"); await gate; events.push("end"); });
  const second = queueSessionWrite("a", async () => { events.push("second"); });
  await queueSessionWrite("b", async () => { events.push("other session"); });
  assert.deepEqual(events, ["start", "other session"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["start", "other session", "end", "second"]);
  await assert.rejects(queueSessionWrite("a", async () => { throw new Error("failed"); }));
  await queueSessionWrite("a", async () => { events.push("recovered"); });
  assert.equal(events.at(-1), "recovered");
});

test("enterReady waits for the CLI to echo the body before sending Enter", () => {
  const { enterReady } = moduleExports;
  assert.equal(enterReady(1000, 900, 1500, 1500), false); // 본문 이후 출력 없음
  assert.equal(enterReady(1000, null, 4000, 1500), true); // 3초 지나면 그냥 보냄
  assert.equal(enterReady(1000, 1050, 1120, 1500), false); // 반영 직후, 아직 출력 중일 수 있음
  assert.equal(enterReady(1000, 1050, 1150, 1500), true); // 반영 후 100ms 조용
  assert.equal(enterReady(1000, 2490, 2500, 1500), true); // 계속 출력 중이면 기존 대기 후
});

test("paste wrapping and submission evidence", () => {
  const { pasteWrap, needsEnterRetry, submissionStarted } = moduleExports;
  const long = "가".repeat(650);
  assert.equal(pasteWrap(long, false), long);
  assert.equal(pasteWrap(long, false, "codex"), `\x1b[200~${long}\x1b[201~`);
  assert.equal(pasteWrap(long, null, "codex"), `\x1b[200~${long}\x1b[201~`);
  assert.equal(pasteWrap(long, true), `\x1b[200~${long}\x1b[201~`);
  assert.equal(pasteWrap("a\nb", true), "\x1b[200~a\nb\x1b[201~");
  assert.equal(pasteWrap("short", true), "short");
  assert.equal(needsEnterRetry(submissionStarted("redrawn input", false), false), true);
  assert.equal(needsEnterRetry(submissionStarted("redrawn input", true), false), false);
  assert.equal(needsEnterRetry(submissionStarted("redrawn input", false), true), false);
  assert.equal(submissionStarted("\x1b]7501;state=working:app=codex", null), true);
  assert.equal(submissionStarted("esc\x1b[1Cto\x1b[1Cinterrupt", null), true);
  assert.equal(submissionStarted("redrawn input", null), false);
  assert.equal(needsEnterRetry(submissionStarted("new turn", true, true), false), true);
  assert.equal(needsEnterRetry(submissionStarted("new turn", true, false), false), false);
  assert.equal(needsEnterRetry(submissionStarted("new turn", true, true), true), false);
});

test("apiWriteToSession asks the backend for paste mode, writes the body, then Enter separately; no frontend tracker left", () => {
  const src = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  const m = src.indexOf('"get_session_paste_mode"');
  const w = src.indexOf("data: wrapped }", m);
  const e = src.indexOf('data: "\\r" }', w);
  assert.ok(m > 0 && w > m && e > w);
  assert.ok(!fs.readFileSync("src/lib/sessionWriteQueue.ts", "utf8").includes("trackPasteMode"));
  assert.ok(!fs.readFileSync("src/components/TerminalPane.tsx", "utf8").includes("trackPasteMode"));
});


test("team delivery verifies turn start and stops when user types", () => {
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  const block = bridge.slice(bridge.indexOf("export async function apiWriteToSession"), bridge.indexOf("export interface TeamMail"));
  assert.match(block, /get_session_paste_mode/);
  assert.match(block, /submissionStarted\(output,/);
  assert.match(block, /getUserInputVersion\(sessionId\) !== inputVersion/);
  assert.match(block, /attempt < 3/);
});
