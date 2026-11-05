// T1793840805267_4: 전달·준비 판정 화면은 xterm이 아니라 백엔드 가상 화면에서 읽는다(숨김·크기 변경 무관).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const load = (p) => { const api = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(p, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api }); return api; };

test("mirrored backend screen feeds readers with no xterm registered; registered reader still wins", () => {
  const s = load("src/lib/cursorScreen.ts");
  assert.equal(s.readTerminalScreen("a"), null);
  const rows = Array.from({ length: 30 }, (_, i) => `l${i}`);
  s.setTerminalScreen("a", rows);
  assert.deepEqual(s.readTerminalScreen("a"), rows.slice(-10));
  assert.deepEqual(s.readTerminalTranscript("a"), rows);
  s.forgetTerminalScreen("a");
  assert.equal(s.readTerminalScreen("a"), null);
});

test("TerminalPane no longer registers xterm as judgement source; App polls backend screen and refreshes before turn judgement", () => {
  const pane = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  assert.doesNotMatch(pane, /registerTerminalScreen|registerTerminalTranscript/);
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /getTurnContext = async [^\n]*\n\s*await refreshTerminalScreen\(session\.id\)/);
  assert.match(app, /ids\.forEach\(\(sid\) => void refreshTerminalScreen\(sid\)\)/);
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(bridge, /apiGetSessionScreen\(sessionId, 30\)/);
});
