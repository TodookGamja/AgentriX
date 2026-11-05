/**
 * T1793840117765_3 — _1·_2 회귀
 * - ROLE.md 있으면 첫 브리핑 짧은 파일 참조(긴 전문 0), 없으면 전문+collab
 * - 출근·릴레이·tauriBridge 3경로 roleBriefText, 1회( pending 게이트 )
 * - outbox는 ROLE.md 협업 규칙에 유지·팀원 폴더 격리·공유 AGENTS/GEMINI 0
 * - Codex: 파일 지침 미적용(Forge _2) → 긴 역할은 6_000 한도로 시스템 주입 실패 후 짧은 브리핑; T23=6_000
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const loadTs = (rel) => {
  const api = {};
  vm.runInNewContext(
    ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: api, module: { exports: api } },
  );
  return api;
};

const dispatch = loadTs("src/lib/blackboardDispatch.ts");
const app = read("src/App.tsx");
const bridge = read("src/lib/tauriBridge.ts");
const pty = read("src-tauri/src/pty.rs");
const handoffTest = read("tests/handoffRelay.test.cjs");
const agentsDir = path.join(ROOT, ".ai-agents", "agents");

const agents = [
  { id: "deep-ai-ai-cli-manager-5-mvuhjiq5", name: "Sentinel", roleTitle: "QA" },
  { id: "deep-ai-ai-cli-manager-1-mvuhjiq5", name: "Conductor PM", roleTitle: "PM" },
];
const longRole = {
  id: "deep-ai-ai-cli-manager-5-mvuhjiq5",
  rolePrompt: "역할전문 ".repeat(80) + "협업규칙 수천자급",
};

test("T3/①: ROLE.md 있으면 브리핑 ≤200자·파일 참조 한 줄, 긴 rolePrompt 전문 0", () => {
  const short = dispatch.roleBriefText(longRole, agents, true);
  assert.ok(short.length <= 200, `short len=${short.length}`);
  assert.match(short, /\.ai-agents\/agents\/deep-ai-ai-cli-manager-5-mvuhjiq5\/ROLE\.md를 먼저 읽고/);
  assert.ok(!short.includes("역할전문"));
  assert.ok(!short.includes("outbox")); // 메시지가 아니라 ROLE.md에 위임
  const full = dispatch.roleBriefText(longRole, agents, false);
  assert.ok(full.length > 200);
  assert.ok(full.includes("역할전문") && full.includes(dispatch.collabProtocol(longRole.id, agents)));
});

test("T3/②: 출근·릴레이·tauriBridge 최초 제출이 모두 roleBriefText (긴 전문 markRolePrefix 경로 0)", () => {
  assert.match(app, /markRolePrefix\(session\.id,\s*roleBriefText\(agent,\s*projectAgents,/);
  assert.match(app, /markRolePrefix\(newSession\.id,\s*roleBriefText\(relayAgent,\s*relayAgents,/);
  assert.match(bridge, /markRolePrefix\(sessionId,\s*roleBriefText\(agent,\s*agents,/);
  assert.ok(!app.includes("markRolePrefix(session.id, `${agent.rolePrompt"));
  assert.ok(!app.includes("markRolePrefix(newSession.id, `${relayAgent.rolePrompt"));
});

test("T3/③: 지침 1회 — roleInSystem·getRoleState·pending 게이트·resumed 스킵", () => {
  assert.match(app, /!session\.roleInSystem/);
  assert.match(app, /!newSession\.roleInSystem/);
  assert.match(bridge, /!session\.roleInSystem\s*&&\s*!getRoleState\(sessionId\)/);
  assert.match(app, /getRoleState\(session\.id\)\s*!==\s*"pending"/);
  assert.match(app, /session\.resumed/);
});

test("T3/④: 팀원 ROLE.md마다 outbox·협업 규칙, 공유 AGENTS/GEMINI 0, 상호 ROLE 누수 문구 0", () => {
  const dirs = fs.readdirSync(agentsDir).filter((n) =>
    fs.statSync(path.join(agentsDir, n)).isDirectory(),
  );
  assert.ok(dirs.length >= 4);
  for (const id of dirs) {
    const rolePath = path.join(agentsDir, id, "ROLE.md");
    assert.ok(fs.existsSync(rolePath), id);
    const text = fs.readFileSync(rolePath, "utf8");
    assert.match(text, /outbox/);
    assert.match(text, /협업 규칙|팀 메시지/);
    assert.ok(!text.includes("AGENTS.md"));
    // 다른 팀원 ROLE.md 경로를 쓰라고 하지 않음(자기 agentId 폴더만)
    for (const other of dirs) {
      if (other === id) continue;
      assert.ok(
        !text.includes(`.ai-agents/agents/${other}/ROLE.md`),
        `${id} leaks ${other}`,
      );
    }
  }
  assert.ok(!fs.existsSync(path.join(ROOT, ".ai-agents", "AGENTS.md")));
  assert.ok(!fs.existsSync(path.join(ROOT, ".ai-agents", "GEMINI.md")));
});

test("T3/⑤: Codex 6_000 한도·T23 교정, 긴 역할은 시스템 주입 실패 → 짧은 브리핑 경로", () => {
  assert.match(pty, /fn codex_role_config\(role: &str\) -> Option<String>/);
  assert.match(pty, /value\.len\(\) > 6_000/);
  assert.ok(!pty.includes("16_000"));
  assert.ok(handoffTest.includes("6_000"), "T23이 pty 6_000 한도를 단언");
  assert.ok(!handoffTest.includes("16_000"), "T23 구 16_000 단언 잔존 0");
  // 유닛: 입력 ~1000자면 encoded value가 한도 초과(None) → roleInSystem false 전제
  assert.match(pty, /assert!\(codex_role_config\(&"a"\.repeat\(1000\)\)\.is_none\(\)\)/);
  assert.match(pty, /assert!\(codex_role_config\(&"a"\.repeat\(995\)\)\.is_some\(\)\)/);
});
