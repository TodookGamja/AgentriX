/**
 * T1793842681518_3 — _1·_2·_4 회귀
 * _1 raw key 우회 · _2 endedQueueIds · _4 화면유휴/agy 로그오탐 안전망
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = (rel) => {
  const api = {};
  vm.runInNewContext(
    ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: api, require: () => ({}) },
  );
  return api;
};

const bridge = read("src/lib/tauriBridge.ts");
const app = read("src/App.tsx");
const pane = read("src/components/TerminalPane.tsx");
const main = read("src-tauri/src/main.rs");
const ctxRs = read("src-tauri/src/context.rs");
const gate = load("src/lib/deliveryGate.ts");
const sq = load("src/lib/sessionQueue.ts");

const isRaw = (() => {
  const m = bridge.match(/export function isRawUserKey[\s\S]*?\n}\n/)[0];
  const mod = { exports: {} };
  new Function("exports", ts.transpileModule(m, { compilerOptions: { module: 1 } }).outputText)(mod.exports);
  return mod.exports.isRawUserKey;
})();

test("T3/_1: 휠·화살표·단일키는 쓰기 대기열 우회, 전달·붙여넣기·역할브리핑·확인창 단축키 차단 유지", () => {
  assert.equal(isRaw("a", false), true);
  assert.equal(isRaw("\x1b[A", false), true);
  assert.equal(isRaw("\x1b[<64;10;5M", false), true); // 휠 보고
  assert.equal(isRaw("팀 전달 본문\r", false), false);
  assert.equal(isRaw("a", true), false);
  assert.equal(isRaw("a", false, {}), false);
  assert.equal(isRaw("a", false, undefined, true), false);
  const body = bridge.slice(bridge.indexOf("export async function apiWriteToSession"));
  assert.ok(body.indexOf("isRawUserKey(data") < body.indexOf("queueSessionWrite("));
  assert.match(pane, /if \(isConfirmOpen\(\)\) return/);
  // Claude/Codex/Cursor 경로도 동일 apiWriteToSession — CLI 분기 우회 없음
  assert.doesNotMatch(bridge, /isRawUserKey\([\s\S]{0,80}cliId/);
});

test("T3/_2: 끝난 작업 report·mail 정리, 진행중·ID없음·결과메일·stuck 유지, _1≠_10, App handled+ack", () => {
  const item = (id, source, extra = {}) => ({ id, source, preview: "", payload: "", createdAt: 0, ...extra });
  const tasks = [
    { taskId: "T100000_1", status: "done" },
    { taskId: "T100000_2", status: "closed" },
    { taskId: "T100000_3", status: "start" },
    { taskId: "T100000_10", status: "start" },
  ];
  const mailOf = (id) =>
    ({
      m1: { subject: "T100000_1 확인", body: "", isResult: false },
      m2: { subject: "T100000_2 확인", body: "", isResult: false },
      m3: { subject: "T100000_9 확인", body: "", isResult: false }, // 보드 없음 → 정리
      m4: { subject: "일반 안내", body: "", isResult: false }, // ID 없음 유지
      m5: { subject: "T100000_3 진행", body: "", isResult: false }, // 🔥 유지
      m6: { subject: "T100000_1 확인 T100000_3", body: "", isResult: false }, // 혼합 → 유지
      m7: { subject: "T100000_1 결과", body: "", isResult: true }, // 결과메일 유지
    })[id];
  const list = [
    item("mail:m1", "mail"),
    item("mail:m2", "mail"),
    item("mail:m3", "mail"),
    item("mail:m4", "mail"),
    item("mail:m5", "mail"),
    item("mail:m6", "mail"),
    item("mail:m7", "mail"),
    item("mail:stuck", "mail", { stuck: true }),
    item("mail:unc", "mail", { unconfirmed: true }),
    item("report:T100000_1:a", "report"), // done 유지(settled 경로)
    item("report:T100000_2:a", "report"), // closed → 제거
    item("report:T100000_3:a", "report"), // start → 제거
    item("report:T100000_7:a", "report"), // 없음 → 제거
  ];
  assert.equal(
    JSON.stringify([...sq.endedQueueIds(list, tasks, mailOf)]),
    JSON.stringify(["mail:m1", "mail:m2", "mail:m3", "report:T100000_2:a", "report:T100000_3:a", "report:T100000_7:a"]),
  );
  // _1 과 _10 동시 언급 → 진행 중 _10 때문에 오삭제 0
  assert.equal(
    JSON.stringify([
      ...sq.endedQueueIds([item("mail:x", "mail")], tasks, () => ({
        subject: "T100000_1",
        body: "T100000_10",
        isResult: false,
      })),
    ]),
    "[]",
  );
  assert.match(app, /endedQueueIds\(/);
  assert.match(app, /markHandled\(`\$\{key\}\|\$\{id\}`\)/);
  assert.match(app, /apiAcknowledgeTeamMail\(project, s\.agentId, id\.slice\(5\)\)/);
  assert.match(app, /끝난 작업 관련 대기 항목/);
});

test("T3/_4: 공통 60s 화면유휴 · agy 로그오탐 fallback · 끼어들기 0", () => {
  assert.equal(gate.AGY_IDLE_FALLBACK_MS, 60_000);
  const screens = {
    claude: { lines: ["❯", "bypass permissions on"], rows: 10, cursorRow: 8, cursorCol: 1 },
    codex: { lines: ["›", "gpt-5.1-codex"], rows: 10, cursorRow: 8, cursorCol: 1 },
    cursor: { lines: ["→", "ready"], rows: 10, cursorRow: 8, cursorCol: 1 },
    antigravity: { lines: [">", "? for shortcuts"], rows: 10, cursorRow: 8, cursorCol: 1 },
  };
  for (const [cli, screen] of Object.entries(screens)) {
    assert.equal(gate.idleScreenFallback(cli, screen, 200, 150, false, 60_200), true, cli);
    assert.equal(gate.idleScreenFallback(cli, screen, 200, 150, true, 60_200), false, `${cli} pending`);
    assert.equal(gate.idleScreenFallback(cli, screen, 200, 150, false, 60_199), false, `${cli} <60s`);
  }
  const agyCtx = { source: "transcript.jsonl", startedAt: 100, completedAt: null, sourceModifiedAt: 200 };
  const agyScreen = { lines: ["finished", "> ", "? for shortcuts"], rows: 20, cursorRow: 18, cursorCol: 2 };
  assert.equal(gate.agyIdleFallback(agyCtx, agyScreen, 200, 150, false, 60_200), true);
  assert.equal(gate.agyIdleFallback(agyCtx, agyScreen, 200, 150, true, 60_200), false);
  assert.equal(gate.deliveryGate({ at: 1 }, false, null, 20_000), "wait");
  assert.equal(gate.deliveryGate({ at: 1, started: true }, true, 9_000, 20_000), "proceed");
});

test("T3/_4 Forge세부: USER_INPUT ROLE 고정·ambiguous 1회·미확인 UI·delivery.log 필드(본문0)", () => {
  assert.match(ctxRs, /USER_INPUT[\s\S]{0,200}ROLE\.md/);
  assert.match(ctxRs, /antigravity_with_agent/);
  assert.match(ctxRs, /agy:ambiguous/);
  assert.match(app, /allowAgyRetry:\s*!\["agy:ambiguous", "agy:unavailable"\]\.includes\(ctx\.source\)/);
  assert.match(app, /agyIdleFallback\(/);
  assert.match(app, /idleScreenFallback\(session\.cliId/);
  // 미확인 수동 전송·삭제
  assert.match(pane, /전달 결과를 확인하지 못했습니다/);
  assert.match(pane, /sendQueuedNow\(it\.id, it\.payload/);
  assert.match(pane, /useSessionQueue\.getState\(\)\.(?:remove|resolve)\(qKey, it\.id\)/);
  // delivery.log: agent/cli/stage/source — body·원문 data 없음
  assert.match(main, /fn log_delivery_stage/);
  assert.match(main, /agent=\{\} cli=\{\}/);
  assert.match(main, /stage=\{\} source=\{\}/);
  const logFn = main.slice(main.indexOf("fn log_delivery_stage"), main.indexOf("fn log_delivery_stage") + 1200);
  assert.doesNotMatch(logFn, /\bbody\b|\bpayload\b|data\.as_str|write_to_session/);
  assert.match(logFn, /filter\(\|c\| c\.is_ascii_alphanumeric/);
});
