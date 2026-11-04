/**
 * T1793776116339_15 — _14 Claude 중단 턴 회귀 검증
 * ① 로그 interrupt → 턴 완료 ② Interrupted 화면 idle fallback ③ Esc 자동주입 0
 * ④ 유휴 후 대기열 게이트 해제 · 응답중 끼어들기 0 · 타 CLI 비누수
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const api = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/deliveryGate.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: api },
);

const app = read("src/App.tsx");
const ctx = read("src-tauri/src/context.rs");
const pane = read("src/components/TerminalPane.tsx");
const interruptedScreen = ["Interrupted · What should Claude do instead?", "❯", "? for shortcuts"];
const open = { startedAt: 100, completedAt: null };

test("T15/①: context.rs는 Request interrupted·tool interrupted를 턴 완료로 처리하고 이후 user 입력은 미완료", () => {
  assert.match(ctx, /\[Request interrupted by user\]/);
  assert.match(ctx, /tool_result[\s\S]*interrupted/);
  assert.match(ctx, /fn claude_interrupted_turn_completes_but_a_later_user_input_does_not/);
  assert.match(ctx, /claude_completion\(interrupted\).*parse_ts\("2026-11-04T07:48:52/);
  assert.match(ctx, /after_new_input[\s\S]*assert_eq!\(claude_completion\(&after_new_input\), None\)/);
});

test("T15/②: Interrupted·빈 ❯·? for shortcuts 화면은 30초 quiet 후 fallback true, 입력·도구 중 false", () => {
  assert.equal(api.claudeIdleFallback("claude", open, interruptedScreen, 200, 30_199), false);
  assert.equal(api.claudeIdleFallback("claude", open, interruptedScreen, 200, 30_200), true);
  assert.equal(api.claudeIdleFallback("claude", open, ["Interrupted · What should Claude do instead?", "❯ draft", "? for shortcuts"], 200, 30_200), false);
  assert.equal(api.claudeIdleFallback("claude", open, interruptedScreen, null, 90_000), false);
  assert.equal(api.claudeIdleFallback("claude", { startedAt: 100, completedAt: 150 }, interruptedScreen, 200, 30_200), false);
  assert.match(app, /claudeIdleFallback\(session\.cliId, ctx, readTerminalScreen/);
  assert.match(read("src/lib/deliveryGate.ts"), /\?\\s\+for shortcuts/);
});

test("T15/③: App 전달·재전송 경로에 Esc(\\x1b) 자동 쓰기 0 — Esc는 TerminalPane 사용자 키/버튼만", () => {
  assert.ok(!/apiWriteToSession\([^)]*\\x1b/.test(app));
  assert.ok(!app.includes('apiWriteToSession(session.id, "\\x1b")'));
  assert.ok(!app.includes("apiWriteToSession(session.id, '\\x1b')"));
  // 재전송은 Enter(\\r)만
  assert.match(app, /apiWriteToSession\(session\.id, "\\r", true\)/);
  assert.match(pane, /apiWriteToSession\(session\.id, "\\x1b"\)/);
  assert.match(pane, /e\.key === "Escape"[\s\S]{0,80}sendTermKey\("\\x1b"\)/);
});

test("T15/④: 중단 완료 후 busy 해제·대기열 proceed / 응답중·미확인은 끼어들기 0", () => {
  assert.equal(api.logTurnStillBusy("claude", { startedAt: 100, completedAt: null }), true);
  assert.equal(api.logTurnStillBusy("claude", { startedAt: 100, completedAt: 200 }), false);
  // 유휴 증거 있으면 다음 본문 진행
  assert.equal(api.deliveryGate({ at: 1, started: true }, true, 9_000, 20_000), "proceed");
  // 응답 중(quiet=null)은 wait — 끼어들기 0
  assert.equal(api.deliveryGate({ at: 1 }, false, null, 20_000), "wait");
  // 미확인은 stuck
  assert.equal(api.deliveryGate({ at: 1, started: true, unconfirmed: true }, false, 9_000, 20_000), "stuck");
  // idle fallback은 미확인 pending이면 App이 스킵
  assert.match(app, /!pending\.unconfirmed\s*&&\s*pending\.started\s*&&\s*ctx\.startedAt\s*>\s*pending\.at/);
});

test("T15: Codex/agy/Cursor에 claudeIdleFallback 비누수 + App agy 조기 return 유지", () => {
  assert.equal(api.claudeIdleFallback("codex", open, interruptedScreen, 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("antigravity", open, interruptedScreen, 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("cursor", open, interruptedScreen, 200, 60_000), false);
  const gt = app.slice(app.indexOf("getTurnContext"), app.indexOf("getTurnContext") + 3500);
  assert.ok(gt.indexOf('if (session.cliId === "antigravity") return ctx;') < gt.indexOf("claudeIdleFallback"));
});
