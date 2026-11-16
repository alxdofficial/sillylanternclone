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
      if (request.model === 'fixture/prose' || request.model === 'thedrummer/cydonia-24b-v4.1'
        || (request.model === 'deepseek/deepseek-v4.1-flash' && !request.tools)) {
        const endsEarly = request.messages.at(-1).content.endsWith('cutoff fixture');
        assert.equal(request.max_tokens,request.model === 'fixture/prose' ? 2048 : 8000);
        assert.ok(request.messages[0].content.includes(
          'The output limit for this turn is ' + request.max_tokens.toLocaleString('en-US') + ' tokens.'));
        assert.equal(request.response_format,undefined);
        assert.equal(request.tools,undefined);
        if (request.messages.at(-1).content.endsWith('sensitive fixture') || request.messages.at(-1).content.endsWith('sensitive agent routing fixture')) {
          assert.match(JSON.stringify(request.messages),/PRIVATE_HISTORY/);
          assert.doesNotMatch(JSON.stringify(request.messages),/ALL_ROUTE_MARKER/);
        } else assert.doesNotMatch(JSON.stringify(request.messages),/PRIVATE_HISTORY|ALL_ROUTE_MARKER/);
        assert.equal(request.provider.require_parameters,undefined);
        assert.match(request.messages[0].content,/For a scene, begin directly in the story/);
        assert.doesNotMatch(request.messages[0].content,/JSON Schema|Classify authorDirection/);
        if (request.messages.at(-1).content.endsWith('abandon fixture')) {
          process.stdout.write('fixture artist started\\n');
          await new Promise((resolve,reject) => options.signal.addEventListener('abort',() => {
            process.stdout.write('fixture artist canceled\\n');
            reject(options.signal.reason);
          },{once:true}));
        }
        if (request.messages.at(-1).content.startsWith('turn turn turn ')) {
          assert.ok(request.messages.at(-1).content.endsWith('PRIVATE_DIRECTION_SUFFIX'));
        }
        if (request.messages.at(-1).content.endsWith('replacement direction')) {
          assert.match(request.messages[0].content,/Original reply time:\\n1998-10-25T00:10/);
        }
        if (request.messages.at(-1).content.endsWith('late upstream error')) {
          return Response.json({error:{code:429,message:'PRIVATE_UPSTREAM_ERROR'}});
        }
        if (request.messages.at(-1).content.endsWith('removal fixture')) {
          return Response.json({choices:[{finish_reason:'stop',message:{content:"I've been instructed to write approximately 250 words.\\n\\n[removed]"}}]});
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
      const selectedSensitiveAgent = ['mistralai/mistral-large-4-0','x-ai/grok-4.7'].includes(request.model);
      if (request.model !== 'deepseek/deepseek-v4.1-flash' && !selectedSensitiveAgent) {
        return new Response(${JSON.stringify(fixture)}, {status:401});
      }
      const source = request.messages.filter(message=>message.role === 'user').map(message=>{try { return JSON.parse(message.content); } catch { return null; }}).find(message=>message && Object.hasOwn(message,'draft'));
      const observation = request.messages.at(-1);
      assert.equal(source.draft,text);
      if (selectedSensitiveAgent) {
        assert.equal(source.authorDirection,'sensitive agent routing fixture');
        assert.ok(request.messages[0].content.includes('writer marked this direction sensitive'));
      }
      assert.doesNotMatch(JSON.stringify(request.messages.slice(0,request.messages.findIndex(message=>message.content.startsWith?.('{"authorDirection":')))),/PRIVATE_HISTORY|ALL_ROUTE_MARKER/);
      if (source.authorDirection.startsWith('turn turn turn ')) {
        assert.ok(source.authorDirection.endsWith('PRIVATE_DIRECTION_SUFFIX'));
      }
      assert.equal(request.provider.require_parameters,true);
      assert.equal(request.response_format,undefined);
      assert.equal(request.tool_choice,'auto');
      assert.deepEqual(request.tools.map(tool=>tool.function.name),['inspect_continuity','record_scene']);
      assert.match(request.messages[0].content,/Classify the latest author direction and draft independently/);
      assert.match(request.messages[0].content,/Keep every field safe for work/);
      if (source.authorDirection === 'metadata outage') return new Response(null,{status:503});
      const finish = (name,args,id) => Response.json({provider:'Fixture Metadata Host',usage:{prompt_tokens:160,completion_tokens:45},
        choices:[{finish_reason:'tool_calls',message:{content:null,
          tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
      if (source.authorDirection === 'invalid proposals' && observation.role !== 'tool') {
        return finish('record_scene',{...metadata,updates:[...metadata.updates,
          {kind:'relationship',from:'PRIVATE_INVALID_NAME',to:'OTHER_INVALID_NAME',label:'They talk.'},
          {kind:'relationship',from:'The Keeper',to:'The Keeper',label:'They talk.'}
        ]},'bad-proposal');
      }
      if (source.authorDirection === 'invalid proposals') {
        assert.equal(observation.tool_call_id,'bad-proposal');
        assert.doesNotMatch(observation.content,/PRIVATE_INVALID_NAME|OTHER_INVALID_NAME/);
        assert.equal(JSON.parse(observation.content).rejections.length,2);
      }
      if (source.authorDirection === 'lookup fixture' && observation.role !== 'tool') {
        return finish('inspect_continuity',{section:'world'},'world');
      }
      if (source.authorDirection === 'lookup fixture') {
        assert.equal(observation.tool_call_id,'world');
        assert.deepEqual(JSON.parse(observation.content),{world:'The ferry is moored.'});
      }
      if (source.authorDirection === 'incomplete metadata') {
        return Response.json({choices:[{finish_reason:'stop',message:{content:'No tool used.'}}]});
      }
      const replacing = source.authorDirection === 'replacement direction';
      const cutoff = source.authorDirection === 'cutoff fixture';
      if (replacing || cutoff) assert.match(request.messages[0].content,/empty updates array/);
      if (replacing) assert.equal(source.knownTime,'1998-10-25T00:10');
      if (cutoff) assert.match(request.messages[0].content,/draft ends early/);
      return finish('record_scene',{...metadata,updates:replacing || cutoff ? [] : metadata.updates},'record');
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
    const nullGeneration = await fetch(origin+'/api/generate',{method:'POST',headers,body:'null'});
    assert.equal(nullGeneration.status,400);
    const invalid = await fetch(origin+'/api/state',{method:'PUT',headers,body:fixture});
    assert.equal(invalid.status,400);
    const generate = (model, instruction = fixture, mode = 'send', sensitive = false, signal, agentModel) => fetch(origin+'/api/generate',{
      method:'POST',headers,signal,body:JSON.stringify({
        project:{id:fixture,title:fixture,cast:[{id:'keeper',name:'The Keeper',description:'',personality:'',scenario:'',examples:''}],lore:'The ferry is moored.',notes:'',messages:[
          {role:'assistant',content:'PRIVATE_HISTORY',contentSensitivity:'explicit'},
          {role:'assistant',content:'ALL_ROUTE_MARKER',excludeFromContext:true}
        ],
          ...(mode === 'replace' ? {replyTime:'1998-10-25T00:10'} : {})},
        instruction, key:fixture, provider:'openrouter',model,mode,sensitive,agentModel
      })
    });
    const controller = new AbortController();
    const artistStarted = once(child.stdout,'data',{signal:AbortSignal.timeout(5000)});
    const abandoned = assert.rejects(generate('fixture/prose','abandon fixture','send',false,controller.signal),{name:'AbortError'});
    assert.match(String((await artistStarted)[0]),/fixture artist started/);
    const artistCanceled = once(child.stdout,'data',{signal:AbortSignal.timeout(5000)});
    controller.abort();
    await abandoned;
    assert.match(String((await artistCanceled)[0]),/fixture artist canceled/);

    const blockedAgent = await generate('thedrummer/cydonia-24b-v4.1','blocked route fixture','send',true,undefined,'openai/gpt-6.1-terra');
    assert.equal(blockedAgent.status,400);
    assert.match((await blockedAgent.json()).error,/supported sensitive-scene continuity agent/);
    for (const agentModel of ['mistralai/mistral-large-4-0','x-ai/grok-4.7']) {
      const routed = await generate('thedrummer/cydonia-24b-v4.1','sensitive agent routing fixture','send',true,undefined,agentModel);
      assert.equal(routed.status,200);
      const response = await routed.json();
      assert.equal(response.input,'explicit');
      assert.equal(response.metadataFailed,undefined);
      assert.deepEqual(response.suggestions,scene.updates);
    }
    const success = await generate('fixture/prose');
    const draft = await success.json();
    const {updates, ...expected} = scene;
    assert.equal(success.status,200,JSON.stringify(draft));
    assert.deepEqual(draft,{...expected,suggestions:updates});
    const deepSeekProse = await generate('deepseek/deepseek-v4.1-flash');
    assert.equal(deepSeekProse.status,200);
    assert.deepEqual(await deepSeekProse.json(),draft);
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
    assert.deepEqual(rejected,draft);
    const lookedUp = await generate('fixture/prose','lookup fixture');
    assert.deepEqual(await lookedUp.json(),draft);
    const unsupported = await generate('fixture/prose','sensitive fixture','send',true);
    assert.equal(unsupported.status,400);
    const sensitive = await generate('thedrummer/cydonia-24b-v4.1','sensitive fixture','send',true);
    assert.deepEqual(await sensitive.json(),{...draft,input:'explicit'});
    const cutoff = await generate('thedrummer/cydonia-24b-v4.1','cutoff fixture');
    assert.equal(cutoff.status,200);
    assert.deepEqual(await cutoff.json(),{...expected,suggestions:[],truncated:true});
    const partial = await generate('fixture/prose','metadata outage');
    assert.equal(partial.status,200);
    assert.deepEqual(await partial.json(),{
      text:scene.text,input:'unclassified',reply:'unclassified',storyTime:'',suggestions:[],metadataFailed:true
    });
    const incomplete = await generate('fixture/prose','incomplete metadata');
    assert.deepEqual(await incomplete.json(),{text:scene.text,input:'unclassified',reply:'unclassified',storyTime:'',suggestions:[],metadataFailed:true});
    const direction = 'turn '.repeat(7999) + 'PRIVATE_DIRECTION_SUFFIX';
    const exact = await generate('fixture/prose',direction);
    assert.deepEqual(await exact.json(),draft);
    const long = await generate('fixture/prose',direction.repeat(3));
    assert.equal(long.status,400);
    assert.match((await long.json()).error,/shared input budget/);
    const replacement = await generate('fixture/prose','replacement direction','replace');
    assert.deepEqual(await replacement.json(),{...draft,storyTime:'1998-10-25T00:10',suggestions:[]});
    const providerError = await generate('fixture/prose','late upstream error');
    assert.equal(providerError.status,500);
    assert.match((await providerError.json()).error,/OpenRouter reported a provider error.*rate limited/);
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
    assert.ok(events.some(event=>event.event==='generation_disconnected' &&
      event.endpoint==='/api/generate' && !event.metadata));
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
    const incompleteLog = events.find(event=>event.requestId===incomplete.headers.get('x-story-studio-request-id') && event.event==='request_completed');
    assert.equal(incompleteLog?.metadataCode,'CONTINUITY_NOT_RECORDED');
    const longLog = events.find(event=>event.requestId===long.headers.get('x-story-studio-request-id'));
    assert.equal(longLog?.status,400);
    assert.equal(longLog?.prose,undefined);
    const upstreamError = events.find(event=>event.code==='OPENROUTER_UPSTREAM_ERROR');
    assert.equal(upstreamError?.prose?.status,200);
    assert.equal(upstreamError?.prose?.errorStatus,429);
    assert.equal(upstreamError?.metadata,undefined);
    assert.doesNotMatch(contents,/PRIVATE_UPSTREAM_ERROR|PRIVATE_DIRECTION_SUFFIX|invalid fixture label/);
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
    assert.equal(rejectedLog?.toolRounds,2);
    assert.deepEqual(rejectedLog?.toolCalls.map(round=>round.tools),[['record_scene'],['record_scene']]);
    assert.deepEqual(rejectedLog?.mapUpdateRejections.map(({code})=>code),['CAST_NAME_UNRESOLVED','SELF_RELATIONSHIP']);
    assert.doesNotMatch(contents,/PRIVATE_INVALID_NAME|OTHER_INVALID_NAME|bad time/);
    assert.ok(events.some(event=>event.requestId===withPreamble.headers.get('x-story-studio-request-id') && event.prosePreambleRemoved));
    assert.ok(events.some(event=>event.requestId===removed.headers.get('x-story-studio-request-id')
      && event.code==='OPENROUTER_REMOVAL_PLACEHOLDER' && event.finishReason==='stop' && !event.metadata));
    assert.equal(events.filter(event=>event.event==='request_failed'
      && event.code==='OPENROUTER_WRITING_DECLINED' && event.finishReason==='stop' && !event.metadata).length,2);
    assert.doesNotMatch(contents,new RegExp(fixture));
    assert.doesNotMatch(contents,/PRIVATE_HISTORY|ALL_ROUTE_MARKER/);
    assert.ok(!contents.includes(scene.text));
    const full = await readFile(join(directory,'logs','openrouter-trace.log'),'utf8');
    const exchanges = full.trim().split('\n').map(line=>JSON.parse(line));
    const byRequest = (res, stage, event) => exchanges.find(record=>record.requestId === res.headers.get('x-story-studio-request-id') && record.stage === stage && record.event === event);
    const proseRequest = byRequest(sensitive,'prose','request');
    assert.match(JSON.stringify(proseRequest.payload.messages),/PRIVATE_HISTORY/);
    assert.doesNotMatch(JSON.stringify(byRequest(success,'prose','request').payload.messages),/PRIVATE_HISTORY/);
    assert.doesNotMatch(full,/ALL_ROUTE_MARKER|PRIVATE_TEST_VALUE/);
    const proseResponse = byRequest(sensitive,'prose','response');
    assert.equal(proseResponse.exchangeId,proseRequest.exchangeId);
    assert.equal(proseResponse.payload.choices[0].message.content,scene.text);
    assert.match(JSON.stringify(byRequest(sensitive,'metadata','response').payload),/record_scene/);
    assert.equal(byRequest(response,'prose','response').body,'[REDACTED API KEY]');
  } finally {
    child.kill();
    await done;
    await rm(directory,{recursive:true,force:true});
  }
});
