import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostedStorage } from '../hosted-storage.mjs';

const first = 'a0000000-0000-4000-8000-000000000001';
const second = 'a0000000-0000-4000-8000-000000000002';

function fixture() {
  const rows = new Map(), objects = new Map();
  let conflict = false;
  const storage = createHostedStorage({url:'https://storage.example',key:'publishable',fetchImpl:async (url,options)=>{
    const [,token] = options.headers.authorization.split(' ');
    assert.equal(options.headers.apikey,'publishable');
    if (url.pathname.startsWith('/rest/')) {
      if (options.method === 'POST') {
        const args = JSON.parse(options.body);
        const record = args.p_record_key ?? 'library';
        const key = token+'/'+record;
        if (conflict || (rows.get(key)?.revision ?? null) !== args.p_expected_revision) {
          conflict = false;
          return Response.json(false);
        }
        rows.set(key,{revision:args.p_revision, [record === 'library' ? 'library' : 'value']:args.p_library ?? args.p_value});
        return Response.json(true);
      }
      assert.equal(url.searchParams.get('user_id'),'eq.'+token);
      const record = url.searchParams.get('record_key')?.slice(3) ?? 'library';
      const row = rows.get(token+'/'+record);
      return Response.json(row ? [row] : []);
    }
    const objectPath = url.pathname.split('/story-studio-private')[1].slice(1);
    if (options.method === 'DELETE') {
      for (const object of JSON.parse(options.body).prefixes) {
        assert.ok(object.startsWith(token+'/'));
        objects.delete(object);
      }
      return Response.json([]);
    }
    assert.ok(objectPath.startsWith(token+'/'));
    if (options.method === 'POST') {
      assert.equal(objects.has(objectPath),false);
      objects.set(objectPath,options.body);
      return Response.json({Key:objectPath});
    }
    assert.match(url.pathname,/\/object\/authenticated\//u);
    assert.ok(objects.has(objectPath));
    return new Response(objects.get(objectPath));
  }});
  return {
    account:userId=>storage.forAccount({userId,accessToken:userId}),
    objects,
    conflictOnce:()=>{ conflict = true; }
  };
}

test('library writes use per-account compare and swap',async ()=>{
  const {account} = fixture();
  const a = account(first).library;
  const b = account(second).library;
  assert.deepEqual(await a.read(),{value:null,revision:null});
  const value = {activeId:'private',projects:[]};
  assert.equal(await a.write(value,null),true);
  assert.equal(await a.write({activeId:'duplicate',projects:[]},null),false);
  const saved = await a.read();
  assert.deepEqual(saved.value,value);
  assert.equal(await a.write({activeId:'next',projects:[]},saved.revision),true);
  assert.equal(await a.write(value,saved.revision),false);
  assert.deepEqual(await b.read(),{value:null,revision:null});
});

test('private artwork retries manifest conflicts and archives original assets',async ()=>{
  const {account,objects,conflictOnce} = fixture();
  const {artwork} = account(first);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+2dxkAAAAASUVORK5CYII=','base64');
  conflictOnce();
  const [image] = await artwork.put('same-story',[{mime:'image/png',kind:'illustration',label:'Cover',prompt:'A cover',bytes:png}]);
  assert.equal(objects.size,1);
  assert.deepEqual(await artwork.file('same-story',image.id),{mime:'image/png',bytes:png});
  assert.equal(await account(second).artwork.file('same-story',image.id),null);
  const archive = await artwork.archive(['same-story']);
  assert.ok(Object.values(archive).some(bytes=>bytes.equals(png)));
  await artwork.update('same-story',image.id,{action:'discard'});
  assert.equal(await artwork.file('same-story',image.id),null);
  assert.equal(objects.size,0);
});

test('private versions and spend persist through a new account adapter',async ()=>{
  const {account} = fixture();
  const time = new Date('2026-11-18T12:00:00.000Z');
  const firstAccess = account(first);
  const project = {id:'story',title:'Private',messages:[]};
  const version = await firstAccess.versions.record(project);
  await firstAccess.spend.record({provider:'openrouter',model:'openrouter/free',result:{usage:{cost:0.1}},time});
  const reopened = account(first);
  assert.deepEqual(await reopened.versions.get('story',version.id),project);
  assert.equal((await reopened.records.read('spend:2026-11-18')).value.entries[0].usd,0.1);
  assert.deepEqual(await account(second).versions.list('story'),[]);
});
