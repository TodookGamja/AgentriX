const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("T30: cancel_project_blackboard_task는 정규화·금지경로 검사 후 프로젝트/.ai-agents/BLACKBOARD.md만 다룸", () => {
  const db = read("src-tauri/src/db.rs");
  const fn = db.match(/pub fn cancel_project_blackboard_task[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(fn, /normalize_project_path\(project_path\)/);
  assert.match(fn, /is_forbidden_system_dir\(&norm\)/);
  assert.match(fn, /task_id\.trim\(\)\.is_empty\(\)/);
  assert.match(fn, /Path::new\(&norm\)\.join\("\.ai-agents"\)\.join\("BLACKBOARD\.md"\)/);
  // temp는 같은 디렉터리 BLACKBOARD.{uuid}.tmp — 경로 탈출·타 프로젝트 파일 수정 불가
  assert.match(fn, /path\.with_file_name\(format!\("BLACKBOARD\.\{\}\.tmp"/);
  assert.match(fn, /std::fs::rename\(&temp, &path\)/);
  assert.doesNotMatch(fn, /join\(task_id\)|PathBuf::from\(task_id\)/);
});

test("T30: ID는 cells[1] 정확 일치만·0건/중복은 오류, 부분일치 경로 없음", () => {
  const db = read("src-tauri/src/db.rs");
  const fn = db.match(/pub fn cancel_project_blackboard_task[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(fn, /cells\.get\(1\)\.is_some_and\(\|cell\| cell\.trim\(\) == task_id\)/);
  assert.match(fn, /if matches\.len\(\) != 1/);
  assert.doesNotMatch(fn, /starts_with\(task_id\)|contains\(task_id\)/);
  const unit = db.match(/fn cancel_blackboard_preserves_other_rows_and_rejects_missing_or_duplicate_ids[\s\S]*?^    }/m)?.[0] ?? "";
  assert.match(unit, /\| T10 \|/);
  assert.match(unit, /"missing"\)\.is_err\(\)/);
  assert.match(unit, /중복[\s\S]*is_err/);
});

test("T30: IPC 3중 등록 — build.rs · invoke_handler · capabilities · tauriBridge", () => {
  assert.match(read("src-tauri/build.rs"), /"cancel_project_blackboard_task"/);
  assert.match(read("src-tauri/src/main.rs"), /cancel_project_blackboard_task,/);
  const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.ok(caps.permissions.includes("allow-cancel-project-blackboard-task"));
  assert.match(read("src/lib/tauriBridge.ts"), /invoke\("cancel_project_blackboard_task"/);
  const ui = read("src/components/TaskApprovalBoard.tsx");
  assert.match(ui, /apiCancelProjectBlackboardTask\(projectPath, c\.taskId\)/);
  assert.doesNotMatch(ui, /apiSaveProjectBlackboard|cancelBoardRow\(/);
});

test("T30 Low: 읽기~rename 사이 재읽기/비교 없음 — 창은 ms 단위, 완전 CAS 아님(PM 수용)", () => {
  const fn = (read("src-tauri/src/db.rs").match(/pub fn cancel_project_blackboard_task[\s\S]*?^}/m) ?? [""])[0];
  assert.match(fn, /let board = std::fs::read_to_string\(&path\)\?;/);
  assert.match(fn, /std::fs::write\(&temp, updated\)\?;\s*std::fs::rename\(&temp, &path\)\?;/);
  // 본문 읽기는 1회뿐 — rename 직전 CAS/재읽기/락 없음(값싼 개선: rename 전 바이트 비교 후 불일치면 Err)
  assert.equal((fn.match(/read_to_string\(&path\)/g) ?? []).length, 1);
  assert.doesNotMatch(fn, /metadata\(&path\)|file_lock|compare_exchange/);
});
