/**
 * T1793776116339_11 — _10·_12·_13 회귀 검증
 * - 짧은 메일/배정문에 outbox 꼬리말 0
 * - roleInSystem=false·릴레이·Cursor 래퍼/재개 → 브리핑(접두)로 outbox 규칙 1회 유지
 * - roleInSystem=true 경로는 collab_protocol 있을 때만(ROLE.md에 outbox 포함)
 * - 팀원별 ROLE 격리·공유 AGENTS/GEMINI 미작성
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(rel) {
  const source = fs.readFileSync(rel, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const api = {};
  vm.runInNewContext(js, { exports: api, module: { exports: api }, require: () => ({}) });
  return api;
}

const dispatch = loadTs("src/lib/blackboardDispatch.ts");
const handoff = loadTs("src/lib/handoffRelay.ts");
const app = fs.readFileSync("src/App.tsx", "utf8");
const pty = fs.readFileSync("src-tauri/src/pty.rs", "utf8");
const db = fs.readFileSync("src-tauri/src/db.rs", "utf8");

const agents = [
  { id: "pm", name: "Conductor PM", roleTitle: "총괄 PM" },
  { id: "pixel", name: "Pixel", roleTitle: "프론트엔드" },
  { id: "forge", name: "Forge", roleTitle: "Rust" },
];

test("T1793776116339_11: 짧은 메일·배정문에 outbox 규칙 꼬리말 0, 머리말·메일ID 유지", () => {
  const mail = dispatch.teamMailText("PM", "mail-1", "제목", "본문");
  const assign = dispatch.assignText("T1793776116339_11");
  for (const t of [mail, assign]) {
    for (const bad of ["outbox", "JSON", "수신 가능한", "이미 처리한 ID", "mailProtocol"]) {
      assert.ok(!t.includes(bad), bad);
    }
  }
  assert.match(mail, /메일 ID: mail-1/);
  assert.match(assign, /\[PM 배정\].*T1793776116339_11/);
  assert.ok(app.includes("teamMailText(") && app.includes("assignText("));
  assert.ok(!app.includes("mailProtocol(session.agentId") && !app.includes("mailProtocol(t.agentId"));
});

test("T1793776116339_11: collabProtocol/mailProtocol은 시작 지침에 outbox 경로를 갖고 팀원별 agentId 격리", () => {
  const pixel = dispatch.collabProtocol("pixel", agents);
  const forge = dispatch.collabProtocol("forge", agents);
  assert.match(pixel, /\.ai-agents\/agents\/pixel\/outbox\//);
  assert.match(forge, /\.ai-agents\/agents\/forge\/outbox\//);
  assert.ok(!pixel.includes("/forge/outbox/") && !forge.includes("/pixel/outbox/"));
  assert.match(pixel, /요청에는 답변하고, 결과 통보에는 불필요한 답장을 하지 마세요/);
  const pm = dispatch.collabProtocol("pm", agents);
  assert.match(pm, /BLACKBOARD\.md/);
  assert.match(pm, /\.ai-agents\/agents\/pm\/outbox\//);
});

test("T1793776116339_11: roleInSystem=false·릴레이 새 세션은 markRolePrefix에 collabProtocol(outbox) 포함", () => {
  assert.match(app, /!session\.roleInSystem[\s\S]{0,120}markRolePrefix\(session\.id,/);
  assert.match(app, /!newSession\.roleInSystem[\s\S]{0,120}markRolePrefix\(newSession\.id,/);
  assert.match(app, /markRolePrefix\(session\.id, `\$\{agent\.rolePrompt[\s\S]*?collabProtocol\(agent\.id, projectAgents\)/);
  assert.match(app, /markRolePrefix\(newSession\.id, `\$\{relayAgent\.rolePrompt[\s\S]*?collabProtocol\(relayAgent\.id, relayAgents\)/);
  // 역할 틱은 짧은 대기 문구만; outbox는 접두에 이미 있음
  assert.match(app, /역할 지침을 확인하고 다음 지시를 기다리세요/);
  assert.match(app, /onlyPendingRole = false/);
  assert.match(app, /getRoleState\(session\.id\) !== "pending"/);
});

test("T1793776116339_11: 접두에 outbox가 있으면 짧은 배정만으로도 첫 제출에 규칙이 붙고 1회만", () => {
  const sid = "relay-no-sys";
  const role = `역할 ${dispatch.collabProtocol("pixel", agents)} `;
  handoff.markRolePrefix(sid, role);
  const first = handoff.applyHandoffHint(sid, dispatch.assignText("T_x"));
  assert.ok(first.startsWith(role));
  assert.match(first, /pixel\/outbox\//);
  assert.match(first, /\[PM 배정\]/);
  const second = handoff.applyHandoffHint(sid, dispatch.teamMailText("PM", "m2", "s", "b"));
  assert.equal(second.startsWith(role), false);
  assert.ok(!second.includes("outbox"));
});

test("T1793776116339_11: Cursor 래퍼·재개·미검증 경로는 startup_role 없음 → 브리핑 유지 코드 존재", () => {
  assert.match(pty, /fn startup_role_args\(/);
  assert.match(pty, /"antigravity" => Some\(vec!\["--prompt-interactive"/);
  assert.match(pty, /"cursor" => Some\(vec!\[escaped\]\)/);
  assert.match(pty, /resume_id\.is_some\(\).*return None/);
  // 단위 테스트가 래퍼/재개 None을 고정
  assert.match(pty, /startup_role_args\("cursor", Some\("__WRAPPER__"\), Some\("hcursor\.cmd"\), None, role\)\.is_none\(\)/);
  assert.match(pty, /startup_role_args\("antigravity", None, None, Some\("resumed"\), role\)\.is_none\(\)/);
  assert.match(pty, /supports_codex_wrapper_role\(Some\("__WRAPPER__"\), Some\("C:\\\\tools\\\\hcodex\.cmd"\), Some\("resumed"\)\)/);
  // role_in_system 승격은 collab_protocol Some일 때만
  assert.match(pty, /collab_protocol\.as_deref\(\)\.is_some_and\(\|s\| !s\.trim\(\)\.is_empty\(\)\)/);
});

test("T1793776116339_11: ROLE.md는 에이전트 폴더만 쓰고 공유 AGENTS/GEMINI 미작성", () => {
  assert.match(db, /agents"\)\.join\(&agent\.id\)/);
  assert.match(db, /agent_dir\.join\("ROLE\.md"\)/);
  assert.doesNotMatch(db, /AGENTS\.md|GEMINI\.md|CLAUDE\.md/);
  assert.doesNotMatch(pty, /AGENTS\.md|GEMINI\.md/);
  // 실디스크: 팀원 ROLE outbox 경로가 서로 다름
  const root = path.join(".ai-agents", "agents");
  if (fs.existsSync(root)) {
    const roles = fs.readdirSync(root).map((id) => {
      const p = path.join(root, id, "ROLE.md");
      return fs.existsSync(p) ? { id, text: fs.readFileSync(p, "utf8") } : null;
    }).filter(Boolean);
    assert.ok(roles.length >= 2, "에이전트 ROLE 샘플 필요");
    for (const r of roles) {
      if (!r.text.includes("[팀 메시지]")) continue;
      assert.match(r.text, new RegExp(`agents/${r.id}/outbox/`));
      for (const other of roles) {
        if (other.id === r.id) continue;
        assert.ok(!r.text.includes(`agents/${other.id}/outbox/`), `누수 ${r.id}←${other.id}`);
      }
    }
  }
});

test("T1793776116339_11: App 출근·릴레이는 start_session에 collabProtocol 전달(시스템 주입 경로)", () => {
  assert.match(app, /collabProtocol\(agent\.id, projectAgents\)/);
  assert.match(app, /relayAgent \? collabProtocol\(relayAgent\.id, relayAgents\) : undefined/);
});
