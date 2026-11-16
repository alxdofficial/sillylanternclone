import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { captureGraphVersion } from '../public/graph-history.js';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const toolData = result => JSON.parse(result.content[0].text);
const story = (id, title, extra = {}) => ({
  id, title, characterName:'Mara', characterNickname:'Mar', character:'An archivist.', persona:'', lore:'An old harbor.', notes:'',
  cast:[{id:'iona', name:'Iona', nickname:'Io', description:'A ferry pilot.', personality:'', scenario:'', examples:''}],
  messages:[{role:'assistant', content:'Mara unlocks the archive.', turnNumber:1, speakerId:'primary', speakerName:'Mara'}],
  nextTurn:2, ...extra
});

test('agents watch for writing and metadata edits, decline requests, and get checked map updates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-studio-watch-'));
  const port = await freePort();
  await writeFile(join(directory, 'library.json'), JSON.stringify({activeId:'first', projects:[
    story('first', 'First Story'),
    // A request that no longer points at the last turn must never be written against.
    story('stale', 'Stale Story', {agentRequest:{mode:'send', speakerId:'primary', turnNumber:9}})
  ]}));
  const source = join(dirname(fileURLToPath(import.meta.url)), '..');
  const client = new Client({name:'story-studio-watch-test', version:'0.1.0'});
  const origin = `http://127.0.0.1:${port}`;
  const jsonHeaders = {'content-type':'application/json', origin};
  let childPid;
  // Queue a writer turn the way the browser does.
  async function queue(storyId, content) {
    const response = await fetch(origin + '/api/state');
    const state = await response.json();
    const project = state.projects.find(item => item.id === storyId);
    const turnNumber = Math.max(...project.messages.map(message => message.turnNumber)) + 1;
    project.messages.push({role:'user', content, turnNumber});
    project.nextTurn = turnNumber + 1;
    project.agentRequest = {mode:'send', speakerId:'primary', turnNumber};
    const saved = await fetch(origin + '/api/state', {method:'PUT', headers:{...jsonHeaders, 'if-match':response.headers.get('etag')}, body:JSON.stringify(state)});
    assert.equal(saved.status, 200);
  }
  const project = async id => (await (await fetch(origin + '/api/state')).json()).projects.find(item => item.id === id);
  try {
    await client.connect(new StdioClientTransport({
      command:join(source, 'bin', 'story-studio-mcp'),
      env:{PORT:String(port), STORY_STUDIO_DATA:directory}
    }));
    const instructions = client.getInstructions();
    assert.ok(instructions.length < 4096, 'Claude Code truncates server instructions at 4,096 characters');
    assert.match(instructions, /wait_for_queued_turn/);
    assert.match(instructions, /decline_turn/);
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(item => item.name).sort(),
      ['decline_turn', 'edit_story_state', 'get_story_context', 'get_story_state', 'inspect_continuity', 'list_stories', 'open_studio', 'record_scene', 'submit_reply',
        'submit_setup_response', 'wait_for_queued_turn', 'wait_for_setup_request']);
    const opened = toolData(await client.callTool({name:'open_studio', arguments:{}}));
    childPid = opened.pid;

    const directionLimit = `${'brief '.repeat(7999)}ending`;
    const longContext = toolData(await client.callTool({name:'get_story_context',arguments:{storyId:'first',direction:directionLimit}}));
    assert.ok(longContext.prompt.includes(directionLimit));
    const excessDirection = await client.callTool({name:'get_story_context',arguments:{storyId:'first',direction:`${directionLimit} more`}});
    assert.equal(excessDirection.isError,true);
    assert.match(excessDirection.content[0].text,/8,000 words/);
    const excessWriterTurn = await client.callTool({name:'submit_reply',arguments:{
      storyId:'first',revision:longContext.revision,writerTurn:`${directionLimit} more`,reply:'A fixture reply.'
    }});
    assert.equal(excessWriterTurn.isError,true);
    assert.match(excessWriterTurn.content[0].text,/8,000 words/);

    const idle = toolData(await client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:1}}));
    assert.equal(idle.status, 'idle');
    assert.equal(idle.skipped[0].storyId, 'stale');
    assert.match(idle.next, /call wait_for_queued_turn again/i);

    // A turn queued in a story that is not active is found while waiting.
    const waiting = client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:20}});
    await new Promise(resolve => setTimeout(resolve, 1500));
    await queue('stale', 'This one is ignored because the stale request is replaced below.');
    const queued = toolData(await waiting);
    assert.equal(queued.status, 'queued');
    assert.equal(queued.storyId, 'stale');
    assert.match(queued.prompt, /stale request is replaced/);
    assert.doesNotMatch(queued.prompt, /submit_reply’s updates array/);
    assert.match(queued.save, /submit_reply/);

    // Updates that cannot be kept are refused before anything is saved.
    const refused = await client.callTool({name:'submit_reply', arguments:{
      storyId:'stale', revision:queued.revision, reply:'Mara reads the log aloud.', storyTime:'1904-09-23T08:30',
      updates:[{kind:'relationship', from:'Mara', to:'Captain Wren', label:'Mara asks Wren for the key.'}, {kind:'profile', name:'Nobody', note:'A fact.'}]
    }});
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /Nothing was saved/);
    assert.match(refused.content[0].text, /Captain Wren is not a cast name/);
    assert.match(refused.content[0].text, /no single cast member is named Nobody/);
    assert.equal((await project('stale')).agentRequest.mode, 'send');

    const afterFence = await client.callTool({name:'submit_reply', arguments:{
      storyId:'stale', revision:queued.revision,
      reply:'Mara reads.\n```story-graph\n[{"kind":"fact","note":"The log is complete."}]\n```\nThen she closes it.'
    }});
    assert.match(afterFence.content[0].text, /Prose follows the story-graph block/);

    // A new character can be introduced and linked in the same reply; nicknames resolve.
    const saved = toolData(await client.callTool({name:'submit_reply', arguments:{
      storyId:'stale', revision:queued.revision, reply:'Mara reads the log aloud.', storyTime:'1904-09-23T08:30',
      updates:[
        {kind:'character', name:'Captain Wren', note:'Keeps the harbor keys.'},
        {kind:'relationship', from:'Mar', to:'Captain Wren', label:'Mara asks Wren for the key.', storyTime:'1904-09-23T08:31'},
        {kind:'profile', name:'Io', note:'Iona can read semaphore.'},
        {kind:'world', note:'The archive floods at spring tide.'},
        {kind:'fact', note:'The log is complete.'}
      ]
    }}));
    assert.equal(saved.proposedUpdates, 5);
    assert.equal(saved.appliedUpdates, 5);
    assert.equal(saved.pendingUpdates, 0);
    const written = await project('stale');
    assert.equal(written.agentRequest, undefined);
    assert.deepEqual(written.messages.at(-1).appliedGraphUpdates.map(item => item.kind), ['character', 'relationship', 'profile', 'world', 'fact']);
    assert.equal(written.messages.at(-1).graphSuggestions, undefined);
    assert.equal(written.relationships.at(-1).turn,written.messages.at(-1).turnNumber);
    assert.equal(written.relationships.at(-1).storyTime,'1904-09-23T08:31');
    assert.equal(written.messages.at(-1).storyTime, '1904-09-23T08:30');

    // Declining clears the queue, labels the writer turn and leaves a notice.
    await queue('first', 'Write the explicit version.');
    const second = toolData(await client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:5}}));
    assert.equal(second.storyId, 'first');
    const declined = toolData(await client.callTool({name:'decline_turn', arguments:{
      storyId:'first', revision:second.revision, writerTurn:'explicit',
      reason:'I can’t write explicit scenes. Switch to OpenRouter for this one.'
    }}));
    assert.equal(declined.declined, 2);
    const handedBack = await project('first');
    assert.equal(handedBack.agentRequest, undefined);
    assert.equal(handedBack.messages.at(-1).contentSensitivity, 'explicit');
    assert.match(handedBack.agentNotice.message, /Switch to OpenRouter/);
    const quiet = toolData(await client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:1}}));
    assert.equal(quiet.status, 'idle', 'a declined turn is not picked up again');
    const context = toolData(await client.callTool({name:'get_story_context', arguments:{storyId:'first'}}));
    assert.doesNotMatch(context.prompt, /explicit version/, 'the declined explicit turn leaves MCP context');

    const queueReplacement = async changes => {
      const response = await fetch(origin + '/api/state');
      const state = await response.json();
      const target = state.projects.find(item => item.id === 'first');
      changes(target);
      target.agentRequest = {mode:'replace',speakerId:'story-studio:narrator',turnNumber:2,replyTurnNumber:3};
      const saved = await fetch(origin + '/api/state', {method:'PUT',
        headers:{...jsonHeaders, 'if-match':response.headers.get('etag')}, body:JSON.stringify(state)});
      assert.equal(saved.status, 200);
    };
    await queueReplacement(target => {
      Object.assign(target.messages[1],{content:'Revised: open a different ledger.',contentSensitivity:'reviewed-safe'});
      captureGraphVersion(target,0);
      target.lore = 'Later reveal: the harbor has a hidden tunnel.';
      captureGraphVersion(target,4);
      target.messages.push({
        role:'assistant',turnNumber:3,content:'Old paired reply.',storyTime:'1904-09-23T08:00',
        alternatives:['Other take.','Old paired reply.'],selectedAlternative:1,alternativeSensitivities:[null,'safe'],
        graphSuggestions:[{kind:'fact',note:'Old proposal.'}],
        firstTakeSuggestions:[{kind:'fact',note:'First take proposal.'}],
        appliedGraphUpdates:[{kind:'fact',note:'Accepted fact.'}]
      },{role:'user',turnNumber:4,content:'Later writer direction.'});
      target.nextTurn = 5;
      delete target.agentNotice;
    });
    const replacement = toolData(await client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:5}}));
    assert.deepEqual(replacement.pendingRequest,{mode:'replace',speakerId:'story-studio:narrator',turnNumber:2,replyTurnNumber:3});
    assert.match(replacement.prompt,/Mara unlocks the archive/);
    assert.match(replacement.prompt,/An old harbor/);
    assert.match(replacement.prompt,/open a different ledger/);
    assert.match(replacement.prompt,/1904-09-23T08:00/);
    assert.doesNotMatch(replacement.prompt,/Old paired reply|Other take|Later writer direction|Later reveal|submit_reply’s updates array/);
    const replaced = toolData(await client.callTool({name:'submit_reply', arguments:{
      storyId:'first',revision:replacement.revision,reply:'Mara opens the second ledger.',storyTime:'1904-09-23T09:00',
      updates:[{kind:'fact',note:'The second ledger is newer.'}]
    }}));
    assert.equal(replaced.turnNumber,3);
    assert.equal(replaced.proposedUpdates,0);
    const revised = await project('first');
    assert.equal(revised.agentRequest,undefined);
    assert.deepEqual(revised.messages.map(turn => turn.turnNumber),[1,2,3,4]);
    assert.deepEqual(revised.messages[2].alternatives,['Other take.','Mara opens the second ledger.']);
    assert.deepEqual(revised.messages[2].alternativeSensitivities,[null,null]);
    assert.equal(revised.messages[2].content,'Mara opens the second ledger.');
    assert.equal(revised.messages[2].storyTime,'1904-09-23T08:00');
    assert.equal(revised.messages[2].graphSuggestions,undefined);
    assert.deepEqual(revised.messages[2].firstTakeSuggestions,[{kind:'fact',note:'First take proposal.'}]);
    assert.deepEqual(revised.messages[2].appliedGraphUpdates,[{kind:'fact',note:'Accepted fact.'}]);
    assert.equal(revised.lore,'Later reveal: the harbor has a hidden tunnel.');
    assert.equal(revised.messages[3].content,'Later writer direction.');

    await queueReplacement(() => {});
    const next = toolData(await client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:5}}));
    await client.callTool({name:'decline_turn',arguments:{
      storyId:'first',revision:next.revision,writerTurn:'explicit',reason:'Use OpenRouter for this rewrite.'
    }});
    const declinedReplacement = await project('first');
    assert.equal(declinedReplacement.agentRequest,undefined);
    assert.equal(declinedReplacement.messages[1].contentSensitivity,'explicit');
    assert.equal(declinedReplacement.messages[2].content,'Mara opens the second ledger.');
    assert.deepEqual(declinedReplacement.agentNotice,{
      mode:'replace',turnNumber:2,replyTurnNumber:3,message:'Use OpenRouter for this rewrite.'
    });
    await queueReplacement(() => {});
    const blockedReplacement = await client.callTool({name:'get_story_context',arguments:{storyId:'first'}});
    assert.equal(blockedReplacement.isError,true);
    assert.match(blockedReplacement.content[0].text,/outside MCP context/);

    const queueEdit = async (id,instruction) => {
      const response = await fetch(origin + '/api/state');
      const library = await response.json();
      const target = library.projects.find(item => item.id === 'first');
      target.agentEditRequest = {id,instruction};
      target.agentRequest = {mode:'send',speakerId:'story-studio:narrator',turnNumber:4};
      target.messages[2].startsChapter = true;
      const saved = await fetch(origin + '/api/state',{method:'PUT',
        headers:{...jsonHeaders,'if-match':response.headers.get('etag')},body:JSON.stringify(library)});
      assert.equal(saved.status,200);
      return target;
    };
    const before = await queueEdit('edit-the-world','Add more world information and revise Iona’s profile.');
    const editing = toolData(await client.callTool({name:'wait_for_queued_turn',arguments:{waitSeconds:1}}));
    assert.equal(editing.status,'queued');
    assert.deepEqual(editing.pendingRequest,{mode:'edit',id:'edit-the-world'});
    assert.match(editing.instruction,/world information/);
    assert.match(editing.save,/edit_story_state/);
    assert.match(editing.state.world,/hidden tunnel/);
    assert.doesNotMatch(JSON.stringify(editing.state),/Mara unlocks the archive|Later writer direction|Other take/);
    assert.deepEqual(editing.overview.recentTurns.map(({content}) => content),['Mara unlocks the archive.','Later writer direction.']);
    const read = toolData(await client.callTool({name:'get_story_state',arguments:{storyId:'first'}}));
    assert.deepEqual(read.state,editing.state);
    assert.deepEqual(read.pendingRequest,editing.pendingRequest);

    const edit = (arguments_) => client.callTool({name:'edit_story_state',arguments:{
      storyId:'first',revision:editing.revision,requestId:editing.pendingRequest.id,...arguments_
    }});
    const changes = [
      {kind:'world',action:'append',text:'The lighthouse bell sounds at noon.'},
      {kind:'profile',name:'Iona',field:'description',action:'replace',text:'Pilots the early ferry and charts the shallows.'}
    ];
    const wrongRequest = await edit({requestId:'stale-request',changes});
    assert.equal(wrongRequest.isError,true);
    assert.match(wrongRequest.content[0].text,/requestId/);
    const erroneous = await edit({changes:[changes[0],{...changes[1],name:'Unknown cast member'}]});
    assert.equal(erroneous.isError,true);
    assert.equal((await project('first')).lore,before.lore,'invalid batches leave earlier changes unapplied');
    const badNarration = await client.callTool({name:'submit_reply',arguments:{
      storyId:'first',revision:editing.revision,reply:'Prose accidentally sent to Agent mode.'
    }});
    assert.equal(badNarration.isError,true);
    assert.match(badNarration.content[0].text,/queued Agent edit/);

    const applied = toolData(await edit({changes}));
    assert.equal(applied.appliedEdits,2);
    const edited = await project('first');
    assert.equal(edited.agentEditRequest,undefined);
    assert.deepEqual(edited.agentEditNotice,{message:'Applied 2 story edits.'});
    assert.deepEqual(edited.messages,before.messages);
    assert.deepEqual(edited.agentRequest,before.agentRequest);
    assert.match(edited.lore,/hidden tunnel\.[\s\S]*bell sounds at noon/);
    assert.match(edited.cast.find(member=>member.name === 'Iona').description,/charts the shallows/);
    const staleEdit = await edit({changes});
    assert.equal(staleEdit.isError,true);
    assert.match(staleEdit.content[0].text,/library changed/);

    const later = await queueEdit('unsupported-edit','Delete the chapter.');
    const decline = toolData(await client.callTool({name:'get_story_state',arguments:{storyId:'first'}}));
    const rejected = toolData(await client.callTool({name:'edit_story_state',arguments:{
      storyId:'first',revision:decline.revision,requestId:'unsupported-edit',reason:'Agent mode only edits metadata.'
    }}));
    assert.equal(rejected.declined,true);
    const declinedEdit = await project('first');
    assert.equal(declinedEdit.agentEditRequest,undefined);
    assert.deepEqual(declinedEdit.agentEditNotice,{message:'Agent mode only edits metadata.'});
    assert.deepEqual(declinedEdit.messages,later.messages);
    const directRead = toolData(await client.callTool({name:'get_story_state',arguments:{storyId:'first'}}));
    assert.equal(directRead.pendingRequest,null);
    assert.equal(directRead.instruction,undefined);
    const direct = toolData(await client.callTool({name:'edit_story_state',arguments:{
      storyId:'first',revision:directRead.revision,changes:[{kind:'notes',action:'append',text:'Use past tense.'}]
    }}));
    assert.equal(direct.appliedEdits,1);
    assert.equal((await project('first')).notes,'Use past tense.');
    const nextWriting = toolData(await client.callTool({name:'wait_for_queued_turn',arguments:{waitSeconds:1}}));
    assert.equal(nextWriting.pendingRequest.mode,'send');
    assert.equal(nextWriting.storyId,'first');
  } finally {
    await client.close();
    if (childPid) process.kill(childPid);
    await rm(directory, {force:true, recursive:true});
  }
});
