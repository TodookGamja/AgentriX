const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(path, sandbox = {}) {
  const source = fs.readFileSync(path, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const api = {};
  vm.runInNewContext(js, { exports: api, require: () => ({}), ...sandbox });
  return api;
}

test("header BoardPanel and project workspace both mount the same TaskApprovalBoard", () => {
  const panel = fs.readFileSync("src/components/BoardPanel.tsx", "utf8");
  const workspace = fs.readFileSync("src/components/ProjectWorkspaceView.tsx", "utf8");
  assert.match(panel, /import \{ TaskApprovalBoard \} from "\.\/TaskApprovalBoard"/);
  assert.match(panel, /<TaskApprovalBoard projectPath=\{projectPath\} agents=\{agents\} \/>/);
  assert.match(workspace, /import \{ TaskApprovalBoard \} from "\.\/TaskApprovalBoard"/);
  assert.match(workspace, /<TaskApprovalBoard projectPath=\{projectPath\} agents=\{agents\} \/>/);
  assert.equal(panel.includes("parseBoardTables"), false);
});

test("empty or broken blackboard yields empty task list without throw", () => {
  const api = loadTs("src/lib/blackboardDispatch.ts");
  const empty = (board) => {
    const got = api.parseBoardTasks(board, ["a"]);
    assert.equal(got.length, 0);
  };
  empty("");
  empty("hello world\nno table");
  empty("| only | one |\n|---|---|\n| broken |");
  assert.equal(api.boardTaskTitle("", "T1"), "");
});

test("manual approval upsert gates: pending blocks, approved/rejected recorded", () => {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const api = loadTs("src/lib/taskApproval.ts", { localStorage, JSON, Array });
  const project = "C:/proj";

  api.setApprovalMode(project, "manual");
  assert.equal(api.getApprovalMode(project), "manual");

  // App 디스패처와 동일: 승인 없으면 pending 기록 → 전달 스킵
  assert.equal(api.findApproval(project, "T1", "pixel"), undefined);
  api.upsertApproval(project, { taskId: "T1", agentId: "pixel", status: "pending" });
  assert.equal(api.findApproval(project, "T1", "pixel").status, "pending");

  // 패널 승인 버튼 → approved → 디스패처가 전달 진행
  api.upsertApproval(project, { taskId: "T1", agentId: "pixel", status: "approved" });
  assert.equal(api.findApproval(project, "T1", "pixel").status, "approved");

  // 패널 반려 → rejected + reason
  api.upsertApproval(project, { taskId: "T2", agentId: "forge", status: "rejected", reason: "범위 밖" });
  const rej = api.findApproval(project, "T2", "forge");
  assert.equal(rej.status, "rejected");
  assert.equal(rej.reason, "범위 밖");
});

test("App dispatcher still skips start tasks until manual approval is approved", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /getApprovalMode\(project\) === "manual"/);
  assert.match(app, /status === "pending"\) continue/);
  assert.match(app, /status === "rejected"/);
  assert.match(app, /upsertApproval\(project, \{ taskId: t\.taskId, agentId: t\.agentId, status: "pending" \}/);
});

test("shortTaskTitle strips markdown, keeps first sentence, caps at 40 chars", () => {
  const api = loadTs("src/lib/blackboardDispatch.ts");
  assert.equal(api.shortTaskTitle("**`pty.rs` 마커 제거**. 나머지 설명"), "pty.rs 마커 제거.");
  assert.equal(api.shortTaskTitle("[링크](http://x) 제목"), "링크 제목");
  assert.equal(api.shortTaskTitle(""), "");
  const long = api.shortTaskTitle("가".repeat(100));
  assert.equal(long.length, 40);
  assert.ok(long.endsWith("…"));
});

test("T11: 팀빌더 카드 CLI·모델 배지는 이름 줄 밖(아래 줄)에서 말줄임+title", () => {
  const src = require("node:fs").readFileSync("src/components/AiDeepTeamModal.tsx", "utf8");
  const i = src.indexOf('aria-label="에이전트 역할"');
  const rest = src.slice(i, i + 1600);
  assert.match(rest, /<\/div>\s*<span\s+title=\{`\$\{ag\.cliId\}[\s\S]*?block max-w-full truncate/);
});
