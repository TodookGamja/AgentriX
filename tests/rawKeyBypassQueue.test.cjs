// T1793842681518_1: agy 탭 스크롤·타이핑 먹통 = 사용자 키가 팀 전달 쓰기 대기열 뒤에 서던 문제
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const src = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");

test("raw user keys / arrows / mouse-wheel reports bypass the delivery write queue; deliveries and pastes still queue", () => {
  const m = src.match(/export function isRawUserKey[\s\S]*?\n}\n/)[0];
  const js = require("typescript").transpileModule(m, { compilerOptions: { module: 1 } }).outputText; const mod = { exports: {} }; new Function("exports", js)(mod.exports); const isRawUserKey = mod.exports.isRawUserKey;
  assert.equal(isRawUserKey("a", false), true);
  assert.equal(isRawUserKey("\r", false), true);
  assert.equal(isRawUserKey("\x1b[A", false), true);
  assert.equal(isRawUserKey("\x1b[<64;10;5M", false), true);
  assert.equal(isRawUserKey("본문 전달\r", false), false);
  assert.equal(isRawUserKey("a", true), false);
  assert.equal(isRawUserKey("a", false, {}), false);
  assert.equal(isRawUserKey("a", false, undefined, true), false);
});

test("apiWriteToSession writes raw keys before queueSessionWrite", () => {
  const body = src.slice(src.indexOf("export async function apiWriteToSession"));
  assert.ok(body.indexOf("isRawUserKey(data") > 0 && body.indexOf("isRawUserKey(data") < body.indexOf("queueSessionWrite("));
});
