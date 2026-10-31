const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const js = ts.transpileModule(fs.readFileSync("src/lib/deliveryGate.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("no previous delivery or turn-start evidence proceeds", () => {
  assert.equal(api.deliveryGate(undefined, false, 0, 0), "proceed");
  assert.equal(api.deliveryGate({ at: 1 }, true, 0, 0), "proceed");
});

test("log-less CLI (a): submitted normally then idle -> proceeds (output after the echo window seen)", () => {
  const p = { at: 1000 };
  assert.equal(api.deliveryGate(p, false, 1000 + api.ECHO_WINDOW_MS + 1, 1000 + 60000), "proceed");
  const busyThenIdle = { at: 1000 }; // 작업 중 관측 → 대기, 멈춘 뒤 진행
  assert.equal(api.deliveryGate(busyThenIdle, false, null, 1000 + 5000), "wait");
  assert.equal(api.deliveryGate(busyThenIdle, false, 1000 + 4000, 1000 + 30000), "proceed");
});

test("log-less CLI (b): unsubmitted -> Enter resent once -> stuck, next body never proceeds", () => {
  const p = { at: 1000 };
  const echoOnly = 1000 + 200; // 붙여넣기 에코만 있고 이후 출력 없음
  assert.equal(api.deliveryGate(p, false, echoOnly, 1000 + 20000), "resend");
  p.retriedAt = 1000 + 20000;
  assert.equal(api.deliveryGate(p, false, p.retriedAt + 100, p.retriedAt + api.STUCK_AFTER_MS), "wait"); // Enter 에코는 시작이 아님
  assert.equal(api.deliveryGate(p, false, p.retriedAt + 100, p.retriedAt + 1 + api.STUCK_AFTER_MS), "stuck");
});

test("busy right after delivery waits without resend or stuck", () => {
  const p = { at: 1000 };
  assert.equal(api.deliveryGate(p, false, null, 1000 + 500), "wait");
  assert.equal(p.started, undefined); // 에코 구간 출력은 시작으로 세지 않음
});

test("App gates sendToIdleTeamSession with deliveryGate and never writes the next prompt before proceed", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const g = app.indexOf("deliveryGate(pending");
  const w = app.indexOf("apiWriteToSession(session.id, prompt, true)");
  assert.ok(g > 0 && w > g);
});
