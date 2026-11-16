import assert from 'node:assert/strict';
import test from 'node:test';
import { continuityMessages,inspectContinuity,runContinuity,runStoryEdit } from '../continuity.mjs';
import { recentTokenCap, recentTurns, storyEditContext } from '../public/prompt.js';

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

test('a parallel final edit is retried as a single batch before any metadata changes', async () => {
  const project = {...story};
  const worldEdit = {kind:'world',action:'append',text:'There is a signal bell.'};
  const notesEdit = {kind:'notes',action:'append',text:'Use short sentences.'};
  const saved = await runStoryEdit(project,'Add a bell and change the writing notes.',async messages => {
    if (messages.length === 2) return assistant(
      call('edit_story_state',{changes:[worldEdit],message:'Bell added.'},'world-edit'),
      call('edit_story_state',{changes:[notesEdit],message:'Notes updated.'},'notes-edit')
    );
    assert.equal(project.lore,world);
    assert.equal(project.notes,undefined);
    assert.deepEqual(messages.slice(-2).map(({tool_call_id})=>tool_call_id),['world-edit','notes-edit']);
    for (const feedback of messages.slice(-2)) assert.match(JSON.parse(feedback.content).error,/one final tool call/);
    return assistant(call('edit_story_state',{changes:[worldEdit,notesEdit],message:'Both edits applied.'},'combined'));
  });
  assert.equal(saved.count,2);
  assert.match(project.lore,/signal bell/);
  assert.equal(project.notes,'Use short sentences.');
});

test('metadata reads omit unknown stored fields and flag clipped state', () => {
  const examples = 'First line. ' + 'x'.repeat(3500) + ' Last line.';
  const project = {...story,lore:'x'.repeat(20000),cast:[{...story.cast[0],examples,privateAttachment:'UNKNOWN_FIELD_SENTINEL'}]};
  const state = storyEditContext(project);
  assert.equal(state.shortened,true);
  assert.ok(state.world.length <= 12000);
  assert.doesNotMatch(JSON.stringify(state),/UNKNOWN_FIELD_SENTINEL|WITHHELD/);
  const {cast:[profile]} = inspectContinuity(project,{section:'cast',character:'Iona'});
  assert.deepEqual(profile.shortenedFields,['examples']);
  assert.match(profile.examples,/^First line\..*Last line\.$/s);
});

test('continuity can recover an entire long profile one page at a time', () => {
  const personality = 'x'.repeat(11999) + '🗝️ ' + 'patient '.repeat(19999);
  const project = {...story,cast:[{...story.cast[0],personality}]};
  const query = {section:'cast',character:'Iona',field:'personality'};
  let page = inspectContinuity(project,query);
  assert.equal(page.nextOffset,11999);
  let recovered = page.personality;
  while (page.nextOffset !== undefined) {
    page = inspectContinuity(project,{...query,offset:page.nextOffset});
    recovered += page.personality;
  }
  assert.equal(recovered,personality);
});
