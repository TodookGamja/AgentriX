const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const js = ts.transpileModule(fs.readFileSync("src/lib/sessionQueue.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

const it = (id, source, extra = {}) => ({ id, source, preview: id, payload: id, createdAt: 1, ...extra });

test("queue drain sends orphaned heads in order and releases a blocked reservation", async () => {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync("src/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("nextQueueItem(")) effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  const session = { id: "session", agentId: "a", cwd: "project" };
  const handled = [];
  const state = { queues: { a: [it("report:T1:worker", "report"), it("mail:m1", "mail"), it("assign:T2", "assign"), it("user1", "user")] },
    remove: (key, id) => { state.queues[key] = state.queues[key].filter((item) => item.id !== id); }, markHandled: (id) => handled.push(id) };
  let tick, reservation, blocked = true, duplicate = false;
  const sent = [];
  const sandbox = { module: { exports: null }, console, Date,
    useAppStore: { getState: () => ({ sessions: [session] }) }, useSessionQueue: { getState: () => state },
    queueKey: () => "a", nextQueueItem: api.nextQueueItem, queueReservation: api.queueReservation,
    apiRouteTeamMail: async () => [], hasTaskResultMail: () => duplicate,
    reserveTeamMailDelivery: (value) => { if (reservation) return false; reservation = value; return true; },
    removeTeamMailDelivery: () => { reservation = undefined; }, saveTeamMailDelivery: (value) => { reservation = value; },
    SUBMISSION_UNCONFIRMED_REASON: eval(fs.readFileSync("src/App.tsx", "utf8").match(/^const SUBMISSION_UNCONFIRMED_REASON = (".*");/m)[1]),
    getLastSubmission: () => 1, sendBlockReasonRef: { current: {} },
    sendToIdleTeamSession: async (_s, _payload, item) => {
      if (blocked) { blocked = false; return false; }
      sent.push(item.id); state.remove("a", item.id); return true;
    }, window: { setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => {} } };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${effect}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  sandbox.module.exports();
  await tick();
  assert.equal(reservation, undefined);
  for (let i = 0; i < 4; i++) { await tick(); reservation = undefined; }
  assert.deepEqual(sent, ["report:T1:worker", "mail:m1", "assign:T2", "user1"]);
  assert.equal(state.queues.a.length, 0);
  state.queues.a = [it("report:T3:worker", "report"), it("mail:m3", "mail")];
  duplicate = true;
  await tick();
  assert.deepEqual(handled, []);
  assert.equal(sent.at(-1), "report:T3:worker");
  reservation = undefined;
  await tick();
  assert.equal(sent.at(-1), "mail:m3");
});

test("queue: auto items dedupe by id, user items drain one at a time and a stuck head blocks the rest", () => {
  let q = api.upsertItem({}, "a", it("assign:T1", "assign", { reason: "응답 중" }));
  q = api.upsertItem(q, "a", it("assign:T1", "assign", { reason: "입력창 대기" }));
  assert.equal(q.a.length, 1);
  assert.equal(q.a[0].reason, "입력창 대기");
  q = api.upsertItem(q, "a", it("u1", "user"));
  q = api.upsertItem(q, "a", it("u2", "user"));
  assert.equal(api.nextUserItem(q.a), undefined); // 자동 항목이 앞에 있으면 기다림
  q = api.removeItem(q, "a", "assign:T1");
  assert.equal(api.nextUserItem(q.a).id, "u1");
  q = api.upsertItem(q, "a", it("u1", "user", { stuck: true }));
  assert.equal(api.nextUserItem(q.a), undefined); // 멈춤이면 u2도 보류
  q = api.removeItem(q, "a", "u1");
  assert.equal(api.nextUserItem(q.a).id, "u2");
});

test("queue: move swaps only user items, removing the last item drops the session key", () => {
  let q = {};
  for (const x of [it("u1", "user"), it("m1", "mail"), it("u2", "user")]) q = api.upsertItem(q, "a", x);
  q = api.moveItem(q, "a", "u2", -1);
  assert.equal(q.a.map((x) => x.id).join(), "u2,m1,u1");
  assert.equal(api.moveItem(q, "a", "m1", 1), q); // 자동 항목은 고정
  assert.equal(api.moveItem(q, "a", "u2", -1), q); // 끝에서 더 못 감
  for (const id of ["u1", "u2", "m1"]) q = api.removeItem(q, "a", id);
  assert.equal(Object.keys(q).length, 0);
});

test("queue: stale auto items are dropped, user items survive; preview is one short line", () => {
  let q = {};
  for (const x of [it("m1", "mail"), it("m2", "mail"), it("u1", "user")]) q = api.upsertItem(q, "a", x);
  q = api.dropStaleAuto(q, (_k, id) => id === "m2");
  assert.equal(q.a.map((x) => x.id).join(), "m2,u1");
  assert.ok(q.a.some((x) => x.id === "u1") && !q.a.some((x) => x.id === "m1"));
  const p = api.previewOf("줄1\n\n줄2 " + "가".repeat(100));
  assert.ok(!p.includes("\n") && p.length === 60 && p.endsWith("…"));
});

test("T7: 자동 항목 수동 처리 — 게이트가 resolved를 소비해 재전송 없이 완료 처리, 패널은 모든 항목에 보내기/버리기", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const gate = app.slice(app.indexOf("const sendToIdleTeamSession = async"), app.indexOf("const sendToIdleTeamSessionRaw"));
  assert.match(gate, /q\.resolved\.includes\(`\$\{key\}\|\$\{meta\.id\}`\)[\s\S]*?return false;[\s\S]*?await sendToIdleTeamSessionRaw/);
  assert.match(gate, /payload: prompt/); // 자동 항목도 payload 보관(지금 보내기용)
  const tp = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  assert.ok(tp.includes("auto && hasPendingSessionInput(session.id) && !(await confirmDialog("));
  assert.match(tp, /sendQueuedNow\(it\.id, it\.payload, it\.source !== "user"\)/);
  assert.match(tp, /\.resolve\(qKey, it\.id\)/);
  assert.match(tp, /it\.source === "user" && <>/); // ↑↓는 사용자 항목만
  // 스토어: resolve = 항목 제거 + resolved 등록
  const st = fs.readFileSync("src/lib/sessionQueueStore.ts", "utf8");
  assert.match(st, /resolve: \(sid, id\) => set\([\s\S]*?removeItem[\s\S]*?`\$\{sid\}\|\$\{id\}`/);
});

test("T51: 보드 ✅가 된 assign·PM이 결과 메일을 받은 report는 stuck head여도 정리되고 뒤 항목이 head가 된다", () => {
  const stuck = { stuck: true, reason: "입력창에 멈춤: 전달 결과 미확인" };
  let q = {};
  for (const x of [it("assign:T46", "assign", stuck), it("report:T9:forge", "report", stuck), it("assign:T50", "assign", { reason: "앞 전달 대기" }), it("assign:T47", "assign", stuck)]) q = api.upsertItem(q, "prism", x);
  const ids = api.settledAutoIds(q.prism, new Set(["T46"]), (t, r) => t === "T9" && r === "forge");
  assert.equal(JSON.stringify(ids), JSON.stringify(["assign:T46", "report:T9:forge"])); // 🔥 T47(stuck)은 증거 없어 유지
  for (const id of ids) q = api.removeItem(q, "prism", id);
  assert.equal(q.prism[0].id, "assign:T50"); // 뒤 항목이 head
  assert.equal(q.prism[1].stuck, true);
  // 단위 밖 배선: 대시 tick이 보드 done + 결과 메일로 정리하고 deliveryGate 대기도 푼다
  const src = require("node:fs").readFileSync("src/App.tsx", "utf8");
  const blk = src.slice(src.indexOf("교착 해소: 보드 ✅가 된 assign"), src.indexOf("교착 해소: 보드 ✅가 된 assign") + 6000);
  assert.match(blk, /settledAutoIds\(/);
  assert.match(blk, /removeTeamMailDelivery\(project, s\.agentId/);
  assert.match(blk, /delete pendingDeliveryRef\.current\[s\.id\]/);
});

test("T5: 결과 메일은 전달 확인된 보고와 완료된 같은 작업이 있을 때만 정리한다", () => {
  const code = ts.transpileModule(fs.readFileSync("src/lib/blackboardDispatch.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const dispatch = {};
  vm.runInNewContext(code, { exports: dispatch });
  const mail = { from: "worker", to: "pm", subject: "T1 완료 보고", body: "완료" };
  const task = { taskId: "T1", agentId: "worker", status: "done" };
  const key = "pm|report:T1:worker";
  const check = (m, t, h) => dispatch.confirmedResultMail(m, [t], h, "pm", "pm");
  assert.equal(check(mail, task, [key]), true);
  assert.equal(check(mail, { ...task, status: "closed" }, [key]), true);
  assert.equal(check(mail, task, []), false);
  assert.equal(check(mail, { ...task, status: "start" }, [key]), false);
  assert.equal(check({ ...mail, subject: "질문", body: "문의" }, task, [key]), false);
  assert.equal(check({ ...mail, from: "other" }, task, [key]), false);
});

test("T5: 미확인 사용자 항목의 전송 시도 기록은 대기열 갱신에도 보존된다", () => {
  const attempt = { sessionId: "s1", at: 123, body: "actual message" };
  let q = api.upsertItem({}, "a", it("u1", "user", { attempt }));
  q = api.upsertItem(q, "a", it("u1", "user", { stuck: true }));
  assert.equal(q.a[0].attempt, attempt);
  assert.equal(api.nextUserItem(q.a), undefined);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.ok(app.includes("item.attempt.sessionId !== s.id"));
  assert.ok(app.includes("apiSessionUserMessageSubmitted(s.id, item.attempt.body, item.attempt.at)"));
});

test("T54: PM 본인 담당 행의 완료는 PM에게 자기 보고(doneTasks)를 만들지 않는다", () => {
  const src = require("node:fs").readFileSync("src/App.tsx", "utf8");
  const i = src.indexOf("doneTasks.push(t);");
  assert.ok(i > 0);
  assert.match(src.slice(i - 700, i), /t\.agentId === pmSession\.agentId\) continue/);
});

test("T58/T59: stuck 항목은 화면에 본문 끝까지 찍히고 입력창 영역 밖에 응답이 뒤따를 때만 전달 확정, 미제출 긴 입력은 유지", () => {
  const body = (id) => `[팀 메시지: PM] 메일 ID: ${id}. 이미 처리한 ID면 다시 처리하지 마세요. 내용: 끝부분 마커 문장입니다 ${id}`;
  const mail = it("mail:M_1", "mail", { stuck: true, payload: body("M_1") });
  const assign = it("assign:T_9", "assign", { unconfirmed: true, payload: "[PM 배정] .ai-agents/BLACKBOARD.md 작업표의 T_9 작업을 수행하세요. 끝 ABCDEFGHIJKLMN" });
  const normal = it("mail:M_2", "mail", { payload: body("M_2") });
  const tail = ["", "", "", ""];
  const got = (list, lines) => JSON.stringify(api.deliveredByScreen(list, lines));
  const wrap = (t, n = 30) => t.match(new RegExp(`.{1,${n}}`, "g"));
  // 제출됨: 본문(줄바꿈으로 쪼개져도) + 실제 응답 10줄 이상 + 아래 입력창 영역
  const reply = Array.from({ length: 10 }, (_, i) => `✦ 응답 ${i + 1}`);
  const sent = [...wrap(body("M_1")), "[PM 배정] .ai-agents/BLACKBOARD.md 작업표의 T_9 작업을 수행하세요.", "끝 ABCDEFGHIJKLMN", ...reply, ...tail];
  assert.equal(got([mail, assign, normal], sent), JSON.stringify(["mail:M_1", "assign:T_9"]));
  // T60: 미제출 본문 아래 CLI 하단 UI 5줄·8줄(박스 테두리 포함)은 응답으로 보지 않음
  const ui = ["╭────────╮", "│ > │", "╰────────╯", "? for shortcuts", "model: x", "~/proj", "ctx 10%", "────"];
  assert.equal(got([mail], [...wrap(body("M_1")), ...ui.slice(0, 5), ...tail]), "[]");
  assert.equal(got([mail], [...wrap(body("M_1")), ...ui, ...tail]), "[]");
  // 응답 9줄 + 테두리만 있는 줄들은 10줄에 못 미쳐 유지
  assert.equal(got([mail], [...wrap(body("M_1")), ...reply.slice(0, 9), "────", "╰──╯", ...tail]), "[]");
  // 미제출 긴 입력: 본문 끝이 화면 맨 아래까지 이어짐(앞부분 ID는 위로 밀려도 끝이 아래 4줄 안) → 유지
  assert.equal(got([mail], ["위쪽 출력", ...wrap(body("M_1")), "", "상태줄"]), "[]");
  // 본문 끝이 입력창 영역 밖이어도 뒤에 응답(비어 있지 않은 줄)이 없으면 유지
  assert.equal(got([mail], ["x", ...wrap(body("M_1")), "", "", "", "", ""]), "[]");
  // 본문 끝부분이 화면에 없으면(앞부분만) 유지
  assert.equal(got([mail], ["메일 ID: M_1. 이미 처리한", "응답1", "응답2", ...tail, "z"]), "[]");
  assert.equal(got([mail], null), "[]");
});

test("T65: inbox에서 사라진 mail 항목만 제거, 미처리·예약 중·assign/user는 유지", () => {
  const list = [it("mail:A", "mail"), it("mail:B", "mail"), it("mail:C", "mail", { stuck: true }), it("assign:T_1", "assign"), it("u1", "user")];
  const got = api.staleMailIds(list, new Set(["B"]), new Set(["C"]));
  assert.equal(JSON.stringify(got), JSON.stringify(["mail:A"]));
  assert.equal(JSON.stringify(api.staleMailIds(undefined, new Set(), new Set())), "[]");
});

test("T1: 🔥가 아닌 assign만 제거, 🔥 assign·mail·user는 유지, 빈 목록이면 호출부가 안 부름", () => {
  const list = [it("assign:T_1", "assign"), it("assign:T_2", "assign"), it("mail:M", "mail"), it("u", "user")];
  assert.equal(JSON.stringify(api.revokedAssignIds(list, new Set(["T_1"]))), JSON.stringify(["assign:T_2"]));
  assert.equal(JSON.stringify(api.revokedAssignIds(undefined, new Set())), "[]");
  const src = require("node:fs").readFileSync("src/App.tsx", "utf8");
  assert.match(src, /tasks\.length === 0 \? \[\] : revokedAssignIds\(/);
  assert.ok(src.includes("if (boardTasks.length > 0) clearDispatchNotes("));
});

test("T1b: 🔥 아닌 작업의 assign handled·resolved 기록만 지워 재착수 시 재전달이 막히지 않는다", () => {
  const recs = ["a1|assign:T_1", "a1|assign:T_2", "a1|report:T_2:a1", "a2|assign:T_3", "a1|mail:M"];
  assert.equal(JSON.stringify(api.staleAssignRecordKeys(recs, "a1", new Set(["T_1"]))), JSON.stringify(["a1|assign:T_2"]));
  const src = require("node:fs").readFileSync("src/App.tsx", "utf8");
  assert.ok(!src.includes("for (const id of revoked) useSessionQueue.getState().markHandled"));
  assert.ok(src.includes("st.unmark(stale)"));
  // 재전달 경로: 기록이 지워진 뒤에는 handled에 없으므로 continue로 막히지 않는다
  const handled = ["a1|assign:T_2"].filter((k) => !api.staleAssignRecordKeys(["a1|assign:T_2"], "a1", new Set()).includes(k));
  assert.equal(handled.includes("a1|assign:T_2"), false);
});

test("T4: 전달 보류는 delivery.log에 CLI·사유·로그 시작/종료 유무를 남긴다", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "App.tsx"), "utf8").replace(/\r/g, "");
  assert.ok(src.includes("attempt.step(`blocked_${session.cliId}_"));
  assert.ok(src.includes("logSig = `_ctx${ctx ?"));
});

test("T8: resumed id 없는 Codex 세션도 저장된 대화 id의 로그로 ctx를 읽는다", () => {
  const src = require("node:fs").readFileSync("src-tauri/src/main.rs", "utf8").replace(/\r/g, "");
  assert.ok(src.includes("pty.resumed_cli_id(&session_id).or_else("));
  assert.ok(src.includes('context::saved_codex_log_in_use(&codex_dir, &cwd, &saved, &started_at)'));
});

test("터미널 URL 클릭은 xterm 기본 경고 대신 외부 브라우저 열기를 쓴다", () => {
  const src = require("node:fs").readFileSync("src/components/TerminalPane.tsx", "utf8").replace(/\r/g, "");
  assert.ok(src.includes("linkHandler: { activate:"));
  assert.ok(src.includes("term.registerLinkProvider("));
  assert.ok(src.includes("apiOpenExternalUrl(m[0])"));
});

test("T1793752130651_3: Tauri에서 URL 열기 거부는 window.open으로 우회하지 않고, 줄바꿈 URL은 이어 붙여 연다", () => {
  const fs = require("node:fs");
  const br = fs.readFileSync("src/lib/tauriBridge.ts", "utf8").replace(/\r/g, "");
  const body = br.slice(br.indexOf("export async function apiOpenExternalUrl"), br.indexOf("export interface UpdateProgressPayload")).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(body.includes('await invoke("open_external_url", { url });'));
  assert.ok(!body.includes("catch"));
  assert.equal(body.match(/window\.open/g).length, 1);
  assert.ok(body.indexOf("window.open") > body.indexOf("return;"));
  const tp = fs.readFileSync("src/components/TerminalPane.tsx", "utf8").replace(/\r/g, "");
  assert.ok(tp.includes("isWrapped") && tp.includes("line.getCell(x)"));
  const app = fs.readFileSync("src/App.tsx", "utf8").replace(/\r/g, "");
  assert.ok(!/apiOpenExternalUrl\(updateInfo\.release_url\)\}/.test(app));
});

test("T1793752130651_7: 출력 없는 세션 안내·릴레이 복구 경로와 잘린 재생 경계 보정", () => {
  const fs = require("node:fs");
  const tp = fs.readFileSync("src/components/TerminalPane.tsx", "utf8").replace(/\r/g, "");
  assert.ok(tp.includes("setSilentSession(!!session.resumed && chunk.nextCursor === 0 &&"));
  assert.ok(tp.includes("릴레이로 다시 열기"));
  const pty = fs.readFileSync("src-tauri/src/pty.rs", "utf8").replace(/\r/g, "");
  assert.ok(pty.includes("take(4096).position("));
});

test("T1793842681518_2: 끝난 작업의 report·mail만 제거(완료·취소·삭제·ID없음 4경우, _1≠_10, 진행 중 오삭제 0)", () => {
  const sq = {};
  require("node:vm").runInNewContext(require("typescript").transpileModule(require("node:fs").readFileSync("src/lib/sessionQueue.ts", "utf8"), { compilerOptions: { module: 1 } }).outputText, { exports: sq, require: () => ({}) });
  const item = (id, source, extra = {}) => ({ id, source, preview: "", payload: "", createdAt: 0, ...extra });
  const tasks = [{ taskId: "T100000_1", status: "done" }, { taskId: "T100000_2", status: "closed" }, { taskId: "T100000_3", status: "start" }, { taskId: "T100000_10", status: "start" }];
  const mails = { m1: "T100000_1 확인", m2: "T100000_2 확인", m3: "T100000_9 확인", m4: "일반 안내", m5: "T100000_3 진행", m6: "T100000_1 확인 T100000_3", m7: "T100000_1 결과", m8: "T100000_1 확인" };
  const mailOf = (id) => mails[id] && { subject: mails[id], body: "", isResult: id === "m7" };
  const list = [
    item("mail:m1", "mail"), item("mail:m2", "mail"), item("mail:m3", "mail"), item("mail:m4", "mail"), item("mail:m5", "mail"), item("mail:m6", "mail"), item("mail:m7", "mail"),
    item("mail:m8", "mail", { stuck: true }), // 닫힌 작업의 stuck mail도 제거
    item("report:T100000_1:a", "report"), item("report:T100000_2:a", "report"), item("report:T100000_3:a", "report"), item("report:T100000_7:a", "report"),
  ];
  assert.deepEqual([...sq.endedQueueIds(list, tasks, mailOf)], ["mail:m1", "mail:m2", "mail:m3", "mail:m8", "report:T100000_2:a", "report:T100000_3:a", "report:T100000_7:a"]);
  // _1 은 _10 과 구별
  assert.deepEqual([...sq.endedQueueIds([item("mail:x", "mail")], tasks, () => ({ subject: "T100000_1", body: "T100000_10", isResult: false }))], []);
});

test("T1793860863515_1: 담당자가 이미 받은(ack) assign만 닫히고 다른 ID는 유지", () => {
  const q = [it("assign:T20", "assign", { reason: "팀원이 응답 중" }), it("assign:T21", "assign")];
  assert.deepEqual([...api.settledAutoIds(q, new Set(), () => false, new Set(["T20"]))], ["assign:T20"]);
  assert.deepEqual([...api.settledAutoIds(q, new Set(), () => false)], []);
  const app = require("node:fs").readFileSync("src/App.tsx", "utf8");
  assert.match(app, /m\.from === s\.agentId/);
});
