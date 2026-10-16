import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemorySession } from '../build/src/index.js';
import { FixtureProvider } from '../build/test-support/fixture-provider.js';
import { loadFixture } from '../build/test-support/fixture-loader.js';
import { context, request, data, temporary, cleanup } from './helpers.mjs';

async function using(fn, fixture = data(), ctx = context()) {
  const session = new MemorySession(new FixtureProvider(fixture), ctx);
  await session.initialize();
  try { await fn(async (method, params = {}, patch = {}) => session.invoke(request(ctx, method, params, patch))); }
  finally { await session.close(); }
}
const result = response => { assert.equal(response.ok, true, JSON.stringify(response.error)); return response.result; };

test('all nine read capabilities work with Chinese synthetic records and stable references', async () => {
  await using(async invoke => {
    assert.equal(result(await invoke('health')).state, 'fixture-readonly');
    assert.equal(result(await invoke('snapshot')).entries.length, 2);
    const recalled = result(await invoke('recall', {query: '发布'}));
    assert.equal(recalled.hits.length, 1);
    const ref = recalled.hits[0].ref;
    assert.match(result(await invoke('resolveEvidence', {ref})).text, /隔离夹具/);
    assert.equal(result(await invoke('listSources')).sources.length, 2);
    assert.equal(result(await invoke('findEntities', {query: '发布'})).entities.length, 1);
    const nodes = result(await invoke('coverWindow', {from:'2026-01-01T00:00:00.000Z', to:'2026-01-05T00:00:00.000Z'}));
    assert.equal(nodes.nodes.length, 2); assert.equal(nodes.complete, true);
    assert.equal(result(await invoke('drillDown', {nodeId:ref.itemId, version:ref.revision})).nodes.length, 1);
    const changes = result(await invoke('changes', {sourceId:ref.sourceId, sourceIdentity:'fixture-source-v1'}));
    assert.deepEqual(changes.items.map(i=>i.kind), ['upsert','deleted']);
  });
});

test('scope and classification filters exclude other principals, projects, restricted and deleted bodies', async () => {
  await using(async invoke => {
    const responses = [];
    for (const [method, params] of [['snapshot',{}],['recall',{query:'发布'}],['coverWindow',{from:'2026-01-01T00:00:00.000Z',to:'2026-01-05T00:00:00.000Z'}]]) responses.push(result(await invoke(method,params)));
    assert.doesNotMatch(JSON.stringify(responses), /OTHER_PROJECT_SENTINEL|OTHER_USER_SENTINEL|RESTRICTED_SENTINEL|DELETED_SENTINEL/);
    assert.equal(result(await invoke('recall',{query:'发布',sourceIds:['fixture-notes']})).hits.length, 0);
    assert.equal(result(await invoke('recall',{query:'发布',classifications:['personal']})).hits.length, 0);
    assert.equal((await invoke('resolveEvidence',{ref:data().records[2].ref})).error.code,'NOT_FOUND');
  });
  const ctx = context(); delete ctx.grant.scope.projectId;
  await using(async invoke => {
    assert.equal(result(await invoke('snapshot')).entries.length, 1);
    assert.equal(result(await invoke('recall',{query:'发布'})).hits.length, 0);
  }, data(), ctx);
});

test('stale evidence, nodes and source identities fail explicitly without fallback', async () => {
  await using(async invoke => {
    assert.equal((await invoke('resolveEvidence',{ref:{...data().records[0].ref,revision:'v0'}})).error.code,'VERSION_CONFLICT');
    assert.equal((await invoke('drillDown',{nodeId:'fixture-1',version:'v0'})).error.code,'VERSION_CONFLICT');
    assert.equal((await invoke('changes',{sourceId:'fixture-chat',sourceIdentity:'other-source'})).error.code,'VERSION_CONFLICT');
    assert.equal((await invoke('changes',{sourceId:'fixture-chat',sourceIdentity:'fixture-source-v1',cursor:'cursor-999'})).error.code,'INVALID_REQUEST');
  });
});

test('bounded results report omissions and change pagination retains tombstones', async () => {
  await using(async invoke => {
    const budget = {maxItems:1,maxChars:4096,timeoutMs:1000};
    const snap = result(await invoke('snapshot',{}, {budget})); assert.equal(snap.entries.length,1); assert.equal(snap.coverage.omitted,1);
    const win = result(await invoke('coverWindow',{from:'2026-01-01T00:00:00.000Z',to:'2026-01-05T00:00:00.000Z'},{budget}));
    assert.equal(win.complete,false); assert.equal(win.coverage.omitted,1);
    const p = {sourceId:'fixture-chat',sourceIdentity:'fixture-source-v1'};
    const a = result(await invoke('changes',p,{budget})); assert.equal(a.complete,false);
    const b = result(await invoke('changes',{...p,cursor:a.nextCursor},{budget})); assert.equal(b.complete,true); assert.equal(b.items[0].kind,'deleted');
    const empty = result(await invoke('snapshot',{}, {budget:{...budget,maxChars:1}})); assert.equal(empty.entries.length,0); assert.equal(empty.coverage.omitted,2);
  });
});

test('snapshot excludes expired or unresolvable entries without inventing user preferences', async () => {
  const fixture = data(); fixture.entries[0].expiresAt='2020-01-01T00:00:00.000Z'; fixture.entries[1].provenance[0].revision='missing';
  await using(async invoke => assert.equal(result(await invoke('snapshot')).entries.length,0), fixture);
});

test('fixture loader accepts only marked isolated roots and rejects malformed fixture data', () => {
  const directory=temporary(), file=path.join(directory,'test.json');
  try {
    fs.writeFileSync(file,JSON.stringify(data())); assert.equal(loadFixture(file).kind,'uu-m1-synthetic');
    fs.rmSync(path.join(directory,'.uu-m1-isolated.json'));
    assert.throws(()=>loadFixture(file),e=>e.code==='SCOPE_DENIED');
    fs.writeFileSync(path.join(directory,'.uu-m1-isolated.json'),JSON.stringify({purpose:'uu-m1-synthetic-only'}));
    fs.writeFileSync(file,JSON.stringify({...data(),kind:'production'})); assert.throws(()=>loadFixture(file),e=>e.code==='INVALID_REQUEST');
    fs.writeFileSync(file,JSON.stringify({...data(),records:[{...data().records[0],ref:{...data().records[0].ref,authorityId:'real-authority'}}]}));
    assert.throws(()=>loadFixture(file),e=>e.code==='SCOPE_DENIED');
    // No stat/open is attempted for this synthetic path outside either allowlisted root.
    assert.throws(()=>loadFixture(path.join(path.dirname(directory),'uu-denied', 'not-a-fixture.json')),e=>e.code==='SCOPE_DENIED');
  } finally { cleanup(directory); }
});

test('junction redirects cannot turn a fixture root into an arbitrary file reader', () => {
  const directory=temporary(), target=temporary(), link=path.join(directory,'redirect');
  try {
    fs.writeFileSync(path.join(target,'test.json'),JSON.stringify(data()));
    fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>loadFixture(path.join(link,'test.json')),e=>e.code==='SCOPE_DENIED');
  } finally {
    if(fs.existsSync(link)) fs.unlinkSync(link);
    cleanup(directory); cleanup(target);
  }
});
