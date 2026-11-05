const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const app = fs.readFileSync("src/App.tsx", "utf8");
const rs = fs.readFileSync("src-tauri/src/main.rs", "utf8");
test("T14: '이미 실행 중' 오류는 기존 세션 탭을 열고, 못 찾으면 앱 안 모달로 새 대화 제안", () => {
  assert.match(rs, /세션이 이미 실행 중입니다/);
  const body = app.slice(app.indexOf("const handleSpawnAgentSession"), app.indexOf("const handleSpawnAllProjectAgents"));
  assert.match(body, /includes\("이미 실행 중"\)/);
  assert.match(body, /s\.agentId === agent\.id && s\.cliId === agent\.cliId/);
  assert.match(body, /setActiveSessionId\(existing\.id\)[\s\S]*return;/);
  assert.match(body, /confirmDialog\(\{[\s\S]*새 대화로 시작[\s\S]*handleSpawnAgentSession\(agent, true\)/);
  assert.doesNotMatch(body, /window\.(confirm|alert)/);
});
