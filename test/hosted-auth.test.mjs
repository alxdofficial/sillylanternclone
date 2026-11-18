import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createHostedAuth } from '../hosted-auth.mjs';
import { createHostedCredentials } from '../hosted-credentials.mjs';
import { createHostedStorage } from '../hosted-storage.mjs';

const user = {id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',email:'writer@example.test'};

function response() {
  const headers = new Map();
  return {
    getHeader:name=>headers.get(name),
    setHeader:(name,value)=>headers.set(name,value),
    request() { return {headers:{cookie:headers.get('Set-Cookie')?.split(';')[0]}}; }
  };
}

function fixture() {
  let time = 0;
  let generation = 0;
  let revoked = false;
  const refreshTokens = [];
  const config = {url:'https://fixture.supabase.co',key:'sb_publishable_fixture',async fetchImpl(url,options) {
    const body = options.body && JSON.parse(options.body);
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        refreshTokens.push(body.refresh_token);
        if (revoked) return Response.json({}, {status:400});
        if (body.refresh_token === 'refresh-' + generation) generation++;
        else if (body.refresh_token !== 'refresh-' + (generation-1)) return Response.json({}, {status:400});
      }
      return Response.json({user,access_token:'access-' + generation,refresh_token:'refresh-' + generation,expires_in:60});
    }
    if (options.headers.authorization !== 'Bearer access-' + generation) return Response.json({}, {status:401});
    if (url.pathname === '/auth/v1/logout') {
      revoked = true;
      return new Response(null,{status:204});
    }
    if (url.pathname === '/rest/v1/story_studio_accounts') return Response.json([{enabled:true,can_bring_key:true}]);
    if (url.pathname === '/rest/v1/story_studio_provider_keys') return Response.json([{provider:'openrouter'}]);
    if (url.pathname === '/rest/v1/rpc/story_studio_update_provider_keys') return Response.json(false);
    if (url.pathname === '/rest/v1/rpc/story_studio_save_library') return Response.json(true);
    throw new Error('Unexpected fixture request');
  }};
  return {
    auth:createHostedAuth({...config,encryptionKey:randomBytes(32).toString('base64url'),clock:()=>time}),
    storage:createHostedStorage(config),
    advance:seconds=>{ time += seconds*1000; },
    refreshTokens,
    revoked:()=>revoked
  };
}

async function login(auth) {
  const res = response();
  await auth.login({},res,{email:user.email,password:'fixture-password'});
  return res.request();
}

test('admitted hosted requests use the current token for late storage and credential access',async ()=>{
  const {auth,storage,advance,refreshTokens} = fixture();
  const req = await login(auth);
  const admitted = response();
  const session = await auth.authenticate(req,admitted);
  const {library} = storage.forAccount(session);
  admitted.headersSent = true;
  const credentials = createHostedCredentials(auth,session);
  advance(61);
  assert.equal(await library.write({projects:[]},null),true);
  assert.equal(admitted.getHeader('Set-Cookie'),undefined);
  const polled = response();
  await auth.authenticate(req,polled);
  assert.ok(polled.getHeader('Set-Cookie'));
  advance(61);
  const repolled = response();
  await auth.authenticate(polled.request(),repolled);
  assert.deepEqual(await credentials.status(),['openrouter']);
  assert.deepEqual(refreshTokens,['refresh-0','refresh-1']);
});

test('hosted logout revokes a session with an expired access token',async ()=>{
  const {auth,advance,revoked,refreshTokens} = fixture();
  const req = await login(auth);
  advance(61);
  const signedOut = response();
  await auth.logout(req,signedOut);
  assert.match(signedOut.getHeader('Set-Cookie'),/__Host-story-studio=;.*Max-Age=0/);
  assert.deepEqual(refreshTokens,['refresh-0']);
  assert.equal(revoked(),true);
});


test('hosted key updates require confirmation from the save function',async ()=>{
  const {auth} = fixture();
  const req = await login(auth);
  const credentials = createHostedCredentials(auth,await auth.authenticate(req,response()));
  await assert.rejects(credentials.update({openrouter:'fictional-provider-test-value'}),{status:503});
});


test('a foreground request sends only its latest cookie after the token rotates again',async ()=>{
  const {auth,storage,advance,refreshTokens} = fixture();
  const req = await login(auth);
  advance(61);
  const admitted = response();
  const session = await auth.authenticate(req,admitted);
  const firstCookie = admitted.getHeader('Set-Cookie');
  advance(61);
  const {library} = storage.forAccount(session);
  assert.equal(await library.write({projects:[]},null),true);
  const latestCookie = admitted.getHeader('Set-Cookie');
  assert.equal(typeof latestCookie,'string');
  assert.notEqual(latestCookie,firstCookie);
  assert.equal(await library.write({projects:[]},null),true);
  assert.equal(admitted.getHeader('Set-Cookie'),latestCookie);
  assert.equal((await auth.authenticate(admitted.request(),response())).account.id,user.id);
  assert.deepEqual(refreshTokens,['refresh-0','refresh-1']);
});
