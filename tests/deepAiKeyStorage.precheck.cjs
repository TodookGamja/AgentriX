const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("① startup strips legacy apiKey from localStorage payload", () => {
  const main = fs.readFileSync("src/main.tsx", "utf8");
  assert.match(main, /agentrix_deep_ai_config/);
  assert.match(main, /apiKey:\s*_drop/);
  assert.match(main, /localStorage\.setItem\("agentrix_deep_ai_config", JSON\.stringify\(rest\)\)/);

  // main.tsx와 동일 로직: 기존 평문 키 제거
  const store = new Map();
  store.set(
    "agentrix_deep_ai_config",
    JSON.stringify({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-legacy-secret" })
  );
  const raw = store.get("agentrix_deep_ai_config");
  const { apiKey: _drop, ...rest } = JSON.parse(raw);
  store.set("agentrix_deep_ai_config", JSON.stringify(rest));
  const cleaned = JSON.parse(store.get("agentrix_deep_ai_config"));
  assert.equal(cleaned.apiKey, undefined);
  assert.equal(cleaned.provider, "openai");
  assert.doesNotMatch(store.get("agentrix_deep_ai_config"), /sk-legacy-secret/);
});

test("① modal never persists apiKey; saves via apiSaveApiKey deep-ai", () => {
  const modal = fs.readFileSync("src/components/AiDeepTeamModal.tsx", "utf8");
  assert.match(modal, /const \{ apiKey, \.\.\.rest \} = config/);
  assert.match(modal, /JSON\.stringify\(rest\)/);
  assert.match(modal, /apiSaveApiKey\("deep-ai"/);
  assert.match(modal, /\.\.\.JSON\.parse\(v\),\s*apiKey: ""/);
  assert.doesNotMatch(modal, /localStorage\.setItem\([^)]*JSON\.stringify\(config\)/);
  assert.match(modal, /maskedPreview/);
  assert.doesNotMatch(modal, /rawKey/);
});

test("⑤ frontend types and IPC helpers expose no rawKey / no secret getter", () => {
  const types = fs.readFileSync("src/types/types.ts", "utf8");
  assert.doesNotMatch(types, /rawKey/);
  const bridge = fs.readFileSync("src/lib/tauriBridge.ts", "utf8");
  assert.match(bridge, /request_with_detected_credential/);
  assert.doesNotMatch(bridge, /get_api_key_secret|getApiKeySecret/);
  const rust = fs.readFileSync("src-tauri/src/main.rs", "utf8");
  assert.match(rust, /#\[serde\(skip\)\][\s\S]*pub raw_key/);
  assert.match(rust, /detect_saved_deep_credentials/);
  assert.match(rust, /fn find_detected_key/);
  assert.doesNotMatch(rust, /get_api_key_secret/);
});
