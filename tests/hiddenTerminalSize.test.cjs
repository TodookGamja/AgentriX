// 안 본 탭의 xterm은 fit이 안 되므로 PTY 시작 크기와 같아야 화면 기반 판정이 어긋나지 않는다.
const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
test("hidden xterm starts at PTY spawn size", () => {
  const pty = fs.readFileSync("src-tauri/src/pty.rs", "utf8");
  const pane = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  const [, rows, cols] = pty.match(/let size = PtySize \{\s*rows: (\d+),\s*cols: (\d+)/);
  const opts = pane.slice(pane.indexOf("new Terminal({"));
  assert.ok(opts.includes(`cols: ${cols},`) && opts.includes(`rows: ${rows},`));
  assert.ok(opts.indexOf(`cols: ${cols},`) < opts.indexOf("cursorBlink"));
});
