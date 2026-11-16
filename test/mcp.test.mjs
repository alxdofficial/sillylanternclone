import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['decline_turn','edit_story_state','get_story_context','get_story_state','inspect_continuity','list_stories','open_studio','record_scene','submit_reply',
      'submit_setup_response','wait_for_queued_turn','wait_for_setup_request']);
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
    const sessionId = randomUUID();
    const setup = body => fetch(origin+'/api/setup/mcp',{method:'POST',
      headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({sessionId,...body})});
    const waitForSetup = () => client.callTool({name:'wait_for_setup_request',arguments:{sessionId,waitSeconds:1}}).then(toolData);
    const manuscript = {turnCount:2,hasChapters:true,passages:[{turn:2,excerpt:'PREVIEWED SETUP EXCERPT'}]};
    const contextNote = 'SETUP NOTES: The bridge is closed in winter.' + ' bridge-reference-note'.repeat(16_000);
    const request = {action:'queue',mode:'chat',messages:[{role:'user',content:'Help me plan an import.'}],
      manuscript,context:contextNote};
    assert.equal((await setup({...request,context:'note '.repeat(20_001)})).status,400);
    assert.equal(toolData(await client.callTool({name:'wait_for_setup_request',arguments:{sessionId,waitSeconds:1}})).status,'closed');
    assert.equal((await setup(request)).status,200);
    const queuedSetup = await waitForSetup();
    assert.match(queuedSetup.prompt[1].content,/PREVIEWED SETUP EXCERPT/);
    assert.ok(queuedSetup.prompt[1].content.includes(contextNote));
    assert.doesNotMatch(JSON.stringify(queuedSetup),/PRIVATE TEST MARKER/);
    const submitSetup = (requestId,response) => client.callTool({name:'submit_setup_response',arguments:{sessionId,requestId,...response}});
    assert.equal(toolData(await submitSetup(queuedSetup.requestId,{text:'What should we preserve?'})).status,'saved');
    assert.deepEqual(await (await setup({action:'status'})).json(),{status:'done',text:'What should we preserve?'});
    assert.equal((await setup({action:'queue',mode:'draft',messages:[],manuscript,context:contextNote})).status,200);
    const draftRequest = await waitForSetup();
    assert.notEqual(queuedSetup.requestId,draftRequest.requestId);
    assert.ok(draftRequest.prompt[1].content.includes(contextNote));
    assert.equal((await submitSetup(queuedSetup.requestId,{text:'Stale setup reply.'})).isError,true);
    const draft = {title:'The Harbor',lore:'A port city.',scenario:'',notes:'',cast:[],continuity:'',chapterStarts:[2]};
    assert.equal(toolData(await submitSetup(draftRequest.requestId,{draft})).status,'saved');
    assert.deepEqual(await (await setup({action:'status'})).json(),{status:'done',draft:{...draft,chapterStarts:[]}});
    await setup({action:'cancel'});
    assert.equal((await waitForSetup()).status,'closed');

    let stateResponse = await fetch(origin+'/api/state');
    const state = await stateResponse.json();
    const project = state.projects[0];
    assert.equal(project.agentRequest, undefined);
    assert.equal(project.messages[0].content, 'PRIVATE TEST MARKER');
    assert.equal(project.messages[2].content, 'Mara tests the bridge.');
    assert.equal(project.messages[2].speakerId,narrator.id);
    assert.equal(project.messages[2].storyTime, '1904-09-23T08:30');
    assert.equal(project.storyStartAt, '1904-09-23T08:30');
    assert.equal(project.messages[2].appliedGraphUpdates[0].note, 'The bridge is passable.');
    assert.equal(project.messages[2].graphSuggestions, undefined);
    assert.match(project.continuity,/Turn 3: The bridge is passable/);
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
    const handoffLog = await readFile(join(directory,'logs','mcp.log'),'utf8');
    const handoffEvents = handoffLog.trim().split('\n').map(line=>JSON.parse(line));
    const prepared = handoffEvents.find(event=>event.event === 'context_prepared' && event.turnNumber === 8);
    assert.match(prepared?.storyRef,/^[a-f0-9]{12}$/);
    assert.equal(prepared?.historyIncluded,1);
    assert.equal(prepared?.historyOmittedForBudget,0);
    assert.deepEqual(prepared?.historyOmittedByPolicy,{allRoutes:1,explicit:2,unverified:1,directionWithheld:2});
    assert.deepEqual(prepared?.recentPolicyOmissions.at(-1),{turnNumber:6,reason:'directionWithheld'});
    assert.ok(handoffEvents.some(event=>event.tool === 'wait_for_queued_turn' && event.storyRef === prepared.storyRef && event.turnNumber === 8));
    assert.doesNotMatch(handoffLog,/PROSE MARKER|conversation at the café|The Morning After/);

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
