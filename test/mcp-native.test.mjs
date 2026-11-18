import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { storyAtTurn } from '../public/graph-history.js';
import { applyNativeStoryChange } from '../native-story.mjs';

test('native chat creates, writes, edits, and branches without queued work or leaking held prose', async () => {
  const directory = await mkdtemp(join(tmpdir(),'story-studio-native-test-'));
  const probe = createServer();
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const {port} = probe.address();
  await new Promise(resolve=>probe.close(resolve));
  const client = new Client({name:'native-test',version:'1'});
  const command = fileURLToPath(new URL('../bin/story-studio-mcp',import.meta.url));
  let childPid;
  try {
    await client.connect(new StdioClientTransport({command,env:{PORT:String(port),STORY_STUDIO_DATA:directory}}));
    const call = (name,arguments_={}) => client.callTool({name,arguments:arguments_});
    const invoke = async (name,args) => {
      const result = await call(name,args);
      assert.equal(result.isError,undefined,JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(({name})=>name === 'edit_story_structure'));
    assert.ok(tools.some(({name})=>name === 'offer_story_directions'));
    assert.ok(!tools.some(({name})=>name.startsWith('wait_for_')));
    const instructions = client.getInstructions();
    assert.ok(instructions.length < 512);
    assert.match(instructions,/optional tools.*current revision/);
    assert.doesNotMatch(instructions,/before replying|workflow|Story Flow/);
    assert.match(tools.find(({name})=>name === 'submit_reply').description,/Append a non-explicit prose scene/);
    const opened = await invoke('open_studio');
    childPid = opened.pid;
    assert.match(opened.url,/\?view=book&via=mcp$/);
    assert.match(opened.settingsUrl,/\?view=write&via=mcp&settings=1$/);
    const library = await invoke('list_stories');
    const created = await invoke('create_story',{revision:library.revision,draft:{
      title:'The Signal Tower',scenario:'The signal lamp fails.'
    }});
    const {storyId} = created;
    const edit = (revision,changes) => invoke('edit_story_state',{storyId,revision,changes});
    const installments = Array.from({length:23},(_,index)=>({kind:'character',name:`Crew member ${index + 1}`,description:'A member of the harbor crew.'}));
    const seeded = await edit(created.revision,[
      {kind:'character',name:'Mina',description:'The keeper.'},
      {kind:'character',name:'Ada',description:'The pilot.'},
      {kind:'world',action:'append',text:'An island harbor.'},
      ...installments.slice(0,15)
    ]);
    const completed = await edit(seeded.revision,[...installments.slice(15),
      {kind:'relationship',from:'Mina',to:'Ada',label:'They share the tower key.'}
    ]);
    assert.equal(completed.appliedEdits,9);
    const castOverview = await invoke('get_story_state',{storyId});
    assert.equal(castOverview.state.cast.length,24);
    assert.equal(castOverview.castNextOffset,24);
    const castPage = await invoke('inspect_continuity',{storyId,section:'cast'});
    assert.equal(castPage.nextOffset,24);
    const finalCastPage = await invoke('inspect_continuity',{storyId,section:'cast',offset:castPage.nextOffset});
    assert.deepEqual(finalCastPage.cast.map(({name})=>name),['Crew member 23']);
    const reference = await invoke('get_story_context',{storyId,purpose:'reference',direction:'What if the lamp failed?'});
    assert.equal(reference.purpose,'reference');
    assert.match(reference.prompt,/They share the tower key/);
    assert.doesNotMatch(reference.prompt,/You are the narrator|Continue naturally|What if the lamp failed/);
    assert.equal(reference.save,undefined);
    const exactContext = await invoke('get_story_context',{storyId,purpose:'draft',direction:'CHAT DIRECTION MARKER'});
    assert.equal(exactContext.revision,reference.revision);
    assert.doesNotMatch(exactContext.prompt,/You are the narrator|CHAT DIRECTION MARKER/);
    assert.match(exactContext.prompt,/They share the tower key/);
    assert.equal(exactContext.save,undefined);
    const saved = await invoke('submit_reply',{storyId,revision:exactContext.revision,reply:'Ada lights the wick.',updates:[
      {kind:'plot',note:'The tower wick is the backup signal.'},
      {kind:'writing',note:'Keep each paragraph brief.'}
    ]});
    assert.equal(saved.continuityPending,undefined);
    const firstTurns = await invoke('read_story_turns',{storyId});
    assert.deepEqual(firstTurns.turns.map(turn=>[turn.role,turn.preview]),[['assistant','Ada lights the wick.']]);
    const settings = (revision,change) => invoke('edit_story_structure',{storyId,revision,change});
    const metadata = await invoke('get_story_state',{storyId});
    assert.equal(metadata.settings.graphUpdates,true);
    assert.equal(metadata.save,undefined);
    const longNote = 'Keep the danger implied. ' + 'Let the island weather set the rhythm. '.repeat(350) + 'End the note here.';
    const note = await edit(metadata.revision,[{kind:'notes',action:'append',text:longNote}]);
    const exactNote = await invoke('inspect_continuity',{storyId,section:'notes'});
    const endOfNote = await invoke('inspect_continuity',{storyId,section:'notes',offset:exactNote.nextOffset});
    assert.ok(exactNote.nextOffset);
    assert.equal(exactNote.notes + endOfNote.notes,'Turn 1: Keep each paragraph brief.\n\n' + longNote);
    const held = await settings(note.revision,{kind:'hold_turn',turnNumber:1,reason:'explicit'});
    assert.ok(held.revision);
    const redacted = await invoke('read_story_turns',{storyId,turnNumber:1});
    assert.equal(redacted.turn.context,'explicit');
    assert.equal(redacted.turn.content,undefined);
    const origin = new URL(opened.url).origin;
    const saveFromBrowser = async change => {
      const snapshot = await fetch(origin + '/api/state');
      const current = await snapshot.json();
      const index = current.projects.findIndex(project=>project.id === storyId);
      current.projects[index] = change(current.projects[index]);
      const stored = await fetch(origin + '/api/state',{method:'PUT',
        headers:{origin,'content-type':'application/json','if-match':snapshot.headers.get('etag')},
        body:JSON.stringify(current)
      });
      assert.equal(stored.status,200);
    };
    await saveFromBrowser(story=>{
      story.messages.push({role:'user',content:'HELD BROWSER DIRECTION MARKER',turnNumber:2,contentSensitivity:'explicit'});
      story.nextTurn = 3;
      return story;
    });
    const draft = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.doesNotMatch(draft.prompt,/Continue naturally/);
    assert.doesNotMatch(draft.prompt,/Ada lights the wick|HELD BROWSER DIRECTION MARKER/);
    assert.match(draft.prompt,/They share the tower key/);
    await invoke('submit_reply',{storyId,revision:draft.revision,reply:'Mina crosses the quay.',updates:[]});
    const next = await invoke('get_story_context',{storyId});
    assert.equal(next.purpose,'reference');
    assert.equal(next.history.censored,2);
    assert.match(next.prompt,/Mina crosses the quay/);
    const recent = await invoke('read_story_turns',{storyId,recent:true,limit:1});
    assert.deepEqual(recent.turns.map(turn=>turn.turnNumber),[3]);
    const directionEdit = await settings(next.revision,{kind:'edit_turn',turnNumber:3,startsChapter:true,content:'Mina crosses the empty quay.'});
    const relation = await invoke('inspect_continuity',{storyId,section:'relationships'});
    const changed = await edit(relation.revision,[{kind:'edit_relationship',eventIndex:relation.events[0].eventIndex,label:'The key belongs to Ada.'}]);
    assert.ok(changed.revision);
    const stale = await call('edit_story_structure',{storyId,revision:directionEdit.revision,change:{kind:'settings',title:'Stale rename'}});
    assert.equal(stale.isError,true);
    const branch = await settings(changed.revision,{kind:'branch',turnNumber:1,title:'The Signal Tower, alternate'});
    const alternate = await invoke('read_story_turns',{storyId:branch.branchId});
    assert.deepEqual(alternate.turns.map(turn=>[turn.turnNumber,turn.context]),[[1,'explicit']]);
    const original = await invoke('read_story_turns',{storyId,turnNumber:3});
    assert.equal(original.turn.content,'Mina crosses the empty quay.');
    assert.equal(original.turn.startsChapter,true);
    const removed = await settings(original.revision,{kind:'delete_turn',turnNumber:2});
    assert.equal(removed.deletedTurns,1);
    assert.equal((await invoke('read_story_turns',{storyId,turnNumber:3})).turn.content,'Mina crosses the empty quay.');

    const beforeBrowserDelete = await invoke('get_story_context',{storyId,purpose:'draft'});
    await invoke('submit_reply',{storyId,revision:beforeBrowserDelete.revision,reply:'Ada unties the skiff.',updates:[]});
    const beforeEdit = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.match(beforeEdit.prompt,/Ada unties the skiff/);
    await saveFromBrowser(story=>{
      story.messages.pop();
      return story;
    });
    const afterDelete = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.doesNotMatch(afterDelete.prompt,/Ada unties the skiff/);
    assert.match(afterDelete.prompt,/Mina crosses the empty quay/);

    await saveFromBrowser(story=>storyAtTurn(story,0));
    const rejected = await call('submit_reply',{storyId,revision:afterDelete.revision,reply:'A draft prepared before rewind.',updates:[]});
    assert.equal(rejected.isError,true);
    assert.match(rejected.content[0].text,/library changed/i);
    const afterRewind = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.doesNotMatch(afterRewind.prompt,/Mina crosses the empty quay|draft prepared before rewind/);
    assert.match(afterRewind.prompt,/The key belongs to Ada/);

    await saveFromBrowser(story=>{
      story.messages.push({role:'assistant',content:'The first ferryman kept the red lantern.',turnNumber:2,standalone:true});
      for (let turnNumber = 3; turnNumber <= 22; turnNumber++) {
        story.messages.push({role:'assistant',turnNumber,standalone:true,content:'Recent harbor story. '.repeat(270)});
      }
      story.nextTurn = 23;
      return story;
    });
    const brief = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.doesNotMatch(brief.prompt,/first ferryman/);
    assert.match(brief.prompt,/The tower wick is the backup signal/);
    assert.match(brief.prompt,/Keep each paragraph brief/);
    const olderTurn = await invoke('read_story_turns',{storyId,turnNumber:2});
    assert.equal(olderTurn.turn.content,'The first ferryman kept the red lantern.');
    assert.equal(olderTurn.revision,brief.revision);

    const options = [
      {title:'Follow the flare',direction:'Mina follows a flare through the harbor fog.'},
      {title:'Search the chart room',direction:'Ada searches for the missing chart behind the dispatch desk.'},
      {title:'Hear a witness',direction:'A ferryman tells the crew why the lantern went out.'}
    ];
    const offer = await invoke('offer_story_directions',{storyId,revision:brief.revision,options,waitSeconds:0});
    assert.equal(offer.status,'pending');
    assert.equal(offer.afterTurn,22);
    assert.match(offer.url,/\?view=write&story=/);
    assert.equal(new URL(offer.url).searchParams.get('via'),'mcp');
    const pending = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.deepEqual(pending.storyFlow,{status:'pending',afterTurn:22});
    assert.doesNotMatch(pending.prompt,/missing chart behind the dispatch desk/);

    await saveFromBrowser(story=>{
      assert.deepEqual(story.storyFlow,{source:'mcp',afterTurn:22,options});
      story.storyFlow.selected = 1;
      return story;
    });
    const resumed = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.deepEqual(resumed.storyFlow,{status:'selected',afterTurn:22,option:options[1]});
    assert.doesNotMatch(resumed.prompt,/Ada searches for the missing chart behind the dispatch desk/);
    assert.doesNotMatch(resumed.prompt,/Mina follows a flare/);
    const reply = await invoke('submit_reply',{storyId,revision:resumed.revision,reply:'Ada found the chart beneath a loose floorboard.',updates:[]});
    assert.equal(reply.nextStoryFlow,undefined);
    const continued = await invoke('get_story_context',{storyId,purpose:'draft'});
    assert.equal(continued.storyFlow,undefined);
    assert.equal(reply.revision,continued.revision);

    const waiting = invoke('offer_story_directions',{storyId,revision:reply.revision,options,waitSeconds:3});
    let published;
    for (let attempt=0; attempt<40 && !published; attempt++) {
      const state = await (await fetch(origin + '/api/state')).json();
      published = state.projects.find(candidate=>candidate.id === storyId)?.storyFlow;
      if (!published) await delay(25);
    }
    assert.equal(published?.afterTurn,23);
    await saveFromBrowser(story=>{
      story.storyFlow.selected = 2;
      return story;
    });
    const selected = await waiting;
    assert.equal(selected.status,'selected');
    assert.deepEqual(selected.option,options[2]);
    const selectedContext = await invoke('get_story_context',{storyId});
    assert.equal(selectedContext.revision,selected.revision);
    assert.deepEqual(selectedContext.storyFlow.option,options[2]);
  } finally {
    await client.close();
    if (childPid) try { process.kill(childPid,'SIGTERM'); } catch {}
    await rm(directory,{recursive:true,force:true});
  }
});

test('native deletion removes the paired scene’s metadata and preserves unrelated drafts',()=>{
  const project = {
    id:'test',
    messages:[
      {turnNumber:1,role:'user',content:'Open at the dock.'},
      {turnNumber:2,role:'assistant',content:'Mina watches the water.'},
      {turnNumber:3,role:'assistant',content:'Hours pass.',standalone:true,startsChapter:true}
    ],
    draftCheckpoints:[{turn:2,id:'removed'},{turn:3,id:'kept'}],
    sceneBoard:{chapters:[[3],[2]],scenes:{2:{summary:'Deleted scene'},3:{summary:'Remaining scene'}}},
    agentRequest:{mode:'replace',replyTurnNumber:3},
    agentNotice:{turnNumber:1,message:'Completed'}
  };
  const result = applyNativeStoryChange({projects:[project]},project,{kind:'delete_turn',turnNumber:1});
  assert.deepEqual(result,{deletedTurns:2});
  assert.deepEqual(project.messages.map(turn=>turn.turnNumber),[3]);
  assert.deepEqual(project.draftCheckpoints,[{turn:3,id:'kept'}]);
  assert.deepEqual(project.sceneBoard,{scenes:{3:{summary:'Remaining scene'}}});
  assert.deepEqual(project.agentRequest,{mode:'replace',replyTurnNumber:3});
  assert.equal(project.agentNotice,undefined);
});
