const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/splitLayout.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api });

test("layout cycle rotates single → split-h → split-v → grid-4 → single", () => {
  assert.equal(api.nextSplitLayout("single"), "split-h");
  assert.equal(api.nextSplitLayout("split-h"), "split-v");
  assert.equal(api.nextSplitLayout("split-v"), "grid-4");
  assert.equal(api.nextSplitLayout("grid-4"), "single");
  assert.equal(api.visibleSlotCount("single"), 1);
  assert.equal(api.visibleSlotCount("split-h"), 2);
  assert.equal(api.visibleSlotCount("split-v"), 2);
  assert.equal(api.visibleSlotCount("grid-4"), 4);
});

test("split layout keeps slot placement fixed when focus changes", () => {
  const sessions = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ];
  const slots = ["b", "a", null, null];
  const focusedOnA = api.resolvePaneSessions({
    layout: "split-h",
    sessions,
    projectSessions: sessions,
    activeSessionId: "a",
    splitSlotSessionIds: slots,
  });
  const focusedOnC = api.resolvePaneSessions({
    layout: "split-h",
    sessions,
    projectSessions: sessions,
    activeSessionId: "c",
    splitSlotSessionIds: slots,
  });
  assert.equal(focusedOnA[0].id, "b");
  assert.equal(focusedOnA[1].id, "a");
  assert.equal(focusedOnC[0].id, "b");
  assert.equal(focusedOnC[1].id, "a");
  assert.notEqual(focusedOnC[0].id, "c");
});

test("single layout shows active session only; empty slots stay null", () => {
  const sessions = [{ id: "x" }, { id: "y" }];
  const panes = api.resolvePaneSessions({
    layout: "single",
    sessions,
    projectSessions: sessions,
    activeSessionId: "y",
    splitSlotSessionIds: ["x", "y", null, null],
  });
  assert.equal(panes[0].id, "y");
  assert.equal(panes[1], null);
  assert.equal(panes[2], null);
  assert.equal(panes[3], null);
});

test("App wires layout cycle + fixed slot resolve into split UI", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8");
  assert.match(app, /nextSplitLayout/);
  assert.match(app, /visibleSlotCount as splitVisibleSlotCount/);
  assert.match(app, /resolvePaneSessions/);
  assert.match(app, /const nextLayout = nextSplitLayout\(splitLayout\)/);
  assert.match(app, /layout: splitLayout/);
  assert.match(app, /splitSlotSessionIds/);
});
