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
