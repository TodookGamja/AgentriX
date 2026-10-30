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
