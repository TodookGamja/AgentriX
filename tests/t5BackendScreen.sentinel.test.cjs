/**
 * T1793840805267_5 — Forge _3 · Pixel _4 백엔드 가상 화면 전달 판정 회귀
 * 기준: 안 연 탭·창/글꼴 변경 후에도 CLI 자동 전달, 끼어들기·중복 0,
 * 판정 xterm buffer 의존 0, 긴 본문 무한 재전송 0, 500ms 폴링 부하,
 * _2 High(숨김 재마운트 크기 불일치) 판정 경로 해소.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = (rel) => {
  const api = {};
  vm.runInNewContext(
    ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: api },
  );
  return api;
};

const app = read("src/App.tsx");
const pane = read("src/components/TerminalPane.tsx");
const bridge = read("src/lib/tauriBridge.ts");
const pty = read("src-tauri/src/pty.rs");
const main = read("src-tauri/src/main.rs");
const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
const screenApi = load("src/lib/cursorScreen.ts");
const queueApi = load("src/lib/sessionQueue.ts");
const gateApi = load("src/lib/deliveryGate.ts");

test("T5/① 판정 소스 = get_session_screen 미러, xterm 등록 0 · buffer.active는 URL만", () => {
  assert.doesNotMatch(pane, /registerTerminalScreen|registerTerminalTranscript/);
  assert.match(bridge, /invoke<\w+>\(\s*"get_session_screen"/);
  assert.match(bridge, /apiGetSessionScreen\(sessionId, 30\)/);
  assert.match(app, /await refreshTerminalScreen\(session\.id\)/);
  assert.match(app, /ids\.forEach\(\(sid\) => void refreshTerminalScreen\(sid\)\)/);
  // buffer.active: URL 줄바꿈 인식만 (판정 경로 아님)
  const bufHits = [...pane.matchAll(/buffer\.active/g)];
  assert.equal(bufHits.length, 1);
  const around = pane.slice(Math.max(0, bufHits[0].index - 120), bufHits[0].index + 80);
  assert.match(around, /isWrapped|URL|link/i);
  // Claude/Codex/agy/Cursor 판정은 readTerminalScreen|Transcript
  assert.match(app, /claudeIdleFallback\([\s\S]{0,80}screen\?\.lines/);
  assert.match(app, /codexInterruptedIdle\([\s\S]{0,80}screen\?\.lines/);
  assert.match(app, /agyFirstPromptReady\(readTerminalTranscript/);
  assert.match(app, /readCursorTurn\(session\.id\)/);
});

test("T5/② IPC 삼중 등록 + vt100 화면(숨김·resize 동일)", () => {
  assert.match(main, /fn get_session_screen/);
  assert.match(main, /get_session_screen,/);
  assert.ok(caps.permissions.includes("allow-get-session-screen"));
  assert.match(pty, /vt100::Parser/);
  assert.match(pty, /fn screen_tracks_stream_and_resize_without_a_mounted_terminal|screen_snapshot/);
  assert.match(pty, /buffer\.screen\.set_size/);
});

test("T5/③ 미러만으로 화면 판독(탭 미오픈 시뮬) · 등록 reader 우선", () => {
  assert.equal(screenApi.readTerminalScreen("hidden-cli"), null);
  const rows = Array.from({ length: 40 }, (_, i) => (i === 39 ? "> " : `row${i}`));
  screenApi.setTerminalScreen("hidden-cli", rows);
  assert.deepEqual(screenApi.readTerminalScreen("hidden-cli"), rows.slice(-10));
  assert.deepEqual(screenApi.readTerminalTranscript("hidden-cli"), rows);
  screenApi.forgetTerminalScreen("hidden-cli");
});

test("T5/④ 끼어들기 0 · 유휴 proceed (전 CLI 게이트)", () => {
  assert.equal(gateApi.deliveryGate({ at: 1 }, false, null, 20_000), "wait");
  assert.equal(gateApi.deliveryGate({ at: 1, started: true, unconfirmed: true }, false, 9_000, 20_000), "stuck");
  assert.equal(gateApi.deliveryGate({ at: 1, started: true }, true, 9_000, 20_000), "proceed");
});

test("T5/⑤ 긴 본문: 화면 밖 머리말만으로는 확정 0 · 비agy는 startedAt으로 unconfirmed 해제(재전송 루프 0)", () => {
  const long = "긴메일본문 ".repeat(80) + "끝마커ABCDEFGHIJKLMNOP";
  const item = {
    id: "mail:M_LONG",
    source: "mail",
    stuck: true,
    payload: `메일 ID: M_LONG. 제목: t 내용: ${long}`,
  };
  // 화면 높이(30줄)보다 긴 본문 → 머리말 스크롤아웃, 끝만 보임 → deliveredByScreen 확정 실패
  const visibleTail = Array.from({ length: 30 }, (_, i) =>
    i < 28 ? long.slice(i * 10, i * 10 + 10) : i === 28 ? "끝마커ABCDEFGHIJKLMNOP" : "> ",
  );
  assert.equal(JSON.stringify(queueApi.deliveredByScreen([item], visibleTail)), "[]");
  // App: 비-agy unconfirmed는 ctx.startedAt > submittedAt 이면 해제 (agy만 화면 확정 필수)
  assert.equal(
    (app.match(/unconfirmed && session\.cliId === "antigravity" && !agyConfirmed/g) ?? []).length,
    2,
  );
  assert.match(
    app,
    /pending\?\.unconfirmed && \(agyConfirmed \|\| \(session\.cliId !== "antigravity" && ctx && "startedAt" in ctx/,
  );
  assert.match(app, /s\.cliId === "antigravity" \? \[\] : deliveredByScreen/);
});

test("T5/⑥ 500ms 폴링: 세션당 인터벌 아님 · 단일 setInterval + forEach fire-and-forget", () => {
  const blocks = [...app.matchAll(/setInterval\(\(\)\s*=>\s*\{[\s\S]*?refreshTerminalScreen[\s\S]*?\},\s*500\)/g)];
  assert.equal(blocks.length, 1, "500ms 화면 폴링 인터벌은 1개");
  assert.match(blocks[0][0], /ids\.forEach\(\(sid\) => void refreshTerminalScreen\(sid\)\)/);
  assert.doesNotMatch(app, /setInterval\([^\)]*refreshTerminalScreen[^\)]*\)[^\n]{0,40}sessions\.map/);
});

test("T5/⑦ High 해소: 판정이 xterm cols/rows·lastPtySize·fontSize에 의존하지 않음", () => {
  // 숨김 재마운트 시 xterm은 110x30 고정일 수 있으나 판정은 백엔드 화면
  assert.match(pane, /cols:\s*110/);
  assert.doesNotMatch(
    app,
    /readTerminalScreen\([^\)]*\)[\s\S]{0,40}term\.(cols|rows)|fitAddon|fontSize/,
  );
  const restoresFromLast =
    /lastPtySize\.get\([^)]+\)[\s\S]{0,200}(?:\.resize\(|cols:\s*|rows:\s*)/.test(pane) &&
    (/lastPtySize\.get\(session\.id\)/.test(pane) || /lastPtySize\.get\([^)]*session/.test(pane));
  assert.equal(restoresFromLast, false);
  // 글꼴 크기 변경은 TerminalPane 옵션일 뿐 판정 입력 아님
  assert.doesNotMatch(
    bridge + "\n" + read("src/lib/cursorScreen.ts"),
    /fontSize/,
  );
});
