// 실행: npx tsx scripts/check_permission_settings.ts
import assert from "node:assert/strict";
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
const { permissionLaunch, savePermSettings, loadPermSettings } = await import("../src/lib/permissionSettings.ts");

assert.deepEqual(permissionLaunch("claude"), { args: [], auto: false }); // 저장값 없음 → 수동
savePermSettings("full_auto", loadPermSettings().flags);
assert.deepEqual(permissionLaunch("codex"), { args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"], auto: true });
assert.deepEqual(permissionLaunch("opencode"), { args: [], auto: true }); // opencode는 환경변수로 승인
savePermSettings("custom", { ...loadPermSettings().flags, claude: "--permission-mode acceptEdits" });
assert.deepEqual(permissionLaunch("claude"), { args: ["--permission-mode", "acceptEdits"], auto: false });
assert.equal(loadPermSettings().mode, "custom"); // 재시작 후에도 유지
console.log("Permission settings checks passed!");
