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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const toolData = result => JSON.parse(result.content[0].text);

test('the page can see whether an agent is watching, writing or gone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-studio-agent-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  await writeFile(join(directory, 'library.json'), JSON.stringify({activeId:'story', projects:[{
    id:'story', title:'Status', characterName:'Mara', character:'An archivist.', persona:'', lore:'', notes:'',
    messages:[{role:'assistant', content:'WITHHELD EARLIER DRAFT', turnNumber:1,contentSensitivity:'explicit'}], nextTurn:2
  }]}));
  const source = join(dirname(fileURLToPath(import.meta.url)), '..');
  const client = new Client({name:'claude-code', title:'Claude Code', version:'0.0.0'});
  let childPid;
  const agents = async () => (await (await fetch(origin + '/api/agent')).json()).agents;
  try {
    await client.connect(new StdioClientTransport({command:join(source, 'bin', 'story-studio-mcp'), env:{PORT:String(port), STORY_STUDIO_DATA:directory, STORY_STUDIO_LEGACY_QUEUE:'1'}}));
    childPid = toolData(await client.callTool({name:'open_studio', arguments:{}})).pid;
    assert.deepEqual(await agents(), []);

    // Only well-formed reports from the app's own origin are accepted.
    const bad = await fetch(origin + '/api/agent', {method:'POST', headers:{'content-type':'application/json', origin}, body:JSON.stringify({id:'x', state:'watching'})});
    assert.equal(bad.status, 400);
    const foreign = await fetch(origin + '/api/agent', {method:'POST', headers:{'content-type':'application/json', origin:'http://example.com'}, body:'{}'});
    assert.equal(foreign.status, 403);

    const waiting = client.callTool({name:'wait_for_queued_turn', arguments:{waitSeconds:15}});
    await pause(800);
    let [agent] = await agents();
    assert.equal(agent.state, 'watching');
    assert.equal(agent.client, 'Claude');

    const response = await fetch(origin + '/api/state');
    const library = await response.json();
    library.projects[0].messages.push({role:'user', content:'Open the archive.', turnNumber:2});
    library.projects[0].nextTurn = 3;
    library.projects[0].agentRequest = {mode:'send', speakerId:'primary', turnNumber:2};
    await fetch(origin + '/api/state', {method:'PUT', headers:{'content-type':'application/json', origin, 'if-match':response.headers.get('etag')}, body:JSON.stringify(library)});
    const queued = toolData(await waiting);
    assert.equal(queued.status, 'queued');
    await pause(300);
    [agent] = await agents();
    assert.deepEqual([agent.state, agent.storyId, agent.turnNumber, agent.speaker], ['writing', 'story', 2, 'Narrator']);

    const saved = toolData(await client.callTool({name:'submit_reply', arguments:{storyId:'story',
      revision:queued.revision,reply:'Mara opens it.'}}));
    assert.equal(saved.continuityPending,true);
    const continuity = toolData(await client.callTool({name:'wait_for_queued_turn',arguments:{waitSeconds:1}}));
    assert.deepEqual(continuity.pendingRequest,{mode:'continuity',turnNumber:saved.turnNumber});
    assert.equal(continuity.authorDirection,'Open the archive.');
    assert.equal(continuity.draft,'Mara opens it.');
    assert.doesNotMatch(JSON.stringify(continuity),/WITHHELD EARLIER DRAFT/);
    const world = toolData(await client.callTool({name:'inspect_continuity',arguments:{storyId:'story',section:'world'}}));
    assert.equal(typeof world.world,'string');
    const record = edits => client.callTool({name:'record_scene',arguments:{storyId:'story',
      revision:continuity.revision,turnNumber:continuity.turnNumber,storyTime:'1998-10-25T00:13',
      updates:[{kind:'fact',note:'Mara opened the archive.'}],...edits}});
    const stale = await record({revision:queued.revision});
    assert.equal(stale.isError,true);
    assert.match(stale.content[0].text,/library changed/i);
    const wrongTurn = await record({turnNumber:continuity.turnNumber + 1});
    assert.equal(wrongTurn.isError,true);
    assert.match(wrongTurn.content[0].text,/no longer awaiting continuity/i);
    const badMap = await record({updates:[{kind:'profile',name:'Unknown',note:'An old map.'}]});
    assert.equal(badMap.isError,true);
    assert.match(badMap.content[0].text,/Fix these map updates/i);
    const recorded = toolData(await record());
    assert.equal(recorded.appliedUpdates,1);
    const final = await fetch(origin + '/api/state');
    const finished = (await final.json()).projects[0];
    assert.equal(finished.messages[1].storyTime,'1998-10-25T00:13');
    assert.equal(finished.messages[2].content,'Mara opens it.');
    assert.equal(finished.messages[2].continuityPending,undefined);
    assert.equal(finished.messages[2].appliedGraphUpdates.length,1);
    assert.equal((await record({revision:final.headers.get('etag')})).isError,true);
    await pause(300);
    [agent] = await agents();
    assert.equal(agent.state, 'watching', 'a watching agent goes back to watching after saving');

    await client.close();
    await pause(500);
    assert.deepEqual(await agents(), [], 'a closed agent is no longer shown');
  } finally {
    await client.close().catch(() => {});
    if (childPid) process.kill(childPid);
    await rm(directory, {force:true, recursive:true});
  }
});
