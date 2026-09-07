const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../outputs/GameForge_Flow_v0.4');
const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
const shared = css.slice(css.indexOf('/* v0.8.4 — shared jade lighting.'), css.indexOf('/* v0.8.6 — Vision:'));

test('all stages reuse the approved navigation light without stage-specific geometry', () => {
  assert.match(css,/body\[data-stage\] \.work-stage-rail button\.active\{/);
  assert.match(css,/body\[data-stage\] \.work-stage-link b\.active\{/);
  assert.doesNotMatch(css,/body\[data-stage="production"\] \.work-stage-rail button/);
  for (const surface of ['#saveScreen','#hubScreen','#visionPanel','#executionPanel']) assert.ok(shared.includes(surface));
});

test('lighting is paint-only and does not add animation, hit targets, or editor markup', () => {
  assert.doesNotMatch(shared, /(?:animation|transition|transform|font-size|padding|margin|width|height)\s*:/);
  assert.doesNotMatch(shared, /content\s*:/);
  assert.match(shared, /#saveScreen \.save-list\{mask-image:linear-gradient/);
  assert.match(shared, /#saveScreen \.fade-mask\{background:none\}/);
  assert.match(shared, /::selection\{background:#245c52;color:#f0fff8;text-shadow:none\}/);
});

test('all modal variants, selected execution cards and team controls share lighting', () => {
  assert.match(shared, /\.modal\.system-modal,\.modal\.save-create-modal,\.modal\.system-modal\.production-editor-modal,\.pause-card,\.context-menu\{\s*background:var\(--light-panel\)/);
  assert.match(shared, /\.execution-mission\.selected\{[^}]*box-shadow:var\(--light-rim\)/);
  assert.match(shared, /\.execution-lane:has\(\.execution-mission\.selected\) \.execution-lane-head i\{[^}]*box-shadow:var\(--light-node\)/);
  assert.match(shared, /\.team-check input\[type="checkbox"\]:checked/);
  assert.match(shared, /:not\(:disabled\):not\(\.danger\)/);
  assert.match(shared, /@media\(forced-colors:active\)/);
});
