import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { estimateContextTokens } from '../public/prompt.js';
import { runChunkedSetup, setupPromptFits, validateSetupDraft, setupMessages } from '../setup-chat.mjs';

const fullManuscript = {turnCount:3,hasChapters:false,turns:[{turn:1,text:'An old map.'},{turn:2,text:'Unabridged middle. ' + 'The harbor changed. '.repeat(25_000)},{turn:3,text:'End of story.'}]};
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
  cast:[{name:'Sam',description:'A novelist.'},{name:'Mira',description:'A cartographer and longtime friend.'}],
  storyStartAt:'1934-10-12T06:10',relationships:[{from:'Sam',to:'Mira',label:'Mira helps Sam interpret the inherited map.'}]
};
const writer = content => ({role:'user',content});
const assistant = content => ({role:'assistant',content});

test('setup accepts large inputs and rejects invalid roles, fields and duplicate names', () => {
  assert.equal(setupMessages([{role:'system',content:seed}],'chat'),null);
  assert.equal(setupMessages([writer(seed),assistant(question)],'chat'),null);
  assert.ok(setupMessages([writer('note '.repeat(20_001))],'chat'));
  assert.ok(setupMessages([writer('note '.repeat(20_000))],'chat'));
  assert.ok(setupMessages([],'draft',undefined,'note '.repeat(20_001)));
  const previous = [writer('first '.repeat(5000)),assistant(question)];
  const atLimit = [...previous,writer('second '.repeat(9000))];
  const context = 'reference '.repeat(6000);
  assert.ok(setupMessages(atLimit,'chat',manuscript,context));
  assert.ok(setupMessages(atLimit,'draft',manuscript,context));
  assert.ok(setupMessages(atLimit,'chat',manuscript,context + ' extra'));
  assert.ok(setupMessages(atLimit,'draft',manuscript,context + ' extra'));
  assert.match(setupMessages([],'draft',undefined,contextNote)[1].content,/Maps are printed on blue paper/);
  const roles = Array.from({length:43},(_,i) => i % 2 ? assistant(question) : writer(seed));
  assert.ok(setupMessages(roles,'chat'));
  assert.ok(setupMessages(roles.slice(0,-1),'draft'));
  const largeCast = Array.from({length:40},(_,index)=>({name:'Character ' + index,description:'Useful profile.'}));
  assert.equal(validateSetupDraft({...draft,cast:largeCast,relationships:[]}).cast.length,40);
  assert.throws(() => validateSetupDraft({...draft,postHistory:'Extra'}),{diagnosticCode:'SETUP_DRAFT_INVALID'});
  assert.throws(() => validateSetupDraft({...draft,cast:[draft.cast[0],{name:'sam',description:''}]}),
    {diagnosticCode:'SETUP_DRAFT_DUPLICATE_CAST'});
  assert.throws(() => validateSetupDraft({...draft,relationships:[{...draft.relationships[0],to:'Unknown'}]}),
    {diagnosticCode:'SETUP_DRAFT_BAD_RELATIONSHIP'});
  assert.throws(() => validateSetupDraft({...draft,relationships:[{...draft.relationships[0],to:'sam'}]}),
    {diagnosticCode:'SETUP_DRAFT_BAD_RELATIONSHIP'});
  assert.throws(() => validateSetupDraft({...draft,storyStartAt:'1934-02-30T06:10'}),{diagnosticCode:'SETUP_DRAFT_INVALID'});
  assert.deepEqual(validateSetupDraft({...draft,relationships:[{...draft.relationships[0],to:'mira'}]}),draft);

});

test('chunked setup reads every source in order, then compacts lengthy notes before a validated draft', async () => {
  const inputLimit = 7500;
  const context = 'First context. ' + '\\ Review the map by daylight. 👩🏾 '.repeat(2300) + ' Last context.';
  const largeManuscript = {
    turnCount:2,hasChapters:false,turns:[
      {turn:1,text:'Chapter first. ' + 'The courtyard is outside the tower. '.repeat(2600)},
      {turn:2,text:'A second chapter: Iona visits at dawn.'}
    ]
  };
  const messages = [writer(seed),assistant(question),writer(clarification)];
  const sources = [];
  let reductions = 0;
  const toolCall = (name, value) => ({
    role:'assistant',content:null,tool_calls:[{type:'function',id:name,function:{name,arguments:JSON.stringify(value)}}]
  });
  const complete = async (prompt,tools) => {
    assert.equal(tools[0].function.name,'record_setup_notes');
    assert.ok(estimateContextTokens(JSON.stringify({messages:prompt,tools})) <= inputLimit);
    const payload = JSON.parse(prompt.at(-1).content);
    if (payload.section === undefined) {
      reductions++;
      assert.ok(payload.sources.every(entry=>entry.source.endsWith('notes')));
      return toolCall('record_setup_notes',{story:'Iona visits at dawn in turn 2.',writer:'Use evening publication.'});
    }
    sources.push(...payload.sources);
    return toolCall('record_setup_notes',{story:'Story note. '.repeat(390),writer:'Writing note. '.repeat(100)});
  };
  const prepare = async (prompt,tools) => {
    assert.equal(tools[0].function.name,'prepare_story_setup');
    assert.ok(setupPromptFits(prompt,'draft',largeManuscript,inputLimit));
    const {latestWriterMessage,sections} = JSON.parse(prompt.at(-1).content);
    assert.equal(latestWriterMessage,clarification);
    assert.ok(sections.every(note=>note.story.includes('Iona visits at dawn')));
    return toolCall('prepare_story_setup',{...draft,plotEvents:[{note:'Current non-explicit events.'}],chapterStarts:[2,99]});
  };
  const result = await runChunkedSetup({messages,mode:'draft',manuscript:largeManuscript,context,complete,prepare,inputLimit});
  assert.ok(result.sections > 2);
  assert.ok(reductions > 0);
  assert.deepEqual(result.draft.chapterStarts,[2]);
  for (const {turn,text} of largeManuscript.turns) {
    assert.equal(sources.filter(source=>source.turn === turn).map(source=>source.text).join(''),text);
  }
  assert.equal(sources.filter(source=>source.source === 'author reference').map(source=>source.text).join(''),context);
  assert.deepEqual(sources.filter(source=>['writer','brainstorm discussion'].includes(source.source)).map(source=>source.text),
    messages.map(message=>message.content));
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
    let oversizedContextSeen = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.headers.authorization,'Bearer ' + key);
      const request = JSON.parse(options.body);
      assert.equal(request.provider.data_collection,'deny');
      const setupTool = request.tools?.[0]?.function;
      const completedTool = (name,args) => Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[
        {type:'function',id:'fixture-result',function:{name,arguments:JSON.stringify(args)}}
      ]}}]});
      if (setupTool?.name === 'record_setup_notes') {
        const {sources,section} = JSON.parse(request.messages[1].content);
        assert.ok(section > 0);
        assert.equal(request.model,'deepseek/deepseek-v4.1-flash');
        for (const source of sources) if (source.source === 'author reference') {
          oversizedContextSeen += source.text.length;
        }
        return completedTool('record_setup_notes',{story:'The map changed at sunrise.',writer:'Preserve a quiet atmosphere.'});
      }
      if (request.messages[0].content.includes('The source was read in consecutive sections.')) {
        assert.equal(setupTool.name,'prepare_story_setup');
        assert.equal(oversizedContextSeen,3_000_000);
        assert.equal(request.model,'deepseek/deepseek-v4.1-flash');
        assert.ok(JSON.parse(request.messages[1].content).sections.length > 1);
        return completedTool('prepare_story_setup',{...draft,plotEvents:[{note:'The map changed.'}],chapterStarts:[]});
      }
      const fullImport = request.messages[1].content.includes('Unabridged middle.');
      const importDraft = fullImport || request.messages[1].content.includes(contextNote);
      assert.equal(request.response_format,undefined);
      if (fullImport) {
        assert.ok(request.messages[1].content.includes('The harbor changed. '.repeat(25_000)));
        assert.ok(request.messages[1].content.includes('End of story.'));
      } else if (importDraft) {
        assert.ok(request.messages[1].content.includes('Additional setup context'));
        assert.ok(request.messages[1].content.includes(JSON.stringify(manuscript)));
        assert.ok(request.messages[1].content.includes(contextNote + ' map-reference-note'.repeat(16_000)));
        assert.equal(request.model,'deepseek/deepseek-v4.1-flash');
        assert.ok(Object.hasOwn(setupTool.parameters.properties,'plotEvents'));
      } else {
        assert.equal(request.messages[1].content,seed);
        if (request.messages.length > 2) {
          assert.deepEqual(request.messages[2],{role:'assistant',content:question});
          assert.ok(request.messages[3].content.startsWith(clarification));
        }
      }
      if (!setupTool) {
        if (request.model === 'deepseek/deepseek-v4.1-flash') {
          assert.equal(request.provider.require_parameters,true);
          assert.deepEqual(request.reasoning,{enabled:false});
        } else {
          assert.equal(request.model,'fixture/brainstorm');
          assert.equal(request.provider.require_parameters,undefined);
          assert.equal(request.reasoning,undefined);
        }
        assert.equal(request.max_tokens,2048);
        assert.match(request.messages[0].content,/fiction brainstorming partner/);
        return Response.json({choices:[{finish_reason:'stop',message:{content:question}}]});
      }
      const selected = request.messages[3]?.content.includes('selected-tool-model') ? 'openai/gpt-6.1-terra' : 'deepseek/deepseek-v4.1-flash';
      assert.equal(request.model,selected);
      assert.equal(request.provider.require_parameters,true);
      assert.equal(setupTool.name,'prepare_story_setup');
      assert.equal(setupTool.parameters.additionalProperties,false);
      assert.equal(setupTool.parameters.properties.cast.maxItems,undefined);
      assert.equal(setupTool.parameters.properties.relationships.maxItems,undefined);
      assert.match(request.messages[0].content,/latest choices/);
      assert.match(request.messages[0].content,/one non-explicit sentence/);
      assert.match(request.messages[0].content,/prepare_story_setup/);
      assert.match(request.messages.at(-1).content,/Prepare the story setup/);
      const args = importDraft ? {...draft,plotEvents:[{note:'The map changed.'}],chapterStarts:[]} : draft;
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
    const deepSeekChat = await send('chat',[writer(seed)],origin,{model:'deepseek/deepseek-v4.1-flash'});
    assert.equal(deepSeekChat.status,200);
    assert.deepEqual(await deepSeekChat.json(),{text:question});
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
    assert.deepEqual(await imported.json(),{draft:{...draft,plotEvents:[{note:'The map changed.'}],chapterStarts:[]}});
    const unabridged = await send('draft',[],origin,{manuscript:fullManuscript});
    assert.equal(unabridged.status,200);
    assert.equal((await unabridged.json()).draft.plotEvents[0].note,'The map changed.');
    const overflow = await send('draft',[],origin,{manuscript,context:'note '.repeat(600_000)});
    assert.equal(overflow.status,200);
    const chunked = await overflow.json();
    assert.ok(chunked.sections > 1);
    assert.deepEqual(chunked.draft,{...draft,plotEvents:[{note:'The map changed.'}],chapterStarts:[]});
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
