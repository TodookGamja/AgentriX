const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/blackboardDispatch.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, require: () => ({}) });

test("only the assigned agent's result mail for this exact task replaces its report", () => {
  const mail = { from: "agent", to: "pm", subject: "T123_4 작업 완료", body: "결과" };
  assert.equal(api.hasTaskResultMail([mail], "T123_4", "agent", "pm"), true);
  assert.equal(api.hasTaskResultMail([{ ...mail, subject: "T123_4 작업", body: "결과를 확인했습니다" }], "T123_4", "agent", "pm"), true);
  assert.equal(api.hasTaskResultMail([mail], "T123_40", "agent", "pm"), false);
  assert.equal(api.hasTaskResultMail([mail], "T123_4", "other", "pm"), false);
  assert.equal(api.hasTaskResultMail([{ ...mail, subject: "T123_4 완료 문의" }], "T123_4", "agent", "pm"), false);
  assert.equal(api.hasTaskResultMail([{ ...mail, body: "작업을 완료하지 못했습니다" }], "T123_4", "agent", "pm"), false);
  assert.equal(api.hasTaskResultMail([{ ...mail, to: "other" }], "T123_4", "agent", "pm"), false);
});

test("table rows accept non-T prefixed IDs (SEC1) and ignore plain words", () => {
  const board = [
    "| ID | 작업 | 담당 | 선행 | 상태 |",
    "|---|---|---|---|---|",
    "| SEC1 | x | agentA | — | 🔥 착수 |",
    "| T1030_ORC2 | y | agentA | — | ✅ 완료 |",
    "| 비고 | z | agentA | — | 🔥 착수 |",
  ].join("\n");
  const ids = api.parseBoardTasks(board, ["agentA"]).map((t) => t.taskId);
  assert.equal(ids.join(","), "SEC1,T1030_ORC2");
});

test("status uses the first marker so done notes mentioning 🔥 stay done", () => {
  assert.equal(api.statusKind("✅ 완료 — 상태별 배지(⏳/🔥/✅) 개선안 전달"), "done");
  assert.equal(api.statusKind("🔥 착수 (완료 기준 확인 중)"), "start");
  assert.equal(api.statusKind("⏳ 대기"), null);
  assert.equal(api.statusKind("⏳ 대기 — 완료 후 재개"), null);
});

test("forgetEndedStarts: re-start after done/waiting redelivers once, steady 🔥 does not", () => {
  const t = (status) => [{ taskId: "T1", agentId: "a", status }];
  const sent = new Set(["T1:start:a"]);
  assert.equal(api.forgetEndedStarts(sent, t("start")), false); // 🔥 유지: 중복 전달 0
  assert.ok(sent.has("T1:start:a"));
  assert.equal(api.forgetEndedStarts(sent, t("done")), true); // ✅ 확인 → start 기록 삭제
  assert.equal(sent.has("T1:start:a"), false); // 다시 🔥가 되면 키가 없어 1회 재전달
  const s2 = new Set(["T1:start:a"]);
  api.forgetEndedStarts(s2, [{ taskId: "T2", agentId: "a", status: "start" }]); // ⏳로 행이 빠진 경우
  assert.equal(s2.has("T1:start:a"), false);
  const s3 = new Set(["T1:done:a"]);
  api.forgetEndedStarts(s3, t("start")); // 재착수 후 다음 완료도 PM에 보고
  assert.equal(s3.has("T1:done:a"), false);
});

test("T69: PM 수신 메일 꼬리말은 다음 단계 지시, 팀원 꼬리말은 불변", () => {
  const agents = [{ id: "pm", name: "Conductor PM", roleTitle: "총괄 PM" }, { id: "a1", name: "Pixel", roleTitle: "프론트엔드" }];
  const pm = api.mailProtocol("pm", agents), member = api.mailProtocol("a1", agents);
  assert.ok(pm.endsWith("결과를 받으면 답장하지 말고 .ai-agents/BLACKBOARD.md를 확인해 다음 작업을 배정하거나 모두 끝났으면 최종 보고하세요."));
  assert.ok(!pm.includes("불필요한 답장"));
  assert.ok(member.endsWith("요청에는 답변하고, 결과 통보에는 불필요한 답장을 하지 마세요."));
  assert.ok(!member.includes("다음 작업을 배정"));
  assert.ok(api.collabProtocol("pm", agents).endsWith("최종 보고하세요."));
});

test("T5: 한 번만 사라졌다 돌아온 🔥 행은 정리·재전달 없음, 연속 2회 🔥가 아니면 정리", () => {
  const row = (id, status) => ({ taskId: id, agentId: "a", status });
  const sent = new Set(["X1:start:a", "X2:start:a"]);
  let prev = [row("X1", "start"), row("X2", "start")];
  // 읽기 1: X1이 부분 읽기로 사라짐 → 아직 🔥로 간주
  let read = [row("X2", "start"), row("Y", "wait")];
  assert.equal(JSON.stringify(api.keepRecentStarts(prev, read).filter((t) => t.status === "start").map((t) => t.taskId)), '["X2","X1"]');
  assert.equal(api.forgetEndedStarts(sent, api.keepRecentStarts(prev, read)), false);
  assert.ok(sent.has("X1:start:a")); // 기록 유지: 돌아와도 재전달 없음
  prev = read.filter((t) => t.status === "start");
  // 읽기 2: X1 돌아옴
  read = [row("X1", "start"), row("X2", "start")];
  assert.equal(api.forgetEndedStarts(sent, api.keepRecentStarts(prev, read)), false);
  // 읽기 3·4: X1이 연속 2회 🔥 아님 → 정리
  prev = read;
  read = [row("X2", "start"), row("X1", "done")];
  assert.equal(api.forgetEndedStarts(sent, api.keepRecentStarts(prev, read)), false); // 1회째: 유지
  prev = read.filter((t) => t.status === "start");
  assert.equal(api.forgetEndedStarts(sent, api.keepRecentStarts(prev, read)), true); // 2회째: 정리
  assert.ok(!sent.has("X1:start:a") && sent.has("X2:start:a"));
});

test("T5: App.tsx 정리 경로는 모두 boardTasks(2회 확인) 기준", () => {
  const src = fs.readFileSync("src/App.tsx", "utf8").replace(/\r/g, "");
  assert.ok(src.includes("forgetEndedStarts(sent, boardTasks)"));
  assert.ok(src.includes("const startIds = new Set(boardTasks.filter"));
  assert.ok(src.includes("revokedAssignIds(list, new Set(boardTasks.filter"));
  assert.ok(src.includes("clearDispatchNotes(project, (id) => boardTasks.some"));
});

test("T1793692464223_1: 통합·취소 행은 closed — 전달·완료 보고 대상 아님, 대기 칸 제외, 🔥→통합은 정리 대상", () => {
  const board = [
    "| ID | 작업 | 담당 | 선행 | 기준 | 상태 |",
    "|---|---|---|---|---|---|",
    "| T1_1 | a | agentA | — | x | 통합 → T1_9 |",
    "| T1_2 | b | agentA | — | x | 취소 |",
    "| T1_3 | c | agentA | — | x | cancelled |",
    "| T1_4 | d | agentA | — | x | merged into T1_9 |",
    "| T1_5 | e | agentA | — | x | ⏳ 대기 (취소 아님) |",
    "| T1_6 | f | agentA | — | x | ✅ 완료 (T1_2 통합) |",
    "| T1_7 | g | agentA | — | x | 🔥 착수 |",
  ].join("\n");
  const t = api.parseBoardTasks(board, ["agentA"], undefined, true);
  const st = Object.fromEntries(t.map((x) => [x.taskId, x.status]));
  assert.equal(JSON.stringify(st), JSON.stringify({ T1_1: "closed", T1_2: "closed", T1_3: "closed", T1_4: "closed", T1_5: "wait", T1_6: "done", T1_7: "start" }));
  assert.equal(api.boardTaskColumn({ status: "closed", manual: false, confirmed: false, live: true, queued: false }), "done");
  // 🔥였다가 통합으로 바뀌면 start 기록 정리
  const sent = new Set(["T1_1:start:agentA"]);
  assert.equal(api.forgetEndedStarts(sent, t), true);
  assert.ok(!sent.has("T1_1:start:agentA"));
  const src = fs.readFileSync("src/App.tsx", "utf8").replace(/\r/g, "");
  assert.ok(src.includes('if (t.status === "wait" || t.status === "closed") continue;'));
});

test("T1793692464223_1: PM 지침에 통합·취소 상태 표기 안내", () => {
  const s = fs.readFileSync("src/lib/blackboardDispatch.ts", "utf8");
  assert.ok(s.includes('"통합 → <ID>" 또는 "취소"'));
});

test("T1793776116339_10: 팀 메일·PM 배정 전달문에 outbox 경로·형식·명단·중복 안내 꼬리말이 없고 화면 대조 머리말은 유지", () => {
  const m = api.teamMailText("PM", "M1", "제목", "내용\n줄"), a = api.assignText("T_1");
  assert.equal(m, "[팀 메시지: PM] 메일 ID: M1. 제목: 제목 내용: 내용 줄\r");
  for (const t of [m, a]) for (const bad of ["outbox", "JSON", "수신 가능한", "이미 처리한 ID"]) assert.ok(!t.includes(bad), bad);
  assert.ok(a.startsWith("[PM 배정] .ai-agents/BLACKBOARD.md 작업표의 T_1 작업") && a.endsWith("\r"));
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.ok(!app.includes("mailProtocol(session.agentId") && !app.includes("mailProtocol(t.agentId"));
});

test("T1793840117765_1: 첫 역할 브리핑 — ROLE.md가 있으면 200자 이하 파일 참조 한 줄, 없으면 기존 전문(역할+협업 규칙)", () => {
  const agents = [{ id: "a1", name: "Pixel", roleTitle: "FE" }, { id: "pm", name: "PM", roleTitle: "PM" }];
  const agent = { id: "a1", rolePrompt: "너는 프론트 담당\n입니다" };
  const short = api.roleBriefText(agent, agents, true), full = api.roleBriefText(agent, agents, false);
  assert.equal(short, ".ai-agents/agents/a1/ROLE.md를 먼저 읽고 그 역할·협업 규칙을 따르세요. ");
  assert.ok(short.length <= 200 && !short.includes("outbox"));
  assert.ok(full.startsWith("너는 프론트 담당 입니다 ") && full.includes(api.collabProtocol("a1", agents)));
});

test("T1793841150955_1: result mail marks the task so the ✅ auto report is skipped (mail first / none / ✅ first)", () => {
  const mail = { from: "agent", to: "pm", subject: "T9_1 결과", body: "완료" };
  const task = (taskId, status) => ({ taskId, status, agentId: "agent" });
  // 메일 먼저(🔥 상태에서 이미 보냄) 또는 ✅ 먼저·메일 나중: 메일이 보이는 순간 키가 잡혀 보고 생략/대기열 제거
  assert.deepEqual(api.resultMailTaskKeys([mail], [task("T9_1", "start")], "pm"), ["T9_1:agent"]);
  assert.deepEqual(api.resultMailTaskKeys([mail], [task("T9_1", "done")], "pm"), ["T9_1:agent"]);
  // 메일 없음: 키 없음 → 자동 보고 유지
  assert.deepEqual(api.resultMailTaskKeys([], [task("T9_1", "done")], "pm"), []);
  // T9_1 메일이 T9_10을 삼키지 않음
  assert.deepEqual(api.resultMailTaskKeys([mail], [task("T9_10", "done")], "pm"), []);
});

test("T1793841150955_1: App skips report for mailed tasks and dedupes the queue", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /if \(mailSeen\.has\(`\$\{t\.taskId\}:\$\{t\.agentId\}`\)\)[\s\S]{0,300}markHandled\(`\$\{qk\}\|report:/);
});

test("T1793845112668_1: new session for an agent re-sends its 🔥 rows once; same/resumed session never", () => {
  const starts = [{ taskId: "T1_1", agentId: "a" }, { taskId: "T1_2", agentId: "b" }];
  const first = api.newSessionResends([{ id: "s1", agentId: "a" }, { id: "s2", agentId: "b" }], {}, starts);
  assert.deepEqual([...first.keys], ["T1_1:start:a", "T1_2:start:b"]);
  // 같은 세션 다음 폴링: 중복 0
  assert.deepEqual([...api.newSessionResends([{ id: "s1", agentId: "a" }, { id: "s2", agentId: "b" }], first.seen, starts).keys], []);
  // a만 새 세션(재시작·릴레이·앱 재실행): a의 행만
  const re = api.newSessionResends([{ id: "s3", agentId: "a" }, { id: "s2", agentId: "b" }], first.seen, starts);
  assert.deepEqual([...re.keys], ["T1_1:start:a"]);
  // 재개 세션: 이미 받은 대화 → 재전달 0, 기록은 갱신
  const resumed = api.newSessionResends([{ id: "s4", agentId: "a", resumed: true }], re.seen, starts);
  assert.deepEqual([...resumed.keys], []);
  assert.equal(resumed.seen.a, "s4");
  // 에이전트 없는 세션 무시
  assert.deepEqual([...api.newSessionResends([{ id: "x", agentId: null }], {}, starts).keys], []);
});
