import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { renderMarkdown, htmlToMarkdown } from '../outputs/GameForge_Flow_v0.4/src/markdown.js';
import { createProject, sourceState, categoryLabel, productionContent, productionTitle } from '../outputs/GameForge_Flow_v0.4/src/domain.js';

test('Markdown renders headings, emphasis, lists, tables and read-only checklists', () => {
  const result = renderMarkdown('# IA de patrulha\n\n**Inimigos** com *investigação*.\n\n- Rota\n- Retorno\n\n- [x] Protótipo\n- [ ] Testes\n\n| Estado | Duração |\n| --- | --- |\n| Alerta | 5s |');
  for (const tag of ['h1', 'strong', 'em', 'ul', 'table', 'thead', 'tbody']) assert.ok(result.includes(`<${tag}>`));
  assert.match(result, /type="checkbox" disabled checked/);
  assert.doesNotMatch(result, /\*\*Inimigos\*\*/);
});

test('inline and fenced code stay literal; URL underscores do not become emphasis', () => {
  const result = renderMarkdown('`**literal** <script>` e **texto `x_y` forte**\n\n[rota](https://example.test/a_b_c)\n\n```js\nconst value = "**literal**";\n```');
  assert.ok(result.includes('<code>**literal** &lt;script&gt;</code>'));
  assert.ok(result.includes('<strong>texto <code>x_y</code> forte</strong>'));
  assert.ok(result.includes('href="https://example.test/a_b_c"'));
  assert.ok(result.includes('<pre><code>const value = &quot;**literal**&quot;;</code></pre>'));
  assert.equal(renderMarkdown('\\*literal\\*'), '<p>*literal*</p>');
});

test('raw HTML and unsafe URLs cannot become executable elements or attributes', () => {
  const result = renderMarkdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n![**x**](https://example.test/a_b_c.png)\n\n[quote](https://example.test/\"x)');
  assert.ok(result.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.doesNotMatch(result, /href="javascript:|<img src=x|<script/);
  assert.ok(result.includes('alt="**x**"'));
  assert.ok(result.includes('src="https://example.test/a_b_c.png"'));
  assert.ok(result.includes('href="https://example.test/&quot;x"'));
});

function productionFixture() {
  const project = createProject('Markdown QA', false);
  const source = fs.readFileSync(new URL('../outputs/GameForge_Flow_v0.4/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    loadWorkspace: () => ({projects: [project], activeProjectId: project.id}),
    Collaboration: class {}, renderMarkdown, sourceState, categoryLabel, productionContent
  });
  vm.runInContext(source.replace(/^import\s+[\s\S]*?from\s+"[^"]+";\s*/gm, '').replace(/boot\(\);\s*$/, '') + '\nglobalThis.testUI = { renderProductionCard, state };', context);
  return {project, ...context.testUI};
}

test('actual Production card renders Markdown without changing the stored source', () => {
  const f = productionFixture();
  const item = {id:'demand-qa', priority:'normal', category:'code', text:'## Patrulha **inimiga**', description:'- Investigar\n- Retornar\n\n> Não atacar fora da rota', status:'ready'};
  const before = JSON.stringify(item);
  f.state.activeProductionId = item.id;
  const result = f.renderProductionCard(item);
  assert.match(result, /class="demand-title markdown-content"><h2>Patrulha <strong>inimiga<\/strong><\/h2>/);
  assert.match(result, /class="production-demand-description markdown-content"><ul><li>Investigar<\/li>/);
  assert.match(result, /<blockquote>Não atacar fora da rota<\/blockquote>/);
  assert.match(result, /data-edit-production="demand-qa"/);
  assert.match(result, /data-send-execution="demand-qa"/);
  assert.equal(JSON.stringify(item), before);
  f.state.activeProductionId = null;
  assert.doesNotMatch(f.renderProductionCard(item), /production-demand-description/);
});

test('card interactions leave links, code selection and already expanded content alone', () => {
  const source = fs.readFileSync(new URL('../outputs/GameForge_Flow_v0.4/app.js', import.meta.url), 'utf8');
  assert.match(source, /if \(event\.target\.closest\("button, a, input, pre, code"\) \|\| state\.activeProductionId === card\.dataset\.id\) return/);
});

test('legacy multiline titles become concise headings without truncating original content or notes', () => {
  const excerpt = '### Level 0\r\n\r\n- [ ] Câmara embrionária\r\n- [x] Sala de religar sistemas\r\n';
  const item = {text:excerpt,description:'Notas adicionais **importantes**',sourceDocumentId:'doc'};
  const before = JSON.stringify(item);
  const content = productionContent(item);
  assert.equal(content.text, 'Level 0');
  assert.equal(content.description, excerpt + '\n\nNotas adicionais **importantes**');
  assert.equal(JSON.stringify(item), before);
  assert.deepEqual(productionContent({...item,...content}), content);
  const card = productionFixture(); card.state.activeProductionId = 'legacy';
  const markup = card.renderProductionCard({...item,id:'legacy',priority:'normal',category:'code'});
  assert.ok(markup.includes('demand-title markdown-content"><p>Level 0</p>'));
  assert.ok(markup.includes('production-demand-description markdown-content"><h3>Level 0</h3>'));
  assert.ok(markup.includes('Câmara embrionária'));
});

test('short manually authored titles and existing descriptions are not reinterpreted', () => {
  const manual = {text:'Patrulha inimiga',description:''};
  assert.deepEqual(productionContent(manual), manual);
  const existing = {text:'## Patrulha **inimiga**',description:'Descrição já separada',sourceDocumentId:'doc'};
  assert.deepEqual(productionContent(existing), {text:existing.text,description:existing.description});
  const shortExcerpt = {text:'Investigar ruídos',description:'',sourceDocumentId:'doc'};
  assert.equal(productionContent(shortExcerpt).description, 'Investigar ruídos');
  assert.equal(productionContent({...shortExcerpt,contentLayout:'title-description'}).description, '');
});

test('derived title is bounded, while the full original Markdown remains available', () => {
  const text = '## **[Level 0](https://example.test)**';
  assert.equal(productionTitle(text), 'Level 0');
  const long = 'Texto extenso '.repeat(40);
  const content = productionContent({text:long,description:''});
  assert.ok(Array.from(content.text).length <= 100);
  assert.equal(content.description, long);
  assert.equal(productionTitle(''), 'Nova demanda');
});

// Minimal element tree tests the real serializer independently of layout/browser APIs.
function element(tag, children = [], attributes = {}) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: children.map(child => typeof child === 'string' ? {nodeType:3,textContent:child} : child),
    get textContent() { return this.childNodes.map(child => child.textContent).join(''); },
    get children() { return this.childNodes.filter(child => child.nodeType === 1); },
    getAttribute(name) { return attributes[name] || null; },
    querySelector() { return null; },
    querySelectorAll(selector) { return selector.includes('thead') ? this.children.flatMap(section => section.children) : []; }
  };
  node.childNodes.forEach(child => child.parentElement = node);
  return node;
}

test('visual editing preserves code literals, escaped punctuation and inline table formatting', () => {
  globalThis.Node = {TEXT_NODE:3, ELEMENT_NODE:1};
  try {
    const root = element('article', [
      element('h2', ['Comportamento']),
      element('p', ['*literal* e ', element('strong', ['importante']), ' com ', element('code', ['x_y **literal**'])]),
      element('blockquote', [element('em', ['Investigar'])]),
      element('pre', [element('code', ['const literal = "**abc**";'])]),
      element('table', [element('thead', [element('tr', [element('th', ['Estado'])])]), element('tbody', [element('tr', [element('td', [element('strong', ['Alerta']), ' e ', element('code', ['x_y'])])])])])
    ]);
    const markdown = htmlToMarkdown(root, {preserveFormatting:true});
    assert.ok(markdown.includes('\\*literal\\* e **importante**'));
    assert.ok(markdown.includes('`x_y **literal**`'));
    assert.ok(markdown.includes('> *Investigar*'));
    assert.ok(markdown.includes('```\nconst literal = "**abc**";\n```'));
    assert.ok(markdown.includes('| **Alerta** e `x_y` |'));
    const rendered = renderMarkdown(markdown);
    assert.ok(rendered.includes('<p>*literal* e <strong>importante</strong>'));
    assert.ok(rendered.includes('<td><strong>Alerta</strong> e <code>x_y</code></td>'));
  } finally { delete globalThis.Node; }
});

test('plain pasted HTML remains text when the visual draft is serialized and rendered', () => {
  globalThis.Node = {TEXT_NODE:3, ELEMENT_NODE:1};
  try {
    const root = element('article', [element('p', ['<img src=x onerror=alert(1)> [fake](javascript:alert(1))'])]);
    const rendered = renderMarkdown(htmlToMarkdown(root, {preserveFormatting:true}));
    assert.ok(rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.doesNotMatch(rendered, /<img|href="javascript:/);
  } finally { delete globalThis.Node; }
});
