const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const code = ts.transpileModule(fs.readFileSync("src/lib/agentCli.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleExports = {};
vm.runInNewContext(code, { exports: moduleExports, Set });

test("a fallback CLI clears the previous CLI's model and effort", () => {
  const agents = [{ cliId: "codex", model: "model", effort: "xhigh" }];
  const changed = moduleExports.fitAgentsToInstalled(agents, [{ id: "claude", installed: true }]);
  assert.equal(changed[0].cliId, "claude");
  assert.equal(changed[0].model, "");
  assert.equal(changed[0].effort, "");
  const unchanged = moduleExports.fitAgentsToInstalled(agents, [{ id: "codex", installed: true }]);
  assert.equal(unchanged[0].effort, "xhigh");
});
