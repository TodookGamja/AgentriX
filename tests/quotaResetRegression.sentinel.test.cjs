const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const usage = fs.readFileSync(path.join(ROOT, "src-tauri/src/usage.rs"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
const miniSrc = fs.readFileSync(path.join(ROOT, "src/lib/miniQuotaCache.ts"), "utf8");
const miniJs = ts.transpileModule(miniSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mini = {};
vm.runInNewContext(miniJs, { exports: mini, JSON });

test("T3(a): past localStorage resets normalize to 100%; legacy/no-savedAt discarded", () => {
  const savedAt = Date.parse("2026-11-02T12:00:00+09:00");
  const snap = {
    cliId: "claude",
    cliName: "Claude Code",
    planLabel: "Claude Pro",
    accentColor: "#f97316",
    remainPct5h: 12,
    remainPctWeekly: 34,
    resetsAt5h: "11:00",
    resetsAtWeekly: "11/02 09:00", // savedAt 당일·1일 이내 과거 → 연도 보정 없이 만료
    savedAt,
  };
  const now = Date.parse("2026-11-02T12:30:00+09:00");
  const n = mini.normalizeMiniQuota(snap, now);
  assert.equal(n.remainPct5h, 100);
  assert.equal(n.resetsAt5h, null);
  assert.equal(n.remainPctWeekly, 100);
  assert.equal(n.resetsAtWeekly, null);
  assert.equal(mini.normalizeMiniQuota({ ...snap, savedAt: undefined }), null);
  // parseMiniQuotaCache → normalize 경로(사이드바 복원)도 동일
  const hourAgo = Date.now() - 3600_000;
  const pastHm = new Date(hourAgo + 9 * 3600_000);
  const hh = String(pastHm.getUTCHours()).padStart(2, "0");
  const mm = String(pastHm.getUTCMinutes()).padStart(2, "0");
  const parsed = mini.parseMiniQuotaCache(JSON.stringify({
    ...snap,
    resetsAt5h: `${hh}:${mm}`,
    resetsAtWeekly: null,
    savedAt: Date.now() - 60_000,
  }));
  assert.equal(parsed.remainPct5h, 100);
  assert.equal(parsed.resetsAt5h, null);
  assert.match(app, /restoreMiniQuotaCache/);
  assert.match(app, /isSidebarQuotaValid \? Math\.round\(sidebarQuota!\.remainingPercent5h\) : \(cachedMiniQuota\?\.remainPct5h/);
  assert.doesNotMatch(app, /defaultMiniQuota|remainPct5h:\s*70|remainPctWeekly:\s*74/);
});

test("T3(b)(e): agy main = GEMINI MODELS via /quota PTY; normalize + cache preserve", () => {
  const agy = fs.readFileSync(path.join(ROOT, "src-tauri/src/agy_quota.rs"), "utf8");
  const worker = usage.slice(
    usage.indexOf("fn fetch_antigravity_quota_worker"),
    usage.indexOf("fn get_agy_cache_file")
  );
  const normalize = usage.slice(
    usage.indexOf("fn normalize_cached_quota"),
    usage.indexOf("fn normalize_memory_quota")
  );
  const diskLoad = usage.slice(
    usage.indexOf("fn load_agy_cache_from_disk"),
    usage.indexOf("pub fn extract_antigravity_quota")
  );
  // 메인 = GEMINI MODELS만 (Claude/GPT·최솟값 혼합 금지); 옛 API 경로 제거
  assert.match(worker, /crate::agy_quota::fetch_combined\(\)/);
  assert.doesNotMatch(usage, /retrieveUserQuota|antigravity_min_5h|antigravity_gemini_group/);
  assert.match(agy, /g\.name\.eq_ignore_ascii_case\("GEMINI MODELS"\)/);
  assert.match(agy, /remaining_percent_5h:\s*five/);
  assert.match(agy, /remaining_percent_weekly:\s*weekly/);
  assert.match(normalize, /g\.name\.contains\("GEMINI MODELS"\)/);
  assert.doesNotMatch(normalize, /antigravity_min_5h|group_5h_expired/);
  // 디스크: 리셋 경과 normalize + 옛 API 캐시(source≠agy /quota) 표시 제외
  assert.match(diskLoad, /source_label != "agy \/quota"/);
  assert.match(diskLoad, /normalize_cached_quota/);
  assert.match(usage, /load_claude_cache_from_disk[\s\S]{0,500}normalize_cached_quota/);
  // 메모리 5분 캐시(의도) + 실패 시 직전 캐시 유지
  assert.match(usage, /fetched_at\.elapsed\(\)\.as_secs\(\)\s*<\s*300/);
  assert.match(usage, /fn antigravity_main_5h_tracks_gemini_after_reset/);
  assert.match(usage, /fn antigravity_missing_gemini_preserves_memory_cache/);
  assert.match(agy, /fn parses_quota_groups/);
});

test("T9: /quota parse drives main+weekly; sub_groups keep Claude/GPT·Argon; no weekly 100 sentinel", () => {
  const agy = fs.readFileSync(path.join(ROOT, "src-tauri/src/agy_quota.rs"), "utf8");
  const worker = usage.slice(
    usage.indexOf("fn fetch_antigravity_quota_worker"),
    usage.indexOf("fn get_agy_cache_file")
  );
  assert.match(worker, /crate::agy_quota::fetch_combined\(\)/);
  assert.doesNotMatch(worker, /retrieveUserQuota|retrieveUserQuotaSummary|antigravity_gemini_group/);
  assert.match(agy, /retrieveUserQuotaSummary/);
  assert.match(agy, /retrieveUserQuota/);
  // 메인 주간은 파싱값(weekly) — 옛 센티널 100/None 하드코딩 금지
  assert.match(agy, /remaining_percent_weekly:\s*weekly/);
  assert.match(agy, /resets_at_weekly:\s*main\.and_then\(/);
  assert.doesNotMatch(agy, /remaining_percent_weekly:\s*100\.0/);
  // 픽스처: Gemini 5h 94.71 / 주간 24.67, 타 그룹은 sub만
  assert.match(agy, /94\.71/);
  assert.match(agy, /24\.67/);
  assert.match(agy, /source_label:\s*"agy \/quota \+ API"/);
  assert.match(agy, /sub_groups:\s*Some\(groups\)/);
  assert.match(agy, /from_secs\(15\)/);
  assert.match(agy, /child\.kill\(\)/);
  const uv = fs.readFileSync(path.join(ROOT, "src/components/UsageView.tsx"), "utf8");
  assert.match(uv, /q\.subGroups/);
  assert.match(app, /remainingPercent5h|remainPct5h/);
});

test("T13 SEC: agy /quota PTY — fixed bin, no args inject, timeout kill, no email in parse/cache", () => {
  const agy = fs.readFileSync(path.join(ROOT, "src-tauri/src/agy_quota.rs"), "utf8");
  // 고정 경로·인자 없음·화면 입력은 리터럴 /quota 만
  assert.match(agy, /CommandBuilder::new\(bin\)/);
  const quotaCommand = agy.slice(agy.indexOf("fn quota_command("), agy.indexOf("pub fn fetch()"));
  assert.doesNotMatch(quotaCommand, /\.args\(|arg\(|CommandBuilder::new\([^)]*format!/);
  assert.match(agy, /write_all\(b"\/quota\\r"\)/);
  assert.match(agy, /from_secs\(15\)/);
  assert.match(agy, /child\.kill\(\)/);
  assert.match(agy, /child\.wait\(\)/);
  // 파싱 결과는 그룹명·수치·리셋만 — 원문 화면/이메일을 status·캐시에 넣지 않음
  assert.doesNotMatch(agy, /status_message:\s*Some\(|email|@gmail|@google/i);
  assert.match(agy, /status_message:\s*None/);
  const diskSave = usage.slice(
    usage.indexOf("fn save_agy_cache_to_disk"),
    usage.indexOf("fn load_agy_cache_from_disk")
  );
  assert.match(diskSave, /serde_json::to_string\(quota\)/);
  assert.doesNotMatch(diskSave, /screen|output|raw/);
});

test("T1793584554469_10 weekly UI: antigravity 정보 없음 분기 제거 — 실제 주간 %·리셋 표시", () => {
  const uv = fs.readFileSync(path.join(ROOT, "src/components/UsageView.tsx"), "utf8");
  assert.doesNotMatch(uv, /정보 없음/);
  const gaugeAnchor = app.indexOf('focusedCliId === "cursor" ? "기타 모델" : "주간 잔여"');
  assert.ok(gaugeAnchor >= 0);
  const sidebarBlock = app.slice(gaugeAnchor, gaugeAnchor + 1600);
  assert.match(sidebarBlock, /\{remainPctWeekly\}%/);
  assert.doesNotMatch(sidebarBlock, /정보 없음|focusedCliId === "antigravity"|invisible/);
});

test("T3(c): Codex/Claude/Cursor quota extractors still wired; UsageView reads remainingPercent5h", () => {
  assert.match(usage, /fn extract_codex_quota|extract_codex_quota\(/);
  assert.match(usage, /fn extract_claude_quota|pub fn extract_claude_quota/);
  assert.match(usage, /cli_id == "cursor"|\"cursor\"/);
  const uv = fs.readFileSync(path.join(ROOT, "src/components/UsageView.tsx"), "utf8");
  assert.match(uv, /remainingPercent5h/);
  assert.match(uv, /subGroups/);
  assert.match(uv, /q\.cliId === "cursor"/);
  assert.match(usage, /cached_quota_resets_each_expired_window/);
});
