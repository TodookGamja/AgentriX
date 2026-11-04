const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const api = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(ROOT, "src/lib/blackboardDispatch.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: api },
);

const head = ["| ID | 작업 | 담당 | 선행 | 기준 | 상태 |", "|---|---|---|---|---|---|", ""].join("\n");
const board = (rows) => head + rows.join("\n");

test("T28: cancelBoardRow는 ID 정확 일치 행의 상태 칸만 바꾸고 다른 행·칸·CRLF는 유지", () => {
  const b = board([
    "| T28_1 | a | agent | — | keep-a | 🔥 착수 |",
    "| T28_10 | b | agent | T28_1 | keep-b | ⏳ 대기 |",
    "| T28_2 | c | agent | — | keep-c | ✅ 완료 — 메모 |",
  ]).replace(/\n/g, "\r\n");
  const next = api.cancelBoardRow(b, "T28_1");
  assert.ok(next);
  const lines = next.split("\r\n");
  assert.equal(lines[2], "| T28_1 | a | agent | — | keep-a | 취소 — 사용자 작업판에서 취소 |");
  assert.equal(lines[3], "| T28_10 | b | agent | T28_1 | keep-b | ⏳ 대기 |");
  assert.equal(lines[4], "| T28_2 | c | agent | — | keep-c | ✅ 완료 — 메모 |");
  assert.equal(lines.length, 5);
  assert.equal(api.cancelBoardRow(b, "T28"), null);
  assert.equal(api.cancelBoardRow(b, "T28_10".slice(0, 4)), null);
  const cols = lines[0].split("|").length;
  for (const line of lines.slice(2)) assert.equal(line.split("|").length, cols);
});

test("T28: 선행 ID가 표에 없으면 영구 대기 없이 전달 대상", () => {
  const b = board(["| T28_9 | go | agent | T999_missing, _8 | x | 🔥 착수 |"]);
  const dispatched = api.parseBoardTasks(b, ["agent"]);
  assert.equal(JSON.stringify(dispatched.map((t) => t.taskId)), '["T28_9"]');
  assert.equal(dispatched[0].blockedBy, undefined);
});

test("T28: 상태 형식 오류(invalid) 행은 기본 파싱·전달 대상에서 제외, 보드 includeWaiting에만 노출", () => {
  const b = board([
    "| T28_1 | bad | agent | — | x | 보류 메모 ⏳ 재착수 |",
    "| T28_2 | ok | agent | — | x | 🔥 착수 |",
  ]);
  assert.equal(JSON.stringify(api.parseBoardTasks(b, ["agent"]).map((t) => [t.taskId, t.status])), '[["T28_2","start"]]');
  assert.equal(
    JSON.stringify(api.parseBoardTasks(b, ["agent"], undefined, true).map((t) => [t.taskId, t.status])),
    '[["T28_1","invalid"],["T28_2","start"]]',
  );
  assert.equal(api.boardTaskColumn({ status: "invalid", manual: false, confirmed: true, live: true, queued: false }), "waiting");
});

test("T28: App 디스패치는 includeWaiting 없이 parse — invalid·closed 미전달 가드 유지", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(app, /parseBoardTasks\(board, agents\.map\(/);
  assert.equal(/parseBoardTasks\([^\n]*true\s*\)/.test(app), false);
  assert.match(app, /if \(t\.status === "wait" \|\| t\.status === "closed"\) continue;/);
  const ui = fs.readFileSync(path.join(ROOT, "src/components/TaskApprovalBoard.tsx"), "utf8").replace(/\r/g, "");
  assert.match(ui, /parseBoardTasks\([^\n]*true\)/);
  assert.match(ui, /apiCancelProjectBlackboardTask\(projectPath, c\.taskId\)/);
});

test("T29: 취소는 백엔드 행 갱신 커맨드를 호출한다", () => {
  const db = fs.readFileSync(path.join(ROOT, "src-tauri/src/db.rs"), "utf8");
  const fn = db.match(/pub fn save_project_blackboard[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(fn, /std::fs::write\(.*BLACKBOARD\.md/);
  assert.equal(/atomic|compare_and|etag|lock|row.?replace/i.test(fn), false);
  const ui = fs.readFileSync(path.join(ROOT, "src/components/TaskApprovalBoard.tsx"), "utf8");
  assert.match(ui, /apiCancelProjectBlackboardTask\(projectPath, c\.taskId\)/);
  assert.doesNotMatch(ui, /apiSaveProjectBlackboard/);
});

test("T28: closed 취소 행은 완료 칸·start 기록 정리 대상(자동 전달·완료 보고 회귀)", () => {
  const b = board(["| T28_1 | a | agent | — | x | 🔥 착수 |"]);
  const cancelled = api.cancelBoardRow(b, "T28_1");
  const tasks = api.parseBoardTasks(cancelled, ["agent"]);
  assert.equal(JSON.stringify(tasks.map((t) => [t.taskId, t.status])), '[["T28_1","closed"]]');
  assert.equal(api.boardTaskColumn({ status: "closed", manual: false, confirmed: false, live: true, queued: false }), "done");
  const sent = new Set(["T28_1:start:agent"]);
  assert.equal(api.forgetEndedStarts(sent, tasks), true);
  assert.equal(sent.has("T28_1:start:agent"), false);
});
