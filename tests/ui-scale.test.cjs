const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../outputs/GameForge_Flow_v0.4/styles.css'), 'utf8');
const scale = css.slice(css.indexOf('/* Readable UI scale:'));

// Source-level design contracts only. These do not replace browser layout QA.
test('fluid type has readable rem floors, bounded desktop growth and respects larger default fonts', () => {
  const match = scale.match(/font-size:clamp\(([\d.]+)rem,calc\(([\d.]+)rem \+ ([\d.]+)vw\),([\d.]+)rem\)/);
  assert.ok(match, 'The root scale must keep relative lower and upper bounds');
  const [, lower, offset, viewport, upper] = match.map(Number);
  const root = (width, defaultFont = 16) => Math.max(lower * defaultFont, Math.min(offset * defaultFont + viewport * width / 100, upper * defaultFont));
  const token = name => Number(scale.match(new RegExp('--ui-' + name + ':([\\d.]+)rem'))[1]);
  for (const width of [320, 390, 768, 1366, 1920, 2560, 3840]) {
    assert.ok(root(width) * token('label') >= 12);
    assert.ok(root(width) * token('body') >= 15);
    assert.ok(root(width) * token('title') >= 16);
    assert.ok(root(width) <= 20);
    assert.ok(root(width, 24) >= 24, 'Do not cancel the user default font size');
  }
  assert.equal(root(2560), 20);
  assert.ok(root(1920) > root(1366));
  assert.doesNotMatch(scale, /(?:^|[;{])\s*zoom\s*:/);
});

test('boards preserve card widths, wrapping, and reachable columns instead of shrinking type', () => {
  assert.match(scale, /\.production-board\{[^}]*minmax\(20rem,1fr\)[^}]*overflow-x:auto/);
  assert.match(scale, /\.execution-board\{[^}]*minmax\(15rem,1fr\)[^}]*overflow-x:auto/);
  assert.match(scale, /\.production-demand-line \.demand-title\{[^}]*font-size:var\(--ui-title\)[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
  assert.match(scale, /\.execution-mission strong\{[^}]*font-size:var\(--ui-title\)[^}]*overflow-wrap:anywhere/);
  assert.match(scale, /\.production-demand-detail button\{[^}]*min-height:2\.75rem[^}]*height:auto/);
  assert.match(scale, /\.production-filter:nth-of-type\(n\+6\)\{display:block\}/);
});

test('compact screens keep departments and task details accessible, with no smaller type tokens', () => {
  const compact = scale.slice(scale.indexOf('@media(max-width:1200px)'));
  assert.match(compact, /\.execution-layout\{[^}]*grid-template-rows:auto minmax\(26rem,1fr\) auto[^}]*overflow-y:auto/);
  assert.match(compact, /\.department-list\{display:flex;[^}]*overflow-x:auto/);
  assert.match(compact, /\.task-detail-panel\{display:flex/);
  assert.doesNotMatch(compact, /--ui-(?:label|small|body|title)\s*:/);
  assert.match(compact, /\.doc-strip\{display:flex/);
});
