import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { artworkImageByteLimit, createArtworkStore } from '../artwork-store.mjs';

const sampleBytes = Object.fromEntries(Object.entries({
  'image/png':'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAA1BMVEVofmuKYkvqAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC',
  'image/jpeg':'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ACHh3/9k=',
  'image/webp':'UklGRiwAAABXRUJQVlA4ICAAAABwAQCdASoCAAIAAgA0JYwCdAF1AAD+3g7CqcTHomAAAA=='
}).map(([mime,file])=>[mime,Buffer.from(file,'base64')]));

const pane = (fields = {})=>{
  const mime = fields.mime || 'image/png';
  return {kind:'illustration',label:'The quay',prompt:'An ink drawing of a ferry quay.',mime,bytes:sampleBytes[mime],...fields};
};

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(),'story-artwork-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}

test('store stages a complete generation batch and atomically approves and places an image',async t=>{
  const storage = await scratch(t);
  const store = createArtworkStore(storage);
  const story = 'library-story';
  assert.deepEqual(await store.list(story),[]);
  const id = randomUUID();
  const source = {scene:{turn:3,fingerprint:'scene-hash',start:0,end:26},canonKey:'canon-hash',referenceKey:'reference-hash'};
  const [reference,illustration,comic] = await store.put(story,[
    pane({id,kind:'reference',subject:{kind:'location',name:'West quay'}}),
    pane({source,references:[id],mime:'image/jpeg'}),
    pane({kind:'comic',source,references:[id],mime:'image/webp'})
  ]);
  assert.equal(reference.id,id);
  assert.equal(reference.status,'pending');
  assert.deepEqual(illustration.source,source);
  assert.deepEqual(comic.references,[id]);
  assert.ok(Number.isFinite(Date.parse(comic.createdAt)));
  assert.equal(illustration.byteLength,sampleBytes[illustration.mime].length);
  assert.deepEqual(await store.file(story,comic.id),{mime:comic.mime,bytes:sampleBytes[comic.mime]});

  const placed = await store.update(story,id,{action:'place',turn:3});
  assert.equal(placed.status,'approved');
  assert.equal(placed.placedTurn,3);
  const restarted = createArtworkStore(storage);
  const reloaded = await restarted.list(story);
  assert.deepEqual(reloaded,[placed,illustration,comic]);

  const unplaced = await restarted.update(story,id,{action:'unplace'});
  assert.equal(unplaced.status,'approved');
  assert.equal(unplaced.placedTurn,undefined);
  assert.deepEqual(await restarted.update(story,id,{action:'discard'}),{id,discarded:true});
  assert.equal(await restarted.file(story,id),null);
  assert.equal(await restarted.update(story,id,{action:'approve'}),null);
  assert.deepEqual((await restarted.list(story)).map(entry=>entry.id),[illustration.id,comic.id]);
});

test('invalid image batches are atomic, unsafe IDs are rejected, and queued writes recover after an error',async t=>{
  const storage = await scratch(t);
  const store = createArtworkStore(storage);
  const story = '../imported/story.id';
  await assert.rejects(store.put(story,[pane(),pane({bytes:Buffer.from('<svg>not raster</svg>')})]),
    error=>error.status === 400 && error.code === 'ARTWORK_INVALID_IMAGE');
  await assert.rejects(store.put(story,[pane({mime:'image/svg+xml'})]),{status:400});
  await assert.rejects(store.put(story,[pane({id:'../outside.png'})]),{status:400});
  await assert.rejects(store.put(story,[pane({source:{scene:{turn:1,fingerprint:'a',end:2}}})]),{status:400});
  await assert.rejects(store.put(story,[pane({bytes:Buffer.alloc(artworkImageByteLimit+1)})]),{status:413});
  const enormous = Buffer.from(sampleBytes['image/png']);
  enormous.writeUInt32BE(20000,16);
  enormous.writeUInt32BE(20000,20);
  await assert.rejects(store.put(story,[pane({bytes:enormous})]),{status:400});
  assert.equal(await store.file(story,'../manifest.json'),null);
  assert.deepEqual(await readdir(storage),[]);

  const bad = store.put(story,[pane({references:[randomUUID()]})]);
  const good = store.put(story,[pane()]);
  const [,added] = await Promise.all([assert.rejects(bad,{status:400,code:'ARTWORK_REFERENCE_MISSING'}),good]);
  const [first] = added;
  await assert.rejects(store.put(story,[pane({id:first.id})]),{status:409});
  await assert.rejects(store.put('other story',[pane({references:[first.id]})]),{status:400});
  assert.deepEqual(await store.list(story),added);
  assert.deepEqual(await store.list('other story'),[]);
  const keys = await readdir(join(storage,'artwork'));
  assert.equal(keys.length,1);
  assert.match(keys[0],/^[0-9a-f]{64}$/u);
});

test('archive uses portable metadata and the original bytes, with story ownership and byte limits',async t=>{
  const directory = await scratch(t);
  const restored = await scratch(t);
  const store = createArtworkStore(directory);
  const [item] = await store.put('chapter draft',[pane({mime:'image/jpeg'})]);
  await store.update('chapter draft',item.id,{action:'place',turn:5});
  await store.put('unrelated',[pane()]);
  const files = await store.archive(['not present','chapter draft','chapter draft']);
  assert.equal(Object.keys(files).length,2);
  for (const [path,bytes] of Object.entries(files)) {
    assert.match(path,/^artwork\/[0-9a-f]{64}\//u);
    assert.deepEqual(bytes,await readFile(join(directory,path)));
    const target = join(restored,path);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,bytes);
  }
  const fromArchive = createArtworkStore(restored);
  const [entry] = await fromArchive.list('chapter draft');
  assert.equal(entry.placedTurn,5);
  assert.deepEqual(await fromArchive.file('chapter draft',item.id),{mime:item.mime,bytes:sampleBytes[item.mime]});
  assert.equal(await fromArchive.file('unrelated',item.id),null);
  await assert.rejects(store.archive(['chapter draft'],{maxBytes:2}),{status:413});
});

test('store refuses symbolic links in image and story directory paths',async t=>{
  const directory = await scratch(t);
  const store = createArtworkStore(directory);
  const [item] = await store.put('gallery',[pane()]);
  const files = await store.archive(['gallery']);
  const imageName = Object.keys(files).find(path=>path.endsWith('.png'));
  const imagePath = join(directory,imageName);
  const elsewhere = join(directory,'untrusted');
  await writeFile(elsewhere,sampleBytes[item.mime]);
  await rm(imagePath);
  await symlink(elsewhere,imagePath);
  await assert.rejects(store.file('gallery',item.id),{code:'ELOOP'});
  await rm(dirname(imagePath),{recursive:true});
  await symlink(directory,dirname(imagePath));
  await assert.rejects(store.list('gallery'),{status:500,code:'ARTWORK_STORAGE_INVALID'});
});
