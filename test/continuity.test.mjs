import assert from 'node:assert/strict';
import test from 'node:test';
import { continuityMessages,inspectContinuity,runContinuity,runStoryEdit } from '../continuity.mjs';
import { applyStoryEdits } from '../story-edits.mjs';
import { storyAtTurn } from '../public/graph-history.js';
import { nextTurnNumber, recentTokenCap, recentTurns, storyEditContext } from '../public/prompt.js';

const sceneTime = '1998-10-25T00:13';
const world = 'A ferry shelter at the pier.';
const story = {
  characterName:'Mara',character:'An archivist.',lore:world,
  plotEvents:[{note:'The bridge is closed.',turn:0,storyTime:'1998-01-01T08:00'}],
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
const fact = {kind:'plot',note:'The ferry leaves at dawn.'};
const scene = {input:'safe',reply:'safe',storyTime:sceneTime,updates:[fact]};

test('scene continuity includes the new draft and eligible recent prose only', () => {
  const messages = continuityMessages(story,'LATEST DIRECTION','LATEST DRAFT',options);
  const [system] = messages;
  const source = JSON.parse(messages.at(-1).content);
  assert.equal(system.role,'system');
  assert.match(system.content,/inspect_continuity/);
  assert.match(system.content,/record_scene/);
  assert.match(system.content,/After each new scene.*relationship.*world for setting changes, plot for other lasting plot events, writing for requested standing guidance/);
  assert.deepEqual(messages.slice(1,3),[
    {role:'assistant',content:'Mara brings Iona the ledger.'},
    {role:'user',content:'Check the ferry schedule.'}
  ]);
  assert.deepEqual([source.authorDirection,source.draft],['LATEST DIRECTION','LATEST DRAFT']);
  const context = JSON.stringify(messages);
  assert.doesNotMatch(context,/WITHHELD/);
  assert.match(context,/The bridge is closed/);
  assert.match(context,/shelter at the pier/);
  const snapshot = {...story,messages:recentTurns(story.messages,recentTokenCap,{includeSensitive:true})};
  assert.match(JSON.stringify(snapshot.messages),/WITHHELD PAIRED REPLY/);
  assert.doesNotMatch(JSON.stringify(continuityMessages(snapshot,'LATEST DIRECTION','LATEST DRAFT',options)),/WITHHELD/);
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
    return assistant(call('record_scene',scene,'duplicate'),call('inspect_continuity',{section:'plot'},'duplicate'));
  },()=>{}),{diagnosticCode:'CONTINUITY_NOT_RECORDED'});
  let calls = 0;
  await assert.rejects(runContinuity(story,'A direction.','A draft.',options,async ()=>{
    return assistant(call('inspect_continuity',{section:'plot'},'lookup-' + ++calls));
  },()=>{}),{diagnosticCode:'CONTINUITY_NOT_RECORDED'});
  assert.equal(calls,4);
});

test('a parallel final edit is retried as a single batch before any metadata changes', async () => {
  const project = {...story};
  const worldEdit = {kind:'world',action:'append',text:'There is a signal bell.'};
  const notesEdit = {kind:'notes',action:'append',text:'Use short sentences.'};
  const saved = await runStoryEdit(project,'Add a bell and change the writing notes.',async messages => {
    if (messages.at(-1).role === 'user') return assistant(
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

test('Agent repairs a rejected batch after reading its tool results and must supply a visible reply', async () => {
  const project = structuredClone(story);
  const before = structuredClone(project);
  const invalid = {kind:'relationship',from:'Unknown',to:'Orin',label:'They exchange charts.'};
  const valid = {kind:'relationship',from:'Iona',to:'Orin',label:'They exchange charts.'};
  const reply = 'I recorded the chart exchange between Iona and Orin.';
  let round = 0;
  const result = await runStoryEdit(project,'Record the chart exchange.',async messages => {
    assert.deepEqual(project,before);
    switch (++round) {
      case 1:
        return assistant(call('edit_story_state',{changes:[invalid],message:'Recorded.'},'unresolved'));
      case 2:
        assert.match(JSON.parse(messages.at(-1).content).error,/exact, unambiguous cast name/);
        return assistant(call('inspect_continuity',{section:'cast',character:'Iona'},'cast'));
      case 3:
        assert.equal(JSON.parse(messages.at(-1).content).cast[0].name,'Iona');
        return assistant(call('edit_story_state',{changes:[valid],message:' '},'blank-reply'));
      default:
        assert.deepEqual(JSON.parse(messages.at(-1).content).fields,['message']);
        return assistant(call('edit_story_state',{changes:[valid],message:reply},'complete'));
    }
  });
  assert.equal(round,4);
  assert.deepEqual(result,{count:1,message:reply});
  assert.equal(project.agentHistory.at(-1).message,reply);
  assert.equal(project.relationships.length,1);
  assert.deepEqual(project.messages,before.messages);
});

test('Agent cannot report a rejected or ineffective metadata edit as applied',async()=>{
  for (const reject of [true,false]) {
    const project = structuredClone(story);
    const before = structuredClone(project);
    const duplicate = {kind:'world',action:'append',text:world};
    const invalid = {kind:'remove_relationship',eventIndex:99};
    let round = 0;
    const result = await runStoryEdit(project,'Update the story.',async messages => {
      assert.deepEqual(project,before);
      const changes = !reject ? [duplicate] : ++round === 1 ? [duplicate,invalid] : [];
      if (reject && round === 2) assert.match(JSON.parse(messages.at(-1).content).error,/eventIndex/);
      return assistant(call('edit_story_state',{changes,message:'All changes applied.'},'attempt'));
    });
    assert.equal(result.count,0);
    assert.match(result.message,/No story changes were saved/);
    assert.doesNotMatch(result.message,/All changes applied/);
    const {agentHistory,...saved} = project;
    assert.deepEqual(saved,before);
    assert.equal(agentHistory.at(-1).message,result.message);
  }
});

test('Agent reports the applied count when some submitted changes have no effect',async()=>{
  const project = structuredClone(story);
  const changes = [
    {kind:'world',action:'append',text:world},
    {kind:'notes',action:'append',text:'Keep close to Iona.'}
  ];
  const result = await runStoryEdit(project,'Update the story.',async () =>
    assistant(call('edit_story_state',{changes,message:'Both applied.'},'attempt')));
  assert.equal(result.count,1);
  assert.match(result.message,/Saved 1 of 2 submitted changes/);
  assert.equal(project.agentHistory.at(-1).message,result.message);
  assert.equal(project.notes,'Keep close to Iona.');
});

test('Agent leaves the story untouched and reports failure when all four edit attempts fail',async()=>{
  const project = structuredClone(story);
  const before = structuredClone(project);
  let rounds = 0;
  await assert.rejects(runStoryEdit(project,'Rename Iona.',async messages => {
    if (rounds) assert.match(JSON.parse(messages.at(-1).content).error,/exact, unambiguous cast name/);
    const changes = [{kind:'rename_character',name:'Unknown',newName:'Mina'}];
    return assistant(call('edit_story_state',{changes,message:'Renamed.'},'invalid-' + ++rounds));
  }),{diagnosticCode:'STORY_EDIT_NOT_RECORDED',message:/No story changes were saved/});
  assert.equal(rounds,4);
  assert.deepEqual(project,before);
});

test('brainstorming records a conversation without changing manuscript or story state',async()=>{
  const project = structuredClone(story);
  const before = structuredClone(project);
  const instruction = 'What could happen next if a lighthouse were added?';
  const message = 'A failed lamp could force the crew to choose between waiting and asking for help.';
  const reply = await runStoryEdit(project,instruction,async(messages,tools)=>{
    assert.match(messages[0].content,/brainstorm.+changes: \[\]/i);
    assert.match(tools.at(-1).function.description,/changes: \[\] for discussion/);
    return assistant(call('edit_story_state',{changes:[],message,historySafe:true},'brainstorm'));
  });
  assert.deepEqual(reply,{count:0,message});
  const {agentHistory,...saved} = project;
  assert.deepEqual(saved,before);
  assert.equal(agentHistory[0].request,instruction);
  assert.equal(agentHistory[0].message,message);
});

test('metadata reads omit unknown stored fields and flag clipped state', () => {
  const description = 'First line. ' + 'x'.repeat(13000) + ' Last line.';
  const project = {...story,lore:'x'.repeat(20000),cast:[{...story.cast[0],description,privateAttachment:'UNKNOWN_FIELD_SENTINEL'}]};
  const state = storyEditContext(project);
  assert.equal(state.shortened,true);
  assert.ok(state.world.length <= 12000);
  assert.doesNotMatch(JSON.stringify(state),/UNKNOWN_FIELD_SENTINEL|WITHHELD/);
  const {cast:[profile]} = inspectContinuity(project,{section:'cast',character:'Iona'});
  assert.deepEqual(profile.shortenedFields,['description']);
  assert.match(profile.description,/^First line\..*Last line\.$/s);
});

test('continuity can recover an entire long profile one page at a time', () => {
  const description = 'x'.repeat(11999) + '🗝️ ' + 'patient '.repeat(19999);
  const project = {...story,cast:[{...story.cast[0],description}]};
  const query = {section:'cast',character:'Iona',field:'description'};
  let page = inspectContinuity(project,query);
  assert.equal(page.nextOffset,11999);
  let recovered = page.description;
  while (page.nextOffset !== undefined) {
    page = inspectContinuity(project,{...query,offset:page.nextOffset});
    recovered += page.description;
  }
  assert.equal(recovered,description);
});

test('the OpenRouter editor inspects existing events and waits for read results before committing', async () => {
  const project = {
    title:'A harbor',
    cast:[{id:'ada',name:'Ada',description:'An island pilot.'},{id:'mina',name:'Mina',description:'The signal keeper.'}],
    relationships:[{from:'ada',to:'mina',label:'They share the key.',turn:0},
      {from:'mina',to:'ada',label:'They trade maps.',turn:0}],
    lore:'The tower opens at dawn.',
    notes:'Keep the prose close to Ada.',
    messages:[{role:'assistant',content:'First scene.',turnNumber:1},{role:'assistant',content:'Second scene.',turnNumber:2}]
  };
  const changes = [{kind:'remove_relationship',eventIndex:0},
    {kind:'edit_relationship',eventIndex:1,label:'Mina lends Ada the marked map.',storyTime:sceneTime},
    {kind:'rename_character',name:'Mina',newName:'Mira'},
    {kind:'field',field:'notes',text:'Keep the quiet tone and use present tense.'}];
  let attempts = 0;
  const result = await runStoryEdit(project,'Update the map handoff, rename Mina, edit the author note, and remove the key event.',async messages => {
    if (++attempts === 1) return assistant(
      call('edit_story_state',{changes,message:'Updated the graph.'},'early'),
      call('inspect_continuity',{section:'relationships'},'events')
    );
    assert.equal(project.relationships.length,2);
    assert.match(JSON.parse(messages.at(-2).content).error,/Review the read results/);
    const {events} = JSON.parse(messages.at(-1).content);
    assert.equal(events[1].eventIndex,1);
    return assistant(call('edit_story_state',{changes,message:'Updated the graph.',historySafe:true},'final'));
  });
  assert.equal(result.count,4);
  assert.equal(project.cast[1].name,'Mira');
  assert.equal(project.relationships.length,1);
  assert.equal(project.relationships[0].label,'Mina lends Ada the marked map.');
  assert.equal(project.relationships[0].storyTime,sceneTime);
  assert.equal(project.notes,'Keep the quiet tone and use present tense.');
  assert.equal(project.messages.length,2);
});

test('a failed metadata batch is atomic and rewind restores legacy writing notes', () => {
  const project = {
    cast:[],lore:'',continuity:'',notes:'Keep the prose quiet.',relationships:[],
    graphHistory:[{turn:0,cast:[],lore:'',continuity:''}],
    messages:[{role:'assistant',content:'First scene.',turnNumber:1},{role:'assistant',content:'Second scene.',turnNumber:2}]
  };
  const before = structuredClone(project);
  const notes = {kind:'notes',action:'replace',text:'Use more dialogue.'};
  assert.throws(()=>applyStoryEdits(project,[notes,{kind:'remove_relationship',eventIndex:1}]),
    {diagnosticCode:'STORY_EDIT_EVENT_UNKNOWN'});
  assert.deepEqual(project,before);
  assert.equal(applyStoryEdits(project,[notes]),1);
  assert.equal(storyAtTurn(project,0).notes,'Keep the prose quiet.');
  assert.equal(storyAtTurn(project,1).notes,'Use more dialogue.');
});

test('malformed tool-call envelopes are not replayed to the provider',async()=>{
  let attempts = 0;
  await assert.rejects(runContinuity(story,'A direction.','A draft.',options,async()=>{
    attempts++;
    return assistant({id:'broken',type:'function',function:{name:'record_scene',arguments:{}}});
  },()=>{}),{diagnosticCode:'CONTINUITY_NOT_RECORDED'});
  assert.equal(attempts,1);
});

test('turn numbering works with imports larger than the JavaScript argument limit',()=>{
  const messages = Array.from({length:150_000},()=>({role:'assistant',content:'A scene.'}));
  assert.equal(nextTurnNumber({messages}),150_001);
});

test('invalid read arguments identify the field to correct before the final action', async () => {
  let round = 0;
  const complete = async messages=>{
    if (!round++) return assistant(call('inspect_continuity',{section:'plot',offset:-1},'read'));
    assert.deepEqual(JSON.parse(messages.at(-1).content).fields,['offset']);
    return assistant(call('record_scene',scene,'finish'));
  };
  await runContinuity(story,'A direction.','A draft.',options,complete,()=>{});
  assert.equal(round,2);
});

test('a marked sensitive alternate has a single classification instruction', () => {
  const [system] = continuityMessages(story,'','A draft.',{mode:'alternate',sensitive:true});
  assert.match(system.content,/Set input to explicit/);
  assert.doesNotMatch(system.content,/Set input to safe/);
});

test('plot inspection and MCP story state expose only the supported event fields',()=>{
  const event = {note:'The ferry docks.',turn:1,storyTime:sceneTime};
  const project = {messages:[],plotEvents:[{...event,localAnnotation:'Synthetic private note'}]};
  assert.deepEqual(inspectContinuity(project,{section:'plot'}).events,[{...event,eventIndex:0}]);
  assert.deepEqual(storyEditContext(project).plotEvents,[event]);
  assert.equal(project.plotEvents[0].localAnnotation,'Synthetic private note');
});

test('creating or renaming a character cannot redirect an existing cast alias',()=>{
  for (const change of [
    {kind:'character',name:'Pilot',description:'Another person.'},
    {kind:'rename_character',name:'Orin',newName:'pilot'}
  ]) {
    const project = structuredClone(story);
    assert.throws(()=>applyStoryEdits(project,[
      {kind:'notes',action:'append',text:'A temporary note.'},change
    ]),/already/);
    assert.deepEqual(project,story);
  }
});
