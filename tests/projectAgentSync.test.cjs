const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("src/App.tsx", "utf8");

test("selected project and sidebar share the same team list", () => {
  assert.match(app, /const projectAgents = agentsByProject\[selectedProjectPath\] \?\? \[\]/);
  assert.match(app, /: agentsByProject\[proj\.path\] \?\? \[\]/);
  assert.match(app, /apiDeleteProjectAgent\(selectedProjectPath, agentId\);\s*updateProjectAgents\(selectedProjectPath, updated\)/);
  assert.match(app, /updateProjectAgents\(selectedProjectPath, latest\)/);
});

test("late reads cannot replace a changed team or another project's analysis", () => {
  assert.match(app, /agentVersionsRef\.current\[path\] = \(agentVersionsRef\.current\[path\] \?\? 0\) \+ 1/);
  assert.match(app, /!cancelled && \(agentVersionsRef\.current\[f\.path\] \?\? 0\) === version/);
  assert.match(app, /analysisState\?\.path === selectedProjectPath/);
  assert.match(app, /if \(!cancelled && analysis\) setAnalysisState/);
});
