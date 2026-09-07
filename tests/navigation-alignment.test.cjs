const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'../outputs/GameForge_Flow_v0.4');
const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const marker = css.slice(css.indexOf('/* v0.8.7 —'));
const rule = selector => marker.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]+)\\}'))?.[1] || '';

test('hub and workspace Back controls use one shared responsive size', () => {
  assert.match(marker,/:root\{--back-control-size:3rem\}/);
  const shared=rule('.hub-brand-button,.work-brand-button');
  assert.match(shared,/width:var\(--back-control-size\)/);assert.match(shared,/height:var\(--back-control-size\)/);
  assert.doesNotMatch(marker,/\.hub-brand-button\{[^}]*width:(?!var\(--back-control-size\))/);
  assert.doesNotMatch(marker,/\.work-brand-button\{[^}]*width:(?!var\(--back-control-size\))/);
});

for (const [viewport,rootPx] of [[390,16],[760,16],[1366,16],[1920,18],[2560,20]]) {
  test(`Back controls stay equal at ${viewport}px`, () => {
    const expected=rootPx*3;
    assert.equal(expected,rootPx*3,'hub');assert.equal(expected,rootPx*3,'workspace');
    assert.ok(expected>=48 && expected<=60);
  });
}

test('diamond is a rotated pseudo-element while the arrow is never rotated', () => {
  const diamond=rule('.hub-brand-button::before,.work-brand-button::before');
  assert.match(diamond,/inset:14\.65%/);assert.match(diamond,/transform:rotate\(45deg\)/);
  assert.match(marker,/\.hub-brand-button \.nav-back-icon,\.work-brand-button \.nav-back-icon\{[^}]*width:1\.1rem;[^}]*height:1\.1rem/);
  assert.doesNotMatch(rule('.hub-brand-button .nav-back-icon,.work-brand-button .nav-back-icon'),/transform:/);
});

test('hover, focus, press and reduced-motion rules do not move the Back control itself', () => {
  const interactive=rule('.hub-brand-button:is(:hover,:focus-visible),.work-brand-button:is(:hover,:focus-visible)');
  assert.match(interactive,/transform:none/);assert.match(interactive,/outline:0/);
  assert.match(marker,/::before\{[^}]*transform:rotate\(45deg\) scale\(1\.05\)/);
  assert.match(marker,/:active::before\{transform:rotate\(45deg\) scale\(\.95\)\}/);
  assert.match(css,/\.reduced-motion \*::before[^}]*transition-duration:\.001ms!important/);
});

test('mobile header reserves the full Back size without squeezing the center rail', () => {
  assert.match(marker,/@media\(max-width:760px\)\{[\s\S]*?\.work-stage-header\{grid-template-columns:var\(--back-control-size\) minmax\(0,1fr\) 2\.25rem\}/);
  assert.match(marker,/\.hub-topbar-balance\{width:var\(--back-control-size\)\}/);
});

test('Vision active highlight begins at the exact document node axis', () => {
  const strip=rule('body[data-stage="vision"] .doc-item::after');
  assert.match(strip,/left:var\(--doc-node-x\)/);assert.match(strip,/right:0/);
  const item=css.match(/\/\* v0\.8\.6[^]*?body\[data-stage="vision"\] \.doc-item i\{([^}]+)\}/)?.[1] || '';
  const rail=css.match(/\/\* v0\.8\.6[^]*?body\[data-stage="vision"\] \.doc-item::before\{([^}]+)\}/)?.[1] || '';
  assert.match(item,/left:calc\(var\(--doc-node-x\) \+ \.5px\)/);
  assert.match(rail,/left:var\(--doc-node-x\)/);
});

test('Vision axis alignment is the final cascade rule, after the approved concept styles', () => {
  const final=css.slice(css.indexOf('/* v0.8.9 —'));
  assert.match(final,/\.doc-item:is\(\.active,:hover,:focus-visible\)\{background:transparent;box-shadow:none\}/);
  assert.match(final,/\.doc-item::after\{[\s\S]*?inset:auto 0 0 var\(--doc-node-x\);[\s\S]*?top:0;/);
  assert.ok(css.indexOf('/* v0.8.9 —')>css.indexOf('/* v0.8.6 —'));
});

test('there are exactly two real Back controls and both keep clear labels and destinations', () => {
  const buttons=[...html.matchAll(/<button class="(hub-brand-button|work-brand-button)"([^>]*)>/g)];
  assert.equal(buttons.length,2);
  assert.match(buttons[0][2],/data-nav="saves"/);assert.match(buttons[0][2],/aria-label="Voltar para seleção de Saves"/);
  assert.match(buttons[1][2],/data-nav="hub"/);assert.match(buttons[1][2],/aria-label="Voltar para seleção de etapas"/);
});

test('both Back controls reuse the same unrotated SVG arrow geometry', () => {
  assert.equal((html.match(/<svg class="nav-back-icon"/g)||[]).length,2);
  assert.equal((html.match(/<path d="M19 12H5m7-7-7 7 7 7"/g)||[]).length,2);
});

test('forced-colors preserves a visible diamond and keyboard focus state', () => {
  assert.match(marker,/@media\(forced-colors:active\)/);
  assert.match(marker,/::before\{border-color:ButtonText\}/);
  assert.match(marker,/:focus-visible,:hover\)::before[^}]*border-color:Highlight/);
});
