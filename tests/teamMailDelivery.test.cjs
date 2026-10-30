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

test("releases mail for a disappeared session without losing other deliveries", () => {
  values.clear();
  const base = { project: "p", agentId: "a", submittedAt: 1 };
  api.saveTeamMailDelivery({ ...base, id: "mail", sessionId: "old" });
  api.saveTeamMailDelivery({ ...base, id: "live", sessionId: "new" });
  api.saveTeamMailDelivery({ ...base, id: "task", sessionId: "old", kind: "task" });
  api.saveTeamMailDelivery({ ...base, project: "other", id: "other", sessionId: "old" });
  api.pruneStaleMailDeliveries("p", ["new"]);
  assert.deepEqual(api.getTeamMailDeliveries().map((d) => d.id).sort(), ["live", "other", "task"]);
  values.clear();
});

test("prunes stale deliveries whose session is gone but keeps goals and live ones", () => {
  values.clear();
  const base = { project: "p", agentId: "forge", submittedAt: 1 };
  api.saveTeamMailDelivery({ ...base, id: "SEC1", sessionId: "old", kind: "task" });
  api.saveTeamMailDelivery({ ...base, id: "SEC3", sessionId: "new", kind: "task" });
  api.saveTeamMailDelivery({ ...base, id: "g", sessionId: "", kind: "goal", payload: "x" });
  api.saveTeamMailDelivery({ ...base, project: "other", id: "X", sessionId: "old", kind: "task" });
  assert.equal(api.pruneStaleDeliveries("p", ["new"]), 1);
  assert.deepEqual(api.getTeamMailDeliveries().map((d) => d.id).sort(), ["SEC3", "X", "g"]);
});

test("redelivers only when 2+ min passed with no output since submit, max 3 times", () => {
  assert.equal(api.shouldRedeliver(2, 100, 200, 0), true);
  assert.equal(api.shouldRedeliver(1, 100, 200, 0), false);
  assert.equal(api.shouldRedeliver(5, 300, 200, 0), false); // 전달 뒤 출력이 있었음
  assert.equal(api.shouldRedeliver(5, null, 200, 0), false); // 지금도 출력 중
  assert.equal(api.shouldRedeliver(5, 100, 200, 3), false);
});
