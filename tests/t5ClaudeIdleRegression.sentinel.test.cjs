/**
 * T1793776116339_5 — Sentinel 회귀·보안 재검증 (_4 Claude/Codex 유휴 안전망)
 * Critical/High → 릴리스 HOLD.
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
  ts.transpileModule(read("src/lib/deliveryGate.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: api },
);

const open = { startedAt: 100, completedAt: null };
const claudeIdleScreen = ["❯", "⏵⏵ bypass permissions on (shift+tab to cycle)"];
const codexIdleScreen = ["› Ask Codex to do anything", "gpt-5.1-codex high"];

test("T5: 긴 도구·생각 무출력은 유휴 오판 안 함(화면·시간·quiet 가드)", () => {
  // 응답 중(quietSince=null) — 30초+여도 false
  assert.equal(api.claudeIdleFallback("claude", open, claudeIdleScreen, null, 100_000), false);
  // 빈 ❯ 없이 도구/생각 잔여 화면
  assert.equal(api.claudeIdleFallback("claude", open, ["Running tool…", "bypass permissions on"], 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("claude", open, ["Thinking…", "accept edits on"], 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("claude", open, ["❯", "…thinking"], 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("claude", open, ["❯ draft still here", "bypass permissions on"], 200, 60_000), false);
  // 권한 확인 모달(유휴 footer 아님)
  assert.equal(api.claudeIdleFallback("claude", open, ["❯", "Allow this action?"], 200, 60_000), false);
  // 30초 미만
  assert.equal(api.claudeIdleFallback("claude", open, claudeIdleScreen, 200, 30_199), false);
  // 정상 유휴만 true
  assert.equal(api.claudeIdleFallback("claude", open, claudeIdleScreen, 200, 30_200), true);
  assert.equal(api.claudeIdleFallback("claude", open, ["❯", "accept edits on"], 200, 30_200), true);
});

test("T5: CLI 비누수 — Claude/Codex/agy 판정 교차 0", () => {
  assert.equal(api.claudeIdleFallback("codex", open, claudeIdleScreen, 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("antigravity", open, claudeIdleScreen, 200, 60_000), false);
  assert.equal(api.claudeIdleFallback("cursor", open, claudeIdleScreen, 200, 60_000), false);
  assert.equal(api.codexInterruptedIdle("claude", open, codexIdleScreen, 200, 20_000), false);
  assert.equal(api.codexInterruptedIdle("antigravity", open, codexIdleScreen, 200, 20_000), false);
  assert.equal(api.codexInterruptedIdle("codex", open, codexIdleScreen, null, 20_000), false); // 응답 중
  assert.equal(api.codexInterruptedIdle("codex", open, codexIdleScreen, 200, 10_200), true);
  // agy 첫 프롬프트 회귀
  assert.equal(api.agyFirstPromptReady(["›", "? for shortcuts"]), true);
  assert.equal(api.agyFirstPromptReady(["›", "? for shortcuts", "working"]), false);
});

test("T5: 미확인 전달은 완료로 안 침 + App 가드 소스", () => {
  assert.equal(api.deliveryGate({ at: 1, started: true, unconfirmed: true }, false, 9000, 20000), "stuck");
  assert.equal(api.deliveryGate({ at: 1, started: true, unconfirmed: true }, true, 9000, 20000), "proceed");
  const app = read("src/App.tsx");
  assert.match(app, /claudeIdleFallback/);
  assert.match(app, /codexInterruptedIdle/);
  // 미확인이면 idle fallback 스킵
  assert.match(
    app,
    /if\s*\(!pending\s*\|\|\s*\(!pending\.unconfirmed\s*&&\s*pending\.started\s*&&\s*ctx\.startedAt\s*>\s*pending\.at\)\)/,
  );
  // agy는 getTurnContext 안에서 Claude/Codex idle fallback보다 먼저 early-return
  const gt = app.slice(app.indexOf("const getTurnContext"), app.indexOf("const agyCompletedAttempt"));
  assert.match(gt, /if\s*\(session\.cliId\s*===\s*"antigravity"\)\s*return ctx;/);
  assert.ok(gt.indexOf('if (session.cliId === "antigravity") return ctx;') < gt.indexOf("claudeIdleFallback"));
});

test("T5: 응답 중 끼어들기 방지 — logTurnStillBusy 유지 + silent만 해제", () => {
  assert.equal(api.logTurnStillBusy("claude", open), true);
  assert.equal(api.logTurnStillBusy("codex", open), true);
  assert.equal(api.logTurnStillBusy("claude", { startedAt: 1, completedAt: 2 }), false);
  // quietSince < startedAt → 주입 전 화면 잔상으로 해제 불가
  assert.equal(api.claudeIdleFallback("claude", open, claudeIdleScreen, 50, 60_000), false);
  assert.equal(api.codexInterruptedIdle("codex", open, codexIdleScreen, 50, 20_000), false);
});
