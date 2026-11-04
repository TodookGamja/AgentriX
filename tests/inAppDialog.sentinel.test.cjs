/**
 * T1793776116339_3 — Sentinel 회귀: 앱 내 확인 모달 (_1)
 * Critical/High → 릴리스 HOLD.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("T1793776116339_3: src window.confirm/alert/prompt 잔존 0 + ConfirmHost 마운트", () => {
  const hits = walk(path.join(ROOT, "src"))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /\bwindow\.(confirm|alert|prompt)\s*\(/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
  assert.match(read("src/main.tsx"), /<ConfirmHost\s*\/>/);
});

test("T1793776116339_3: 4곳 confirmDialog + 취소 시 early return(동작 0)", () => {
  const board = read("src/components/TaskApprovalBoard.tsx");
  const app = read("src/App.tsx");
  const term = read("src/components/TerminalPane.tsx");
  const after = (src, startRe, mustHave) => {
    const m = src.match(startRe);
    assert.ok(m, `missing ${startRe}`);
    const body = src.slice(m.index);
    assert.ok(body.indexOf("confirmDialog") >= 0 && body.indexOf(mustHave) > body.indexOf("confirmDialog"), `${mustHave} must follow confirmDialog`);
  };
  // 작업 취소
  assert.match(board, /confirmDialog\(\{[\s\S]*?danger:\s*true[\s\S]*?\}\)/);
  assert.match(board, /if\s*\(!\(await confirmDialog\([\s\S]*?\)\)\)\s*return;/);
  assert.match(board, /alertDialog\(/);
  after(board, /const cancel = async/, "apiCancelProjectBlackboardTask");
  // 앱 초기화
  assert.match(app, /confirmDialog\(\{[\s\S]*?danger:\s*true[\s\S]*?\}\)/);
  assert.match(app, /!\(await confirmDialog\([\s\S]*?\)\)\s*\)\s*\{\s*return;/);
  after(app, /const handleResetAllAppData = async/, "apiResetAppData");
  // 입력창 글 확인 후 전송
  assert.match(term, /confirmDialog\(\{[\s\S]*?지금 보내기[\s\S]*?\}\)/);
  assert.match(term, /!\(await confirmDialog\([\s\S]*?\)\)\)\s*return;/);
  after(term, /const sendQueuedNow = async/, "apiWriteToSession");
});

test("T1793776116339_3: confirmDialog 미마운트=false, 구독 resolve 값 반영", async () => {
  const api = {};
  vm.runInNewContext(
    ts.transpileModule(read("src/lib/confirmDialog.ts"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports: api, Promise },
  );
  assert.equal(await api.confirmDialog({ title: "x" }), false);
  const off = api.confirmDialogSubscribe((r) => r.resolve(false)); // 취소
  assert.equal(await api.confirmDialog({ title: "x" }), false);
  off();
  const off2 = api.confirmDialogSubscribe((r) => r.resolve(true)); // 확인
  assert.equal(await api.confirmDialog({ title: "x" }), true);
  off2();
});

test("T1793776116339_3: Esc stopPropagation·capture 리스너(터미널/단축키 부분 차단)", () => {
  const host = read("src/components/ConfirmHost.tsx");
  assert.match(host, /e\.key === "Escape"/);
  assert.match(host, /stopPropagation/);
  assert.match(host, /addEventListener\("keydown", onKey, true\)/);
  assert.match(host, /e\.key === "Tab"/);
  // Medium 잔존: Alt/F11·일반 키는 ConfirmHost가 막지 않음 (App capture 단축키 누수 가능)
  assert.equal(/altKey|F11/.test(host), false);
});
