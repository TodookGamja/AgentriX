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

test("regression: full cycle returns to single; unknown layout resets to single", () => {
  let layout = "single";
  const seen = [];
  for (let i = 0; i < 4; i++) {
    layout = api.nextSplitLayout(layout);
    seen.push(layout);
  }
  assert.deepEqual(seen, ["split-h", "split-v", "grid-4", "single"]);
  // indexOf miss → idx 0 → LAYOUT_CYCLE[0] === "single"
  assert.equal(api.nextSplitLayout("not-a-layout"), "single");
});

test("regression: grid-4 fills four distinct slots then nulls when sessions run out", () => {
  const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const panes = api.resolvePaneSessions({
    layout: "grid-4",
    sessions,
    projectSessions: sessions,
    activeSessionId: "a",
    splitSlotSessionIds: [null, null, null, null],
  });
  assert.equal(panes.filter(Boolean).length, 3);
  assert.equal(panes[3], null);
  assert.equal(panes.filter(Boolean).map((p) => p.id).join(","), "a,b,c");
});

test("regression: duplicate slot ids collapse to one session per pane", () => {
  const sessions = [{ id: "a" }, { id: "b" }];
  const panes = api.resolvePaneSessions({
    layout: "split-h",
    sessions,
    projectSessions: sessions,
    activeSessionId: "a",
    splitSlotSessionIds: ["a", "a", null, null],
  });
  assert.equal(panes[0].id, "a");
  assert.equal(panes[1].id, "b");
});
