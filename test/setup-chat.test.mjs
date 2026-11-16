import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateSetupDraft, setupMessages } from '../setup-chat.mjs';

const app = fileURLToPath(new URL('../server.mjs',import.meta.url));
const key = 'PRIVATE_SETUP_TEST_KEY';
const seed = 'PRIVATE_SETUP_TEST_IDEA. A novelist inherits a map.';
const question = 'What happens if the map changes overnight?';
const clarification = 'It should change every day at sunrise.';
const contextNote = 'PRIVATE_SETUP_TEST_CONTEXT. Maps are printed on blue paper.';
const longContextNote = contextNote + ' map-reference-note'.repeat(16_000);
const manuscript = {turnCount:2,hasChapters:true,passages:[{turn:2,excerpt:'The map changed at sunrise.'}]};
const draft = {
  title:'The Morning Map', lore:'The map changes at sunrise.',
  scenario:'A novelist inherits the map.', notes:'Quiet suspense.',
  cast:[{name:'Sam',description:'A novelist.'}]
};
const writer = content => ({role:'user',content});
const assistant = content => ({role:'assistant',content});

test('setup input and output are bounded and reject invalid roles, fields and duplicate names', () => {
  assert.equal(setupMessages([{role:'system',content:seed}],'chat'),null);
  assert.equal(setupMessages([writer(seed),assistant(question)],'chat'),null);
  assert.equal(setupMessages([writer('note '.repeat(20_001))],'chat'),null);
  assert.ok(setupMessages([writer('note '.repeat(20_000))],'chat'));
  assert.equal(setupMessages([],'draft',undefined,'note '.repeat(20_001)),null);
  const previous = [writer('first '.repeat(5000)),assistant(question)];
  const atLimit = [...previous,writer('second '.repeat(9000))];
  const context = 'reference '.repeat(6000);
  assert.ok(setupMessages(atLimit,'chat',manuscript,context));
  assert.ok(setupMessages(atLimit,'draft',manuscript,context));
  assert.equal(setupMessages(atLimit,'chat',manuscript,context + ' extra'),null);
  assert.equal(setupMessages(atLimit,'draft',manuscript,context + ' extra'),null);
  assert.match(setupMessages([],'draft',undefined,contextNote)[1].content,/Maps are printed on blue paper/);
  const roles = Array.from({length:43},(_,i) => i % 2 ? assistant(question) : writer(seed));
  assert.ok(setupMessages(roles,'chat'));
  assert.ok(setupMessages(roles.slice(0,-1),'draft'));
  assert.throws(() => validateSetupDraft({...draft,postHistory:'Extra'}),{diagnosticCode:'SETUP_DRAFT_INVALID'});
  assert.throws(() => validateSetupDraft({...draft,cast:[draft.cast[0],{name:'sam',description:''}]}),
    {diagnosticCode:'SETUP_DRAFT_DUPLICATE_CAST'});

});

test('setup chat uses the chosen model and stages a validated draft through the shared tools', async () => {
  const directory = await mkdtemp(join(tmpdir(),'story-studio-setup-'));
  const listener = createServer();
  listener.listen(0,'127.0.0.1');
  await once(listener,'listening');
  const {port} = listener.address();
  await new Promise(resolve => listener.close(resolve));
  const mock = join(directory,'openrouter.mjs');
  await writeFile(mock,`
    import assert from 'node:assert/strict';
    const {seed,question,clarification,draft,key,contextNote,manuscript} = ${JSON.stringify({seed,question,clarification,draft,key,contextNote,manuscript})};
    globalThis.fetch = async (url, options) => {
      assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.headers.authorization,'Bearer ' + key);
      const request = JSON.parse(options.body);
      assert.equal(request.provider.data_collection,'deny');
      const setupTool = request.tools?.[0]?.function;
      const importDraft = request.messages[1].content.includes(contextNote);
      assert.equal(request.response_format,undefined);
      if (importDraft) {
        assert.ok(request.messages[1].content.includes('Additional setup context'));
        assert.ok(request.messages[1].content.includes(JSON.stringify(manuscript)));
        assert.ok(request.messages[1].content.includes(contextNote + ' map-reference-note'.repeat(16_000)));
        assert.equal(request.model,'deepseek/deepseek-v4.1-flash');
        assert.ok(setupTool.parameters.required.includes('continuity'));
      } else {
        assert.equal(request.messages[1].content,seed);
        if (request.messages.length > 2) {
          assert.deepEqual(request.messages[2],{role:'assistant',content:question});
          assert.ok(request.messages[3].content.startsWith(clarification));
        }
      }
      if (!setupTool) {
        assert.equal(request.model,'fixture/brainstorm');
        assert.equal(request.max_tokens,768);
        assert.match(request.messages[0].content,/fiction brainstorming partner/);
        assert.equal(request.provider.require_parameters,undefined);
        return Response.json({choices:[{finish_reason:'stop',message:{content:question}}]});
      }
      const selected = request.messages[3]?.content.includes('selected-tool-model') ? 'openai/gpt-6.1-terra' : 'deepseek/deepseek-v4.1-flash';
      assert.equal(request.model,selected);
      assert.equal(request.provider.require_parameters,true);
      assert.equal(setupTool.name,'prepare_story_setup');
      assert.equal(setupTool.parameters.additionalProperties,false);
      assert.equal(setupTool.parameters.properties.cast.maxItems,8);
      assert.match(request.messages[0].content,/latest choices/);
      assert.match(request.messages[0].content,/prepare_story_setup/);
      assert.match(request.messages.at(-1).content,/Prepare the story setup/);
      const args = importDraft ? {...draft,continuity:'The map changed.',chapterStarts:[]} : draft;
      return Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[
        {type:'function',id:'fixture-draft',function:{name:'prepare_story_setup',arguments:JSON.stringify(args)}}
      ]}}]});
    };
  `);
  const child = spawn(process.execPath,['--import',mock,app],{
    env:{...process.env,PORT:String(port),STORY_STUDIO_DATA:directory,STORY_STUDIO_LOG_DIR:join(directory,'logs')},
    stdio:['ignore','pipe','ignore']
  });
  const done = once(child,'exit');
  try {
    await Promise.race([
      once(child.stdout,'data',{signal:AbortSignal.timeout(5000)}),
      done.then(() => { throw Error('Server exited before listening.'); })
    ]);
    const origin = `http://127.0.0.1:${port}`;
    const send = (mode,messages,requestOrigin = origin,context = {}) => fetch(origin+'/api/setup',{
      method:'POST',headers:{origin:requestOrigin,'content-type':'application/json'},
      body:JSON.stringify({mode,model:'fixture/brainstorm',key,messages,...context})
    });
    const first = await send('chat',[writer(seed)]);
    assert.equal(first.status,200);
    assert.deepEqual(await first.json(),{text:question});
    const conversation = [writer(seed),assistant(question),writer(clarification)];
    const second = await send('chat',conversation);
    assert.equal(second.status,200);
    assert.deepEqual(await second.json(),{text:question});
    const prepared = await send('draft',[...conversation,assistant(question)]);
    assert.equal(prepared.status,200);
    assert.deepEqual(await prepared.json(),{draft});
    const explicitlySelected = await send('draft',[writer(seed),assistant(question),writer(clarification + ' selected-tool-model')],
      origin,{model:'openai/gpt-6.1-terra'});
    assert.equal(explicitlySelected.status,200);
    assert.deepEqual(await explicitlySelected.json(),{draft});
    const imported = await send('draft',[],origin,{manuscript,context:longContextNote});
    assert.equal(imported.status,200);
    assert.deepEqual(await imported.json(),{draft:{...draft,continuity:'The map changed.',chapterStarts:[]}});
    assert.equal((await send('draft',[],origin,{manuscript,context:'note '.repeat(20_001)})).status,400);
    assert.equal((await send('chat',[assistant(question)])).status,400);
    assert.equal((await send('chat',[writer(seed)],'https://example.com')).status,403);
    await assert.rejects(readFile(join(directory,'library.json')),{code:'ENOENT'});
    const logs = await readFile(join(directory,'logs','server.log'),'utf8');
    assert.doesNotMatch(logs,/PRIVATE_SETUP_TEST|changes every day|The Morning Map/);
    assert.match(logs,/setup-chat/);
    assert.match(logs,/setup-draft/);
  } finally {
    child.kill();
    await done;
    await rm(directory,{recursive:true,force:true});
  }
});
