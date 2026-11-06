const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const src = fs.readFileSync("src/App.tsx", "utf8");
const relay = src.slice(src.indexOf("const handleAutoRelaySession"), src.indexOf("// 6. 🔥 핵심"));
test("릴레이(자동·수동 공통)는 이어하기 지시를 대기열 전달 경로로 1회 보낸다", () => {
  assert.equal((relay.match(/sendToIdleTeamSession\(newSession, handoffContinuePrompt\(true\)/g) ?? []).length, 1);
  assert.match(relay, /id: `relay:\$\{newSession\.id\}`/);
});
test("고정 지연 원시 쓰기·첫 입력 접두 안내 이중 전달 없음", () => {
  assert.doesNotMatch(relay, /setTimeout\(async[\s\S]{0,200}apiWriteToSession/);
  assert.doesNotMatch(relay, /markHandoffHint\(/);
});
