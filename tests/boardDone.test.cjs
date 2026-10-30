const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const js = ts.transpileModule(fs.readFileSync("src/lib/boardDone.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("recentDone: newest first, 5 by default, toggle shows all", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7];
  const c = api.recentDone(rows, false);
  assert.deepEqual([...c.shown], [7, 6, 5, 4, 3]);
  assert.equal(c.hidden, 2);
  const all = api.recentDone(rows, true);
  assert.deepEqual([...all.shown], [7, 6, 5, 4, 3, 2, 1]);
  assert.equal(all.hidden, 0);
  assert.equal(api.recentDone([1, 2], false).hidden, 0);
  assert.deepEqual(rows, [1, 2, 3, 4, 5, 6, 7]);
});

test("panelMaxHeight keeps bottom inside window, clamps small windows", () => {
  assert.equal(api.panelMaxHeight(768, 60), 684);
  assert.equal(api.panelMaxHeight(300, 200), 240);
});
