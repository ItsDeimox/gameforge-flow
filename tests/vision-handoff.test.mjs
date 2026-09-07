import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createVisionHandoff, DOC_STATUSES, PRIORITIES, categoryLabel, migrateProject } from '../outputs/GameForge_Flow_v0.4/src/domain.js';

test('all creative statuses and suggested priorities preserve content and source without scheduling', () => {
  const project = createProject('Visão QA', false), doc = project.docs[0];
  const original = JSON.stringify(project);
  for (const creativeStatus of Object.keys(DOC_STATUSES)) for (const [priority] of PRIORITIES) {
    const description = '## Portal\n\n**Intenção:** descoberta.\n\n- [ ] Experimento\n';
    const item = createVisionHandoff(project, doc, {title:'  Explorar o portal  ',description,excerpt:'Trecho original',creativeStatus,priority});
    assert.equal(item.text, 'Explorar o portal'); assert.equal(item.description, description);
    assert.equal(item.creativeStatus, creativeStatus); assert.equal(item.suggestedPriority, priority); assert.equal(item.priority, priority);
    assert.equal(item.status, 'inbox'); assert.equal(item.category, 'unclassified'); assert.equal(categoryLabel(item.category), 'A classificar');
    assert.equal(item.assigneeId, null); assert.equal(item.assignee, 'Não atribuído'); assert.equal(item.deadline, 'Sem prazo');
    assert.equal(item.sourceDocumentId, doc.id); assert.equal(item.sourceDocumentTitle, doc.title);
    assert.equal(item.sourceRevision, doc.revision); assert.equal(item.sourceExcerpt, 'Trecho original');
    assert.equal(item.projectId, project.id); assert.equal(item.contentLayout, 'title-description');
  }
  assert.equal(JSON.stringify(project), original, 'factory cannot change the source or the project before confirmation');
});

test('handoff defaults come from the creative document and reject pipeline states and invalid priorities', () => {
  const project = createProject('Defaults', false), doc = project.docs[0]; doc.status = 'canon';
  const item = createVisionHandoff(project, doc, {description:'### Primeiro encontro\n\nDetalhes'});
  assert.equal(item.creativeStatus, 'canon'); assert.equal(item.priority, 'normal'); assert.equal(item.text, 'Primeiro encontro');
  for (const creativeStatus of ['inbox','breakdown','ready','execution','toString']) {
    assert.throws(() => createVisionHandoff(project, doc, {description:'Texto',creativeStatus}), /status criativo/);
  }
  assert.throws(() => createVisionHandoff(project, doc, {description:'   '}), /descrição/);
  assert.throws(() => createVisionHandoff(project, doc, {description:'Texto',priority:'urgente'}), /prioridade sugerida/);
});

test('export/import migration preserves the creative snapshot and leaves previous planned demands untouched', () => {
  const project = createProject('Compatibilidade', true);
  const previous = structuredClone(project.production);
  const item = createVisionHandoff(project, project.docs[0], {description:'## Novo trecho',creativeStatus:'experiment',priority:'high'});
  project.production.push(item);
  const imported = migrateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(imported.production.slice(0, previous.length), previous);
  assert.deepEqual(imported.production.at(-1), item);
  imported.production.at(-1).priority = 'low';
  assert.equal(imported.production.at(-1).suggestedPriority, 'high');
});
