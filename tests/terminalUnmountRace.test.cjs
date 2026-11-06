const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("terminal ignores pending output and cancels initial fit after unmount", () => {
  const source = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  assert.match(source, /await apiReadSessionOutput\(session\.id, cursorRef\.current\);\s*if \(!active\) return;/);
  assert.match(source, /const initialFitTimer = setTimeout\(/);
  assert.match(source, /clearTimeout\(initialFitTimer\)/);
});
