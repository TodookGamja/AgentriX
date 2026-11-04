const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/handoffRelay.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("late evidence consumes only the matching restored role prefix", () => {
  assert.equal(typeof api.confirmRestoredPrefix, "function");
  api.markRolePrefix("late-agy", "ROLE ");
  const delivered = api.applyHandoffHint("late-agy", "task\r");
  api.restoreHandoffHint("late-agy", "ROLE ", true);
  assert.equal(api.confirmRestoredPrefix("late-agy", "different"), false);
  assert.equal(api.getRoleState("late-agy"), "pending");
  assert.equal(api.confirmRestoredPrefix("late-agy", delivered), true);
  assert.equal(api.getRoleState("late-agy"), "sent");
  assert.equal(api.applyHandoffHint("late-agy", "next\r"), "next\r");
});

test("role prefix: pending until first submitted input, then sent", () => {
  api.markRolePrefix("r1", "ROLE ");
  assert.equal(api.getRoleState("r1"), "pending");
  assert.equal(api.applyHandoffHint("r1", "a"), "a");
  assert.equal(api.getRoleState("r1"), "pending");
  assert.equal(api.applyHandoffHint("r1", "작업\r"), "ROLE 작업\r");
  assert.equal(api.getRoleState("r1"), "sent");
  assert.equal(api.getRoleState("none"), undefined);
});

test("fresh sessions skip claude 30s quiet rule in getTurnContext", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /session\.cliId === "claude" && lastSubmit > 0 && Date\.now\(\) - quiet < 30_000/);
});

test("relay naming increments and strips prior relay suffix", () => {
  const first = api.nextRelaySessionName("🔧 Builder");
  assert.equal(first.relayCount, 1);
  assert.equal(first.newSessionName, "🔧 Builder (릴레이 1)");

  const second = api.nextRelaySessionName("🔧 Builder (릴레이 1)");
  assert.equal(second.baseName, "🔧 Builder");
  assert.equal(second.relayCount, 2);
  assert.equal(second.newSessionName, "🔧 Builder (릴레이 2)");

  const spaced = api.nextRelaySessionName("Agent (릴레이  9)");
  assert.equal(spaced.relayCount, 10);
  assert.equal(spaced.newSessionName, "Agent (릴레이 10)");
});

test("split slots remap only the relayed session id", () => {
  const next = api.remapSplitSlotsAfterRelay(["old", "keep", null, "old"], "old", "new");
  assert.deepEqual(next, ["new", "keep", null, "new"]);
});

test("handoff continue prompts differ for manual vs auto relay", () => {
  const manual = api.handoffContinuePrompt(true);
  const auto = api.handoffContinuePrompt(false);
  assert.match(manual, /SESSION_HANDOFF\.md/);
  assert.match(manual, /이어서 끝까지/);
  assert.match(auto, /다음 지시를 기다리세요/);
  assert.notEqual(manual, auto);
  assert.ok(manual.endsWith("\r"));
  assert.ok(auto.endsWith("\r"));
});

test("App remaps split slots; manual injects continue prompt, auto marks hint", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /remapSplitSlotsAfterRelay\(prev, targetSession\.id, newSession\.id\)/);
  assert.match(app, /apiSaveSessionHandoff\(targetSession\.cwd, "SESSION_HANDOFF\.md"/);
  assert.match(app, /apiWriteToSession\(newSession\.id, handoffContinuePrompt\(true\),\s*true\)/);
  assert.match(app, /markHandoffHint\(newSession\.id\)/);
  assert.match(fs.readFileSync("src/lib/tauriBridge.ts", "utf8"), /applyHandoffHint\(sessionId, data\)/);
});

test("regression: remap leaves unrelated slots untouched when id missing", () => {
  const slots = ["keep", null, "other", "keep"];
  assert.deepEqual(api.remapSplitSlotsAfterRelay(slots, "missing", "new"), slots);
  assert.deepEqual(api.remapSplitSlotsAfterRelay([], "a", "b"), []);
});

test("regression: empty / bare name still produces relay suffix 1", () => {
  const empty = api.nextRelaySessionName("");
  assert.equal(empty.relayCount, 1);
  assert.equal(empty.baseName, "");
  assert.equal(empty.newSessionName, " (릴레이 1)");
  const bare = api.nextRelaySessionName("Solo");
  assert.equal(bare.baseName, "Solo");
  assert.equal(bare.newSessionName, "Solo (릴레이 1)");
});

test("regression: successive remaps chain across multiple relays", () => {
  let slots = ["s1", "s2", null, "s1"];
  slots = api.remapSplitSlotsAfterRelay(slots, "s1", "s1r1");
  slots = api.remapSplitSlotsAfterRelay(slots, "s1r1", "s1r2");
  assert.deepEqual(slots, ["s1r2", "s2", null, "s1r2"]);
  const name = api.nextRelaySessionName(api.nextRelaySessionName("Worker").newSessionName);
  assert.equal(name.relayCount, 2);
  assert.equal(name.newSessionName, "Worker (릴레이 2)");
});

test("regression: relay rename + slot remap keeps focused pane after handoff", () => {
  const before = "🔧 Builder (릴레이 3)";
  const { newSessionName, relayCount, baseName } = api.nextRelaySessionName(before);
  assert.equal(baseName, "🔧 Builder");
  assert.equal(relayCount, 4);
  assert.equal(newSessionName, "🔧 Builder (릴레이 4)");
  const remapped = api.remapSplitSlotsAfterRelay(
    ["old-id", "peer", "old-id", null],
    "old-id",
    "relay-id"
  );
  assert.deepEqual(remapped, ["relay-id", "peer", "relay-id", null]);
  const prompt = api.handoffContinuePrompt(true);
  assert.match(prompt, /직전 세션이 받은 지시/);
  assert.doesNotMatch(prompt, /다음 지시를 기다리세요/);
});

test("regression: non-relay parenthetical names are not stripped as relay suffix", () => {
  const named = api.nextRelaySessionName("Reviewer (alpha)");
  assert.equal(named.baseName, "Reviewer (alpha)");
  assert.equal(named.relayCount, 1);
  assert.equal(named.newSessionName, "Reviewer (alpha) (릴레이 1)");
});

test("auto relay hint: prepended once to first submitted input only", () => {
  api.markHandoffHint("n1");
  assert.equal(api.applyHandoffHint("n1", "a"), "a");
  assert.equal(api.applyHandoffHint("n1", "/compact\r"), "/compact\r");
  assert.equal(api.applyHandoffHint("n1", "\r"), "\r");
  assert.equal(api.applyHandoffHint("other", "작업 하세요\r"), "작업 하세요\r");
  assert.equal(api.applyHandoffHint("n1", "작업 하세요\r"), api.HANDOFF_HINT + "작업 하세요\r");
  assert.equal(api.applyHandoffHint("n1", "다시\r"), "다시\r");
});

test("T7: launch passes collabProtocol to start_session and skips chat briefing only when roleInSystem", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(bridge, /collabProtocol: collabProtocol \?\? null/);
  assert.match(app, /undefined,\s*collabProtocol\(agent\.id, projectAgents\),\s*startFresh\s*\);/);
  assert.match(app, /agent\.rolePrompt\.trim\(\) && !session\.roleInSystem/);
  // 출근 시 브리핑 쓰기 0건: 역할은 첫 전달 앞에 붙는다
  assert.ok(!/apiWriteToSession\(session\.id, briefing/.test(app));
  assert.match(app, /markRolePrefix\(session\.id, /);
  assert.ok(!app.includes("pendingRolePrefixRef")); // 팀 전달 쪽 중복 부착 제거
});

test("T15: role prefix attaches once to the first submitted input, whichever path (user or team) comes first", () => {
  const role = "ROLE ";
  // 사용자 입력이 먼저
  api.markFirstInputPrefix("u1", role);
  assert.equal(api.applyHandoffHint("u1", "k"), "k"); // 키 입력은 통과
  assert.equal(api.applyHandoffHint("u1", "지시 내용\r"), role + "지시 내용\r");
  assert.equal(api.applyHandoffHint("u1", "[PM 배정] 팀 전달\r"), "[PM 배정] 팀 전달\r"); // 이후엔 안 붙음
  // 팀 전달이 먼저
  api.markFirstInputPrefix("t1", role);
  assert.equal(api.applyHandoffHint("t1", "[PM 배정] 팀 전달\r"), role + "[PM 배정] 팀 전달\r");
  assert.equal(api.applyHandoffHint("t1", "사용자 지시\r"), "사용자 지시\r");
  // 릴레이 안내와 역할이 함께 대기하면 한 번에
  api.markHandoffHint("b1");
  api.markFirstInputPrefix("b1", role);
  assert.equal(api.applyHandoffHint("b1", "작업\r"), api.HANDOFF_HINT + role + "작업\r");
  assert.equal(api.applyHandoffHint("b1", "다음\r"), "다음\r");
});

test("regression: restoreHandoffHint requeues consumed prefix and pending role after failed submit", () => {
  api.markHandoffHint("fail1");
  api.markRolePrefix("fail1", "ROLE ");
  const consumed = api.HANDOFF_HINT + "ROLE ";
  assert.equal(api.applyHandoffHint("fail1", "작업\r"), consumed + "작업\r");
  assert.equal(api.getRoleState("fail1"), "sent");
  api.restoreHandoffHint("fail1", consumed, true);
  assert.equal(api.getRoleState("fail1"), "pending");
  assert.equal(api.applyHandoffHint("fail1", "재시도\r"), consumed + "재시도\r");
  assert.equal(api.getRoleState("fail1"), "sent");
});

test("regression: bridge restores prefix on unconfirmed submit; roleBriefing strips duplicate role", () => {
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  const pane = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  assert.match(bridge, /restoreHandoffHint\(sessionId, prefix, roleWasPending\)/);
  assert.ok(bridge.includes('if (!confirmed && session?.cliId !== "antigravity") restore();')); // T34: agy는 본문이 입력창에 들어간 뒤라 접두를 되살리지 않음
  assert.match(bridge, /roleBriefing && roleWasPending/);
  assert.match(pane, /apiWriteToSession\(session\.id, briefing, true, undefined, true\)/);
});

test("T23: Codex launch encodes developer_instructions; Claude-only prompt-file; long roles fall back", () => {
  const pty = fs.readFileSync("src-tauri/src/pty.rs", "utf8");
  assert.match(pty, /fn codex_role_config\(role: &str\) -> Option<String>/);
  assert.match(pty, /developer_instructions=/);
  assert.match(pty, /value\.len\(\) > 16_000/);
  assert.match(pty, /cli_def\.id == "codex"/);
  assert.match(pty, /Some\(a\) if role_in_system && cli_def\.id == "claude"/);
  assert.match(pty, /codex_and_opencode_do_not_receive_role_at_launch/);
  assert.match(pty, /codex_role_config_escapes_shell_sensitive_text_and_limits_length/);
  assert.doesNotMatch(pty, /Some\(a\) if role_in_system => \{/);
});

test("T23: restart/relay race keeps prior session pending; new session sends ROLE+hint once", () => {
  api.markRolePrefix("old", "ROLE ");
  assert.equal(api.getRoleState("old"), "pending");
  // 릴레이 신규 세션: 역할 먼저, 이어서 핸드오프 안내
  api.markRolePrefix("relay", "ROLE ");
  api.markHandoffHint("relay");
  assert.equal(api.getRoleState("relay"), "pending");
  assert.equal(api.applyHandoffHint("relay", "작업\r"), "ROLE " + api.HANDOFF_HINT + "작업\r");
  assert.equal(api.getRoleState("relay"), "sent");
  assert.equal(api.applyHandoffHint("relay", "다음\r"), "다음\r");
  // 교체된 이전 세션 id의 pending은 맵에 남아도 슬롯 remap만 새 id를 가리킨다
  assert.equal(api.getRoleState("old"), "pending");
  assert.deepEqual(api.remapSplitSlotsAfterRelay(["old", "peer"], "old", "relay"), ["relay", "peer"]);
});

test("T23: duplicate markRolePrefix coalesces into one pending prefix before first submit", () => {
  api.markRolePrefix("dup", "ROLE-A ");
  api.markRolePrefix("dup", "ROLE-B ");
  assert.equal(api.getRoleState("dup"), "pending");
  assert.equal(api.applyHandoffHint("dup", "go\r"), "ROLE-A ROLE-B go\r");
  assert.equal(api.getRoleState("dup"), "sent");
  assert.equal(api.applyHandoffHint("dup", "again\r"), "again\r");
});

test("T26: Codex resume does not inject developer instructions", () => {
  const pty = fs.readFileSync("src-tauri/src/pty.rs", "utf8");
  const start = pty.indexOf("let codex_role = if saved");
  assert.notEqual(start, -1);
  const after = pty.slice(start, start + 900);
  const condEnd = after.search(/else\s*\{\s*None\s*\}/);
  assert.notEqual(condEnd, -1);
  const cond = after.slice(0, condEnd);
  assert.match(cond, /initial_command\.is_none\(\)/);
  assert.match(cond, /agent\.auto_brief/);
  assert.match(cond, /resume_session_id\.is_none\(\)/);
  assert.match(pty, /configure_codex_resume\(&mut cli_def, resume_session_id/);
});
