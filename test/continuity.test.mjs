import assert from 'node:assert/strict';
import test from 'node:test';
import { continuityMessages,inspectContinuity,runContinuity } from '../continuity.mjs';
import { recentTokenCap, recentTurns } from '../public/prompt.js';

const sceneTime = '1998-10-25T00:13';
const world = 'A ferry shelter at the pier.';
const story = {
  characterName:'Mara',character:'An archivist.',lore:world,continuity:'The bridge is closed.',
  cast:[
    {id:'iona',name:'Iona',nickname:'Pilot',description:'A pilot.'},
    {id:'orin',name:'Orin',description:'A harbor master.'}
  ],
  messages:[
    {role:'user',content:'WITHHELD DIRECTION',contentSensitivity:'explicit'},
    {role:'assistant',content:'WITHHELD PAIRED REPLY',contentSensitivity:'safe'},
    {role:'assistant',content:'Mara brings Iona the ledger.',contentSensitivity:'reviewed-safe'},
    {role:'user',content:'Check the ferry schedule.'},
    {role:'assistant',content:'WITHHELD UNVERIFIED REPLY',contentSensitivity:'unclassified'},
    {role:'assistant',content:'WITHHELD ALL ROUTES',excludeFromContext:true}
  ]
};
const options = {suggest:true,mode:'send'};
const call = (name,args,id) => ({
  id,type:'function',function:{name,arguments:typeof args === 'string' ? args : JSON.stringify(args)}
});
const assistant = (...toolCalls) => ({role:'assistant',content:null,tool_calls:toolCalls});
const fact = {kind:'fact',note:'The ferry leaves at dawn.'};
const scene = {input:'safe',reply:'safe',storyTime:sceneTime,updates:[fact]};

test('scene continuity includes the new draft and eligible recent prose only', () => {
  const [system,source] = continuityMessages(story,'LATEST DIRECTION','LATEST DRAFT',options);
  assert.equal(system.role,'system');
  assert.match(system.content,/inspect_continuity/);
  assert.match(system.content,/record_scene/);
  assert.deepEqual(JSON.parse(source.content).recentTurns,[
    {role:'assistant',content:'Mara brings Iona the ledger.'},
    {role:'user',content:'Check the ferry schedule.'}
  ]);
  assert.deepEqual(
    [JSON.parse(source.content).authorDirection,JSON.parse(source.content).draft],
    ['LATEST DIRECTION','LATEST DRAFT']
  );
  assert.doesNotMatch(source.content,/WITHHELD|The bridge is closed|shelter at the pier/);
  const snapshot = {...story,messages:recentTurns(story.messages,recentTokenCap,{includeSensitive:true})};
  assert.match(JSON.stringify(snapshot.messages),/WITHHELD PAIRED REPLY/);
  assert.doesNotMatch(continuityMessages(snapshot,'LATEST DIRECTION','LATEST DRAFT',options)[1].content,/WITHHELD/);
});

test('relationship inspection pages through matching dated events once and skips unknown endpoints', () => {
  const relationships = Array.from({length:27},(_,index)=>({
    from:'primary',to:'iona',label:'Event ' + (index + 1),storyTime:sceneTime,turn:index + 1
  }));
  relationships.push({from:'primary',to:'orin',label:'Outside filter',storyTime:sceneTime,turn:29},
    {from:'primary',to:'missing',label:'Missing endpoint',storyTime:sceneTime,turn:30});
  const project = {...story,relationships};
  const query = {section:'relationships',character:'Pilot'};
  const first = inspectContinuity(project,query);
  const second = inspectContinuity(project,{...query,offset:first.nextOffset});
  assert.equal(first.events.length,24);
  assert.equal(first.nextOffset,24);
  assert.equal(second.nextOffset,undefined);
  assert.deepEqual([...first.events,...second.events].map(({turn})=>turn),
    Array.from({length:27},(_,index)=>27 - index));
  assert.ok(first.events.every(event=>event.from === 'Mara' && event.to === 'Iona' && event.storyTime === sceneTime));
  assert.ok(!inspectContinuity(project,{section:'relationships'}).events.some(event=>event.label === 'Missing endpoint'));
});

test('the tool loop lets the model recover from invalid calls, inspect state, and retry a rejected update', async () => {
  const rejectedName = 'PRIVATE REJECTED NAME';
  const audit = [];
  const attempts = [
    assistant(call('inspect_continuity','{','parse')),
    assistant(call('inspect_continuity',{section:'world'},'world')),
    assistant(call('record_scene',{...scene,updates:[{kind:'profile',name:rejectedName,note:'An old map.'}]},'invalid-map')),
    assistant(call('record_scene',scene,'finish'))
  ];
  let round = 0;
  const complete = async (messages,tools) => {
    assert.deepEqual(tools.map(({function:{name}})=>name),['inspect_continuity','record_scene']);
    if (round === 1) assert.match(JSON.parse(messages.at(-1).content).error,/match its argument schema/i);
    if (round === 2) assert.deepEqual(messages.at(-1),{role:'tool',tool_call_id:'world',content:JSON.stringify({world})});
    if (round === 3) {
      assert.equal(messages.at(-1).tool_call_id,'invalid-map');
      assert.doesNotMatch(messages.at(-1).content,/PRIVATE REJECTED NAME/);
      assert.match(messages.at(-1).content,/CAST_NAME_UNRESOLVED/);
    }
    return attempts[round++];
  };
  const result = await runContinuity(story,'A direction.','A draft.',{...options,sensitive:true},complete,
    rejections=>audit.push(...rejections));
  assert.equal(round,4);
  assert.deepEqual(result,{input:'explicit',reply:'safe',storyTime:sceneTime,suggestions:[fact]});
  assert.deepEqual(audit,[{index:0,code:'CAST_NAME_UNRESOLVED',fields:['name']}]);
});

test('the continuity pass keeps an established scene time and discards disabled map suggestions', async () => {
  const replyTime = '1998-10-25T00:14';
  const result = await runContinuity({...story,replyTime},'A revision.','A draft.',{
    suggest:false,mode:'replace'
  },async ()=>assistant(call('record_scene',scene,'finish')),()=>{
    assert.fail('Disabled updates should not be audited as errors.');
  });
  assert.deepEqual(result,{input:'safe',reply:'safe',storyTime:replyTime,suggestions:[]});
});

test('unresponsive or malformed tool sequences cannot record a scene', async () => {
  await assert.rejects(runContinuity(story,'A direction.','A draft.',options,async ()=>{
    return assistant(call('record_scene',scene,'duplicate'),call('inspect_continuity',{section:'memory'},'duplicate'));
  },()=>{}),{diagnosticCode:'CONTINUITY_NOT_RECORDED'});
  let calls = 0;
  await assert.rejects(runContinuity(story,'A direction.','A draft.',options,async ()=>{
    return assistant(call('inspect_continuity',{section:'memory'},'lookup-' + ++calls));
  },()=>{}),{diagnosticCode:'CONTINUITY_NOT_RECORDED'});
  assert.equal(calls,4);
});
