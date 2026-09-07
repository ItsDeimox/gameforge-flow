const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '../outputs/GameForge_Flow_v0.4');
const source = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');
const domain = vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'src/domain.js'), 'utf8').replace(/^export /gm, '') + '\n({productionTitle, productionContent, createVisionHandoff, DOC_STATUSES, CATEGORIES, PRIORITIES, statusLabel, saveMember})');

// Lightweight unit fixture: no browser, layout engine or real saved projects.
function fixture({ reducedMotion = false, systemReducedMotion = false } = {}) {
  const nodes = new Map();
  const animations = [];
  const dynamic = [];
  const closeButtons = [];
  const timers = [];
  const windowListeners = new Map();
  let document;
  function node(className = '') {
    let classes = new Set(className.split(/\s+/).filter(Boolean));
    let markup = '';
    const listeners = new Map();
    return {
      isConnected: true, children: [], dataset: {}, style: { setProperty(key, value) { this[key] = value; } },
      value: '', disabled: false, checked: false, inert: false, textContent: '',
      get className() { return [...classes].join(' '); },
      set className(value) { classes = new Set(value.split(/\s+/).filter(Boolean)); },
      classList: {
        contains(value) { return classes.has(value); },
        add(...values) { values.forEach(value => classes.add(value)); }, remove(...values) { values.forEach(value => classes.delete(value)); },
        toggle(value, force) { if (force ?? !classes.has(value)) classes.add(value); else classes.delete(value); }
      },
      htmlWrites: 0,
      set innerHTML(value) { this.htmlWrites++; markup = value; if (this === nodes.get('#modalContent')) parseModal(value); },
      get innerHTML() { return markup; },
      focus() { document.activeElement = this; },
      closest() { return null; }, getClientRects() { return [{}]; },
      getBoundingClientRect() {
        if (this.testRect) return this.testRect;
        if (this === nodes.get('#modalBackdrop')) return {left:0,top:this.classList.contains('editor-focus-backdrop') ? 90 : 0,width:1440,height:900};
        return this.classList.contains('editor-fullscreen') ? {left:0,top:90,width:1440,height:810} : {left:86,top:112,width:1268,height:760};
      },
      setAttribute(key, value) { this[key] = value; },
      appendChild(child) { this.children.push(child); },
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
      dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); this['on' + event.type]?.(event); },
      click() { this.onclick?.({target:this}); }, scrollHeight: 40, selectionStart:0, selectionEnd:0,
      animate(frames, options) { const animation = {target:this,frames,options,cancelled:false,cancel(){this.cancelled=true;},finish(){if(!this.cancelled)this.onfinish?.();}}; animations.push(animation); return animation; },
      setRangeText(text, start, end) { this.value = this.value.slice(0,start) + text + this.value.slice(end); this.selectionStart = this.selectionEnd = start + text.length; },
      querySelectorAll() { return this === nodes.get('#modal') ? [nodes.get('#modalClose'), ...dynamic.filter(item => item.control && !item.disabled)] : [nodes.get('#pauseClose'), nodes.get('[data-pause-action="resume"]')]; }
    };
  }
  function parseModal(markup) {
    dynamic.forEach(item => { item.isConnected = false; if (item.selector) nodes.delete(item.selector); });
    dynamic.length = 0; closeButtons.length = 0;
    for (const match of markup.matchAll(/<(input|button|select|textarea|h3|output|label|small|p|article|div|span|summary)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
      const [, tag, attrs] = match;
      const item = node(attrs.match(/class="([^"]*)"/)?.[1] || '');
      const id = attrs.match(/id="([^"]*)"/)?.[1];
      item.control = ['input', 'button', 'select', 'textarea'].includes(tag);
      item.type = attrs.match(/type="([^"]*)"/)?.[1];
      item.name = attrs.match(/name="([^"]*)"/)?.[1];
      item.value = attrs.match(/value="([^"]*)"/)?.[1] || '';
      if (tag === 'textarea') item.value = markup.slice(match.index + match[0].length).split('</textarea>')[0];
      if (tag === 'select') {
        const options = markup.slice(match.index + match[0].length).split('</select>')[0];
        item.value = options.match(/<option value="([^"]*)" selected/)?.[1] || options.match(/<option value="([^"]*)"/)?.[1] || '';
      }
      if (attrs.includes('data-prod-format')) item.dataset.prodFormat = attrs.match(/data-prod-format="([^"]*)"/)[1];
      item.checked = /\bchecked\b/.test(attrs); item.disabled = /\bdisabled\b/.test(attrs);
      if (id) { item.selector = '#' + id; nodes.set(item.selector, item); }
      if (tag === 'h3') nodes.set('#modalContent h3', item);
      if (item.classList.contains('volume-field')) nodes.set('.volume-field', item);
      if (item.classList.contains('demand-priority-field')) nodes.set('.demand-priority-field', item);
      if (/data-close/.test(attrs)) closeButtons.push(item);
      dynamic.push(item);
    }
  }
  for (const [, id, attrs] of html.matchAll(/\bid="([^"]+)"([^>]*)>/g)) {
    nodes.set('#' + id, node(attrs.match(/class="([^"]*)"/)?.[1] || ''));
  }
  nodes.set('[data-pause-action="resume"]', node());
  for (const selector of ['#visionPanel .editor-surface','#visionPanel .vision-title-rule','#visionPanel .vision-title-rule circle']) nodes.set(selector, node());
  const motionNodes = new Map(['.demand-editor-shell','.demand-writing-surface','.demand-title-rule path','.demand-title-rule i','.demand-title-rule circle'].map(selector => [selector, Array.from({length: / path$| i$/.test(selector) ? 2 : 1}, () => node())]));
  const opener = node();
  const stageButtons = ['vision', 'production', 'execution'].map(stage => { const item = node(); item.dataset.workStage = stage; return item; });
  const stageNodes = ['vision', 'production', 'production', 'execution'].map(stage => { const item = node(); item.dataset.stageNode = stage; return item; });
  document = {
    activeElement: opener, documentElement: node(),
    querySelector(selector) { const result = nodes.get(selector); assert.ok(result, 'Unknown test selector: ' + selector); return result; },
    querySelectorAll(selector) {
      if (motionNodes.has(selector)) return motionNodes.get(selector);
      if (selector === '[data-work-stage]') return stageButtons;
      if (selector === '[data-stage-node]') return stageNodes;
      if (selector === '[data-prod-format]') return dynamic.filter(item => item.dataset.prodFormat);
      if (selector === 'input[name="specialty"]:checked') return dynamic.filter(item => item.name === 'specialty' && item.checked);
      return selector === '[data-close]' ? closeButtons : [];
    },
    createElement() { return node(); }, addEventListener() {}, removeEventListener() {}
  };
  document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  const project = {
    id: 'test-save', name: 'Projeto de teste', settings: { sound: true, volume: .65, reducedMotion: false },
    members: [{ id: 'member', name: 'Ana <dev>', role: 'Design & direção', specialties: ['design'], permissions: ['vision', 'production', 'execution'] }],
    history: [], docs: [{ id: 'doc', title: 'Visão', status: 'canon', revision: 1 }], production: [], execution: []
  };
  let persisted;
  const context = vm.createContext({
    Collaboration: class { active = false; admin = true; },
    eligibleMembers: () => [], categoryLabel: value => value || 'Design',
    sourceState: () => 'manual', assignMember: (project, item, selected) => { item.assigneeId = selected; item.assignee = selected || 'Não atribuído'; },
    document, window: {addEventListener(type, fn) { windowListeners.set(type, fn); }, removeEventListener(type) { windowListeners.delete(type); }, matchMedia: () => ({matches:systemReducedMotion})}, navigator: { onLine: true }, console,
    renderMarkdown: value => '<p>' + value + '</p>', htmlToMarkdown: element => element.innerHTML,
    productionTitle: domain.productionTitle, productionContent: domain.productionContent,
    createVisionHandoff: domain.createVisionHandoff, DOC_STATUSES: domain.DOC_STATUSES, statusLabel: domain.statusLabel,
    saveMember: domain.saveMember,
    loadWorkspace: () => ({ projects: [project], activeProjectId: project.id, selectedProjectId: project.id }),
    saveWorkspace: value => { persisted = JSON.parse(JSON.stringify(value)); },
    requestAnimationFrame: callback => callback(), setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout() {}, addHistory: (target, type, message) => target.history.push({ type, message }),
    CATEGORIES: domain.CATEGORIES, PROD_COLUMNS: [['inbox', 'Backlog']], EXEC_COLUMNS: [['todo', 'A fazer']],
    PRIORITIES: domain.PRIORITIES, STAGES: ['vision', 'production', 'execution'],
    productionItem: (project, partial = {}) => ({ id: 'demand', text: '', category: 'design', priority: 'normal', status: 'inbox', ...partial }),
    task: (project, partial = {}) => ({ id: 'task', text: '', category: 'design', priority: 'normal', status: 'todo', ...partial }),
    downloadProject() {}, uid: () => 'new-id', now: () => '2026-09-02T12:00:00.000Z'
  });
  vm.runInContext(source.replace(/^import\s+[\s\S]*?from\s+"[^"]+";\s*/gm, '').replace(/boot\(\);\s*$/, '') + '\nglobalThis.ui = { openModal, closeModal, handleModalBackdropClick, openTeam, editMember, openSettings, openHistory, pauseMenu, resumeMenu, handleKeydown, editProductionCard, editTask, sendSelectionToProduction, sendProductionToExecution, schedulePersist, updateStageRail, bindSectionActions, renderVision, setEditorMode, newDocument, paintDocumentStatus, state };', context);
  return { ...context.ui, project, nodes, document, opener, stageButtons, stageNodes, animations, windowListeners, get persisted() { return persisted; } };
}

test('Vision document transition runs once per document, not on render or editor-mode changes', () => {
  const f = fixture();f.project.docs[0].markdown='# Visão\n\nTexto original';f.state.activeDocId='doc';
  f.renderVision();assert.equal(f.animations.length,3);
  assert.equal(f.nodes.get('#docStatusSelect').value,'canon');
  const original=JSON.stringify(f.project.docs);
  f.renderVision();f.setEditorMode('markdown');f.setEditorMode('live');
  assert.equal(f.animations.length,3);assert.equal(JSON.stringify(f.project.docs),original);
  f.project.docs.push({id:'doc2',title:'Personagens',status:'draft',markdown:'## Personagens\n\nNovo texto',revision:1});
  f.state.activeDocId='doc2';f.state.selectionText='Trecho do documento anterior';f.renderVision();
  assert.equal(f.animations.length,6);assert.ok(f.animations.slice(0,3).every(a=>a.cancelled));
  assert.equal(f.nodes.get('#docTitle').value,'Personagens');assert.equal(f.nodes.get('#docStatusSelect').value,'draft');
  assert.match(f.nodes.get('#liveEditor').innerHTML,/Novo texto/);assert.equal(f.state.selectionText,'');
  assert.equal(f.nodes.get('#liveEditor').scrollTop,0);
});
test('new documents retain source content and status while reduced motion skips all Vision animations', () => {
  for (const options of [{reducedMotion:true},{systemReducedMotion:true}]) {
    const f=fixture(options);f.project.docs[0].markdown='Texto existente';f.state.activeDocId='doc';
    f.renderVision();f.newDocument();assert.equal(f.animations.length,0);
    assert.equal(f.project.docs.length,2);assert.equal(f.project.docs[0].markdown,'Texto existente');
    assert.equal(f.nodes.get('#docTitle').value,'Novo documento');assert.equal(f.nodes.get('#docStatusSelect').value,'draft');
    assert.match(f.nodes.get('#docList').innerHTML,/Novo documento/);
  }
});

test('closing a contextual handoff returns keyboard focus to the document, not a hidden popup', () => {
  const f=fixture();f.opener.closest=selector=>selector==='#contextMenu' ? f.nodes.get('#contextMenu') : null;
  f.openModal('<h3>Enviar para Produção</h3><button data-close>Cancelar</button>');
  f.closeModal();assert.equal(f.document.activeElement,f.nodes.get('#liveEditor'));
});

test('back navigation uses accessible arrow buttons with unchanged parent destinations', () => {
  for (const [className, destination, label] of [['hub-brand-button','saves','Saves'],['work-brand-button','hub','etapas']]) {
    const button = html.match(new RegExp('<button class="' + className + '"[^>]*>[\\s\\S]*?</button>'))?.[0];
    assert.ok(button); assert.ok(button.includes('data-nav="' + destination + '"'));
    assert.ok(button.includes('aria-label="Voltar para seleção de ' + label + '"'));
    assert.match(button, /<svg class="nav-back-icon"[^>]*aria-hidden="true"[^>]*focusable="false"/);
    assert.doesNotMatch(button, />GF</);
  }
  assert.match(html, /<div class="brand-mark">GF<\/div>/, 'root screen keeps an honest brand instead of a back button with nowhere to go');
  assert.match(css, /\.nav-back-icon\{[^}]*stroke:currentColor;[^}]*pointer-events:none/);
});

test('generic dialogs adopt the shared style; save dialog keeps its approved theme', () => {
  const f = fixture();
  f.openModal('<h3>Teste</h3><button data-close>Fechar</button>', 'modal-wide');
  assert.ok(f.nodes.get('#modal').classList.contains('system-modal'));
  assert.ok(f.nodes.get('#modal').classList.contains('modal-wide'));
  assert.equal(f.nodes.get('#app').inert, true);
  assert.equal(f.document.activeElement, f.nodes.get('#modalContent h3'));
  f.openModal('<h3>Save</h3>', 'save-create-modal');
  assert.equal(f.nodes.get('#modal').classList.contains('system-modal'), false);
  f.closeModal();
  assert.equal(f.nodes.get('#app').inert, false);
  assert.equal(f.document.activeElement, f.opener);
});

test('modal background click handler never cancels checkbox or label defaults', () => {
  const f = fixture(); f.editMember('member');
  assert.match(source, /\$\("#modalBackdrop"\)\.onclick = handleModalBackdropClick;/);
  for (const target of [f.nodes.get('#specialty-vfx'), f.nodes.get('#memberName'), {tagName:'LABEL'}]) {
    assert.equal(f.handleModalBackdropClick({target}), undefined, 'return false here would undo native checkbox activation');
    assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), false);
  }
  f.handleModalBackdropClick({target:f.nodes.get('#modalBackdrop')});
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
  f.editProductionCard();
  f.handleModalBackdropClick({target:f.nodes.get('#modalBackdrop')});
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), false, 'demand editor keeps its background dismissal guard');
});

test('member specialty editor saves multiple choices and restores them on reopening', () => {
  const f = fixture(); f.editMember('member');
  assert.ok(f.nodes.get('#modal').classList.contains('team-member-modal'));
  for (const [key] of domain.CATEGORIES) {
    const input = f.nodes.get('#specialty-' + key);
    assert.ok(input); assert.equal(input.type, 'checkbox'); assert.equal(input.disabled, false);
    assert.match(f.nodes.get('#modalContent').innerHTML, new RegExp('for="specialty-' + key + '"'));
  }
  assert.equal(f.nodes.get('#specialty-design').checked, true);
  f.nodes.get('#specialty-design').checked = false;
  f.nodes.get('#specialty-vfx').checked = true;
  f.nodes.get('#specialty-code').checked = true;
  // Account for native HTML checkbox activation: a bubbling onclick=false would revert it.
  assert.notEqual(f.handleModalBackdropClick({target:f.nodes.get('#specialty-vfx')}), false);
  f.nodes.get('#memberName').value = 'Ana'; f.nodes.get('#memberRole').value = 'VFX Artist';
  f.nodes.get('#saveMemberBtn').click();
  assert.deepEqual(f.persisted.projects[0].members[0].specialties, ['code','vfx']);
  f.editMember('member');
  assert.equal(f.nodes.get('#specialty-design').checked, false);
  assert.equal(f.nodes.get('#specialty-vfx').checked, true); assert.equal(f.nodes.get('#specialty-code').checked, true);
  f.nodes.get('#specialty-code').checked = false; f.nodes.get('#specialty-vfx').checked = false;
  f.nodes.get('#saveMemberBtn').click();
  assert.deepEqual(f.persisted.projects[0].members[0].specialties, []);
});

test('member draft changes are discarded on Back or Close and validation keeps selected specialties', () => {
  const f = fixture(); f.editMember('member');
  f.nodes.get('#specialty-vfx').checked = true;
  f.nodes.get('#cancelMemberBtn').click();
  assert.deepEqual(f.project.members[0].specialties, ['design']);
  f.editMember('member'); f.nodes.get('#specialty-vfx').checked = true;
  f.closeModal(); assert.deepEqual(f.project.members[0].specialties, ['design']);
  f.editMember(); f.nodes.get('#specialty-vfx').checked = true;
  f.nodes.get('#saveMemberBtn').click();
  assert.match(f.nodes.get('#teamFormError').textContent, /nome/);
  assert.equal(f.nodes.get('#specialty-vfx').checked, true); assert.equal(f.project.members.length, 1);
  f.nodes.get('#memberName').value = 'Bia'; f.nodes.get('#memberRole').value = 'VFX Artist';
  f.nodes.get('#saveMemberBtn').click();
  assert.deepEqual(f.persisted.projects[0].members[1].specialties, ['vfx']);
});

test('team checkboxes have dark unchecked states, a selection mark and keyboard/high-contrast affordances', () => {
  assert.match(css, /\.team-check input\[type="checkbox"\]\{[^}]*appearance:none;[^}]*background:#080f12/s);
  assert.match(css, /\.team-check input\[type="checkbox"\]:checked::after\{opacity:1\}/);
  assert.match(css, /\.team-check input\[type="checkbox"\]:focus-visible\{outline:2px solid/);
  assert.match(css, /@media\(forced-colors:active\)/);
  assert.match(css, /\.team-member-modal \.specialty-picker \.team-check\{[^}]*min-height:2\.75rem/s);
  assert.match(css, /@media\(max-width:400px\)\{\s*\.modal\.team-member-modal \.specialty-picker\{grid-template-columns:1fr\}/);
});

test('demand window expands and restores without recreating fields or changing draft values', () => {
  const f = fixture(); f.editProductionCard();
  const title = f.nodes.get('#prodText'), description = f.nodes.get('#prodDescription');
  title.value = 'IA de patrulha'; description.value = '## Regras\n\n- Investigar\n- Retornar\n';
  f.nodes.get('#prodMarkdownBtn').click();
  f.nodes.get('#prodFullscreenBtn').click();
  assert.ok(f.nodes.get('#modal').classList.contains('editor-fullscreen'), 'target layout is applied before bounds interpolate');
  assert.ok(f.nodes.get('#modal').classList.contains('editor-resizing'));
  f.animations.at(-1).finish();
  assert.ok(f.nodes.get('#modal').classList.contains('editor-fullscreen'));
  assert.equal(f.nodes.get('#prodFullscreenBtn')['aria-pressed'], 'true');
  assert.equal(f.nodes.get('#prodText'), title);
  assert.equal(f.nodes.get('#prodDescription'), description);
  f.handleKeydown({key:'Escape', preventDefault(){}});
  f.animations.at(-1).finish();
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), false);
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), false);
  assert.equal(title.value, 'IA de patrulha');
  assert.equal(description.value, '## Regras\n\n- Investigar\n- Retornar\n');
  f.closeModal(true);
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('production-editor-backdrop'), false);
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('editor-focus-backdrop'), false);
});

test('window expands actual bounds without fading, scaling text or replaying the ornament', () => {
  const f = fixture(); f.editProductionCard();
  const description = f.nodes.get('#prodDescription'); description.value = 'Rascunho preservado';
  const ornament = f.animations.slice(0,5), opening = f.animations[5];
  assert.equal(opening.target, f.nodes.get('#modal'));
  assert.equal(opening.frames[0].opacity, 0); assert.equal(opening.frames.at(-1).opacity, 1);
  f.nodes.get('#prodFullscreenBtn').click();
  const expand = f.animations.at(-1);
  assert.ok(opening.cancelled);
  assert.equal(expand.frames[0].width, '1268px');
  assert.equal(expand.frames[0].left, '86px');
  assert.equal(expand.frames[0].top, '22px', 'start is relative to the fullscreen backdrop');
  assert.equal(expand.frames[1].width, '1440px');
  assert.equal(expand.frames[1].top, '0px');
  assert.ok(expand.frames.every(frame => !('opacity' in frame) && !('transform' in frame)));
  assert.equal(expand.options.fill, 'both');
  expand.finish();
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), true);
  assert.equal(f.nodes.get('#modal').classList.contains('editor-resizing'), false);
  f.nodes.get('#prodFullscreenBtn').click();
  const restore = f.animations.at(-1);
  assert.equal(restore.frames[0].width, '1440px');
  assert.equal(restore.frames[0].top, '90px', 'restore starts in the normal backdrop coordinate system');
  assert.equal(restore.frames[1].width, '1268px');
  assert.equal(restore.frames[1].top, '112px');
  f.animations.at(-1).finish();
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), false);
  assert.equal(f.nodes.get('#prodDescription'), description);
  assert.equal(description.value, 'Rascunho preservado');
  const count = f.animations.length;
  f.nodes.get('#prodMarkdownBtn').click();
  assert.equal(f.animations.length, count);
  assert.ok(ornament.every(animation => !animation.cancelled));
  assert.ok(f.animations.slice(5).every(animation => animation.target === f.nodes.get('#modal')));
  f.closeModal(true);
  assert.ok(f.animations.every(animation => animation.cancelled));
});

test('mode switches reuse unchanged visual content and do not replay any animation', () => {
  const f = fixture(); f.editProductionCard();
  const visual = f.nodes.get('#prodVisualEditor');
  const writes = visual.htmlWrites, count = f.animations.length;
  for (let i = 0; i < 3; i++) { f.nodes.get('#prodMarkdownBtn').click(); f.nodes.get('#prodVisualBtn').click(); }
  assert.equal(visual.htmlWrites, writes); assert.equal(f.animations.length, count);
  f.nodes.get('#prodMarkdownBtn').click(); f.nodes.get('#prodDescription').value = 'Texto alterado'; f.nodes.get('#prodVisualBtn').click();
  assert.equal(visual.htmlWrites, writes + 1);
  assert.ok(visual.innerHTML.includes('Texto alterado'));
  assert.equal(f.animations.length, count);
  f.closeModal(true);
});

test('rapid resize requests and closing mid-expansion cannot change a closed or superseded dialog', () => {
  const f = fixture(); f.editProductionCard();
  f.nodes.get('#prodFullscreenBtn').click();
  const staleCallback = f.animations.at(-1).onfinish;
  f.nodes.get('#prodFullscreenBtn').click();
  staleCallback();
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), false);
  f.animations.at(-1).finish();
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), false);
  f.nodes.get('#prodFullscreenBtn').click();
  const closedCallback = f.animations.at(-1).onfinish;
  f.closeModal(true); const count = f.animations.length;
  closedCallback();
  assert.equal(f.animations.length, count);
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), false);
});

test('reversing a resize begins at the current visible bounds and preserves focus/selection', () => {
  const f = fixture(); f.editProductionCard();
  const description = f.nodes.get('#prodDescription'), modal = f.nodes.get('#modal');
  f.nodes.get('#prodMarkdownBtn').click(); description.selectionStart = 2; description.selectionEnd = 8;
  f.nodes.get('#prodFullscreenBtn').click();
  const interrupted = f.animations.at(-1);
  modal.testRect = {left:30,top:98,width:1380,height:798};
  // Only the initial measurement should see the in-flight frame.
  const measure = modal.getBoundingClientRect.bind(modal);
  modal.getBoundingClientRect = () => { const rect = measure(); delete modal.testRect; return rect; };
  f.nodes.get('#prodFullscreenBtn').click();
  assert.ok(interrupted.cancelled);
  assert.equal(f.animations.at(-1).frames[0].width, '1380px');
  assert.equal(f.animations.at(-1).frames[0].left, '30px');
  assert.equal(f.document.activeElement, description);
  assert.equal(description.selectionStart, 2); assert.equal(description.selectionEnd, 8);
  f.closeModal(true);
});

test('viewport resize releases animated bounds and disposal removes its listener', () => {
  const f = fixture(); f.editProductionCard();
  f.nodes.get('#prodFullscreenBtn').click(); const animation = f.animations.at(-1);
  f.windowListeners.get('resize')();
  assert.ok(animation.cancelled);
  assert.equal(f.nodes.get('#modal').classList.contains('editor-resizing'), false);
  assert.equal(f.nodes.get('#modal').classList.contains('editor-fullscreen'), true);
  f.closeModal(true);
  assert.equal(f.windowListeners.has('resize'), false);
});

test('editor honors both project and operating-system reduced motion preferences', () => {
  for (const options of [{reducedMotion:true},{systemReducedMotion:true}]) {
    const f = fixture(options); f.editProductionCard();
    f.nodes.get('#prodFullscreenBtn').click(); f.nodes.get('#prodMarkdownBtn').click();
    assert.equal(f.animations.length, 0);
    assert.ok(f.nodes.get('#modal').classList.contains('editor-fullscreen'));
    f.closeModal(true);
  }
  assert.match(source, /<path pathLength="100"/);
  assert.doesNotMatch(css, /@keyframes demandVDraw|@keyframes demandNodeWake|@keyframes demandRuleDraw/);
  assert.match(css, /\.reduced-motion \.production-editor-modal \*\{animation:none!important;transition:none!important\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.modal\.system-modal\.production-editor-modal,\.production-editor-modal \*\{animation:none!important/);
});

test('V traces from its deep center to both endpoints, then rails, then the dot', () => {
  const f = fixture(); f.editProductionCard();
  const [left, right, leftRail, rightRail, dot] = f.animations;
  assert.deepEqual(left.frames, right.frames);
  assert.deepEqual(left.options, right.options);
  assert.equal(leftRail.options.delay, left.options.duration);
  assert.equal(rightRail.options.delay, right.options.duration);
  assert.equal(dot.options.delay, leftRail.options.delay + leftRail.options.duration);
  assert.equal(dot.frames[0].opacity, 0);
  assert.equal(dot.options.fill, 'both', 'dot must stay hidden during its delay and visible after completion');
  assert.equal(left.frames[1].strokeDashoffset, 0);
  assert.match(source, /viewBox="0 0 100 40"/);
  assert.match(source, /d="M50 28 L0 4"/);
  assert.match(source, /d="M50 28 L100 4"/);
  assert.match(css, /\.demand-title-rule i\{[^}]*transform-origin:right center/);
  assert.match(css, /\.demand-title-rule i:last-child\{[^}]*transform-origin:left center/);
  assert.match(css, /\.demand-title-rule svg\{[^}]*width:6\.25rem;height:2\.5rem;overflow:visible/);
  f.closeModal(true);
});

test('completed ornament retains visible end frames with matching non-animated CSS fallbacks', () => {
  const f = fixture(); f.editProductionCard();
  const [left, right, leftRail, rightRail, dot] = f.animations;
  for (const animation of [left, right, leftRail, rightRail, dot]) assert.equal(animation.options.fill, 'both');
  for (const path of [left, right]) {
    assert.equal(path.frames.at(-1).strokeDashoffset, 0);
    assert.equal(path.frames.at(-1).strokeDasharray, '100 100');
  }
  for (const rail of [leftRail, rightRail]) assert.equal(rail.frames.at(-1).transform, 'scaleX(1)');
  assert.equal(dot.frames.at(-1).opacity, .8);
  assert.match(css, /\.demand-title-rule i\{[^}]*opacity:1;transform:scaleX\(1\)/);
  assert.match(css, /\.demand-title-rule path\{[^}]*stroke-dasharray:100 100;stroke-dashoffset:0;opacity:1/);
  f.nodes.get('#prodFullscreenBtn').click();
  f.animations.at(-1).finish();
  assert.ok([left, right, leftRail, rightRail, dot].every(animation => !animation.cancelled));
  assert.ok(f.animations.slice(0,5).every(animation => animation.options.fill === 'both'));
  f.closeModal(true);
});

test('demand cancellation protects drafts, discard restores focus and leaves project untouched', () => {
  const f = fixture(); const before = JSON.stringify(f.project);
  f.editProductionCard(); f.nodes.get('#prodDescription').value = 'Não perder este rascunho';
  f.closeModal();
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), false);
  assert.equal(f.nodes.get('#prodConfirmClose').classList.contains('hidden'), false);
  assert.equal(f.document.activeElement, f.nodes.get('#prodKeepEditingBtn'));
  f.nodes.get('#prodKeepEditingBtn').click();
  assert.equal(f.nodes.get('#prodConfirmClose').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('#prodDescription').value, 'Não perder este rascunho');
  f.closeModal(); f.nodes.get('#prodDiscardBtn').click();
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
  assert.equal(f.document.activeElement, f.opener);
  assert.equal(JSON.stringify(f.project), before);
});

test('inspecting the visual mode or maximizing does not rewrite Markdown', () => {
  const f = fixture(); f.editProductionCard();
  const markdown = f.nodes.get('#prodDescription');
  const source = '### Título\n\n```js\nconst x = "literal";\n```\n\n| Coluna |\n| --- |\n| **Dado** |\n';
  markdown.value = source;
  f.nodes.get('#prodMarkdownBtn').click(); f.nodes.get('#prodVisualBtn').click();
  f.nodes.get('#prodFullscreenBtn').click(); f.nodes.get('#prodMarkdownBtn').click();
  assert.equal(markdown.value, source);
  f.closeModal(true);
});

test('Markdown toolbar preserves selection and applies formatting to the whole line', () => {
  const f = fixture(); f.editProductionCard(); f.nodes.get('#prodMarkdownBtn').click();
  const markdown = f.nodes.get('#prodDescription');
  markdown.value = 'Patrulha\nRetorno'; markdown.selectionStart = 0; markdown.selectionEnd = 8;
  const buttons = f.document.querySelectorAll('[data-prod-format]');
  buttons.find(button => button.dataset.prodFormat === '**').click();
  assert.equal(markdown.value, '**Patrulha**\nRetorno');
  markdown.selectionStart = 3; markdown.selectionEnd = 5;
  buttons.find(button => button.dataset.prodFormat === '## ').click();
  assert.equal(markdown.value, '## **Patrulha**\nRetorno');
  f.closeModal(true);
});

test('demand editor style reserves the header, scrolls long content and uses responsive sizing', () => {
  assert.match(css, /\.modal-backdrop\.editor-focus-backdrop\{inset:var\(--work-header-height\) 0 0/);
  assert.match(css, /grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.demand-editor-body\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /\.demand-writing\{min-height:24rem;flex-shrink:0\}/);
  assert.match(css, /\.production-editor-modal #prodDescription\{[\s\S]*?font:\.9375rem\/1\.9/);
  assert.match(source, /if \(event\.target === \$\("#modalBackdrop"\) && !productionEditor\) closeModal\(\);/);
});

test('legacy Vision excerpt opens below the title and remains unchanged until saved', () => {
  const f = fixture();
  const excerpt = '### Level 0\n\n- [ ] Câmara embrionária\n- [ ] Saída / elevador\n';
  const item = {id:'legacy-excerpt',text:excerpt,description:'',sourceDocumentId:'doc',sourceExcerpt:excerpt,sourceRevision:22,category:'design',status:'inbox',priority:'normal'};
  f.project.production.push(item);
  const before = JSON.stringify(item);
  f.editProductionCard(item.id);
  assert.equal(f.nodes.get('#prodText').value, 'Level 0');
  assert.equal(f.nodes.get('#prodDescription').value, excerpt);
  assert.ok(f.nodes.get('#prodVisualEditor').innerHTML.includes('Câmara embrionária'));
  assert.match(f.nodes.get('#modalContent').innerHTML, /<input id="prodText" type="text"/);
  assert.doesNotMatch(f.nodes.get('#modalContent').innerHTML, /<textarea id="prodText"/);
  f.nodes.get('#prodFullscreenBtn').click(); f.nodes.get('#prodMarkdownBtn').click();
  assert.equal(f.nodes.get('#prodDescription').value, excerpt);
  f.closeModal(); assert.equal(JSON.stringify(item), before);
  f.editProductionCard(item.id); f.nodes.get('#saveProdBtn').click();
  assert.equal(item.text, 'Level 0'); assert.equal(item.description, excerpt);
  assert.equal(item.sourceExcerpt, excerpt); assert.equal(item.sourceRevision, 22);
  f.editProductionCard(item.id);
  assert.equal(f.nodes.get('#prodDescription').value, excerpt);
  f.nodes.get('#prodMarkdownBtn').click(); f.nodes.get('#prodDescription').value = '';
  f.nodes.get('#saveProdBtn').click(); f.editProductionCard(item.id);
  assert.equal(f.nodes.get('#prodDescription').value, '', 'explicitly cleared descriptions must stay empty');
  assert.equal(item.contentLayout, 'title-description'); f.closeModal();
});

test('new Vision transfer stores editable title separately from complete Markdown description', () => {
  const f = fixture();
  const excerpt = '### Level 0\n\n- [ ] Câmara embrionária\n';
  f.state.editorMode = 'markdown';
  const editor = f.nodes.get('#visionEditor'); editor.value = excerpt; editor.selectionStart = 0; editor.selectionEnd = excerpt.length;
  f.sendSelectionToProduction();
  assert.equal(f.nodes.get('#sendTitle').value, 'Level 0');
  assert.equal(f.nodes.get('#sendText').value, excerpt.trim());
  assert.equal(f.nodes.get('#sendCreativeStatus').value, 'canon');
  for (const id of ['#sendCategory', '#sendStatus', '#sendDeadline', '#sendAssignee', '#sendAssigneeAll']) assert.equal(f.nodes.has(id), false);
  assert.ok(f.nodes.get('#modal').classList.contains('vision-handoff-modal'));
  f.nodes.get('#sendTitle').value = 'Construir Level 0';
  f.nodes.get('#sendText').value = excerpt;
  f.nodes.get('#sendCreativeStatus').value = 'experiment';
  f.nodes.get('#sendPriority').value = 'high';
  f.nodes.get('#confirmSendBtn').click();
  const item = f.persisted.projects[0].production[0];
  assert.equal(item.text, 'Construir Level 0'); assert.equal(item.description, excerpt);
  assert.equal(item.sourceDocumentId, 'doc'); assert.equal(item.sourceExcerpt, excerpt.trim());
  assert.equal(item.creativeStatus, 'experiment'); assert.equal(item.suggestedPriority, 'high');
  assert.equal(item.status, 'inbox'); assert.equal(item.category, 'unclassified');
  assert.equal(item.assigneeId, null); assert.equal(item.deadline, 'Sem prazo');
  assert.equal(f.project.docs[0].status, 'canon');
});

test('Vision handoff commits pending document revision before taking an immutable source snapshot', () => {
  const f = fixture(); f.state.editorMode = 'markdown';
  const editor = f.nodes.get('#visionEditor'); editor.value = 'Trecho'; editor.selectionEnd = 6;
  f.schedulePersist(() => { f.project.docs[0].revision = 2; });
  f.sendSelectionToProduction();
  assert.equal(f.state.saveTimer, null); assert.equal(f.project.docs[0].revision, 2);
  f.project.docs[0].revision = 3;
  f.nodes.get('#confirmSendBtn').click();
  assert.equal(f.project.production[0].sourceRevision, 2, 'a later revision cannot be substituted for the one actually selected');
});

test('Vision handoff validates in place and cancelling never creates a demand', () => {
  const f = fixture(); f.state.editorMode = 'markdown';
  f.state.selectionText = 'Trecho capturado pelo menu de contexto';
  f.sendSelectionToProduction();
  assert.equal(f.nodes.get('#sendText').value, 'Trecho capturado pelo menu de contexto');
  f.nodes.get('#sendText').value = '  ';
  f.nodes.get('#confirmSendBtn').click();
  assert.match(f.nodes.get('#sendFormError').textContent, /descrição/);
  assert.equal(f.project.production.length, 0);
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), false);
  f.closeModal(); assert.equal(f.project.production.length, 0);
});

test('unclassified Vision handoff survives editing in Production; planning is independent from creative intent', () => {
  const f = fixture();
  const item = domain.createVisionHandoff(f.project, f.project.docs[0], {description:'## Intenção',creativeStatus:'probable',priority:'high'});
  f.project.production.push(item);
  f.editProductionCard(item.id);
  assert.equal(f.nodes.get('#prodCategory').value, 'unclassified');
  assert.match(f.nodes.get('#modalContent').innerHTML, /TRECHO ENVIADO · PROVÁVEL/);
  assert.match(f.nodes.get('#prodAssigneeHint').textContent, /Escolha a categoria/);
  f.nodes.get('#saveProdBtn').click();
  assert.equal(item.category, 'unclassified');
  f.sendProductionToExecution(item.id);
  assert.equal(f.project.execution.length, 0); assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
  f.editProductionCard(item.id);
  f.nodes.get('#prodCategory').value = 'design'; f.nodes.get('#prodPriority').value = 'low';
  f.nodes.get('#saveProdBtn').click();
  assert.equal(item.priority, 'low'); assert.equal(item.suggestedPriority, 'high'); assert.equal(item.creativeStatus, 'probable');
  f.sendProductionToExecution(item.id); f.nodes.get('#confirmExecBtn').click();
  assert.equal(f.project.execution[0].priority, 'low'); assert.equal(f.project.execution[0].category, 'design');
});

test('legacy excerpt is not lost when sent straight from Production to Execution', () => {
  const f = fixture();
  const excerpt = '## Patrulha\n\n- Investigar\n- Retornar';
  f.project.production.push({id:'legacy',text:excerpt,description:'',category:'design',status:'ready',priority:'normal',sourceDocumentId:'doc'});
  f.sendProductionToExecution('legacy');
  assert.equal(f.nodes.get('#execText').value, 'Patrulha');
  f.nodes.get('#confirmExecBtn').click();
  assert.equal(f.project.execution[0].text, 'Patrulha'); assert.equal(f.project.execution[0].description, excerpt);
});

test('saving in focus mode persists all demand fields once, without discarding source links', () => {
  const f = fixture();
  const original = {id:'old-demand', text:'Patrulha', description:'Descrição antiga', category:'design', status:'inbox', priority:'normal', sourceDocumentId:'doc', sourceDocumentTitle:'Visão', sourceRevision:2, sourceExcerpt:'Trecho original', dependencies:['other'], subtasks:[], tags:[]};
  f.project.production.push(original); f.editProductionCard('old-demand');
  f.nodes.get('#prodText').value = 'Patrulha atualizada';
  f.nodes.get('#prodDescription').value = '## Plano\n\n- Investigar\n- Retornar\n';
  f.nodes.get('#prodCategory').value = 'vfx'; f.nodes.get('#prodStatus').value = 'ready';
  f.nodes.get('#prodPriority').value = 'high'; f.nodes.get('#prodEstimate').value = '5 pontos';
  f.nodes.get('#prodDeadline').value = '18 set'; f.nodes.get('#prodTags').value = 'teste, IA';
  f.nodes.get('#prodSubtasks').value = 'Rota\nBusca'; f.nodes.get('#prodParent').value = 'parent';
  f.nodes.get('#prodAssignee').value = 'member';
  f.nodes.get('#prodFullscreenBtn').click(); f.animations.at(-1).finish(); f.nodes.get('#saveProdBtn').click();
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
  const saved = f.persisted.projects[0].production[0];
  assert.equal(saved.text, 'Patrulha atualizada'); assert.equal(saved.description, '## Plano\n\n- Investigar\n- Retornar\n');
  assert.equal(saved.sourceDocumentId, 'doc'); assert.equal(saved.sourceRevision, 2); assert.equal(saved.sourceExcerpt, 'Trecho original');
  assert.deepEqual(saved.dependencies, ['other']); assert.deepEqual(saved.tags, ['teste','IA']); assert.deepEqual(saved.subtasks, ['Rota','Busca']);
  assert.equal(saved.category, 'vfx'); assert.equal(saved.status, 'ready'); assert.equal(saved.priority, 'high');
  assert.equal(saved.estimate, '5 pontos'); assert.equal(saved.deadline, '18 set'); assert.equal(saved.parentId, 'parent'); assert.equal(saved.assigneeId, 'member');
  assert.equal(f.project.production.length, 1);
});

test('new demand is created only on Save; keyboard shortcut follows the same save action', () => {
  const f = fixture(); f.editProductionCard();
  assert.equal(f.project.production.length, 0);
  f.nodes.get('#prodText').value = 'Nova demanda';
  f.handleKeydown({key:'s',ctrlKey:true,preventDefault(){}});
  assert.equal(f.project.production.length, 1);
  assert.equal(f.persisted.projects[0].production[0].text, 'Nova demanda');
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
});

test('deletion requires explicit confirmation and can be cancelled without mutation', () => {
  const f = fixture();
  f.project.production.push({id:'remove-me',text:'Teste',category:'design',priority:'normal',status:'inbox'});
  f.editProductionCard('remove-me'); f.nodes.get('#deleteProdBtn').click();
  assert.equal(f.project.production.length, 1);
  f.nodes.get('#prodKeepEditingBtn').click(); assert.equal(f.project.production.length, 1);
  f.nodes.get('#deleteProdBtn').click(); f.nodes.get('#prodDiscardBtn').click();
  assert.equal(f.project.production.length, 0);
  assert.equal(f.nodes.get('#modalBackdrop').classList.contains('hidden'), true);
});

test('settings volume/sound controls update without persisting until Save', () => {
  const f = fixture(); f.openSettings();
  assert.ok(f.nodes.get('#modal').classList.contains('settings-modal'));
  assert.equal(f.nodes.get('#settingsVolumeValue').textContent, '65%');
  assert.equal(f.nodes.get('#deleteSaveBtn').disabled, true);
  assert.ok(f.nodes.get('#modalContent').innerHTML.includes('Ana &lt;dev&gt;'));
  f.nodes.get('#settingsSound').checked = false;
  f.nodes.get('#settingsSound').onchange();
  assert.equal(f.nodes.get('#settingsVolume').disabled, true);
  f.nodes.get('#settingsVolume').value = '.3';
  f.nodes.get('#settingsVolume').oninput();
  assert.equal(f.nodes.get('#settingsVolumeValue').textContent, '30%');
  assert.equal(f.nodes.get('#settingsVolume').style['--range-value'], '30%');
  f.nodes.get('#renameSaveInput').value = 'Meu jogo';
  f.nodes.get('#settingsMotion').checked = true;
  assert.equal(f.project.name, 'Projeto de teste');
  f.nodes.get('#saveSettingsBtn').onclick();
  assert.equal(f.project.name, 'Meu jogo');
  assert.equal(f.project.settings.sound, false);
  assert.equal(f.project.settings.volume, .3);
  assert.equal(f.project.settings.reducedMotion, true);
  assert.equal(f.persisted.projects[0].name, 'Meu jogo');
  assert.equal(f.document.documentElement.classList.contains('reduced-motion'), true);
  assert.equal(f.nodes.get('#app').inert, false);
});

test('cancel does not alter settings', () => {
  const f = fixture(); f.openSettings();
  f.nodes.get('#renameSaveInput').value = 'Descartar';
  f.nodes.get('#settingsSound').checked = false;
  f.closeModal();
  assert.equal(f.project.name, 'Projeto de teste');
  assert.equal(f.project.settings.sound, true);
  assert.equal(f.persisted, undefined);
});

test('pause menu shows current project and restores focus on Escape', () => {
  const f = fixture(); f.state.currentScreen = 'work';
  f.pauseMenu();
  assert.equal(f.nodes.get('#pauseProjectName').textContent, f.project.name);
  assert.equal(f.nodes.get('#pauseMenu').classList.contains('hidden'), false);
  assert.equal(f.nodes.get('#app').inert, true);
  f.handleKeydown({ key: 'Escape' });
  assert.equal(f.nodes.get('#pauseMenu').classList.contains('hidden'), true);
  assert.equal(f.nodes.get('#app').inert, false);
  assert.equal(f.document.activeElement, f.opener);
});

test('Tab and Shift+Tab wrap within a dialog', () => {
  const f = fixture(); f.openSettings();
  const controls = f.nodes.get('#modal').querySelectorAll();
  const first = controls[0], last = controls.at(-1);
  let prevented = false;
  last.focus();
  f.handleKeydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.document.activeElement, first);
  f.handleKeydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(f.document.activeElement, last);
});

test('history handles empty and escaped records with the new theme', () => {
  const f = fixture(); f.openHistory();
  assert.ok(f.nodes.get('#modalContent').innerHTML.includes('history-empty'));
  f.project.history.push({ message: '<img src=x>', actor: 'A&B', at: '2026-09-02T12:00:00Z' });
  f.openHistory();
  assert.ok(f.nodes.get('#modal').classList.contains('history-modal'));
  assert.ok(f.nodes.get('#modalContent').innerHTML.includes('&lt;img src=x&gt;'));
  assert.ok(f.nodes.get('#modalContent').innerHTML.includes('A&amp;B'));
});

test('demand and task dialogs keep their controls while receiving the shared style', () => {
  const f = fixture(); f.editProductionCard();
  assert.ok(f.nodes.get('#modal').classList.contains('system-modal'));
  assert.ok(f.nodes.get('#prodText')); assert.ok(f.nodes.get('#saveProdBtn').onclick);
  f.editTask();
  assert.ok(f.nodes.get('#modal').classList.contains('system-modal'));
  assert.ok(f.nodes.get('#taskText')); assert.ok(f.nodes.get('#saveTaskBtn').onclick);
});

test('static overlay contracts, style structure and cache versions stay aligned', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /id="pauseMenu"[^>]*role="dialog"/);
  assert.match(html, /id="modal"[^>]*aria-modal="true"/);
  assert.match(html, /id="toastHost"[^>]*aria-live="polite"/);
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  let depth = 0;
  for (const char of stripped) { if (char === '{') depth++; if (char === '}') depth--; assert.ok(depth >= 0); }
  assert.equal(depth, 0);
  assert.match(css, /\.modal\.system-modal/);
  assert.match(css, /\.pause-card \.pause-actions button:hover/);
  const version = html.match(/styles\.css\?v=([\d.]+)/)[1];
  assert.ok(html.includes('app.js?v=' + version));
  assert.ok(fs.readFileSync(path.join(projectRoot, 'service-worker.js'), 'utf8').includes('gameforge-flow-v' + version));
});

test('creation actions live in their own sections and still open the correct forms', () => {
  const header = html.match(/<header class="work-stage-header">([\s\S]*?)<\/header>/)[1];
  assert.doesNotMatch(header, /workContextAction|section-create-action|NOVA DEMANDA|NOVA TAREFA/);
  assert.match(html, /class="production-toolbar"[\s\S]*?id="newDemandBtn"[\s\S]*?id="productionBoard"/);
  assert.match(html, /class="execution-sprint-head"[\s\S]*?id="newTaskBtn"[\s\S]*?id="executionBoard"/);
  const f = fixture(); f.bindSectionActions();
  f.nodes.get('#newDemandBtn').onclick();
  assert.ok(f.nodes.get('#prodText'));
  assert.ok(f.nodes.get('#saveProdBtn').onclick);
  f.closeModal();
  f.nodes.get('#newTaskBtn').onclick();
  assert.ok(f.nodes.get('#taskText'));
  assert.ok(f.nodes.get('#saveTaskBtn').onclick);
});

test('stage switching lights only adjacent endpoints without inserting controls in the header', () => {
  const f = fixture();
  assert.equal((html.match(/data-stage-node=/g) || []).length, 4);
  for (const stage of ['vision', 'production', 'execution', 'vision']) {
    f.state.currentStage = stage; f.updateStageRail();
    assert.equal(f.nodes.get('#workStageRail').dataset.active, stage);
    assert.equal(f.stageButtons.filter(button => button.classList.contains('active')).length, 1);
    assert.deepEqual(f.stageNodes.filter(item => item.classList.contains('active')).map(item => item.dataset.stageNode), stage === 'production' ? [stage, stage] : [stage]);
    assert.equal(f.nodes.has('#workContextAction'), false);
  }
  const responsiveCSS = css.slice(css.indexOf('/* Readable UI scale:'));
  assert.match(responsiveCSS, /\.work-stage-header\{[^}]*grid-template-columns:3rem minmax\(0,1fr\) 3rem/);
  assert.match(css, /\.work-stage-link b:last-child\{left:auto;right:0/);
  assert.doesNotMatch(css, /\.section-create-action[^}]*display:none/);
});
