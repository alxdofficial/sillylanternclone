import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { providerAdapters } from '../provider-api.mjs';

test('provider cache hints preserve transcript roles and leave changing batch passages outside the marked prefix', () => {
  const system = {role:'system',content:'Instructions'}, user = {role:'user',content:'Previous direction'};
  const scene = {role:'assistant',content:'Previous scene'}, current = {role:'user',content:'Current request'};
  const messages = [system,user,scene,current];
  const request = (provider,model,stage,params = {}) => providerAdapters.get(provider).request({
    stage,model,messages,maxOutputTokens:100,storyRef:'abc123',...params
  });
  for (const provider of ['anthropic','openrouter']) {
    const model = provider === 'anthropic' ? 'claude-sonnet-5-5' : 'anthropic/claude-sonnet-5.5';
    for (const [stage,params] of [['prose',{}],['story-edit',{prefixLength:3}]]) {
      const body = request(provider,model,stage,params);
      assert.deepEqual(body.messages.at(-2),{role:'assistant',content:[
        {type:'text',text:scene.content,cache_control:{type:'ephemeral'}}
      ]});
      assert.deepEqual(body.messages.at(-1),current);
      if (provider === 'openrouter') assert.equal(body.session_id,'studio-abc123-'+stage);
    }
    const batch = request(provider,model,'revision-background',{messages:[system,current]});
    const blocks = provider === 'anthropic' ? batch.system : batch.messages[0].content;
    assert.equal(blocks[0].cache_control.type,'ephemeral');
    assert.deepEqual(batch.messages.at(-1),current);
    assert.equal(batch.cache_control,undefined);
  }
  for (const [provider,model] of [['openai','gpt-6.1-terra'],['openrouter','openai/gpt-6.1-terra']]) {
    const body = request(provider,model,'story-edit',{prefixLength:3});
    const input = body.input ?? body.messages;
    assert.equal(input[1].content[0].text,user.content);
    assert.deepEqual(input[1].content[0].prompt_cache_breakpoint,{mode:'explicit'});
    assert.deepEqual(input.slice(2),[scene,current]);
    for (const stage of ['revision-background','setup-extract']) {
      const batch = request(provider,model,stage,{messages:[system,current]});
      assert.deepEqual(batch.prompt_cache_options,{mode:'explicit'});
      assert.deepEqual((batch.input ?? batch.messages).at(-1),current);
    }
  }
  assert.deepEqual(request('openrouter','custom/model','prose').messages,messages);
  assert.deepEqual(messages,[system,user,scene,current]);
});

test('direct providers draft and exchange native tool results without crossing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(),'story-studio-providers-'));
  const listener = createServer().listen(0,'127.0.0.1');
  await once(listener,'listening');
  const {port} = listener.address();
  await new Promise(resolve=>listener.close(resolve));
  const mock = join(directory,'providers.mjs');
  await writeFile(mock,`
    import assert from 'node:assert/strict';
    const update = {input:'safe',reply:'safe',storyTime:'1998-10-25T00:13',
      updates:[{kind:'world',note:'The ferry has a bell.'}]};
    const setup = {title:'The Bell',lore:'A ferry port.',scenario:'The bell stops.',notes:'',
      cast:[{name:'Ada',description:'The dock keeper.'}]};
    const edit = {changes:[{kind:'world',action:'append',text:'The pier has a lighthouse.'}],
      message:'Added the lighthouse.',historySafe:true};
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url === 'https://api.anthropic.com/v1/messages') {
        assert.equal(options.headers['x-api-key'],'claude-fixture');
        assert.equal(options.headers.authorization,undefined);
        assert.equal(body.model,'claude-sonnet-5-5');
        assert.ok(body.system);
        assert.ok(body.messages.every(message=>message.role !== 'system'));
        if (!body.tools) return Response.json({stop_reason:'end_turn',usage:{input_tokens:1000,output_tokens:20},
          content:[{type:'text',text:'The ferry bell rang.'}]});
        if (body.tools.some(tool=>tool.name === 'prepare_story_setup')) {
          return Response.json({stop_reason:'tool_use',content:[{type:'tool_use',
            id:'setup-call',name:'prepare_story_setup',input:setup}]});
        }
        assert.ok(body.tools.find(tool=>tool.name === 'inspect_continuity').input_schema);
        assert.equal(body.tool_choice.disable_parallel_tool_use,true);
        const result = body.messages.at(-1).content;
        if (Array.isArray(result)) {
          assert.deepEqual(result,[{type:'tool_result',tool_use_id:'claude-world',content:'{"world":"The ferry is moored."}'}]);
          assert.equal(body.messages.at(-2).content[0].id,'claude-world');
        }
        return Response.json({stop_reason:'tool_use',content:[{type:'tool_use',
          id:Array.isArray(result) ? 'claude-done' : 'claude-world',
          name:Array.isArray(result) ? 'record_scene' : 'inspect_continuity',
          input:Array.isArray(result) ? update : {section:'world'}}]});
      }
      assert.equal(url,'https://api.openai.com/v1/responses');
      assert.equal(options.headers.authorization,'Bearer openai-fixture');
      assert.equal(options.headers['x-api-key'],undefined);
      assert.equal(body.model,'gpt-6.1-terra');
      assert.equal(body.store,false);
      if (!body.tools) return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:20},output:[
        {type:'message',role:'assistant',content:[{type:'output_text',text:'The ferry bell rang.'}]}]});
      if (body.tools.some(tool=>tool.name === 'edit_story_state')) {
        const input = JSON.stringify(body.input);
        const feedback = body.input.at(-1);
        let result = edit;
        if (input.includes('Insert a short dock scene.')) {
          result = {changes:[],manuscript:[{kind:'insert_scene',text:'A boat returned to the dock.'}],message:'A scene is ready to review.'};
        } else if (input.includes('Local-only example.')) {
          result = {changes:[],message:'No story changes.',historySafe:false};
        } else if (input.includes('Concurrent edit example.')) {
          const origin = 'http://127.0.0.1:' + process.env.PORT;
          const state = await nativeFetch(origin+'/api/state');
          const {activeId,projects} = await state.json();
          const project = projects.find(item=>item.id === activeId);
          const saved = await nativeFetch(origin+'/api/starter',{method:'PUT',
            headers:{origin,'content-type':'application/json','if-match':state.headers.get('etag')},
            body:JSON.stringify({...project,title:'A concurrent change'})});
          assert.equal(saved.status,200);
          result = {changes:[{kind:'settings',title:'An agent change'}],message:'Changed the title.'};
        } else if (input.includes('Remove missing event.')) {
          result = feedback.type === 'function_call_output' ? {changes:[],message:'Removed the event.'} :
            {changes:[{kind:'remove_relationship',eventIndex:999}],message:'Removed the event.'};
        } else if (feedback.type === 'function_call_output') {
          assert.equal(feedback.call_id,'edit-call');
          assert.match(JSON.parse(feedback.output).error,/exact, unambiguous cast name/);
        } else {
          result = {changes:[...edit.changes,{kind:'rename_character',name:'Unrecognized',newName:'Ada'}],
            message:'Added the lighthouse and renamed the character.'};
        }
        return Response.json({status:'completed',output:[{type:'function_call',
          call_id:feedback.type === 'function_call_output' ? 'edit-retry' : 'edit-call',
          name:'edit_story_state',arguments:JSON.stringify(result)}]});
      }
      assert.ok(body.tools.find(tool=>tool.name === 'inspect_continuity').parameters);
      assert.deepEqual(body.include,['reasoning.encrypted_content']);
      assert.equal(body.parallel_tool_calls,false);
      const result = body.input.at(-1);
      const found = result.type === 'function_call_output';
      if (found) {
        assert.deepEqual(result,{type:'function_call_output',call_id:'openai-world',output:'{"world":"The ferry is moored."}'});
        assert.equal(body.input.at(-3).encrypted_content,'opaque-reasoning');
        assert.equal(body.input.at(-2).call_id,'openai-world');
      }
      return Response.json({status:'completed',output:[
        {type:'reasoning',id:'reasoning-id',summary:[],encrypted_content:'opaque-reasoning'},
        {type:'function_call',id:'function-id',call_id:found ? 'openai-done' : 'openai-world',
          name:found ? 'record_scene' : 'inspect_continuity',arguments:JSON.stringify(found ? update : {section:'world'})}
      ]});
    };
  `);
  const child = spawn(process.execPath,['--import',mock,fileURLToPath(new URL('../server.mjs',import.meta.url))],{
    env:{...process.env,PORT:String(port),STORY_STUDIO_DATA:directory,STORY_STUDIO_LOG_DIR:join(directory,'logs')},
    stdio:['ignore','pipe','inherit']
  });
  const done = once(child,'exit');
  try {
    await Promise.race([once(child.stdout,'data',{signal:AbortSignal.timeout(5000)}),
      done.then(()=>{ throw Error('Server exited before listening.'); })]);
    const origin = 'http://127.0.0.1:' + port;
    const send = (body,path = '/api/generate') => fetch(origin+path,{method:'POST',
      headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    const project = {id:'fixture',title:'Ferry',lore:'The ferry is moored.',notes:'',cast:[],messages:[]};
    const claude = {provider:'anthropic',model:'claude-sonnet-5-5',key:'claude-fixture'};
    const openai = {provider:'openai',model:'gpt-6.1-terra',key:'openai-fixture'};
    for (const [writer,agent] of [[claude,openai],[openai,claude]]) {
      const reply = await send({project,instruction:'Ring the bell.',...writer,
        agentProvider:agent.provider,agentModel:agent.model,agentKey:agent.key});
      assert.equal(reply.status,200);
      const scene = await reply.json();
      assert.equal(scene.text,'The ferry bell rang.');
      assert.equal(scene.reply,'safe');
      assert.deepEqual(scene.suggestions,[{kind:'world',note:'The ferry has a bell.'}]);
    }
    const setup = await send({...claude,mode:'draft',
      messages:[{role:'user',content:'Plan a story about a ferry.'}]},'/api/setup');
    assert.equal(setup.status,200);
    assert.equal((await setup.json()).draft.cast[0].name,'Ada');
    const state = await fetch(origin+'/api/state');
    const {activeId,projects} = await state.json();
    const original = projects.find(story=>story.id === activeId);
    const edit = await send({...openai,storyId:activeId,revision:state.headers.get('etag'),
      instruction:'Add a lighthouse.'},'/api/story-edits');
    assert.equal(edit.status,200);
    assert.deepEqual(await edit.json(),{count:1,message:'Added the lighthouse.'});
    const saved = (await (await fetch(origin+'/api/state')).json()).projects.find(story=>story.id === activeId);
    assert.match(saved.lore,/The pier has a lighthouse/);
    assert.deepEqual(saved.messages,original.messages);
    assert.equal(saved.agentHistory.at(-1).message,'Added the lighthouse.');
    const afterEdit = await fetch(origin+'/api/state');
    const privateEdit = await send({...openai,storyId:activeId,revision:afterEdit.headers.get('etag'),
      instruction:'Local-only example.'},'/api/story-edits');
    assert.equal(privateEdit.status,200);
    const afterPrivate = (await (await fetch(origin+'/api/state')).json()).projects.find(story=>story.id === activeId);
    assert.deepEqual(afterPrivate.agentHistory.at(-1),{afterTurn:original.messages.at(-1)?.turnNumber ?? original.messages.length,request:'Local-only example.',
      message:'No story changes.',count:0,historySafe:false});
    assert.deepEqual(afterPrivate.messages,original.messages);
    const rejectedState = await fetch(origin+'/api/state');
    const rejected = await send({...openai,storyId:activeId,revision:rejectedState.headers.get('etag'),
      instruction:'Remove missing event.'},'/api/story-edits');
    assert.equal(rejected.status,200);
    const rejectedReply = await rejected.json();
    assert.equal(rejectedReply.count,0);
    assert.match(rejectedReply.message,/No story changes were saved.*eventIndex/);
    const afterRejected = (await (await fetch(origin+'/api/state')).json()).projects.find(story=>story.id === activeId);
    assert.equal(afterRejected.agentHistory.at(-1).message,rejectedReply.message);
    assert.deepEqual(afterRejected.relationships,afterPrivate.relationships);
    assert.deepEqual(afterRejected.messages,original.messages);
    const conflictState = await fetch(origin+'/api/state');
    const conflicted = await send({...openai,storyId:activeId,revision:conflictState.headers.get('etag'),
      instruction:'Concurrent edit example.'},'/api/story-edits');
    assert.equal(conflicted.status,409);
    assert.match((await conflicted.json()).error,/story changed before saving the edit/i);
    const afterConflict = (await (await fetch(origin+'/api/state')).json()).projects.find(story=>story.id === activeId);
    assert.equal(afterConflict.title,'A concurrent change');
    assert.deepEqual(afterConflict.agentHistory,afterRejected.agentHistory);
    const forProposal = await fetch(origin+'/api/state');
    const proposal = await send({...openai,storyId:activeId,revision:forProposal.headers.get('etag'),
      instruction:'Insert a short dock scene.'},'/api/story-edits');
    assert.equal(proposal.status,200);
    const {proposalId} = await proposal.json();
    assert.ok(proposalId);
    const beforeApproval = await fetch(origin+'/api/state');
    const approvalRevision = beforeApproval.headers.get('etag');
    const application = decision=>fetch(origin+'/api/story-edits',{method:'PUT',
      headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({storyId:activeId,revision:approvalRevision,proposalId,decision})});
    const applied = await application('apply');
    assert.equal(applied.status,200);
    assert.deepEqual(await applied.json(),{count:1});
    const retried = await application('apply');
    assert.equal(retried.status,200);
    assert.deepEqual(await retried.json(),{count:1});
    assert.equal((await application('dismiss')).status,409);
    const approved = (await (await fetch(origin+'/api/state')).json()).projects.find(story=>story.id === activeId);
    assert.equal(approved.messages.filter(message=>message.content === 'A boat returned to the dock.').length,1);

    const mismatched = await send({project,instruction:'Ring the bell.',...openai,model:claude.model});
    assert.equal(mismatched.status,400);
    const keyMissing = await send({project,instruction:'Ring the bell.',...openai,
      agentProvider:claude.provider,agentModel:claude.model});
    assert.equal(keyMissing.status,400);
    const sensitive = await send({project,instruction:'Ring the bell.',...claude,
      agentProvider:openai.provider,agentModel:openai.model,agentKey:openai.key,sensitive:true});
    assert.equal(sensitive.status,400);
    const saveKeys = (keys,site = origin)=>fetch(origin+'/api/provider-keys',{method:'PUT',
      headers:{origin:site,'content-type':'application/json'},body:JSON.stringify(keys)});
    assert.equal((await saveKeys({openai:openai.key},'http://example.org')).status,403);
    assert.equal((await saveKeys({openai:openai.key,unknown:'fixture'})).status,400);
    assert.equal((await saveKeys({openai:openai.key,anthropic:claude.key})).status,200);
    assert.equal((await stat(join(directory,'credentials','providers.json'))).mode & 0o777,0o600);
    const stored = await fetch(origin+'/api/provider-keys');
    assert.deepEqual((await stored.json()).enabled.sort(),['anthropic','openai']);
    assert.equal((await fetch(origin+'/credentials/providers.json')).status,404);
    const bothSaved = await send({project,instruction:'Ring the bell.',provider:'openai',model:openai.model,
      agentProvider:'anthropic',agentModel:claude.model});
    assert.equal(bothSaved.status,200);
    assert.equal((await bothSaved.json()).reply,'safe');
    assert.deepEqual(await (await saveKeys({anthropic:null})).json(),{enabled:['openai']});
    const {days} = await (await fetch(origin+'/api/spend?timeZone=UTC')).json();
    const spend = days.flatMap(day=>day.models);
    for (const provider of ['anthropic','openai']) {
      const row = spend.find(entry=>entry.provider === provider);
      assert.ok(row?.usd > 0);
      assert.equal(row.estimated,true);
    }
    for (const provider of ['anthropic','openai']) {
      const trace = await readFile(join(directory,'logs',provider+'-trace.log'),'utf8');
      assert.doesNotMatch(trace,/claude-fixture|openai-fixture/);
    }
    assert.doesNotMatch(await readFile(join(directory,'logs','server.log'),'utf8'),/claude-fixture|openai-fixture/);
  } finally {
    child.kill();
    await done;
    await rm(directory,{recursive:true,force:true});
  }
});
