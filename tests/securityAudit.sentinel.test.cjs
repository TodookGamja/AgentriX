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
  for (const p of caps.permissions) {
    assert.match(p, /^core:/, `unexpected capability permission: ${p}`);
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
    assert.match(sigText, /untrusted comment: signature|RU[A-Za-z0-9+/=\s]+/);
    assert.doesNotMatch(sigText, /private key|RWR[A-Za-z0-9+/=]{20,}/);
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

test("SEC: CSP baseline keeps default-src self; img-src http: tracked as V104_SEC5 Medium", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert.match(conf.app.security.csp, /default-src 'self'/);
  assert.match(conf.app.security.csp, /img-src[^;]*https:/);
  // V104_SEC5: remove bare http: from img-src when Forge lands the fix.
  // Until then, presence is expected and reported as Medium (not a gate fail).
  assert.equal(
    /img-src[^;]*\bhttp:/.test(conf.app.security.csp),
    true,
    "expected img-src http: until V104_SEC5; flip assertion when fixed"
  );
});
