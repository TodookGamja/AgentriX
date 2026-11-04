const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("T30: cancel_project_blackboard_task는 정규화·금지경로 검사 후 프로젝트/.ai-agents/BLACKBOARD.md만 다룸", () => {
  const db = read("src-tauri/src/db.rs");
  const fn = db.match(/fn cancel_project_blackboard_task_with_hook[\s\S]*?^}/m)?.[0] ?? "";
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
  const fn = db.match(/fn cancel_project_blackboard_task_with_hook[\s\S]*?^}/m)?.[0] ?? "";
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

test("T33: rename 직전 재읽고 변경 시 최대 세 번 재시도", () => {
  const fn = (read("src-tauri/src/db.rs").match(/fn cancel_project_blackboard_task_with_hook[\s\S]*?^}/m) ?? [""])[0];
  assert.match(fn, /let board = std::fs::read_to_string\(&path\)\?;/);
  assert.match(fn, /for _ in 0\.\.3/);
  assert.match(fn, /std::fs::read\(&path\)\? != board\.as_bytes\(\)/);
  assert.match(fn, /작업표가 바뀌어 취소를 다시 시도하세요/);
});
