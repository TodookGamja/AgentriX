const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/aiDeepAnalyzer.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, require: () => ({}) });

test("hasDeveloper: writesCode flag wins, PM (first) is ignored", () => {
  assert.equal(api.hasDeveloper([{ name: "PM", writesCode: true }, { roleTitle: "문서 담당", writesCode: false }]), false);
  assert.equal(api.hasDeveloper([{ name: "PM" }, { roleTitle: "Anything", writesCode: true }]), true);
});

test("hasDeveloper: falls back to role title, excluding QA/docs/review roles", () => {
  assert.equal(api.hasDeveloper([{ name: "PM" }, { roleTitle: "Rust 백엔드 개발자" }]), true);
  assert.equal(api.hasDeveloper([{ name: "PM" }, { roleTitle: "QA 엔지니어" }, { roleTitle: "문서화 리드" }]), false);
});

test("prompt no longer tells the model to avoid standard dev roles", () => {
  assert.ok(!source.includes("정석 구성(PM·백엔드·프론트·QA의 반복)에 머무르지"));
  assert.ok(!source.includes("이름과 역할 구성을 겹치지 않게"));
  assert.match(source, /languageStats/);
});

test("quota groups remove exhausted models and reject a depleted recommendation", () => {
  const options = [{ id: "antigravity", name: "agy", models: ["gemini-4-argon-medium", "gemini-3.8-flash-medium", "claude-opus-5-5-low"] }];
  const quota = [{ cliId: "antigravity", hasOfficialQuota: true, remainingPercent5h: 94.71, remainingPercentWeekly: 24.67, subGroups: [
    { name: "GEMINI MODELS", description: "Gemini Flash, Gemini Pro", remaining5h: 94.71, remainingWeekly: 24.67 },
    { name: "GEMINI 4 ARGON", remainingWeekly: 0 },
    { name: "CLAUDE AND GPT MODELS", description: "Claude Opus, Claude Sonnet, GPT-OSS", remainingWeekly: 49.26 },
  ] }];
  const filtered = api.filterExhaustedModels(options, quota);
  assert.deepEqual(Array.from(filtered[0].models), ["gemini-3.8-flash-medium", "claude-opus-5-5-low"]);
  assert.equal(api.pickModel("antigravity", "gemini-4-argon-medium", filtered), "gemini-3.8-flash-medium");
  assert.equal(api.pickModel("antigravity", "unknown", filtered), "");
  assert.deepEqual(Array.from(api.filterExhaustedModels(options, [])[0].models), options[0].models);
  assert.equal(api.filterExhaustedModels([{id:"claude", name:"Claude", models:["claude"]}], [{cliId:"claude", hasOfficialQuota:true, remainingPercent5h:0}])[0].models.length, 0);
});
