import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, migrateProject, saveMember, removeMember, eligibleMembers, assignMember, task, productionItem } from '../outputs/GameForge_Flow_v0.4/src/domain.js';
import { Collaboration, connectionLink, api } from '../outputs/GameForge_Flow_v0.4/src/collaboration.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), clear: () => values.clear() };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

test('each new save has an independent roster; migration preserves old people', () => {
  const a = createProject('A', false), b = createProject('B', false);
  assert.deepEqual(a.members, []);
  saveMember(a, { name: 'Bia', role: 'VFX Artist', specialties: ['vfx'] });
  assert.equal(a.members.length, 1); assert.equal(b.members.length, 0);
  const old = { ...b, schemaVersion: 4, members: [{ id: 'legacy', name: 'Leo', role: 'Programmer' }] };
  const migrated = migrateProject(old);
  assert.equal(migrated.members[0].name, 'Leo'); assert.equal(migrated.members[0].role, 'Programmer');
  assert.deepEqual(migrated.members[0].specialties, []);
  assert.equal(migrated.schemaVersion, 5);
});

test('VFX selection lists matching people; rename/removal keep assignment integrity', () => {
  const p = createProject('Team', false);
  const vfx = saveMember(p, { name: 'Bia', role: 'Art', specialties: ['vfx', 'animation'] });
  saveMember(p, { name: 'Leo', role: 'Code', specialties: ['code'] });
  assert.deepEqual(eligibleMembers(p, 'vfx').map(m => m.name), ['Bia']);
  assert.equal(eligibleMembers(p, 'qa').length, 0); assert.equal(eligibleMembers(p, 'qa', true).length, 2);
  const demand = assignMember(p, productionItem(p, { category: 'vfx' }), vfx.id);
  const execution = assignMember(p, task(p, { category: 'vfx' }), vfx.id);
  p.production.push(demand); p.execution.push(execution);
  saveMember(p, { id: vfx.id, name: 'Beatriz', role: 'Senior VFX', specialties: ['vfx'] });
  assert.equal(execution.assignee, 'Beatriz'); assert.equal(demand.assigneeId, vfx.id);
  assert.throws(() => saveMember(p, { name: 'leo', role: '', specialties: [] }), /Já existe/);
  assert.throws(() => assignMember(p, execution, 'another-save-member'), /não faz mais parte/);
  removeMember(p, vfx.id);
  assert.equal(execution.assigneeId, null); assert.equal(demand.assignee, 'Não atribuído');
  assert.equal(p.production.length, 1); assert.equal(p.execution.length, 1);
});

function fixture(t, room = 'room') {
  localStorage.clear(); sessionStorage.clear();
  let remote = { roomId: room, serverId: 'server', revision: 1, principal: { admin: true, name: 'Host' }, project: createProject('Test', false) };
  let apply = true, lastRemote, failure;
  globalThis.fetch = async (_url, options) => {
    if (failure) throw new Error(failure);
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (body.revision !== remote.revision) return { ok: false, status: 409, json: async () => ({ error: 'Conflict' }) };
      remote = { ...remote, revision: remote.revision + 1, project: body.project };
    }
    return { ok: true, status: 200, json: async () => structuredClone(remote) };
  };
  const client = new Collaboration({ onStatus() {}, onRemote: project => { lastRemote = project; }, canApply: () => apply });
  t.after(() => client.stop());
  return { client, snapshot: () => structuredClone(remote), get lastRemote() { return lastRemote; },
    remoteEdit() { remote = structuredClone(remote); remote.revision++; remote.project.name = 'Remote edit'; },
    set editing(value) { apply = !value; }, set failure(value) { failure = value; } };
}

test('pending local edits are saved to host and offline drafts can retry', async t => {
  const f = fixture(t); await f.client.connect({ roomId: 'room', token: 'secret' }, f.snapshot());
  const draft = structuredClone(f.client.base); draft.name = 'My edit';
  f.client.queue(draft); assert.equal(f.client.status, 'pending'); assert.ok(localStorage.getItem(f.client.draftKey));
  f.failure = 'Offline'; await f.client.flush();
  assert.equal(f.client.status, 'offline'); assert.equal(f.client.dirty, true);
  f.failure = null; await f.client.flush();
  assert.equal(f.client.status, 'synced'); assert.equal(f.snapshot().project.name, 'My edit');
  assert.equal(localStorage.getItem(f.client.draftKey), null);
});

test('a stale client preserves its draft and never overwrites remote changes', async t => {
  const f = fixture(t); await f.client.connect({ roomId: 'room', token: 'secret' }, f.snapshot());
  const draft = structuredClone(f.client.base); draft.name = 'Local competing edit'; f.client.queue(draft);
  f.remoteEdit(); await f.client.flush();
  assert.equal(f.client.status, 'conflict'); assert.equal(f.client.draft.name, 'Local competing edit');
  assert.equal(f.snapshot().project.name, 'Remote edit');
  await f.client.flush(); assert.equal(f.snapshot().revision, 2);
});

test('polling does not replace the editor while it is in use', async t => {
  const f = fixture(t); await f.client.connect({ roomId: 'room', token: 'secret' }, f.snapshot());
  f.editing = true; f.remoteEdit(); await f.client.tick();
  assert.equal(f.lastRemote, undefined); assert.equal(f.client.revision, 1);
  f.editing = false; await f.client.tick();
  assert.equal(f.lastRemote.name, 'Remote edit'); assert.equal(f.client.revision, 2);
});

test('reloading recovers a pending draft instead of silently publishing it', async t => {
  const f = fixture(t); const session = { roomId: 'room', token: 'secret' };
  await f.client.connect(session, f.snapshot());
  const draft = structuredClone(f.client.base); draft.name = 'Unsaved draft'; f.client.queue(draft); f.client.stop();
  const recovered = await f.client.connect(session, f.snapshot());
  assert.equal(recovered.name, 'Unsaved draft'); assert.equal(f.client.status, 'conflict');
});

test('invitation credentials stay in URL fragments and reject unsafe URLs', () => {
  const link = new URL(connectionLink('https://tunnel.example/', 'room', 'secret'));
  assert.equal(link.search, ''); assert.ok(link.hash.includes('token=secret'));
  assert.throws(() => connectionLink('javascript:alert(1)', 'room', 'token'));
  assert.throws(() => connectionLink('https://user:pass@host/', 'room', 'token'));
});

test('API refuses to send credentials through an obsolete caching worker', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; };
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: { controller: { postMessage() {} } } }, configurable: true });
  try {
    await assert.rejects(api('/api/host', { hostKey: 'secret' }), /Atualize a página/);
    assert.equal(fetched, false);
  } finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
});
