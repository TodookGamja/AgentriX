const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/handoffRelay.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

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
  assert.match(app, /undefined,\s*collabProtocol\(agent\.id, projectAgents\)\s*\);/);
  assert.match(app, /agent\.rolePrompt\.trim\(\) && !session\.roleInSystem/);
  // 출근 시 브리핑 쓰기 0건: 역할은 첫 전달 앞에 붙는다
  assert.ok(!/apiWriteToSession\(session\.id, briefing/.test(app));
  assert.match(app, /markFirstInputPrefix\(session\.id, /);
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
