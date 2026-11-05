/**
 * T1793840805267_2 — _1 안 본 탭 지시 전달 회귀
 * - 숨김 마운트 xterm 시작 크기 = PTY spawn(110x30)
 * - clientWidth===0 이면 fit/PTY 축소 스킵(구 80x24 경로 차단)
 * - 창/탭 전환 후 숨김 재마운트 시 lastPtySize 복원 여부(크기 불일치 재발)
 * - 백그라운드 상시 마운트·전달 게이트(끼어들기 0) 유지
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const pane = read("src/components/TerminalPane.tsx");
const app = read("src/App.tsx");
const pty = read("src-tauri/src/pty.rs");
const replayApi = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/terminalReplay.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: replayApi },
);
const gateApi = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/deliveryGate.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: gateApi },
);

const ptySize = pty.match(/let size = PtySize \{\s*rows: (\d+),\s*cols: (\d+)/);
assert.ok(ptySize, "pty.rs spawn PtySize");
const ptyRows = ptySize[1];
const ptyCols = ptySize[2];
const termOpts = pane.slice(pane.indexOf("new Terminal({"), pane.indexOf("cursorBlink"));

test("T2/①: 숨김 xterm 시작 cols/rows = PTY spawn (Pixel _1)", () => {
  assert.equal(ptyCols, "110");
  assert.equal(ptyRows, "30");
  assert.match(termOpts, new RegExp(`cols:\\s*${ptyCols}\\s*,`));
  assert.match(termOpts, new RegExp(`rows:\\s*${ptyRows}\\s*,`));
  assert.match(
    pane,
    /숨김 탭은 fit이 안 돼 PTY 시작 크기|PTY 시작 크기\(pty\.rs 110x30\)/,
  );
});

test("T2/②: clientWidth===0 이면 초기·Observer fit 및 PTY 리사이즈 스킵", () => {
  assert.match(
    pane,
    /if\s*\(!containerRef\.current\s*\|\|\s*containerRef\.current\.clientWidth\s*===\s*0\)\s*return;/,
  );
  assert.match(
    pane,
    /if\s*\(!containerRef\.current\s*\|\|\s*containerRef\.current\.clientWidth\s*===\s*0\)\s*\{\s*return;/,
  );
  assert.match(pane, /if\s*\(container\.clientWidth\s*>\s*0\)\s*\{[\s\S]*?fitAddon\.fit\(\)/);
  assert.equal(replayApi.shouldResizePty({ cols: 110, rows: 30 }, { cols: 3, rows: 30 }), false);
  assert.equal(replayApi.shouldResizePty({ cols: 110, rows: 30 }, { cols: 110, rows: 2 }), false);
});

test("T2/③: [잔여 High→_5] 숨김 재마운트는 lastPtySize로 xterm을 복원하지 않음(불일치 재발 경로)", () => {
  assert.match(pane, /const lastPtySize = new Map/);
  // 탭을 한 번 연 뒤(PTY=창 크기) hidden으로 재마운트되면 clientWidth===0이라 fit 스킵,
  // 새 Terminal은 항상 110x30 → PTY와 어긋남. _1은 never-open만 해소. 근본 해소는 _3·_4(백엔드 화면)→_5.
  const restoresFromLast =
    /lastPtySize\.get\([^)]+\)[\s\S]{0,200}(?:\.resize\(|cols:\s*|rows:\s*)/.test(pane) &&
    (/lastPtySize\.get\(session\.id\)/.test(pane) || /lastPtySize\.get\([^)]*session/.test(pane));
  assert.equal(
    restoresFromLast,
    false,
    "복원 코드가 생기면 이 단언을 뒤집고 _5에서 재발 0을 확인",
  );
  assert.match(
    pane,
    /if\s*\(isVisible\s*&&\s*fitAddonRef\.current\s*&&\s*termRef\.current\)/,
  );
});

test("T2/④: App은 안 보이는 세션을 hidden 상시 마운트 (전달·버퍼 유지)", () => {
  assert.match(app, /className="hidden"\s+aria-hidden="true"/);
  assert.match(app, /PTY 연결 및 버퍼 유지를 위해 hidden 상시 마운트|그라운드 세션들/);
  assert.match(app, /isVisible=\{false\}/);
  assert.match(app, /<TerminalPane/);
});

test("T2/⑤: 응답 중 끼어들기 0 · 유휴 시에만 proceed (중복·끼어들기 게이트)", () => {
  assert.equal(gateApi.deliveryGate({ at: 1 }, false, null, 20_000), "wait");
  assert.equal(gateApi.deliveryGate({ at: 1, started: true, unconfirmed: true }, false, 9_000, 20_000), "stuck");
  assert.equal(gateApi.deliveryGate({ at: 1, started: true }, true, 9_000, 20_000), "proceed");
});
