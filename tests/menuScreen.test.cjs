const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/cursorScreen.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api, Map, Date });
const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");

test("메뉴 화면(hooks·권한·선택 목록)은 메뉴로 판정", () => {
  assert.ok(api.menuScreen(["PermissionRequest hooks", "", "  esc back"]));
  assert.ok(api.menuScreen(["Do you want to proceed?", "Esc to go back"]));
  assert.ok(api.menuScreen(["Select model", "Enter to select · ↑/↓ to navigate · Esc to cancel"]));
});
test("정상 입력창·작업 중 화면은 메뉴 아님", () => {
  assert.ok(!api.menuScreen(["› ", "  ? for shortcuts"]));
  assert.ok(!api.menuScreen(["✻ Working…  esc to interrupt"]));
  assert.ok(!api.menuScreen(null) && !api.menuScreen([]));
});
test("전달은 메뉴에서 쓰기 전 보류, confirm은 메뉴면 성공 아님, Esc 복구 1회", () => {
  assert.match(app, /if \(menuScreen\(menuLines\)\)[\s\S]{0,420}return blocked\(MENU_BLOCK_REASON\)/);
  assert.match(app, /!since\.escaped && Date\.now\(\) - since\.at > MENU_ESC_RECOVER_MS/);
  assert.match(bridge, /confirmed && await apiGetSessionScreen\(sessionId, 30\)\.then\(\(sc\) => menuScreen\(sc\?\.lines\)\)/);
});
