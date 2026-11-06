const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("binary terminal mouse reports are sent as bytes and listener is disposed", () => {
  const terminal = fs.readFileSync("src/components/TerminalPane.tsx", "utf8");
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  const backend = fs.readFileSync("src-tauri/src/main.rs", "utf8");
  assert.match(terminal, /term\.onBinary\(/);
  assert.match(terminal, /binaryDisposable\.dispose\(\)/);
  assert.match(bridge, /Array\.from\(data,.*charCodeAt/s);
  assert.match(bridge, /invoke\("write_to_session_bytes"/);
  assert.match(backend, /fn write_to_session_bytes\([\s\S]*?Vec<u8>/);
});
