const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r/g, "");

function extractPlainUrlRegex(src) {
  const marker = "text.matchAll(";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "plain-text URL matchAll missing");
  let i = start + marker.length;
  while (src[i] === " " || src[i] === "\n") i++;
  assert.equal(src[i], "/", "expected regex literal after matchAll(");
  let j = i + 1;
  let escaped = false;
  for (; j < src.length; j++) {
    const c = src[j];
    if (!escaped && c === "\\") {
      escaped = true;
      continue;
    }
    if (!escaped && c === "/") {
      j++;
      break;
    }
    escaped = false;
  }
  while (j < src.length && /[gimsuy]/.test(src[j])) j++;
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(i, j)}`)();
}

test("T1793752130651_1: OSC8 linkHandler http(s) only + allowNonHttpProtocols false", () => {
  const src = read("src/components/TerminalPane.tsx");
  assert.match(src, /linkHandler:\s*\{\s*activate:/);
  assert.match(src, /allowNonHttpProtocols:\s*false/);
  assert.ok(src.includes("/^https?:\\/\\//i.test(uri)"), "OSC8 activate must guard https? scheme");
  assert.match(src, /apiOpenExternalUrl\(uri\)/);
});

test("T1793752130651_1: plain-text provider matches http(s) only; strips trailing punct; rejects schemes/paths", () => {
  const src = read("src/components/TerminalPane.tsx");
  assert.match(src, /term\.registerLinkProvider\(/);
  assert.match(src, /apiOpenExternalUrl\(m\[0\]\)/);
  const re = extractPlainUrlRegex(src);
  const cases = [
    ["https://ex.com/a.", "https://ex.com/a"],
    ["(see https://ex.com/path).", "https://ex.com/path"],
    ["https://ex.com/a),", "https://ex.com/a"],
    ["https://ex.com/path);", "https://ex.com/path"],
    ["http://ex.com/foo?q=1", "http://ex.com/foo?q=1"],
    ["HTTPS://EX.COM/X", "HTTPS://EX.COM/X"],
    ["한글 https://ex.com/p", "https://ex.com/p"],
    ["https://ex.com/a b", "https://ex.com/a"],
    ["file:///C:/x", null],
    ["javascript:alert(1)", null],
    ["C:\\Windows\\System32\\calc.exe", null],
  ];
  for (const [sample, expect] of cases) {
    const hit = [...sample.matchAll(re)].map((m) => m[0])[0] ?? null;
    assert.equal(hit, expect, `sample=${JSON.stringify(sample)}`);
  }
});

test("T1793752130651_1: remount cleanup disposes terminal (link provider lifetime bound to term)", () => {
  const src = read("src/components/TerminalPane.tsx");
  const providerAt = src.indexOf("term.registerLinkProvider");
  const disposeAt = src.indexOf("term.dispose()", providerAt);
  assert.ok(providerAt >= 0 && disposeAt > providerAt, "registerLinkProvider must be cleaned via term.dispose() in same effect");
  // 명시적 IDisposable 보관은 없으나 session.id effect cleanup에서 term.dispose()로 해제 → 재마운트 누적 없음
  assert.equal(src.includes("const linkProvider = term.registerLinkProvider"), false);
});

test("T1793752130651_1: backend valid_external_url still rejects file/javascript/local/whitespace", () => {
  const rust = read("src-tauri/src/main.rs");
  assert.match(rust, /fn open_external_url\(url: String\)/);
  assert.match(rust, /if !valid_external_url\(&url\)/);
  assert.match(rust, /fn valid_external_url\(url: &str\) -> bool/);
  assert.match(rust, /matches!\(parsed\.scheme\(\),\s*"http"\s*\|\s*"https"\)/);
  assert.match(rust, /javascript:alert\(1\)/);
  assert.match(rust, /file:\/\/\/C:\/calc\.exe/);
  assert.match(rust, /C:\\Windows\\System32\\calc\.exe/);
});

test("T1793752130651_1/_3: Tauri에서 open_external_url 거부는 window.open으로 우회하지 않는다(수정됨)", () => {
  const bridge = read("src/lib/tauriBridge.ts");
  const start = bridge.indexOf("export async function apiOpenExternalUrl");
  const end = bridge.indexOf("\nexport ", start + 1);
  const fn = bridge.slice(start, end > start ? end : undefined);
  assert.match(fn, /if\s*\(isTauriRuntime\(\)\)\s*\{[\s\S]*await invoke\("open_external_url",\s*\{\s*url\s*\}\);[\s\S]*return;/);
  assert.doesNotMatch(fn, /catch/);
  // 브라우저 모드에서만 window.open (Tauri 분기 return 이후)
  assert.match(fn, /return;\s*\}\s*window\.open\(url,\s*"_blank"\);/);
});

test("T1793752130651_4: App 업데이트/릴리즈 호출부는 거부 시 토스트로 끝난다", () => {
  const app = read("src/App.tsx");
  assert.match(
    app,
    /try\s*\{\s*await apiOpenExternalUrl\(updateInfo\.release_url\);\s*\}\s*catch\s*\(e\)\s*\{\s*showToast\(`링크를 열지 못했습니다:/,
  );
  assert.match(
    app,
    /apiOpenExternalUrl\(updateInfo\.release_url\)\.catch\(\(e\)\s*=>\s*showToast\(`링크를 열지 못했습니다:/,
  );
  assert.doesNotMatch(app, /onClick=\{\(\)\s*=>\s*apiOpenExternalUrl\(updateInfo\.release_url\)\}/);
});

test("T1793752130651_4: 여러 줄(isWrapped) URL은 논리 줄 결합 + at(offset) 범위", () => {
  const src = read("src/components/TerminalPane.tsx");
  const providerAt = src.indexOf("term.registerLinkProvider");
  const block = src.slice(providerAt, src.indexOf("termRef.current = term", providerAt));
  assert.ok(block.length > 0, "link provider block missing");
  assert.match(block, /isWrapped/);
  assert.match(block, /getCell\(x\)/);
  assert.match(block, /getWidth\(\) === 0\) continue/);
  assert.match(block, /cellOf\.push\(\(r - first\) \* cols \+ x\)/);
  assert.match(block, /const at = \(o: number\) =>/);
  assert.match(block, /\/gi\)\]/);
  assert.match(block, /range:\s*\{\s*start:\s*at\(m\.index/);
  // 와이드 문자(한글/이모지)는 버퍼 셀(getWidth) 기준 문자열→셀 오프셋 표로 보정(T1793752130651_9)
  assert.doesNotMatch(block, /translateToString/);
});

test("T1793752130651_4: 거부 URL이 TerminalPane에서 window.open으로 재시도되지 않는다", () => {
  const src = read("src/components/TerminalPane.tsx");
  assert.doesNotMatch(src, /window\.open/);
  assert.match(src, /apiOpenExternalUrl\(uri\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  assert.match(src, /apiOpenExternalUrl\(m\[0\]\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
});

/** TerminalPane cellOf 표와 동일: getWidth()>0 셀만, ch.length(UTF-16)만큼 같은 열 오프셋 push */
function mapCells(cells, cols) {
  let text = "";
  const cellOf = [];
  let x = 0;
  for (const { ch, w } of cells) {
    text += ch;
    for (let k = 0; k < ch.length; k++) cellOf.push(x);
    x += w;
  }
  const at = (o) => {
    const c = cellOf[o] ?? 0;
    return { x: (c % cols) + 1, y: Math.floor(c / cols) + 1 };
  };
  return { text, cellOf, at };
}

test("T1793752130651_10: 한글·이모지 접두 시 클릭 범위가 URL 셀과 일치, ASCII 회귀 0", () => {
  const cols = 40;
  const re = extractPlainUrlRegex(read("src/components/TerminalPane.tsx"));
  const asciiCells = [..."see https://ex.com"].map((ch) => ({ ch, w: 1 }));
  const hangulCells = [{ ch: "한", w: 2 }, { ch: "글", w: 2 }, { ch: " ", w: 1 }, ...[..."https://ex.com"].map((ch) => ({ ch, w: 1 }))];
  const emojiCells = [{ ch: "😀", w: 2 }, { ch: " ", w: 1 }, ...[..."https://ex.com"].map((ch) => ({ ch, w: 1 }))];

  for (const [label, cells, expectStartX] of [
    ["ascii", asciiCells, 5], // "see " = 4 → URL at col 5
    ["hangul", hangulCells, 6], // 2+2+1 → URL at col 6
    ["emoji", emojiCells, 4], // 😀 width2 + space → URL at col 4
  ]) {
    const { text, at, cellOf } = mapCells(cells, cols);
    assert.equal(cellOf.length, text.length, label);
    const m = [...text.matchAll(re)][0];
    assert.ok(m, `${label} must match URL in ${JSON.stringify(text)}`);
    assert.equal(at(m.index).x, expectStartX, `${label} start col`);
    assert.equal(at(m.index + m[0].length - 1).x, expectStartX + m[0].length - 1, `${label} end col`);
  }
});

test("T1793752130651_10: /gi 대문자 스킴이 file/javascript/ftp 차단을 약화하지 않음 + 단언 강도 유지", () => {
  const src = read("src/components/TerminalPane.tsx");
  const re = extractPlainUrlRegex(src);
  assert.match(src, /\/gi\)\]/); // Pixel 갱신: case-insensitive plain URL
  for (const bad of ["file:///C:/x", "FILE://x", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "ftp://ex.com", "data:text/html,x"]) {
    assert.equal([...bad.matchAll(re)][0] ?? null, null, bad);
  }
  assert.equal([...("HTTPS://EX.COM/X").matchAll(re)][0]?.[0], "HTTPS://EX.COM/X");
  // 기존 보안 단언이 빠지지 않았는지(약화 방지)
  assert.match(src, /allowNonHttpProtocols:\s*false/);
  assert.ok(src.includes("/^https?:\\/\\//i.test(uri)"));
  const rust = read("src-tauri/src/main.rs");
  assert.match(rust, /matches!\(parsed\.scheme\(\),\s*"http"\s*\|\s*"https"\)/);
});
