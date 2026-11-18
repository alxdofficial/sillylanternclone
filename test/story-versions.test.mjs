import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStoryVersions } from '../story-versions.mjs';

async function storage(t) {
  const folder = await mkdtemp(join(tmpdir(),'story-versions-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  return folder;
}

function story(id = 'ferry') {
  return {
    id,title:'Last Ferry',lore:'A small harbor in winter.',notes:'Keep the creaking boards.',
    messages:[{role:'user',turnNumber:1,content:'Start at the dock.'},
      {role:'assistant',turnNumber:2,content:'The foghorn called across the harbor.',contentSensitivity:'reviewed-safe'}],
    cast:[{id:'keeper',name:'The keeper',description:'Moves slowly among the moored boats.'}],
    plotEvents:[{id:'harbor',turn:2,note:'The foghorn called.'}],
    sceneBoard:{chapters:[[2]],scenes:{}},
    laterFeature:{tags:['setting','revision']}
  };
}

test('records a complete immutable story, deduplicates reordered keys, and reads through restart',async t=>{
  const folder = await storage(t);
  const versions = createStoryVersions(folder);
  assert.deepEqual(await versions.list('unrecorded'),[]);
  const original = story();
  const first = await versions.record(original,{label:' Before revision '});
  assert.equal(first.parentId,null);
  assert.equal(first.label,'Before revision');
  assert.ok(Number.isFinite(Date.parse(first.createdAt)));
  const duplicate = await versions.record(Object.fromEntries(Object.entries(original).reverse()));
  assert.deepEqual(duplicate,first);
  const later = {...original,title:'Midnight Ferry'};
  const second = await versions.record(later);
  assert.equal(second.parentId,first.id);

  const restarted = createStoryVersions(folder);
  assert.deepEqual(await restarted.list(original.id),[second,first]);
  assert.deepEqual(await restarted.get(original.id,first.id),original);
  assert.deepEqual(await restarted.get(original.id,second.id),later);
  const inspected = await restarted.get(original.id,first.id);
  inspected.messages[1].content = 'Temporary edit to the retrieved copy.';
  assert.deepEqual(await restarted.get(original.id,first.id),original);
  assert.equal(await restarted.get(original.id,randomUUID()),null);
  assert.equal(await restarted.get(original.id,'../../manifest.json'),null);
});

test('restoring an earlier story records a new head and keeps later versions without duplicating bytes',async t=>{
  const folder = await storage(t);
  const id = '../imported/ferry';
  const versions = createStoryVersions(folder);
  const original = story(id);
  const first = await versions.record(original,{label:'Original'});
  const revised = {...original,notes:'Keep the bell.'};
  const second = await versions.record(revised,{label:'Revised'});
  const earlier = await versions.get(id,first.id);
  const restored = await versions.record(earlier,{label:'Restored original',restoredFrom:first.id});

  assert.equal(restored.parentId,second.id);
  assert.equal(restored.restoredFrom,first.id);
  assert.notEqual(restored.id,first.id);
  assert.deepEqual(await versions.list(id),[restored,second,first]);
  assert.deepEqual(await versions.get(id,second.id),revised);
  assert.deepEqual(await versions.get(id,restored.id),original);
  const [key] = await readdir(join(folder,'story-versions'));
  assert.match(key,/^[0-9a-f]{64}$/u);
  assert.equal((await readdir(join(folder,'story-versions',key,'snapshots'))).length,2);
  const backup = await versions.archive([id,id,'another story']);
  assert.equal(Object.keys(backup).length,3);
  for (const [name,bytes] of Object.entries(backup)) assert.deepEqual(bytes,await readFile(join(folder,name)));

  assert.equal(await versions.get('another story',restored.id),null);
  await assert.rejects(versions.record(story('another story'),{restoredFrom:first.id}),
    {status:400,code:'STORY_VERSION_INVALID_RESTORE'});
});

test('per-story recording serializes concurrent saves and snapshots the submission before waiting',async t=>{
  const versions = createStoryVersions(await storage(t));
  const baseline = story();
  const first = await versions.record(baseline);
  const rejected = versions.record(baseline,{restoredFrom:randomUUID()});
  const immediateBefore = {...baseline,title:'Crossing One'};
  const recording = versions.record(immediateBefore);
  immediateBefore.title = 'Changed while queued';
  const following = versions.record({...baseline,title:'Crossing Two'});
  const [,second,third] = await Promise.all([
    assert.rejects(rejected,{status:400}),
    recording,
    following
  ]);
  assert.equal(second.parentId,first.id);
  assert.equal(third.parentId,second.id);
  assert.deepEqual(await versions.list(baseline.id),[third,second,first]);
  assert.equal((await versions.get(baseline.id,second.id)).title,'Crossing One');
  assert.equal((await versions.get(baseline.id,third.id)).title,'Crossing Two');
});

test('version integrity checks reject corrupt and symlinked data without replacing the history',async t=>{
  const folder = await storage(t);
  const versionStore = createStoryVersions(folder);
  const baseline = story();
  const entry = await versionStore.record(baseline);
  const [key] = await readdir(join(folder,'story-versions'));
  const directory = join(folder,'story-versions',key);
  const index = join(directory,'manifest.json');
  const savedIndex = await readFile(index);
  const snapshots = join(directory,'snapshots');
  const [name] = await readdir(snapshots);
  const snapshot = join(snapshots,name);
  const preserved = join(folder,'copied.gz');
  await writeFile(preserved,await readFile(snapshot));
  await writeFile(snapshot,Buffer.from('tampered contents'));
  await assert.rejects(versionStore.get(baseline.id,entry.id),{code:'STORY_VERSION_STORAGE_INVALID'});

  await assert.rejects(versionStore.archive([baseline.id]),{code:'STORY_VERSION_STORAGE_INVALID'});

  await rm(snapshot);
  await symlink(preserved,snapshot);
  await assert.rejects(versionStore.get(baseline.id,entry.id),{code:'STORY_VERSION_STORAGE_INVALID'});
  assert.deepEqual(await versionStore.list(baseline.id),[entry]);
  assert.deepEqual(savedIndex,await readFile(index));

  await writeFile(index,'a malformed index');
  await assert.rejects(versionStore.record({...baseline,title:'Another save'}),{code:'STORY_VERSION_STORAGE_INVALID'});
  assert.equal((await readFile(index)).toString(),'a malformed index');
});
