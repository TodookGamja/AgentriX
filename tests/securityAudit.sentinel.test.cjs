const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("SEC: Deep AI config never persists apiKey; startup strips legacy plaintext", () => {
  const main = read("src/main.tsx");
  const modal = read("src/components/AiDeepTeamModal.tsx");
  assert.match(main, /apiKey:\s*_drop/);
  assert.match(main, /localStorage\.setItem\("agentrix_deep_ai_config"/);
  assert.match(modal, /const \{ apiKey, \.\.\.rest \} = config/);
  assert.match(modal, /apiSaveApiKey\("deep-ai"/);
  assert.doesNotMatch(modal, /localStorage\.setItem\([^)]*JSON\.stringify\(config\)/);
});

test("SEC: DetectedCliCredential raw_key is serde-skipped; no secret getter IPC", () => {
  const rust = read("src-tauri/src/main.rs");
  assert.match(rust, /#\[serde\(skip\)\][\s\S]{0,40}pub raw_key/);
  assert.match(rust, /request_with_detected_credential/);
  assert.doesNotMatch(rust, /get_api_key_secret|getApiKeySecret/);
  const bridge = read("src/lib/tauriBridge.ts");
  assert.doesNotMatch(bridge, /get_api_key_secret|getApiKeySecret/);
});

test("SEC: API key at-rest uses cipher_value (not plaintext column); XOR noted for V104", () => {
  const db = read("src-tauri/src/db.rs");
  const ddl = db.match(/CREATE TABLE IF NOT EXISTS api_keys \(([\s\S]*?)\);/);
  assert.ok(ddl, "api_keys DDL missing");
  assert.match(ddl[1], /cipher_value/);
  assert.doesNotMatch(ddl[1], /raw_key|plain_key|api_key\s+TEXT/);
  assert.match(db, /fn encrypt_key/);
  assert.match(db, /b \^ salt\[i % salt\.len\(\)\]/);
  // V104_SEC1: 신규 저장은 DPAPI(v2:), XOR은 옛 값 읽기·이전 전용
  assert.match(db, /CryptProtectData/);
  assert.match(db, /fn migrate_api_keys/);
  assert.match(db, /fn encrypt_key\(plain: &str\) -> Result<String>/);
});

test("SEC: repo root logs must not contain secret-like payloads", () => {
  const patterns = [/sk-[A-Za-z0-9_-]{8,}/, /Bearer\s+[A-Za-z0-9._\-]{8,}/i, /ANTHROPIC_API_KEY\s*=/, /OPENAI_API_KEY\s*=/];
  for (const name of ["out.log", "stdout.log", "stderr.log", "err.log", "panic.log"]) {
    const full = path.join(ROOT, name);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const re of patterns) {
      assert.equal(re.test(text), false, `${name} matched ${re}`);
    }
  }
});

test("SEC: Tauri capability stays core-only; CSP + update URL allowlist present", () => {
  const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.deepEqual(caps.windows, ["main"]);
  // 외부 플러그인 권한 금지: core:* 와 앱 커맨드 allow-* 만 허용(V104_SEC2)
  for (const p of [...caps.permissions, ...JSON.parse(read("src-tauri/capabilities/sensitive.json")).permissions]) {
    assert.match(p, /^(core:|allow-[a-z0-9-]+$)/, `unexpected capability permission: ${p}`);
  }
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.equal(conf.app.withGlobalTauri, false);
  assert.ok(conf.app.security.csp && conf.app.security.csp.includes("default-src 'self'"));
  const rust = read("src-tauri/src/main.rs");
  assert.match(rust, /valid_update_url/);
  assert.match(rust, /UPDATE_PUBLIC_KEY/);
  assert.match(rust, /verify_update/);
  assert.match(rust, /github\.com\/TodookGamja\/AgentriX\/releases\/download\//);
  assert.doesNotMatch(rust, /const UPDATE_PUBLIC_KEY: &str = "";/);
});

test("SEC: shell / PTY injection guards wired (run_quiet meta reject + ps_escape)", () => {
  const main = read("src-tauri/src/main.rs");
  const pty = read("src-tauri/src/pty.rs");
  assert.match(main, /run_quiet_rejects_shell_metacharacters/);
  assert.match(pty, /fn ps_escape_single_quoted/);
  assert.match(pty, /initial_command_does_not_execute_injected_powershell|initial_command_and_fallback_are_quoted/);
  assert.match(read("src-tauri/src/handoff.rs"), /fn redact_secrets/);
  assert.match(read("src-tauri/src/handoff.rs"), /fn validate_safe_handoff_path/);
});

test("SEC T5: session resume rejects path-like IDs; markers allowlisted; resume XOR session-id", () => {
  const main = read("src-tauri/src/main.rs");
  const pty = read("src-tauri/src/pty.rs");
  // Claude/Codex 재개 ID는 UUID parse 후에만 사용 → ../ 등 경로 조작 불가
  assert.match(main, /fn resumable_claude_session/);
  assert.match(main, /uuid::Uuid::parse_str\(&id\)|uuid::Uuid::parse_str\(id\)/);
  assert.match(main, /claude_resume_requires_uuid_and_existing_log/);
  assert.match(main, /\.\.\/project\/other/);
  assert.match(main, /codex_log_for_session[\s\S]{0,120}Uuid::parse_str/);
  // 마커는 명시 9개만 제거(설정·OAuth 유지)
  assert.match(pty, /fn is_claude_session_marker/);
  assert.match(pty, /CLAUDE_CODE_MESSAGING_TOKEN/);
  assert.match(pty, /CLAUDE_CODE_GIT_BASH_PATH/);
  assert.match(pty, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(pty, /claude_session_marker_matches_inherited_keys/);
  // --resume 과 --session-id 는 삼항으로 하나만 extend (둘 다 붙이지 않음)
  assert.match(
    pty,
    /cli\.args\.extend\(\[if resume_id\.is_some\(\) \{ "--resume" \} else \{ "--session-id" \}\.to_string\(\), session_id\.clone\(\)\]\)/
  );
  // 새 대화 경로
  assert.match(main, /start_fresh/);
  assert.match(read("src/lib/tauriBridge.ts"), /startFresh/);
  assert.match(read("src/components/ProjectWorkspaceView.tsx"), /새 대화로 실행/);
});

test("SEC: v1.0.4 write path waits for echo then sends CR only; no secret logging of body", () => {
  const bridge = read("src/lib/tauriBridge.ts");
  const queue = read("src/lib/sessionWriteQueue.ts");
  const main = read("src-tauri/src/main.rs");
  assert.match(queue, /export function enterReady/);
  assert.match(bridge, /enterReady\(sentAt, last, Date\.now\(\), minWait\)/);
  assert.match(bridge, /get_session_quiet_since[\s\S]{0,80}quietMs:\s*0/);
  assert.match(bridge, /data:\s*"\\r"/);
  assert.match(main, /quiet_ms:\s*Option<i64>/);
  assert.doesNotMatch(bridge, /console\.(log|debug|info|warn|error)\([^)]*body/);
  assert.doesNotMatch(bridge, /console\.(log|debug|info|warn|error)\([^)]*data/);
});

test("SEC: OAuth credential path is read in-process only; preview blocks .credentials.json", () => {
  const usage = read("src-tauri/src/usage.rs");
  const main = read("src-tauri/src/main.rs");
  assert.match(usage, /\.claude["']\.join\("\.credentials\.json"\)|\.join\("\.claude"\)\.join\("\.credentials\.json"\)/);
  assert.match(usage, /accessToken/);
  assert.doesNotMatch(usage, /println!\([^)]*access_token|eprintln!\([^)]*accessToken|println!\([^)]*Bearer/);
  assert.match(main, /preview_paths_respect_registered_roots_and_sensitive_home/);
  assert.match(main, /\.credentials\.json/);
  assert.match(main, /민감한 파일은 미리 볼 수 없습니다/);
});

test("SEC: release assets include .sig; repo has no private minisign key", () => {
  const releaseDir = path.join(ROOT, "release");
  if (fs.existsSync(releaseDir)) {
    const names = fs.readdirSync(releaseDir);
    const hasExe = names.some((n) => n === "AgentriX.exe" || /^AgentriX-Setup-v.+\.exe$/.test(n));
    const hasSig = names.includes("AgentriX.exe.sig");
    assert.equal(hasExe, true, "release/ missing AgentriX.exe or setup");
    assert.equal(hasSig, true, "release/ missing AgentriX.exe.sig");
    const sigText = fs.readFileSync(path.join(releaseDir, "AgentriX.exe.sig"), "utf8");
    const signature = Buffer.from(sigText.trim(), "base64").toString("utf8");
    assert.match(signature, /untrusted comment: signature/);
    assert.doesNotMatch(signature, /private key|RWR[A-Za-z0-9+/=]{20,}/);
  }
  const walk = (dir, acc = []) => {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === "target" || ent.name === "target-test") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, acc);
      else if (/\.(key|minisign)$/i.test(ent.name) || /secret\.key$/i.test(ent.name)) acc.push(full);
    }
    return acc;
  };
  assert.deepEqual(walk(ROOT).filter((p) => !p.includes(`${path.sep}.tauri${path.sep}`)), []);
});

test("SEC: CSP baseline keeps default-src self; img-src has no bare http: (V104_SEC5)", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.match(conf.app.security.csp, /default-src 'self'/);
  assert.match(conf.app.security.csp, /img-src[^;]*https:/);
  // V104_SEC5: bare http: 금지, http://asset.localhost는 허용. 토큰 단위 비교로 느슨한 정규식 오탐을 막는다.
  const img = conf.app.security.csp.match(/img-src([^;]*)/)[1].trim().split(/\s+/);
  assert.ok(!img.includes("http:"), "img-src must not allow bare http:");
  assert.ok(img.includes("http://asset.localhost"));
});

test("SEC: helper/PTY/agy processes pin safe_helper_cwd; System32 startup is guarded", () => {
  const cli = read("src-tauri/src/cli.rs");
  const main = read("src-tauri/src/main.rs");
  const pty = read("src-tauri/src/pty.rs");
  const agy = read("src-tauri/src/agy_quota.rs");
  const tools = read("src-tauri/src/tools.rs");
  const usage = read("src-tauri/src/usage.rs");
  assert.match(cli, /pub fn safe_helper_cwd/);
  assert.match(cli, /pub fn guard_startup_cwd/);
  assert.match(cli, /system32_startup_and_helper_use_safe_directory/);
  assert.match(main, /cli::guard_startup_cwd\(\)/);
  assert.match(main, /cli::safe_helper_cwd\(\)/);
  assert.match(pty, /crate::cli::safe_helper_cwd\(\)/);
  assert.match(tools, /crate::cli::safe_helper_cwd\(\)/);
  assert.match(usage, /crate::cli::safe_helper_cwd\(\)/);
  assert.match(agy, /command\.cwd\(cwd\)/);
  assert.match(agy, /let home = QuotaHome::new\(\)/);
  assert.match(agy, /let cwd = home\.path\(\)/);
  assert.doesNotMatch(agy, /println!\([^)]*access_token|eprintln!\([^)]*Bearer|eprintln!\([^)]*access_token/);
});

test("V104_SEC5: CSP img-src has no bare http:", () => {
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  for (const k of ["csp", "devCsp"]) {
    const img = conf.app.security[k].match(/img-src([^;]*)/)[1].split(/\s+/);
    assert.ok(!img.includes("http:"), k);
    assert.ok(img.includes("https:") && img.includes("asset:") && img.includes("http://asset.localhost"), k);
  }
});

test("V104_SEC2: 프론트 invoke 목록 = build.rs 앱 커맨드 목록 = capabilities 허용 목록; 민감 커맨드는 sensitive.json", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const src = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const invoked = new Set([...src.matchAll(/invoke(?:<[^(]*>)?\(\s*["']([a-z_0-9]+)["']/g)].map((m) => m[1]));
  assert.ok(invoked.size > 50, `invoke 수집 실패: ${invoked.size}`);
  const build = read("src-tauri/build.rs");
  const manifest = new Set([...build.match(/APP_COMMANDS: &\[&str\] = &\[([^\]]*)\]/)[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]));
  const caps = (f) => JSON.parse(read(`src-tauri/capabilities/${f}`)).permissions.filter((p) => p.startsWith("allow-"));
  const def = caps("default.json"), sens = caps("sensitive.json");
  const granted = new Set([...def, ...sens].map((p) => p.slice(6).replace(/-/g, "_")));
  const diff = (a, b) => [...a].filter((x) => !b.has(x));
  assert.deepEqual(diff(invoked, manifest), [], "invoke하는데 manifest에 없음(호출 막힘)");
  assert.deepEqual(diff(manifest, invoked), [], "invoke 안 하는데 노출됨");
  assert.deepEqual(diff(manifest, granted), [], "manifest에 있으나 capability 미허용");
  assert.deepEqual(diff(granted, manifest), [], "capability에 있으나 manifest에 없음");
  assert.equal(def.length + sens.length, granted.size, "default/sensitive 중복 허용");
  for (const c of ["write_to_session", "start_session", "stop_session", "install_npm_cli_update", "perform_in_app_update", "save_api_key", "get_detected_cli_credentials", "request_with_detected_credential", "reset_app_data"]) {
    assert.ok(sens.includes("allow-" + c.replace(/_/g, "-")), `${c}는 sensitive.json`);
    assert.ok(!def.includes("allow-" + c.replace(/_/g, "-")), `${c}는 default.json에 없어야 함`);
  }
});
