const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function setup() {
  const session = { id: "resumed", agentId: "agent-1", cliId: "codex", cwd: "project", startedAt: "2026-11-02T00:00:00Z", rolePrompt: "역할 지침", roleInSystem: false };
  const writes = [];
  let enters = 0;
  let inputVersion = 0;
  const invoke = async (name, args) => {
    if (name === "get_project_agents") return [{ id: session.agentId, name: "Forge", roleTitle: "Engineer", rolePrompt: session.rolePrompt, autoBrief: true }];
    if (name === "get_session_context") return { source: "log", startedAt: enters >= 2 ? 200 : 100 };
    if (name === "get_session_paste_mode") return true;
    if (name === "get_session_quiet_since") return Date.now();
    if (name === "read_session_output") return { data: "prompt redraw", nextCursor: 0 };
    if (name === "write_to_session") { writes.push(args.data); if (args.data === "\r") enters++; return; }
    throw new Error(`unexpected invoke: ${name}`);
  };
  const modules = {
    "@tauri-apps/api/core": { invoke },
    "@tauri-apps/api/event": {},
    "./inputHistory": { getUserInputVersion: () => inputVersion, recordSessionInput: (_id, _data, injected) => { if (!injected) inputVersion++; } },
    "./store": { useAppStore: { getState: () => ({ sessions: [session] }) } },
  };
  const load = (path, name) => {
    const js = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    vm.runInNewContext(js, { exports, require: (id) => modules[id] ?? {}, window: { __TAURI_INTERNALS__: {} }, console: { info() {} }, setTimeout: (fn) => { fn(); return 0; }, Promise, Date, Map, Set });
    modules[name] = exports;
    return exports;
  };
  load("src/lib/handoffRelay.ts", "./handoffRelay");
  load("src/lib/blackboardDispatch.ts", "./blackboardDispatch");
  load("src/lib/sessionWriteQueue.ts", "./sessionWriteQueue");
  modules["./sessionWriteQueue"].enterReady = () => true;
  const bridge = load("src/lib/tauriBridge.ts", "./tauriBridge");
  return { bridge, writes, session, role: modules["./handoffRelay"] };
}

test("automatic role submission skips when another delivery already consumed the role", async () => {
  const { bridge, writes, session, role } = setup();
  role.markRolePrefix(session.id, "역할 지침 ");
  role.applyHandoffHint(session.id, "기존 배정\r");
  let skipped = false;
  await bridge.apiWriteToSession(session.id, "다음 지시를 기다리세요.\r", true, {
    hasStarted: async () => false,
    onResult: () => assert.fail("skipped submission must not report a delivery"),
    onlyPendingRole: true,
    onSkip: () => { skipped = true; },
  });
  assert.equal(skipped, true);
  assert.equal(writes.length, 0);
});

test("automatic role submission sends the pending role once", async () => {
  const { bridge, writes, session, role } = setup();
  role.markRolePrefix(session.id, "역할 지침 ");
  let confirmed = false;
  await bridge.apiWriteToSession(session.id, "다음 지시를 기다리세요.\r", true, {
    hasStarted: async () => true,
    onResult: (result) => { confirmed = result; },
    onlyPendingRole: true,
  });
  assert.equal(confirmed, true);
  assert.equal(writes[0].split("역할 지침").length - 1, 1);
  assert.equal(role.getRoleState(session.id), "sent");
});

test("manual role briefing retries an unsubmitted Enter without duplicating the role", async () => {
  const { bridge, writes, session } = setup();
  await bridge.apiWriteToSession(session.id, "역할 지침을 따라주세요.\r", true, undefined, true);
  assert.equal(writes.filter((value) => value === "\r").length, 2);
  assert.equal(writes[0].split("역할 지침").length - 1, 1);
});

test("first mail on a resumed session includes the agent role", async () => {
  const { bridge, writes, session } = setup();
  await bridge.apiWriteToSession(session.id, "[팀 메시지] 작업 안내\r", true);
  assert.match(writes[0], /역할 지침/);
  assert.match(writes[0], /\[팀 메시지\]/);
  assert.equal(writes.filter((value) => value === "\r").length, 2);
});

test("a long pasted team message retries Enter when only the paste redraw appears", async () => {
  const { bridge, writes, session } = setup();
  const body = "긴 전달문 ".repeat(200);
  await bridge.apiWriteToSession(session.id, `${body}\r`, true);
  assert.ok(writes[0].startsWith("\x1b[200~"));
  assert.ok(writes[0].endsWith("\x1b[201~"));
  assert.ok(writes[0].includes(body));
  assert.equal(writes.filter((value) => value === "\r").length, 2);
});

test("a user chat submission does not cancel itself", async () => {
  const { bridge, writes, session } = setup();
  await bridge.apiWriteToSession(session.id, "새 지시\r");
  assert.match(writes[0], /역할 지침/);
  assert.equal(writes.filter((value) => value === "\r").length, 2);
});

test("failed write restores role prefix for the next mail", async () => {
  const session = { id: "fail-restore", agentId: "agent-1", cliId: "codex", cwd: "project", startedAt: "2026-11-02T00:00:00Z", rolePrompt: "역할 지침", roleInSystem: false };
  const writes = [];
  let inputVersion = 0;
  let enters = 0;
  let failOnce = true;
  const invoke = async (name, args) => {
    if (name === "get_project_agents") return [{ id: session.agentId, name: "Forge", roleTitle: "Engineer", rolePrompt: session.rolePrompt, autoBrief: true }];
    if (name === "get_session_context") return { source: "log", startedAt: enters >= 1 ? 200 : 100 };
    if (name === "get_session_paste_mode") return true;
    if (name === "get_session_quiet_since") return Date.now();
    if (name === "read_session_output") return { data: "prompt redraw", nextCursor: 0 };
    if (name === "write_to_session") {
      if (failOnce && args.data !== "\r") { failOnce = false; throw new Error("pty write failed"); }
      writes.push(args.data);
      if (args.data === "\r") enters++;
      return;
    }
    throw new Error(`unexpected invoke: ${name}`);
  };
  const modules = {
    "@tauri-apps/api/core": { invoke },
    "@tauri-apps/api/event": {},
    "./inputHistory": { getUserInputVersion: () => inputVersion, recordSessionInput: (_id, _data, injected) => { if (!injected) inputVersion++; } },
    "./store": { useAppStore: { getState: () => ({ sessions: [session] }) } },
  };
  const load = (path, name) => {
    const js = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    vm.runInNewContext(js, { exports, require: (id) => modules[id] ?? {}, window: { __TAURI_INTERNALS__: {} }, console: { info() {} }, setTimeout: (fn) => { fn(); return 0; }, Promise, Date, Map, Set });
    modules[name] = exports;
    return exports;
  };
  load("src/lib/handoffRelay.ts", "./handoffRelay");
  load("src/lib/blackboardDispatch.ts", "./blackboardDispatch");
  load("src/lib/sessionWriteQueue.ts", "./sessionWriteQueue");
  modules["./sessionWriteQueue"].enterReady = () => true;
  const bridge = load("src/lib/tauriBridge.ts", "./tauriBridge");

  await assert.rejects(() => bridge.apiWriteToSession(session.id, "[팀 메시지] 실패 케이스\r", true), /pty write failed/);
  writes.length = 0;
  await bridge.apiWriteToSession(session.id, "[팀 메시지] 재시도\r", true);
  assert.match(writes[0], /역할 지침/);
  assert.match(writes[0], /\[팀 메시지\] 재시도/);
});

test("T23: roleInSystem sessions do not rematerialize a role prefix on submit", async () => {
  const { bridge, writes, session, role } = setup();
  session.roleInSystem = true;
  await bridge.apiWriteToSession(session.id, "[팀 메시지] 시스템 역할\r", true);
  assert.equal(role.getRoleState(session.id), undefined);
  assert.equal(writes[0].includes("역할 지침"), false);
  assert.match(writes[0], /\[팀 메시지\] 시스템 역할/);
});

test("T23: relay-style handoff hint + pending role race collapses to one prefixed submit", async () => {
  const { bridge, writes, session, role } = setup();
  role.markRolePrefix(session.id, "역할 지침 ");
  role.markHandoffHint(session.id);
  // App 자동 틱 문구와 동일(본문에 '역할 지침' 포함) — prefix 역할은 맨 앞에 1회만
  const tickPrompt = "역할 지침을 확인하고 다음 지시를 기다리세요.\r";
  await bridge.apiWriteToSession(session.id, tickPrompt, true, {
    hasStarted: async () => true,
    onResult: () => {},
    onlyPendingRole: true,
  });
  assert.equal(role.getRoleState(session.id), "sent");
  assert.match(writes[0], /^역할 지침 \[릴레이\]/);
  assert.equal(writes[0].startsWith("역할 지침 역할 지침"), false);
  // write 경로는 본문과 Enter(\r)를 분리하므로 본문에는 CR이 없다
  assert.equal(writes[0].endsWith(tickPrompt.replace(/\r$/, "")), true);
  assert.equal(writes.filter((value) => value === "\r").length >= 1, true);
  let skipped = false;
  writes.length = 0;
  await bridge.apiWriteToSession(session.id, tickPrompt, true, {
    hasStarted: async () => true,
    onResult: () => assert.fail("second onlyPendingRole must skip"),
    onlyPendingRole: true,
    onSkip: () => { skipped = true; },
  });
  assert.equal(skipped, true);
  assert.equal(writes.length, 0);
});

test("T23: App auto-brief tick and relay guards wire onlyPendingRole + roleInSystem", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /getRoleState\(session\.id\) !== "pending"/);
  assert.match(app, /sendToIdleTeamSessionRaw\(session, "역할 지침을 확인하고 다음 지시를 기다리세요\.\\r", true\)/);
  assert.match(app, /onlyPendingRole/);
  assert.match(app, /!session\.roleInSystem/);
  assert.match(app, /!newSession\.roleInSystem/);
  assert.match(app, /workRestarted\(\)/);
});
