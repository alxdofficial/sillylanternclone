import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const fixture = 'PRIVATE_TEST_VALUE';
const app = fileURLToPath(new URL('../server.mjs',import.meta.url));

test('OpenRouter drafts with the selected model and extracts metadata separately', async () => {
  const directory = await mkdtemp(join(tmpdir(),'story-studio-diagnostics-'));
  const listener = createServer();
  listener.listen(0,'127.0.0.1');
  await once(listener,'listening');
  const {port} = listener.address();
  await new Promise(resolve => listener.close(resolve));

  const mock = join(directory,'openrouter.mjs');
  const scene = {
    text:'The ferry bell rang.',input:'safe',reply:'explicit',storyTime:'1998-10-25T00:13',
    updates:[{kind:'world',note:'The ferry has a bell.'}]
  };
  await writeFile(mock,`
    import assert from 'node:assert/strict';
    const {text, ...metadata} = ${JSON.stringify(scene)};
    globalThis.fetch = async (url, options) => {
      assert.ok(url.endsWith('/chat/completions'));
      const request = JSON.parse(options.body);
      assert.equal(request.provider.data_collection,'deny');
      if (request.model === 'fixture/prose' || request.model === 'thedrummer/cydonia-24b-v4.1') {
        const endsEarly = request.messages.at(-1).content.endsWith('cutoff fixture');
        assert.equal(request.max_tokens,request.model === 'fixture/prose' ? 2048 : 8000);
        assert.ok(request.messages[0].content.includes(
          'The output limit for this turn is ' + request.max_tokens.toLocaleString('en-US') + ' tokens.'));
        assert.equal(request.response_format,undefined);
        assert.equal(request.provider.require_parameters,undefined);
        assert.match(request.messages[0].content,/For a scene, begin directly in the story/);
        assert.doesNotMatch(request.messages[0].content,/JSON Schema|Classify authorDirection/);
        if (request.messages.at(-1).content.endsWith('removal fixture')) {
          return Response.json({choices:[{finish_reason:'stop',message:{content:'[removed]'}}]});
        }
        if (request.messages.at(-1).content.endsWith('refusal fixture')) {
          return Response.json({choices:[{finish_reason:'stop',message:{
            content:"This isn't appropriate for our collaborative storytelling environment. I can write a different scene."
          }}]});
        }
        if (request.messages.at(-1).content.endsWith('decline field fixture')) {
          return Response.json({choices:[{finish_reason:'stop',message:{content:null,refusal:'The provider declined.'}}]});
        }
        const preamble = request.messages.at(-1).content.endsWith('preamble fixture')
          ? "I've been instructed to write approximately 250 words.\\n\\n" : '';
        return Response.json({provider:'Fixture Writing Host',usage:{prompt_tokens:120,completion_tokens:30},
          choices:[{finish_reason:endsEarly ? 'length' : 'stop',message:{content:preamble + text}}]});
      }
      if (request.model !== 'deepseek/deepseek-v4.1-flash') {
        return new Response(${JSON.stringify(fixture)}, {status:401});
      }
      const source = JSON.parse(request.messages.at(-1).content);
      assert.equal(source.draft,text);
      if (source.authorDirection === 'metadata outage') return new Response(null,{status:503});
      const updates = source.authorDirection === 'invalid proposals' ? [...metadata.updates,
        {kind:'relationship',from:'PRIVATE_INVALID_NAME',to:'OTHER_INVALID_NAME',label:'They talk.',storyTime:'1998-10-25T00:13'},
        {kind:'relationship',from:'Co-writer',to:'Co-writer',label:'They talk.',storyTime:'bad time'}
      ] : metadata.updates;
      assert.equal(request.provider.require_parameters,true);
      assert.equal(request.response_format.type,'json_schema');
      assert.equal(request.response_format.json_schema.strict,true);
      assert.deepEqual(request.response_format.json_schema.schema.required,Object.keys(metadata));
      assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
      assert.match(request.messages[0].content,/Classify authorDirection as input and draft as reply/);
      if (source.authorDirection === 'cutoff fixture') {
        assert.match(request.messages[0].content,/draft ends early.*Classify the text that is present/);
        assert.match(request.messages[0].content,/empty updates array/);
      }
      return Response.json({provider:'Fixture Metadata Host',usage:{prompt_tokens:160,completion_tokens:45},
        choices:[{finish_reason:'stop',message:{content:JSON.stringify({...metadata,updates})}}]});
    };
  `);
  const child = spawn(process.execPath,['--import',mock,app],{
    env:{...process.env, PORT:String(port), STORY_STUDIO_DATA:directory, STORY_STUDIO_LOG_DIR:join(directory,'logs')},
    stdio:['ignore','pipe','ignore']
  });
  const done = once(child,'exit');
  try {
    await Promise.race([
      once(child.stdout,'data',{signal:AbortSignal.timeout(5000)}),
      done.then(() => { throw Error('Server exited before listening.'); })
    ]);
    const origin = `http://127.0.0.1:${port}`;
    const headers = {origin,'content-type':'application/json'};
    const invalid = await fetch(origin+'/api/state',{method:'PUT',headers,body:fixture});
    assert.equal(invalid.status,400);
    const generate = (model, instruction = fixture) => fetch(origin+'/api/generate',{
      method:'POST',headers,body:JSON.stringify({
        project:{id:fixture,title:fixture,character:'',persona:'',lore:'',notes:'',messages:[]},
        instruction, key:fixture, provider:'openrouter',model
      })
    });
    const success = await generate('fixture/prose');
    const draft = await success.json();
    const {updates, ...expected} = scene;
    assert.equal(success.status,200,JSON.stringify(draft));
    assert.deepEqual(draft,{...expected,suggestions:updates});
    const withPreamble = await generate('fixture/prose','preamble fixture');
    assert.equal(withPreamble.status,200);
    assert.deepEqual(await withPreamble.json(),draft);
    const removed = await generate('fixture/prose','removal fixture');
    assert.equal(removed.status,500);
    assert.match((await removed.json()).error,/writing provider returned a removal placeholder/);
    for (const instruction of ['refusal fixture','decline field fixture']) {
      const refused = await generate('fixture/prose',instruction);
      assert.equal(refused.status,500);
      assert.match((await refused.json()).error,/selected OpenRouter model declined/);
    }
    const withInvalid = await generate('fixture/prose','invalid proposals');
    assert.equal(withInvalid.status,200);
    const rejected = await withInvalid.json();
    assert.equal(rejected.updateProblems,2);
    assert.deepEqual(rejected.suggestions,updates);
    assert.deepEqual(rejected.updateRejections,[
      {index:1,code:'CAST_NAME_UNRESOLVED',fields:['from','to']},
      {index:2,code:'INVALID_FIELDS',fields:[{field:'storyTime',issue:'custom'}]}
    ]);
    const cutoff = await generate('thedrummer/cydonia-24b-v4.1','cutoff fixture');
    assert.equal(cutoff.status,200);
    assert.deepEqual(await cutoff.json(),{...expected,suggestions:[],truncated:true});
    const partial = await generate('fixture/prose','metadata outage');
    assert.equal(partial.status,200);
    assert.deepEqual(await partial.json(),{
      text:scene.text,input:'unclassified',reply:'unclassified',storyTime:'',suggestions:[],metadataFailed:true
    });
    const response = await generate('custom/'+fixture);
    assert.equal(response.status,500);
    assert.match((await response.json()).error,/OpenRouter returned 401/);

    const path = join(directory,'logs','server.log');
    let contents;
    for (let check=0; check<20; check++) {
      contents = await readFile(path,'utf8');
      if (contents.includes('OPENROUTER_HTTP_ERROR')) break;
      await delay(25);
    }
    const events = contents.trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(events.some(event=>event.event==='started' && event.port===port));
    assert.ok(events.some(event=>event.code==='INVALID_JSON' && event.status===400));
    const failure = events.find(event=>event.code==='OPENROUTER_HTTP_ERROR');
    assert.equal(failure?.upstreamStatus,401);
    assert.equal(failure.model,'custom');
    assert.equal(failure.requestId,response.headers.get('x-story-studio-request-id'));
    const metadataFailure = events.find(event=>event.requestId===partial.headers.get('x-story-studio-request-id') && event.event==='request_completed');
    assert.equal(metadataFailure?.upstreamStatus,200);
    assert.equal(metadataFailure?.metadataUpstreamStatus,503);
    assert.equal(metadataFailure?.metadataCode,'OPENROUTER_HTTP_ERROR');
    const classified = events.find(event=>event.requestId===success.headers.get('x-story-studio-request-id') && event.event==='request_completed');
    assert.equal(classified?.inputSensitivity,'safe');
    assert.equal(classified?.replySensitivity,'explicit');
    assert.match(classified?.storyRef,/^[a-f0-9]{12}$/);
    assert.equal(classified?.mapProposals,1);
    assert.equal(classified?.prose?.host,'Fixture Writing Host');
    assert.equal(classified?.prose?.outputTokens,30);
    assert.equal(classified?.prose?.finishReason,'stop');
    assert.equal(classified?.metadata?.host,'Fixture Metadata Host');
    assert.equal(classified?.metadata?.inputTokens,160);
    assert.equal(classified?.metadata?.status,200);
    assert.equal(metadataFailure?.metadata?.status,503);
    const rejectedLog = events.find(event=>event.requestId===withInvalid.headers.get('x-story-studio-request-id') && event.event==='request_completed');
    assert.equal(rejectedLog?.invalidMapUpdates,2);
    assert.deepEqual(rejectedLog?.mapUpdateRejections,rejected.updateRejections);
    assert.doesNotMatch(contents,/PRIVATE_INVALID_NAME|OTHER_INVALID_NAME|bad time/);
    assert.ok(events.some(event=>event.requestId===withPreamble.headers.get('x-story-studio-request-id') && event.prosePreambleRemoved));
    assert.ok(events.some(event=>event.requestId===removed.headers.get('x-story-studio-request-id')
      && event.code==='OPENROUTER_REMOVAL_PLACEHOLDER' && event.finishReason==='stop' && !event.metadata));
    assert.equal(events.filter(event=>event.event==='request_failed'
      && event.code==='OPENROUTER_WRITING_DECLINED' && event.finishReason==='stop' && !event.metadata).length,2);
    assert.doesNotMatch(contents,new RegExp(fixture));
    assert.ok(!contents.includes(scene.text));
  } finally {
    child.kill();
    await done;
    await rm(directory,{recursive:true,force:true});
  }
});
