const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/teamMailDelivery.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const values = new Map();
const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const api = {};
vm.runInNewContext(js, { exports: api, localStorage, JSON, Array });

test("retains in-flight deliveries across reloads and removes only the selected delivery", () => {
  const first = { project: "one", agentId: "a", id: "m", sessionId: "s", submittedAt: 1 };
  const second = { ...first, project: "two" };
  api.saveTeamMailDelivery(first);
  api.saveTeamMailDelivery(second);
  assert.equal(api.getTeamMailDeliveries().length, 2);
  api.removeTeamMailDelivery("one", "a", "m");
  assert.equal(api.getTeamMailDeliveries().length, 1);
  assert.equal(api.getTeamMailDeliveries()[0].project, "two");
  api.saveTeamMailDelivery({ ...second, kind: "task" });
  api.saveTeamMailDelivery({ ...second, kind: "report" });
  api.removeTeamMailDelivery("two", "a", "m", "task");
  assert.equal(api.getTeamMailDeliveries().length, 2);
  assert.ok(api.getTeamMailDeliveries().some((d) => d.kind === "report"));
  api.saveTeamMailDelivery({ ...first, kind: "goal", sessionId: "", submittedAt: 0, payload: "goal" });
  const goal = api.getTeamMailDeliveries().find((d) => d.kind === "goal");
  assert.equal(goal.payload, "goal");
  assert.equal(goal.sessionId, "");
  values.set("agentrix_team_mail_deliveries", "not json");
  assert.throws(() => api.saveTeamMailDelivery(first));
  assert.equal(values.get("agentrix_team_mail_deliveries"), "not json");
});
