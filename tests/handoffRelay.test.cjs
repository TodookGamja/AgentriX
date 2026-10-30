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

test("App remaps split slots and writes continue prompt after relay", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /remapSplitSlotsAfterRelay\(prev, targetSession\.id, newSession\.id\)/);
  assert.match(app, /apiWriteToSession\(newSession\.id, handoffContinuePrompt\(isManual\)\)/);
  assert.match(app, /apiSaveSessionHandoff\(targetSession\.cwd, "SESSION_HANDOFF\.md"/);
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
