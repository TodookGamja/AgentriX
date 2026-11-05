const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const main = fs.readFileSync("src-tauri/src/main.rs", "utf8");
const pty = fs.readFileSync("src-tauri/src/pty.rs", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const start = main.slice(main.indexOf("async fn start_session"), main.indexOf("fn available_resume"));

test("T13: 종료 PTY는 list_sessions에서 제거되고 살아 있는 PTY는 유지", () => {
  assert.match(pty, /sessions\.retain\(\|_, session\| !matches!\(session\.child\.try_wait\(\), Ok\(Some\(_\)\)\)\)/);
  assert.match(pty, /fn exited_pty_is_removed_and_live_pty_stays_until_closed/);
});

test("T13: 진짜 실행 중 세션은 active_agent로 중복 차단 유지", () => {
  assert.match(start, /"active_agent"/);
  assert.match(start, /이미 실행 중입니다/);
  assert.match(start, /s\.agent_id == agent_id && s\.cli_id == cli_def\.id/);
});

test("T13: 재개 ID 충돌은 Err 대신 새 대화(available_resume) — 타 팀원 resume 가로채지 않음", () => {
  assert.match(main, /fn available_resume\(candidate: Option<String>, sessions: &\[\(String, Option<String>\)\]\) -> Option<String>/);
  assert.match(main, /candidate\.filter\(\|id\| !sessions\.iter\(\)\.any/);
  assert.match(start, /available_resume\(resume_session_id, &active\)/);
  assert.match(start, /"resume_collision_fresh"/);
  assert.doesNotMatch(start, /resume_session_id[\s\S]{0,400}return Err\("이 에이전트의 세션이 이미 실행/);
  assert.match(main, /fn conflicting_resume_uses_fresh_session/);
});

test("T13: 탭 닫기는 apiStopSession으로 PTY 종료(고아 방지)", () => {
  const stop = app.slice(app.indexOf("const handleStopSession"), app.indexOf("const handleBroadcastPrompt"));
  assert.match(stop, /removeSession\(sessionId\)/);
  assert.match(stop, /apiStopSession\(sessionId\)/);
});
