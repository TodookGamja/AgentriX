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

test("pasteWrap brackets long/multi-line bodies only when the backend reports 2004h; Enter retry only when no output after Enter", () => {
  const { pasteWrap, needsEnterRetry } = moduleExports;
  const long = "가".repeat(650);
  assert.equal(pasteWrap(long, false), long); // 미수신·끔 = 현행
  assert.equal(pasteWrap(long, true), `\x1b[200~${long}\x1b[201~`);
  assert.equal(pasteWrap("a\nb", true), "\x1b[200~a\nb\x1b[201~");
  assert.equal(pasteWrap("짧은 한 줄", true), "짧은 한 줄");
  assert.equal(needsEnterRetry(1000, null), true);
  assert.equal(needsEnterRetry(1000, 900), true);
  assert.equal(needsEnterRetry(1000, 1200), false);
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

