const test = require("node:test");
const assert = require("node:assert/strict");
const src = require("node:fs").readFileSync("src/components/TerminalPane.tsx", "utf8");
test("세션 전환으로 새 xterm을 만들 때 출력 읽기 커서를 0으로 되돌려 버퍼를 처음부터 재생", () => {
  assert.match(src, /cursorRef\.current = 0;\s*\r?\n\s*let active = true;/);
});
test("보이게 된 뒤·크기 변경 뒤 xterm 전체 행을 다시 그린다(빈 화면 방지)", () => {
  assert.match(src, /termRef\.current\.refresh\(0, termRef\.current\.rows - 1\)/);
  assert.match(src, /term\.refresh\(0, term\.rows - 1\)/);
});
