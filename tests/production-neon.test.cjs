const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../outputs/GameForge_Flow_v0.4');
const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const neon = css.slice(css.indexOf('/* v0.8.3 — approved jade-light concept.'));

test('ambient light follows a bounded production lane and cannot intercept controls', () => {
  assert.match(neon, /#productionPanel\{[^}]*isolation:isolate/);
  assert.match(neon, /#productionPanel::before\{[^}]*left:var\(--production-focus-x,50%\)[^}]*radial-gradient[^}]*pointer-events:none/);
  assert.match(neon, /#productionPanel>\.production-toolbar,[^{]+\{position:relative;z-index:1\}/);
  assert.match(app, /focusItem \? lanes\.findIndex\(lane => lane\.statuses\.includes\(focusItem\.status\)\) : 1/);
  assert.match(app, /Math\.max\(0, focusLane\) \+ \.5/);
});

test('neon ornaments retain their complete frame and support both reduced-motion preferences', () => {
  assert.match(app, /class="demand-card-rule" aria-hidden="true"/);
  assert.match(neon, /\.demand-card-rule\{[^}]*overflow:visible;pointer-events:none;opacity:1/);
  assert.match(neon, /\.demand-card-rule circle\{[^}]*opacity:1/);
  assert.match(neon, /\.reduced-motion #productionPanel::before/);
  assert.match(neon, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(neon, /infinite/);
});

test('hover adds light without geometry changes and surfaces do not use the raster concept as a backdrop', () => {
  assert.match(neon, /#productionPanel \.production-demand:hover\{[^}]*box-shadow:/);
  assert.doesNotMatch(neon, /#productionPanel \.production-demand:hover\{[^}]*(?:transform|padding|width|height):/);
  assert.match(neon, /\.production-demand-actions button:focus-visible\{outline:2px/);
  assert.doesNotMatch(neon, /(?:\.png|\.jpe?g|\.webp|generated_images)/);
});
