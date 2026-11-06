const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("work board shows the live per-agent terminal queue, including user and mail items", () => {
  const source = fs.readFileSync("src/components/TaskApprovalBoard.tsx", "utf8");
  assert.match(source, /useSessionQueue\(\(state\) => state\.queues\)/);
  assert.match(source, /agents\.flatMap\(\(agent\) => \(queues\[agent\.id\] \?\? \[\]\)/);
  assert.match(source, /item\.preview/);
  assert.match(source, /item\.reason/);
});
