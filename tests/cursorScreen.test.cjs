const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObj = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/cursorScreen.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObj, Map, Date });
const { cursorTurnFromLines, cursorTurnBusy, cursorPastedSubmission, codexPastePending } = exportsObj;

test('Cursor working state survives spinner changes and ends after two seconds absent', () => {
  let state = cursorTurnFromLines(['Working ◌', 'ctrl+c to stop'], undefined, 1000);
  assert.equal(state.startedAt, 1000);
  state = cursorTurnFromLines(['Working ◐', 'ctrl+c to stop'], state, 5000);
  assert.equal(state.completedAt, undefined);
  state = cursorTurnFromLines(['→'], state, 6000);
  assert.equal(state.completedAt, undefined);
  state = cursorTurnFromLines(['→'], state, 6999);
  assert.equal(state.completedAt, undefined);
  state = cursorTurnFromLines(['→'], state, 7000);
  assert.equal(state.completedAt, 7000);
  assert.ok(state.completedAt - 6000 < 10000);
  assert.equal(cursorTurnBusy(['Working', 'ctrl+c to stop']), true);
});

test('one missing frame followed by work resets the two-poll requirement', () => {
  let state = cursorTurnFromLines(['ctrl+c to stop'], undefined, 1000);
  state = cursorTurnFromLines(['→'], state, 2000);
  state = cursorTurnFromLines(['ctrl+c to stop'], state, 2500);
  state = cursorTurnFromLines(['→'], state, 3000);
  assert.equal(state.completedAt, undefined);
  state = cursorTurnFromLines(['→'], state, 4000);
  assert.equal(state.completedAt, 4000);
});

test('only a new pasted record with an empty input confirms a submission', () => {
  assert.equal(cursorPastedSubmission(['[Pasted text #9 +1 lines]', '→'], []), true);
  assert.equal(cursorPastedSubmission(['[Pasted text #9 +1 lines]', '→ draft'], []), false);
  assert.equal(cursorPastedSubmission(['[Pasted text #9 +1 lines]', '→'], ['[Pasted text #9 +1 lines]']), false);
});

test('Codex detects a paste chip only in the current input region', () => {
  assert.equal(codexPastePending(['old output', '› [Pasted Content 1341 chars]']), true);
  assert.equal(codexPastePending(['[Pasted Content 1341 chars]', 'assistant reply', '›']), false);
  assert.equal(codexPastePending(['Working']), false);
});

test('only Cursor uses rendered state for delivery and submission', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const bridge = fs.readFileSync('src/lib/tauriBridge.ts', 'utf8');
  assert.match(app, /session\.cliId === "cursor"[\s\S]*?readCursorTurn\(session\.id\)/);
  assert.match(bridge, /cursorConfirmed \|\| \(session\?\.cliId === "cursor"/);
});

test('completed Cursor turn releases the queued item within ten seconds', () => {
  const load = (path) => {
    const out = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: out });
    return out;
  };
  const { deliveryGate } = load('src/lib/deliveryGate.ts');
  const { nextQueueItem } = load('src/lib/sessionQueue.ts');
  let turn = cursorTurnFromLines(['ctrl+c to stop'], undefined, 1000);
  turn = cursorTurnFromLines(['→'], turn, 2000);
  turn = cursorTurnFromLines(['→'], turn, 3000);
  const item = { id: 'mail:1', source: 'mail', payload: 'hello\r', preview: 'hello', createdAt: 1000 };
  assert.equal(deliveryGate({ at: 900, started: true }, turn.completedAt > 900, 0, 4000), 'proceed');
  assert.equal(nextQueueItem([item]).id, 'mail:1');
  assert.ok(turn.completedAt - 2000 < 10000);
});
