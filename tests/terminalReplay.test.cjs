const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/terminalReplay.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("terminal auto-reports are recognized, user input is not", () => {
  assert.equal(api.isTerminalReport("\x1b[1;1R"), true);
  assert.equal(api.isTerminalReport("\x1b[1;1R\x1b[1;1R\x1b[12;40R"), true);
  assert.equal(api.isTerminalReport("\x1b[?1;2c"), true);
  assert.equal(api.isTerminalReport("\x1b[0n"), true);
  assert.equal(api.isTerminalReport("a"), false);
  assert.equal(api.isTerminalReport("\r"), false);
  assert.equal(api.isTerminalReport("\x1b"), false);
  assert.equal(api.isTerminalReport("\x1b[A"), false);
});

test("pty resize skips tiny and unchanged sizes", () => {
  assert.equal(api.shouldResizePty(null, { cols: 120, rows: 30 }), true);
  assert.equal(api.shouldResizePty({ cols: 120, rows: 30 }, { cols: 120, rows: 30 }), false);
  assert.equal(api.shouldResizePty({ cols: 120, rows: 30 }, { cols: 3, rows: 30 }), false);
  assert.equal(api.shouldResizePty({ cols: 120, rows: 30 }, { cols: 120, rows: 2 }), false);
  assert.equal(api.shouldResizePty({ cols: 120, rows: 30 }, { cols: 100, rows: 30 }), true);
});
