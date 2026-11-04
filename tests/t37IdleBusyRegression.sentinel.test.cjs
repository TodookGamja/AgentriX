/**
 * T1793752130651_37 — Sentinel 회귀·보안 재검증 (_33~_36, T1793776116339_6~_9)
 * Critical/High → 릴리스 HOLD.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const loadTs = (rel) => {
  const api = {};
  vm.runInNewContext(
    ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: api, module: { exports: api }, require: () => ({}), console, Date, Math, JSON, Set, Map, Promise },
  );
  return api;
};

test("T37/_33: cancel 재확인 3회·실패 메시지·before_check·원자 rename", () => {
  const db = read("src-tauri/src/db.rs");
  const fn = db.slice(db.indexOf("fn cancel_project_blackboard_task_with_hook"), db.indexOf("anyhow::bail!(\"작업표가 바뀌어") + 80);
  assert.match(fn, /for _ in 0\.\.3/);
  assert.match(fn, /before_check\(\)/);
  assert.match(fn, /std::fs::rename/);
  assert.ok(db.includes('anyhow::bail!("작업표가 바뀌어 취소를 다시 시도하세요")'));
  assert.ok(db.includes("cancel_project_blackboard_task_with_hook(project"), "Rust 회귀 테스트 존재");
});

test("T37/_34+_9: agy retry_full_body 1회·bodyWritten 시 restore no-op·다른 CLI 비누수", () => {
  const br = read("src/lib/tauriBridge.ts");
  assert.ok(br.includes("const agyFullBodyRetried = new Set<string>()"));
  assert.ok(br.includes("!agyFullBodyRetried.has(retryKey)"));
  assert.ok(br.includes("agyFullBodyRetried.add(retryKey)"));
  assert.ok(
    br.includes('const restore = () => { if (!restored && prefix && !(session?.cliId === "antigravity" && bodyWritten))'),
    "agy+bodyWritten이면 restore no-op",
  );
  // Claude/Codex/Cursor 전용 early-return이 restore를 막지 않음(agy만 예외)
  assert.equal(/\(\s*session\?\.cliId === "(claude|codex|cursor)" && bodyWritten\)/.test(br), false);
  assert.ok(read("src/App.tsx").includes("agyBootstrapRef"), "no-log bootstrap 가드");
});

test("T37/_35: turn_aborted 완료 + codexInterruptedIdle이 응답 중 오탐 해제 안 함", () => {
  const ctx = read("src-tauri/src/context.rs");
  assert.match(ctx, /turn_aborted/);
  assert.ok(ctx.includes("codex_interrupted_turn_is_complete"));
  const api = loadTs("src/lib/deliveryGate.ts");
  const open = { startedAt: 100, completedAt: null };
  const idleScreen = ["› Ask Codex to do anything", "gpt-5.1 codex"];
  // 응답 중(quietSince=null) → 유휴 판정 false
  assert.equal(api.codexInterruptedIdle("codex", open, idleScreen, null, 50_000), false);
  // 10초 미만 → false
  assert.equal(api.codexInterruptedIdle("codex", open, idleScreen, 200, 10_199), false);
  // 타 CLI 비누수
  assert.equal(api.codexInterruptedIdle("claude", open, idleScreen, 200, 20_000), false);
  assert.equal(api.codexInterruptedIdle("antigravity", open, idleScreen, 200, 20_000), false);
  // 빈 프롬프트+상태줄+10초 → true
  assert.equal(api.codexInterruptedIdle("codex", open, idleScreen, 200, 10_200), true);
});

test("T37/_36+_7: tabIsActive 고아턴 120s 해제·busySessionIds·ring-offset·CLI 공통", () => {
  const api = loadTs("src/lib/deliveryGate.ts");
  assert.equal(api.TAB_STALE_TURN_MS, 120_000);
  assert.equal(api.tabIsActive(null, undefined), true); // 최근 출력
  assert.equal(api.tabIsActive(100, { startedAt: 120, completedAt: null }, 100 + 120_000), false);
  assert.equal(api.tabIsActive(100, { startedAt: 50, completedAt: 80 }), false); // 완료 턴
  for (const cli of ["claude", "codex", "cursor", "antigravity"]) {
    assert.equal(api.tabIsActive(200, { startedAt: 100, completedAt: 150 }), false, cli);
  }
  const app = read("src/App.tsx");
  assert.match(app, /busySessionIds/);
  assert.match(app, /tabIsActive\(/);
  assert.match(app, /tabOutputPrevRef/);
  assert.match(app, /ring-offset-1 ring-offset-slate-900/);
  assert.match(app, /응답 중 \(하늘색 깜빡임/);
});

test("T37/_6+_8: danger Enter=취소 포커스·모달 중 단축키 차단", async () => {
  const host = read("src/components/ConfirmHost.tsx");
  assert.ok(host.includes("(cur.danger && cancelRef.current ? cancelRef : okRef).current?.focus()"));
  const conf = loadTs("src/lib/confirmDialog.ts");
  assert.equal(conf.isConfirmOpen(), false);
  const off = conf.confirmDialogSubscribe((r) => {
    assert.equal(conf.isConfirmOpen(), true);
    r.resolve(false);
  });
  assert.equal(await conf.confirmDialog({ title: "x", danger: true }), false);
  assert.equal(conf.isConfirmOpen(), false);
  off();
  assert.match(read("src/App.tsx"), /if \(isConfirmOpen\(\)\) return;/);
  assert.match(read("src/components/TerminalPane.tsx"), /if \(isConfirmOpen\(\)\) return;/);
});
