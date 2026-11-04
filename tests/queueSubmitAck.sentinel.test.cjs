const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r/g, "");

test("T1793752130651_6: session_user_message_submitted는 build.rs·capabilities·invoke 삼중 등록(V104_SEC2)", () => {
  const bridge = read("src/lib/tauriBridge.ts");
  assert.match(bridge, /invoke\("session_user_message_submitted",\s*\{\s*sessionId,\s*body,\s*after\s*\}\)/);
  const build = read("src-tauri/build.rs");
  assert.match(build, /"session_user_message_submitted"/);
  const caps = JSON.parse(read("src-tauri/capabilities/default.json")).permissions;
  assert.ok(caps.includes("allow-session-user-message-submitted"));
  const sens = JSON.parse(read("src-tauri/capabilities/sensitive.json")).permissions;
  assert.ok(!sens.includes("allow-session-user-message-submitted"), "민감 목록에 불필요 등록 금지");
});

test("T1793752130651_6: JSONL 경로는 프론트 입력이 아님(세션ID→서버 고정 경로)", () => {
  const main = read("src-tauri/src/main.rs");
  const fn = main.slice(main.indexOf("async fn session_user_message_submitted"), main.indexOf("async fn get_session_context"));
  assert.match(fn, /session_id: String,\s*body: String,\s*after: i64/);
  assert.doesNotMatch(fn, /path:\s*String|jsonl_path|file_path/);
  assert.match(fn, /\.claude"\)\.join\("projects"\)/);
  assert.match(fn, /\.codex"\)\.join\("sessions"\)/);
  assert.match(fn, /home_dir\(\)/);
  // 프론트도 path를 넘기지 않음
  assert.match(read("src/lib/tauriBridge.ts"), /apiSessionUserMessageSubmitted\(sessionId: string, body: string, after: number\)/);
});

test("T1793752130651_6: 시도 시각 이후·본문 정확 일치만 제출 확정(과거 지시 오인 방지)", () => {
  const ctx = read("src-tauri/src/context.rs");
  assert.match(ctx, /fn submitted_user_message\(content: &str, cli: &str, body: &str, after: i64\)/);
  assert.match(ctx, /time\.timestamp_millis\(\) <= after/);
  assert.match(ctx, /text\.replace\("\\r\\n", "\\n"\)\.trim\(\) == body/);
  assert.match(ctx, /fn exact_message_after_attempt_only/);
  assert.match(ctx, /assert!\(!submitted_user_message\(claude, "claude", "hello", at\)\)/);
  assert.match(ctx, /assert!\(!submitted_user_message\(claude, "claude", "hell", at\)\)/);
});

test("T1793752130651_15: Claude 문자열·배열(+이미지무시)·Codex response_item/input_text, 부분일치·시각 회귀 금지", () => {
  const ctx = read("src-tauri/src/context.rs");
  const fn = ctx.slice(ctx.indexOf("pub fn submitted_user_message"), ctx.indexOf("mod submission_tests"));
  assert.match(fn, /Value::String\(text\)/);
  assert.match(fn, /Value::Array\(blocks\)/);
  assert.match(fn, /block\.get\("type"\).*== Some\("text"\)/);
  assert.match(fn, /"response_item"/);
  assert.match(fn, /Some\("input_text"\)/);
  assert.match(fn, /Some\("user"\)/);
  assert.match(fn, /body\.replace\("\\r\\n", "\\n"\)/);
  assert.match(fn, /\.trim\(\)/);
  // 부분 일치(contains/starts_with) 금지 — 정규화 후 == 만
  assert.doesNotMatch(fn, /contains\(|starts_with\(|ends_with\(/);
  const tests = ctx.slice(ctx.indexOf("mod submission_tests"));
  assert.match(tests, /fn claude_text_blocks_and_codex_normalize_without_matching_old_messages/);
  assert.match(tests, /"type":"image"/);
  assert.match(tests, /"type":"input_text"/);
  assert.match(tests, /assert!\(!submitted_user_message\(claude_blocks, "claude", "hello\\nworld", at\)\)/);
  assert.match(tests, /assert!\(!submitted_user_message\(claude_blocks, "claude", "hello\\nother", at - 1\)\)/);
  assert.match(tests, /role\":\"assistant\"/);
});

test("T1793752130651_15: Forge 보고 Node 202 vs _6의 205 — sentinel/queue 테스트 파일 잔존", () => {
  const names = fs.readdirSync(path.join(ROOT, "tests")).filter((n) => n.endsWith(".cjs"));
  for (const need of [
    "queueSubmitAck.sentinel.test.cjs",
    "terminalUrlLink.sentinel.test.cjs",
    "silentSessionReplay.sentinel.test.cjs",
    "securityAudit.sentinel.test.cjs",
    "sessionQueue.test.cjs",
  ]) {
    assert.ok(names.includes(need), `missing ${need}`);
  }
  // deepAiKeyStorage.precheck.cjs 등은 카운트에 포함될 수 있으나 삭제된 sentinel 없음
  assert.ok(names.length >= 25, `tests/*.cjs too few: ${names.length}`);
});

test("T1793752130651_6: PM 확인 보고 제거는 confirmedResultMail(✅/closed+confirmReport+결과메일)만", () => {
  const code = ts.transpileModule(read("src/lib/blackboardDispatch.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dispatch = {};
  vm.runInNewContext(code, { exports: dispatch, module: { exports: dispatch } });
  const mail = { from: "worker", to: "pm", subject: "T1 완료 보고", body: "완료" };
  const done = { taskId: "T1", agentId: "worker", status: "done" };
  const key = "pm|report:T1:worker";
  assert.equal(dispatch.confirmedResultMail(mail, [done], [key], "pm", "pm"), true);
  assert.equal(dispatch.confirmedResultMail(mail, [{ ...done, status: "closed" }], [key], "pm", "pm"), true);
  assert.equal(dispatch.confirmedResultMail(mail, [done], [], "pm", "pm"), false, "confirmReport 없으면 유지");
  assert.equal(dispatch.confirmedResultMail(mail, [{ ...done, status: "start" }], [key], "pm", "pm"), false);
  assert.equal(dispatch.confirmedResultMail(mail, [{ ...done, status: "wait" }], [key], "pm", "pm"), false);
  const app = read("src/App.tsx");
  assert.match(app, /confirmedResultMail\(mail,\s*tasks,\s*q\.confirmedReports/);
  assert.match(app, /confirmReport\(`\$\{key\}\|\$\{meta\.id\}`\)/);
});

test("T1793752130651_6: 미제출 stuck 사용자는 JSONL 확정 없이 제거되지 않음·중복 재전송 가드", () => {
  const app = read("src/App.tsx");
  const callAt = app.indexOf("apiSessionUserMessageSubmitted(s.id, item.attempt.body, item.attempt.at)");
  assert.ok(callAt > 0);
  const blk = app.slice(callAt, callAt + 350);
  assert.match(blk, /apiSessionUserMessageSubmitted\(s\.id, item\.attempt\.body, item\.attempt\.at\)[\s\S]*\.remove\(key, item\.id\)/);
  // stuck/unconfirmed + attempt 일치 세션만 대상
  assert.match(app, /item\.source !== "user" \|\| \(!item\.stuck && !item\.unconfirmed\) \|\| !item\.attempt \|\| item\.attempt\.sessionId !== s\.id/);
  const sq = read("src/lib/sessionQueue.ts");
  assert.match(sq, /if \(cur\.unconfirmed\) return map/); // upsert가 unconfirmed를 덮어쓰지 않음
});

test("T1793752130651_6: 대기열은 세션키 격리·FIFO head(사용자 stuck이면 메일 선행 불가)", () => {
  const sq = read("src/lib/sessionQueue.ts");
  assert.match(sq, /export function nextQueueItem[\s\S]*return list\?\.\[0\]/);
  assert.match(sq, /export function nextUserItem[\s\S]*first\?\.source === "user" && !first\.stuck/);
  const store = read("src/lib/sessionQueueStore.ts");
  assert.match(store, /export const queueKey =/);
  // App 디스패치가 meta head가 아니면 앞 전달 대기로 보류 → stuck user head가 메일을 막음
  const app = read("src/App.tsx");
  assert.match(app, /queues\[key\]\?\.\[0\]\?\.id !== meta\.id/);
  assert.match(app, /앞 전달 대기/);
});
