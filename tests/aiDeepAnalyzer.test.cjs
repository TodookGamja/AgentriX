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
