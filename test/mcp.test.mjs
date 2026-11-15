import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { strFromU8, unzipSync } from 'fflate';
import { starterStoryId } from '../public/library.js';
import { narrator } from '../public/prompt.js';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const toolData = result => JSON.parse(result.content[0].text);

test('native MCP handshake, private context, queued replies, alternates and revision conflicts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-studio-mcp-'));
  const port = await freePort();
  const book = {
    activeId:'story',
    projects:[{
      id:'story',
      title:'The New Bridge',
      characterName:'Mara',
      character:'An archivist.',
      persona:'',
      lore:'An old harbor.',
      notes:'',
      continuity:'Mara and Iona now trust one another.',
      messages:[
        {role:'assistant', content:'PRIVATE TEST MARKER', turnNumber:1, contentSensitivity:'explicit'},
        {role:'user', content:'Plan how they cross the bridge.', turnNumber:2}
      ],
      nextTurn:3,
      agentRequest:{mode:'send',speakerId:'primary',turnNumber:2}
    }]
  };
  book.projects.push({
    id:'handoff',title:'The Morning After',characterName:'Mara',character:'An archivist.',
    cast:[{id:'iona',name:'Iona',description:'A pilot.',personality:'',scenario:'',examples:''}],
    persona:'',lore:'An old harbor.',notes:'',storyStartAt:'1904-09-23T08:00',
    relationships:[{from:'primary',to:'iona',label:'They agreed to meet at the harbor café.',turn:1,storyTime:'1904-09-23T08:10'}],
    messages:[
      {role:'assistant',content:'EXPLICIT PROSE MARKER',turnNumber:1,contentSensitivity:'explicit',
        graphSuggestions:[{kind:'fact',note:'UNREVIEWED GRAPH MARKER'}]},
      {role:'assistant',content:'UNVERIFIED PROSE MARKER',turnNumber:2,contentSensitivity:'unclassified'},
      {role:'assistant',content:'ALL ROUTES PRIVATE MARKER',turnNumber:3,excludeFromContext:true},
      {role:'user',content:'WITHHELD DIRECTION MARKER',turnNumber:4,contentSensitivity:'explicit'},
      {role:'assistant',content:'MISLABELED PROSE MARKER',turnNumber:5,contentSensitivity:'safe'},
      {role:'assistant',content:'UNLABELED PROSE MARKER',turnNumber:6},
      {role:'assistant',content:'They walked to the café.',turnNumber:7,contentSensitivity:'reviewed-safe'},
      {role:'user',content:'Write their conversation at the café.',turnNumber:8}
    ],
    agentRequest:{mode:'send',speakerId:narrator.id,turnNumber:8}
  });
  await writeFile(join(directory, 'library.json'), JSON.stringify(book));
  const source = join(dirname(fileURLToPath(import.meta.url)), '..');
  const client = new Client({name:'story-studio-test',version:'0.1.0'});
  const transport = new StdioClientTransport({
    command:join(source,'bin','story-studio-mcp'),
    env:{PORT:String(port), STORY_STUDIO_DATA:directory}
  });
  let childPid;
  try {
    await client.connect(transport);
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['decline_turn','get_story_context','list_stories','open_studio','submit_reply','wait_for_queued_turn']);
    const opened = await client.callTool({name:'open_studio',arguments:{}});
    assert.equal(opened.isError, undefined, JSON.stringify(opened));
    assert.equal(toolData(opened).started, true, JSON.stringify(opened));
    childPid = toolData(opened).pid;
    const reused = await client.callTool({name:'open_studio',arguments:{}});
    assert.equal(toolData(reused).started, false);

    const stories = await client.callTool({name:'list_stories',arguments:{}});
    assert.equal(toolData(stories).activeStoryId, 'story');
    assert.equal(toolData(stories).stories[0].pendingRequest, 'send');
    const context = toolData(await client.callTool({name:'get_story_context',arguments:{}}));
    assert.equal(context.pendingRequest.mode, 'send');
    assert.deepEqual(context.speaker,narrator);
    assert.match(context.prompt,/You are the narrator/);
    assert.match(context.prompt, /now trust one another/);
    assert.match(context.prompt, /Plan how they cross the bridge/);
    assert.doesNotMatch(context.prompt, /PRIVATE TEST MARKER/);

    const saved = await client.callTool({name:'submit_reply',arguments:{
      storyId:'story', speakerId:context.speaker.id, revision:context.revision,
      storyTime:'1904-09-23T08:30',
      reply:'Mara tests the bridge.\n\n```story-graph\n[{"kind":"fact","note":"The bridge is passable."}]\n```'
    }});
    assert.equal(toolData(saved).turnNumber, 3, JSON.stringify(saved));
    assert.equal(toolData(saved).proposedUpdates, 1);
    const stale = await client.callTool({name:'submit_reply',arguments:{
      storyId:'story',revision:context.revision,reply:'Old draft'
    }});
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /changed since this draft/);
    const diagnostics = await readFile(join(directory,'logs','mcp.log'),'utf8');
    const events = diagnostics.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.tool === 'submit_reply' && event.event === 'tool_completed'));
    assert.ok(events.some(event => event.tool === 'submit_reply' && event.code === 'REVISION_CONFLICT'));
    assert.doesNotMatch(diagnostics,/PRIVATE TEST MARKER|Mara tests the bridge|Old draft/);

    const origin = `http://127.0.0.1:${port}`;
    let stateResponse = await fetch(origin+'/api/state');
    const state = await stateResponse.json();
    const project = state.projects[0];
    assert.equal(project.agentRequest, undefined);
    assert.equal(project.messages[0].content, 'PRIVATE TEST MARKER');
    assert.equal(project.messages[2].content, 'Mara tests the bridge.');
    assert.equal(project.messages[2].speakerId,narrator.id);
    assert.equal(project.messages[2].storyTime, '1904-09-23T08:30');
    assert.equal(project.storyStartAt, '1904-09-23T08:30');
    assert.equal(project.messages[2].graphSuggestions[0].note, 'The bridge is passable.');
    project.agentRequest = {mode:'alternate',speakerId:'primary',turnNumber:3};
    const queued = await fetch(origin+'/api/state', {
      method:'PUT',
      headers:{'content-type':'application/json',origin,'if-match':stateResponse.headers.get('etag')},
      body:JSON.stringify(state)
    });
    assert.equal(queued.status,200);
    const alternate = toolData(await client.callTool({name:'get_story_context',arguments:{}}));
    assert.match(alternate.prompt, /different take/);
    assert.doesNotMatch(alternate.prompt, /Mara tests the bridge/);
    const substituted = await client.callTool({name:'submit_reply',arguments:{
      storyId:'story',revision:alternate.revision,reply:'Mara checks the rope first.'
    }});
    assert.equal(toolData(substituted).turnNumber, 3, JSON.stringify(substituted));
    stateResponse = await fetch(origin+'/api/state');
    const final = (await stateResponse.json()).projects[0];
    assert.equal(final.agentRequest, undefined);
    assert.equal(final.messages.length, 3);
    assert.equal(final.messages[2].storyTime, '1904-09-23T08:30');
    assert.deepEqual(final.messages[2].alternatives, ['Mara tests the bridge.','Mara checks the rope first.']);

    const handoffCalls = [
      {name:'get_story_context',arguments:{storyId:'handoff'}},
      {name:'wait_for_queued_turn',arguments:{waitSeconds:1}}
    ];
    for (const call of handoffCalls) {
      const handoff = toolData(await client.callTool(call));
      assert.equal(handoff.storyId,'handoff');
      assert.match(handoff.prompt,/Relationship map:[\s\S]*They agreed to meet at the harbor café/);
      assert.match(handoff.prompt,/They walked to the café/);
      assert.match(handoff.prompt,/Write their conversation at the café/);
      assert.doesNotMatch(JSON.stringify(handoff),/PROSE MARKER|ALL ROUTES PRIVATE MARKER|WITHHELD DIRECTION MARKER|UNREVIEWED GRAPH MARKER/);
    }

    const disk = await readFile(join(directory,'library.json'),'utf8');
    const demo = toolData(await client.callTool({name:'get_story_context',arguments:{storyId:starterStoryId}}));
    assert.equal(demo.title,'The Late Ferry');
    assert.equal(demo.cast.length,6);
    const demoReply = await client.callTool({name:'submit_reply',arguments:{
      storyId:starterStoryId,revision:demo.revision,reply:'Noor confirmed the two flashes from shore.'
    }});
    assert.equal(toolData(demoReply).turnNumber,7);
    const live = await (await fetch(origin+'/api/state')).json();
    assert.equal(live.projects.find(story => story.id === starterStoryId).messages.length,7);
    assert.equal(await readFile(join(directory,'library.json'),'utf8'),disk);

    const jsonHeaders = {'content-type':'application/json',origin};
    const exportResponse = await fetch(origin+'/api/export',{
      method:'POST',headers:jsonHeaders,body:JSON.stringify(live)
    });
    assert.equal(exportResponse.status,200);
    const archive = unzipSync(new Uint8Array(await exportResponse.arrayBuffer()));
    assert.deepEqual(JSON.parse(strFromU8(archive['library.json'])),JSON.parse(disk));

    const reset = await fetch(origin+'/api/starter/reset',{
      method:'POST',headers:jsonHeaders,body:'{}'
    });
    assert.equal(reset.status,200);
    const restored = await reset.json();
    assert.equal(restored.projects.find(story => story.id === starterStoryId).messages.length,6);
    assert.equal(await readFile(join(directory,'library.json'),'utf8'),disk);

    const starter = restored.projects.find(story => story.id === starterStoryId);
    const openedDemo = await fetch(origin+'/api/starter',{
      method:'PUT',headers:{...jsonHeaders,'if-match':reset.headers.get('etag')},body:JSON.stringify(starter)
    });
    assert.equal(openedDemo.status,200);
    const demoRevision = (await openedDemo.json()).revision;
    await fetch(origin+'/api/starter/reset',{method:'POST',headers:jsonHeaders,body:'{}'});
    const delayedEdit = await fetch(origin+'/api/starter',{
      method:'PUT',headers:{...jsonHeaders,'if-match':demoRevision},body:JSON.stringify({...starter,title:'Stale edit'})
    });
    assert.equal(delayedEdit.status,409);
  } finally {
    await client.close();
    if (childPid) process.kill(childPid);
    await rm(directory,{force:true,recursive:true});
  }
});
