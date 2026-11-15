import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

test('agents watch for queued turns, decline them, and get checked map updates', async () => {
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
      ['decline_turn', 'get_story_context', 'list_stories', 'open_studio', 'submit_reply', 'wait_for_queued_turn']);
    const opened = toolData(await client.callTool({name:'open_studio', arguments:{}}));
    childPid = opened.pid;

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
    assert.match(queued.prompt, /submit_reply’s updates array/);
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
    const written = await project('stale');
    assert.equal(written.agentRequest, undefined);
    assert.deepEqual(written.messages.at(-1).graphSuggestions.map(item => item.kind), ['character', 'relationship', 'profile', 'world', 'fact']);
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
  } finally {
    await client.close();
    if (childPid) process.kill(childPid);
    await rm(directory, {force:true, recursive:true});
  }
});
