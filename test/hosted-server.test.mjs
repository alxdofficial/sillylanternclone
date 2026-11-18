import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { test } from 'node:test';

const accountIds = ['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-accc-cccccccccccc'];
const origin = 'https://studio.example.test';

async function listen(server) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return server.address().port;
}

async function startStudio(t,{google = false} = {}) {
  const rows = new Map();
  const providerKeys = new Map();
  let challenge;
  const fixture = createServer(async (req,res)=>{
    const json = (status,data) => res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
    const url = new URL(req.url,'https://example.supabase.co');
    const received = [];
    for await (const chunk of req) received.push(chunk);
    const text = Buffer.concat(received).toString();
    const data = text && req.headers['content-type'] === 'application/json' ? JSON.parse(text) : undefined;
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'pkce') {
        const index = ['approved-code','second-approved-code','uninvited-code'].indexOf(data?.auth_code);
        if (index < 0) return json(400,{});
        if (!challenge || createHash('sha256').update(data?.code_verifier || '').digest('base64url') !== challenge) return json(400,{});
        const id = accountIds[index];
        return json(200,{access_token:id,refresh_token:'refresh-' + id,expires_in:3600,
          user:{id,email:`google-${index}@example.test`}});
      }
      return json(400,{});
    }
    const account = req.headers.authorization?.slice(7);
    if (!accountIds.includes(account)) return json(401,{});
    if (url.pathname === '/auth/v1/logout') return res.writeHead(204).end();
    const [,,method,operation] = url.pathname.slice(1).split('/');
    const table = operation || method;
    const entitled = account === accountIds[0];
    if (table === 'story_studio_redeem_google_invite') return json(200,account !== accountIds[2]);
    if (table === 'story_studio_accounts') return json(200,[{enabled:true,can_bring_key:entitled}]);
    if (table === 'story_studio_provider_keys') {
      return json(200,Object.entries(providerKeys.get(account) || {}).map(([provider,ciphertext])=>({provider,ciphertext})));
    }
    if (table === 'story_studio_update_provider_keys') {
      if (!entitled) return json(403,{});
      providerKeys.set(account,data.p_changes);
      return json(200,true);
    }
    if (table === 'story_studio_libraries') return json(200,rows.has(account) ? [rows.get(account)] : []);
    if (table === 'story_studio_save_library') {
      if ((rows.get(account)?.revision ?? null) !== data.p_expected_revision) return json(200,false);
      // Mimic JSONB changing property order on round trip.
      const library = JSON.parse(JSON.stringify(data.p_library,(_key,value)=>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse()) : value));
      rows.set(account,{library,revision:data.p_revision});
      return json(200,true);
    }
    if (table === 'story_studio_records') return json(200,[]);
    if (table === 'story_studio_save_record') return json(200,true);
    if (url.pathname.startsWith('/storage/v1/object/')) return res.writeHead(200).end();
    return json(404,{});
  });
  const fixturePort = await listen(fixture);
  t.after(()=>fixture.close());
  const listener = createServer();
  const port = await listen(listener);
  await new Promise(resolve=>listener.close(resolve));

  const interception = `
    const original = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const target = new URL(input);
      if (target.origin !== 'https://example.supabase.co') throw Error('Unexpected outbound request in integration test.');
      return original('http://127.0.0.1:${fixturePort}' + target.pathname + target.search, options);
    };`;
  const child = spawn(process.execPath,['--import','data:text/javascript,' + encodeURIComponent(interception),'server.mjs'],{
    env:{...process.env,PORT:String(port),STORY_STUDIO_MODE:'hosted',STORY_STUDIO_ORIGIN:origin,
      SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_integration_test',
      STORY_STUDIO_ENCRYPTION_KEY:randomBytes(32).toString('base64url'),STORY_STUDIO_GOOGLE_LOGIN:google ? '1' : '0'},stdio:['ignore','pipe','pipe']
  });
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{
    const timeout = setTimeout(()=>reject(new Error('Hosted server did not start')),5_000);
    child.stdout.on('data',chunk=>{
      if (chunk.toString().includes('Story Studio running')) { clearTimeout(timeout); resolve(); }
    });
    let stderr = '';
    child.stderr.on('data',chunk=>{ stderr += chunk; });
    child.once('exit',code=>{ clearTimeout(timeout); reject(new Error(`Hosted server exited ${code}: ${stderr}`)); });
  });

  function request(path,{account,cookie,method = 'GET',data,requestOrigin = origin,revision} = {}) {
    return new Promise((resolve,reject)=>{
      const req = httpRequest({hostname:'127.0.0.1',port,path,method,headers:{
        Host:new URL(origin).host,Origin:requestOrigin,
        ...(cookie ? {Cookie:cookie} : {}),
        ...(account ? {'X-Story-Studio-Account':account} : {}),
        ...(revision ? {'If-Match':revision} : {}),
        ...(method === 'GET' ? {} : {'Content-Type':'application/json'})
      }},async response=>{
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        const headers = new Headers();
        for (const [name,values] of Object.entries(response.headers)) {
          for (const value of [].concat(values)) headers.append(name,value);
        }
        resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers}));
      });
      req.on('error',reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  return {request,providerKeys,expectChallenge(value) { challenge = value; }};
}

async function googleCallback({request,expectChallenge},code) {
  const start = await request('/api/account/google');
  assert.equal(start.status,303);
  const upstream = new URL(start.headers.get('location'));
  assert.equal(upstream.origin,'https://example.supabase.co');
  assert.equal(upstream.searchParams.get('redirect_to'),origin + '/api/account/google/callback');
  assert.equal(upstream.searchParams.get('code_challenge_method'),'s256');
  expectChallenge(upstream.searchParams.get('code_challenge'));
  const cookie = start.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);
  return request('/api/account/google/callback?code=' + code,{cookie:cookie.split(';')[0]});
}

test('hosted routes enforce session ownership, durable revisions and BYOK entitlement',async t=>{
  const studio = await startStudio(t,{google:true});
  const {request,providerKeys} = studio;
  assert.equal((await request('/healthz')).status,200);
  assert.deepEqual(await (await request('/api/account')).json(),{hosted:true,account:null,google:true});
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/account/login',{method:'POST',data:{},requestOrigin:'https://other.example'})).status,403);

  assert.equal((await request('/api/account/login',{method:'POST',data:{email:'writer@example.test',password:'fixture-password'}})).status,401);

  async function login(index,code) {
    const response = await googleCallback(studio,code);
    assert.equal(response.headers.get('location'),'/');
    const session = response.headers.getSetCookie().find(cookie=>cookie.startsWith('__Host-story-studio='));
    assert.match(session,/HttpOnly; Secure; SameSite=Lax/);
    assert.doesNotMatch(session,/refresh-/);
    return {cookie:session.split(';')[0],account:accountIds[index]};
  }
  const first = await login(0,'approved-code');
  const second = await login(1,'second-approved-code');
  assert.equal((await request('/api/state',{...first,account:second.account})).status,401);
  assert.equal((await request('/api/artwork/image?account=' + second.account,first)).status,401);
  const anonymousKey = await request('/api/provider-keys',second);
  assert.deepEqual(await anonymousKey.json(),{enabled:[]});
  const key = 'fictional-provider-test-value';
  const update = account=>request('/api/provider-keys',{...account,method:'PUT',data:{openrouter:key}});
  assert.equal((await update(second)).status,403);
  const savedKey = await update(first);
  assert.equal(savedKey.status,200);
  assert.deepEqual(await savedKey.json(),{enabled:['openrouter']});
  assert.ok(providerKeys.get(first.account).openrouter.length);
  assert.ok(!providerKeys.get(first.account).openrouter.includes(key));

  const before = await request('/api/state',first);
  const etag = before.headers.get('etag');
  const project = {id:'private-id',title:'Private story',lore:'',notes:'',messages:[]};
  const save = await request('/api/state',{...first,method:'PUT',revision:etag,data:{activeId:project.id,projects:[project]}});
  assert.equal(save.status,200);
  const expected = (await save.json()).revision;
  const afterward = await request('/api/state',first);
  assert.equal(afterward.headers.get('etag'),expected);
  assert.ok((await afterward.json()).projects.some(item=>item.id===project.id));
  assert.ok(!(await (await request('/api/state',second)).json()).projects.some(item=>item.id===project.id));
  assert.equal((await request('/api/state',{...first,method:'PUT',revision:etag,data:{activeId:'',projects:[]}})).status,409);
  assert.equal((await request('/api/account/logout',{...second,method:'POST',data:{}})).status,200);
});

test('hosted Google login uses PKCE and gates the session on the verified invite',async t=>{
  const studio = await startStudio(t,{google:true});
  const {request} = studio;
  assert.deepEqual(await (await request('/api/account')).json(),{hosted:true,account:null,google:true});
  const missingCookie = await request('/api/account/google/callback?code=approved-code');
  assert.equal(missingCookie.headers.get('location'),'/?signin=expired');

  const uninvited = await googleCallback(studio,'uninvited-code');
  assert.equal(uninvited.headers.get('location'),'/?signin=not-invited');
  assert.equal(uninvited.headers.getSetCookie().some(cookie=>cookie.startsWith('__Host-story-studio=')),false);
  const invited = await googleCallback(studio,'approved-code');
  assert.equal(invited.headers.get('location'),'/');
  assert.match(invited.headers.getSetCookie()[0],/__Host-story-studio-oauth=;.*Max-Age=0/);
  const cookie = invited.headers.getSetCookie()[1].split(';')[0];
  const account = await (await request('/api/account',{cookie})).json();
  assert.equal(account.account.id,accountIds[0]);
  assert.equal(account.account.canBringKey,true);
});
