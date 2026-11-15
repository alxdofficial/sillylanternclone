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
    messages:[{role:'assistant', content:'Mara waits.', turnNumber:1}], nextTurn:2
  }]}));
  const source = join(dirname(fileURLToPath(import.meta.url)), '..');
  const client = new Client({name:'claude-code', title:'Claude Code', version:'0.0.0'});
  let childPid;
  const agents = async () => (await (await fetch(origin + '/api/agent')).json()).agents;
  try {
    await client.connect(new StdioClientTransport({command:join(source, 'bin', 'story-studio-mcp'), env:{PORT:String(port), STORY_STUDIO_DATA:directory}}));
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

    await client.callTool({name:'submit_reply', arguments:{storyId:'story', revision:queued.revision, reply:'Mara opens it.'}});
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
