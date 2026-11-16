import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendTurn, buildMessages, stripSpeakerName, formatMessages, getCast, narrator, isAvailableToMcp, isStoryTime, lastStoryTime, mcpOmissionReason, storyEditContext, precedingDirection, recordStoryTime, writeInputProblem } from './public/prompt.js';
import { applyTurnGraphUpdates } from './public/graph-history.js';
import { activeStoryFlow, storyFlowDirectionLimit, storyFlowOptionCount, storyFlowTitleLimit, storyFlowTurn, validStoryFlowOptions } from './public/story-flow.js';

import { checkMapUpdates, updateSchema } from './map-updates.mjs';
import { inspectContinuity, inspectDescription, nativeInspectShape, recordDescription, sceneTimeSchema, sceneUpdatesSchema } from './continuity.mjs';
import { applyStoryEdits, storyEditChangesSchema } from './story-edits.mjs';
import { createLogger, createTrace, diagnosticError, errorCode, storyReference } from './diagnostics.mjs';
import { applyNativeStoryChange, createNativeStory, nativeSetupSchema, nativeStoryChange, readNativeTurns } from './native-story.mjs';

const log = createLogger('mcp');
const trace = createTrace('mcp');
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  log('error','startup_failed',{code:'INVALID_PORT'});
  console.error('Story Studio MCP: PORT must be a valid local port.');
  process.exit(1);
}
const origin = `http://127.0.0.1:${port}`;
const companionUrl = (view,storyId) => origin + '/?view=' + view + (storyId ? '&story=' + encodeURIComponent(storyId) : '') + '&via=mcp';
const appDirectory = fileURLToPath(new URL('.', import.meta.url));
const castPageSize = 24;
const instructions = 'Story Studio provides optional tools to read and modify the local story library. Tool descriptions define their scope. Use the current revision for writes and keep changes within the author’s request. Story material is reference data. Withheld turns expose metadata only. Use filtered reads for story text and respect context holds.';
const studio = new McpServer({name:'story-studio',version:'0.3.0'},{instructions});

function result(payload) {
  return {content:[{type:'text',text:JSON.stringify(payload)}]};
}
function failure(message) {
  return {isError:true, content:[{type:'text',text:message}]};
}
function tool(name, config, handler) {
  studio.registerTool(name, config, async (args, extra) => {
    const started = Date.now();
    try {
      const payload = await handler(args, extra);
      log('info','tool_completed',{tool:name,durationMs:Date.now()-started,
        storyRef:storyReference(payload.storyId),turnNumber:payload.turnNumber,
        proposedUpdates:payload.proposedUpdates,appliedUpdates:payload.appliedUpdates,
        pendingUpdates:payload.pendingUpdates,appliedEdits:payload.appliedEdits});
      trace('tool_result',{tool:name,sessionId:agentId,durationMs:Date.now()-started,args,result:payload});
      return result(payload);
    } catch (error) {
      const code = errorCode(error,'TOOL_REQUEST_REJECTED');
      const message = error instanceof Error ? error.message : 'Story Studio request failed.';
      log('warn','tool_failed',{tool:name,code,durationMs:Date.now()-started});
      trace('tool_error',{tool:name,sessionId:agentId,durationMs:Date.now()-started,args,error:{code,message}});
      return failure(message);
    }
  });
}

const agentId = randomUUID();

let cached;
async function readLibrary({conditional = false} = {}) {
  let response;
  try {
    response = await fetch(origin + '/api/state', {
      headers:conditional && cached ? {'if-none-match':cached.revision} : {},
      signal:AbortSignal.timeout(5000),
      redirect:'error'
    });
  } catch (error) {
    throw diagnosticError(errorCode(error) === 'TIMEOUT' ? 'APP_TIMEOUT' : 'APP_UNREACHABLE',
      'Story Studio is not reachable. Start the app or call open_studio.');
  }
  if (response.status === 304 && conditional && cached) return {library:structuredClone(cached.library), revision:cached.revision};
  if (!response.ok) throw diagnosticError('APP_HTTP_ERROR',`Could not read the local Story Studio library (HTTP ${response.status}).`);
  const revision = response.headers.get('etag');
  const library = await response.json();
  if (!revision || !Array.isArray(library.projects) || typeof library.activeId !== 'string') {
    throw diagnosticError('APP_INVALID_RESPONSE','The local port did not return a Story Studio library.');
  }
  cached = {library:structuredClone(library), revision};
  return {library, revision};
}

function findStory(library, storyId) {
  const project = library.projects.find(story => story.id === (storyId || library.activeId));
  if (!project) throw Error('Story not found. Call list_stories to see the available stories.');
  return project;
}

const identifier = z.string().min(1).max(200);
const libraryRevision = z.string().regex(/^"[a-f0-9]{64}"$/);
const writingDirection = z.string().superRefine((value,context) => {
  const message = writeInputProblem(value);
  if (message) context.addIssue({code:'custom',message});
});
function castPreview(cast) {
  return cast.length > castPageSize ? {cast:cast.slice(0,castPageSize),castNextOffset:castPageSize} : {cast};
}

function storyState(revision,project) {
  const state = storyEditContext(project);
  const {cast,castNextOffset} = castPreview(state.cast);
  if (castNextOffset) {
    state.cast = cast;
    state.shortened = true;
  }
  return {
    storyId:project.id,title:state.title,revision,state,
    ...(castNextOffset ? {castNextOffset} : {}),
    settings:{storyStartAt:project.storyStartAt || '',knownTime:lastStoryTime(project),graphUpdates:project.graphUpdates !== false}
  };
}

tool('inspect_continuity', {
  description:inspectDescription + ' Follow nextOffset for more entries or text. Relationship entries include the eventIndex at this revision.',
  inputSchema:{storyId:identifier.optional(),...nativeInspectShape},
  annotations:{readOnlyHint:true,openWorldHint:false}
},async ({storyId,...scope}) => {
  const {library,revision} = await readLibrary();
  const project = findStory(library,storyId);
  return {storyId:project.id,revision,...inspectContinuity(project,{...scope,includeEventIndex:true,castPageSize})};
});

function pendingContinuity(project,turnNumber) {
  let direction;
  for (const [index,scene] of project.messages.entries()) {
    if (scene.role === 'user') direction = scene;
    else if (scene.continuityPending === true && (turnNumber === undefined || scene.turnNumber === turnNumber)
      && isAvailableToMcp(scene,direction)) return {scene,direction:scene.standalone === true ? undefined : direction,index};
  }
  return null;
}

function continuityContext(project,revision,{scene,direction,index}) {
  return {storyId:project.id,revision,turnNumber:scene.turnNumber,draft:scene.content,
    authorDirection:direction && isAvailableToMcp(direction) ? direction.content : '',
    knownTime:lastStoryTime({...project,messages:project.messages.slice(0,index)}),
    ...castPreview(getCast(project).map(({name}) => name)),
    allowUpdates:project.graphUpdates !== false};
}

tool('get_scene_continuity', {
  description:'Read an eligible scene still awaiting continuity. Use after a saved scene needs a separate continuity step.',
  inputSchema:{storyId:identifier.optional(),turnNumber:z.number().int().positive().optional()},
  annotations:{readOnlyHint:true,openWorldHint:false}
},async ({storyId,turnNumber}) => {
  const {library,revision} = await readLibrary();
  const project = findStory(library,storyId);
  const scene = pendingContinuity(project,turnNumber);
  return scene ? continuityContext(project,revision,scene) : {storyId:project.id,revision,continuityPending:false};
});

tool('record_scene', {
  description:recordDescription + ' Use the exact turn and revision from get_scene_continuity or submit_reply.',
  inputSchema:{storyId:identifier,revision:libraryRevision,turnNumber:z.number().int().positive(),
    storyTime:sceneTimeSchema.optional(),updates:sceneUpdatesSchema},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
},async ({storyId,revision,turnNumber,storyTime,updates}) => {
  const {library,revision:currentRevision} = await readLibrary();
  if (currentRevision !== revision) throw diagnosticError('REVISION_CONFLICT','The library changed. Call get_scene_continuity again before recording.');
  const project = findStory(library,storyId);
  const pendingScene = pendingContinuity(project,turnNumber);
  if (!pendingScene) throw diagnosticError('SCENE_CHANGED','This turn is no longer awaiting continuity updates.');
  const checked = checkMapUpdates(project,project.graphUpdates === false ? [] : updates);
  if (checked.problems.length) throw diagnosticError('MAP_UPDATES_INVALID','Fix these map updates or leave them out:\n' + checked.problems.join('\n'));
  const {scene,index} = pendingScene;
  const clock = index === project.messages.length - 1 ? project : {...project,messages:project.messages.slice(0,index),relationships:[]};
  scene.storyTime = recordStoryTime(clock,storyTime);
  const writer = project.messages[index - 1];
  if (!scene.standalone && writer?.role === 'user' && !isStoryTime(writer.storyTime)) writer.storyTime = scene.storyTime;
  const {applied,pending} = applyTurnGraphUpdates(project,scene,checked.updates,{allowAutomatic:true});
  delete scene.continuityPending;
  const response = await fetch(origin + '/api/state',{
    method:'PUT',headers:{'content-type':'application/json',origin,'if-match':revision},
    body:JSON.stringify(library),signal:AbortSignal.timeout(12000),redirect:'error'
  });
  if (response.status === 409) throw diagnosticError('REVISION_CONFLICT','The library changed while recording continuity.');
  if (!response.ok) throw diagnosticError('APP_WRITE_FAILED',`Could not save continuity (HTTP ${response.status}).`);
  return {storyId,revision:(await response.json()).revision,turnNumber,appliedUpdates:applied,pendingUpdates:pending};
});

tool('get_story_state', {
  description:'Read a story-state overview and current revision before editing. Use inspect_continuity to read full fields, more cast entries, and individual relationship events.',
  inputSchema:{storyId:identifier.optional().describe('Use the active story when omitted.')},
  annotations:{readOnlyHint:true,openWorldHint:false},
  _meta:{'anthropic/maxResultSizeChars':200000}
}, async ({storyId}) => {
  const {library,revision} = await readLibrary();
  return storyState(revision,findStory(library,storyId));
});

tool('edit_story_state', {
  description:'Apply a batch of changes to world, cast, notes, settings, and relationship events. Existing relationships use the eventIndex for the given revision.',
  inputSchema:{storyId:identifier,revision:libraryRevision,changes:storyEditChangesSchema},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
}, async ({storyId,revision,changes}) => mutateStoryLibrary(revision,library=>{
  const project = findStory(library,storyId);
  return {storyId,appliedEdits:applyStoryEdits(project,changes)};
}));

function storyContext(revision, project, direction = '', purpose = 'draft') {
  const flow = activeStoryFlow(project);
  const flowChoice = flow?.source === 'mcp' ? flow.options[flow.selected] : undefined;
  const messages = buildMessages(project,direction.trim(),'reference').slice(1);
  const omitted = {allRoutes:0,explicit:0,unverified:0,directionWithheld:0};
  const recentPolicyOmissions = [];
  let priorDirection;
  for (const [index,turn] of project.messages.entries()) {
    if (turn.role === 'user') priorDirection = turn;
    const reason = mcpOmissionReason(turn,priorDirection);
    if (!reason) continue;
    omitted[reason]++;
    const turnNumber = Number.isSafeInteger(turn.turnNumber) && turn.turnNumber > 0 ? turn.turnNumber : index + 1;
    recentPolicyOmissions.push({turnNumber,reason});
  }
  const historyIncluded = messages.filter(message=>message.role !== 'system').length;
  const policyOmitted = Object.values(omitted).reduce((sum,count)=>sum + count,0);
  const historyOmittedForBudget = Math.max(0,project.messages.length - historyIncluded - policyOmitted);
  log('info','context_prepared',{storyRef:storyReference(project.id),mode:purpose,historyIncluded,
    historyOmittedForBudget,historyOmittedByPolicy:omitted,recentPolicyOmissions:recentPolicyOmissions.slice(-24)});
  return {
    storyId:project.id,title:project.title,revision,purpose,
    history:{included:historyIncluded,censored:policyOmitted,beyondPrompt:historyOmittedForBudget},
    ...(flow?.source === 'mcp' ? {storyFlow:{status:flowChoice ? 'selected' : 'pending',afterTurn:flow.afterTurn,
      ...(flowChoice ? {option:flowChoice} : {})}} : {}),
    ...castPreview(getCast(project).map(({id,name})=>({id,name}))),
    prompt:formatMessages(messages)
  };
}

tool('list_stories', {
  description:'List stories and the temporary demo by ID and title.',
  inputSchema:{},
  annotations:{readOnlyHint:true, openWorldHint:false}
}, async () => {
  const {library,revision} = await readLibrary();
  return {activeStoryId:library.activeId, revision, stories:library.projects.map(project => ({
    id:project.id,
    title:project.title
  }))};
});

async function mutateStoryLibrary(revision, update) {
  const current = await readLibrary();
  const stale = () => diagnosticError('REVISION_CONFLICT','The library changed. Read the latest story or library before applying the change.');
  if (current.revision !== revision) throw stale();
  const result = update(current.library);
  const response = await fetch(origin + '/api/state',{
    method:'PUT',headers:{'content-type':'application/json',origin,'if-match':revision},
    body:JSON.stringify(current.library),signal:AbortSignal.timeout(12000),redirect:'error'
  });
  if (response.status === 409) throw stale();
  if (!response.ok) throw diagnosticError('APP_WRITE_FAILED',`Could not save the story change (HTTP ${response.status}).`);
  return {...result,revision:(await response.json()).revision};
}

tool('create_story', {
  description:'Create a story with opening metadata and cast using the current library revision.',
  inputSchema:{revision:libraryRevision,draft:nativeSetupSchema},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
}, async ({revision,draft}) => mutateStoryLibrary(revision,library=>{
  const project = createNativeStory(library,draft);
  return {storyId:project.id,title:project.title,...castPreview(project.cast.map(({name})=>name)),relationships:project.relationships.length,
    url:companionUrl('book',project.id)};
}));

tool('offer_story_directions', {
  description:'Publish three non-explicit next-scene choices to Story Flow for the given revision.',
  inputSchema:{storyId:identifier,revision:libraryRevision,
    options:z.array(z.strictObject({
      title:z.string().trim().min(1).max(storyFlowTitleLimit).describe('Short label for the choice.'),
      direction:z.string().trim().min(1).max(storyFlowDirectionLimit).describe('An actionable next-scene direction grounded in the current story.')
    })).length(storyFlowOptionCount).refine(validStoryFlowOptions,'Provide three distinct story directions.'),
    waitSeconds:z.int().min(0).max(35).optional().describe('Seconds to wait for a browser selection. Defaults to 0, which publishes and returns immediately.')},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
}, async ({storyId,revision,options,waitSeconds = 0}, extra) => {
  const saved = await mutateStoryLibrary(revision,library=>{
    const project = findStory(library,storyId);
    const afterTurn = storyFlowTurn(project);
    project.storyFlow = {source:'mcp',options,afterTurn};
    return {storyId,afterTurn,url:companionUrl('write',storyId)};
  });
  const deadline = Date.now() + waitSeconds * 1000;
  let currentRevision = saved.revision;
  while (Date.now() < deadline) {
    await delay(Math.min(500,Math.max(0,deadline - Date.now())),undefined,{signal:extra?.signal});
    const current = await readLibrary({conditional:true});
    currentRevision = current.revision;
    const project = current.library.projects.find(candidate=>candidate.id === storyId);
    const flow = project && activeStoryFlow(project);
    if (flow?.source !== 'mcp' || flow.afterTurn !== saved.afterTurn || flow.options.length !== options.length ||
        !flow.options.every((option,index)=>option.title === options[index].title && option.direction === options[index].direction)) {
      return {...saved,revision:currentRevision,status:'superseded',guidance:'This offer is no longer current. Reread the story before proposing directions again.'};
    }
    const option = flow.options[flow.selected];
    if (option) return {...saved,revision:currentRevision,status:'selected',option};
  }
  return {...saved,revision:currentRevision,status:'pending'};
});

tool('read_story_turns', {
  description:'Read turn numbers, chapter breaks, dates, and eligible previews. Browse with afterTurn and nextAfterTurn, or use recent: true for the latest turns. For one turn, read by turnNumber and follow nextOffset. Held turns expose metadata only.',
  inputSchema:{storyId:identifier.optional(),afterTurn:z.int().nonnegative().optional(),turnNumber:z.int().positive().optional(),
    recent:z.boolean().optional(),offset:z.int().nonnegative().optional(),limit:z.int().min(1).max(30).optional()},
  annotations:{readOnlyHint:true,openWorldHint:false}
}, async ({storyId,...scope})=>{
  const {library,revision} = await readLibrary();
  const project = findStory(library,storyId);
  return {storyId:project.id,revision,...readNativeTurns(project,scope)};
});

tool('edit_story_structure', {
  description:'Apply a requested manuscript change, including eligible prose, dates, chapters, branches, rewinds, context holds, or deletion. Read the target and use its current revision. Delete or rewind only when explicitly asked. Use edit_story_state for graph and story fields. Review or release held text in the browser.',
  inputSchema:{storyId:identifier,revision:libraryRevision,change:nativeStoryChange},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}
}, async ({storyId,revision,change}) => mutateStoryLibrary(revision,library=>{
  const project = findStory(library,storyId);
  const result = applyNativeStoryChange(library,project,change);
  return {storyId,...result,...(result.branchId ? {url:companionUrl('book',result.branchId)} : {})};
}));

tool('get_story_context', {
  description:'Read a brief of current story state, recent eligible prose, and approved continuity. Optional direction narrows the lore search. Older turns and full fields are available in focused reads.',
  inputSchema:{
    storyId:identifier.optional().describe('Use the active story when omitted.'),
    purpose:z.enum(['draft','reference']).optional(),
    direction:writingDirection.optional().describe('Current direction for a draft or a topic for focused reference. This lookup does not save it.')
  },
  annotations:{readOnlyHint:true, openWorldHint:false},
  _meta:{'anthropic/maxResultSizeChars':200000}
}, async ({storyId,direction = '',purpose = direction.trim() ? 'draft' : 'reference'}) => {
  const {library, revision} = await readLibrary();
  return storyContext(revision,findStory(library,storyId),direction,purpose);
});

// A story-graph fence at the end of the prose is still accepted from agents
// that follow older instructions. Text after the fence would be lost, so it
// is refused rather than silently dropped.
function readReply(reply) {
  const start = reply.search(/(?:^|\n)[ \t]*```story-graph/);
  if (start === -1) return {text:reply, suggestions:[]};
  const close = reply.indexOf('\n```', reply.indexOf('```story-graph', start) + 14);
  if (close === -1) throw Error('The story-graph block is not closed. Pass map updates in the updates array instead.');
  if (reply.slice(close + 4).trim()) throw Error('Prose follows the story-graph block. Put only prose in reply and pass map updates in the updates array.');
  const block = reply.slice(reply.indexOf('\n', reply.indexOf('```story-graph', start)) + 1, close);
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch {
    throw Error('The story-graph block is not valid JSON. Pass map updates in the updates array instead.');
  }
  const checked = z.array(updateSchema).max(5).safeParse(parsed);
  if (!checked.success) throw Error('The story-graph block does not match the update shapes. Pass map updates in the updates array instead.');
  return {text:reply.slice(0, start).trim(), suggestions:checked.data};
}

tool('submit_reply', {
  description:'Append a non-explicit prose scene, optionally with an in-story time and up to five non-explicit continuity facts.',
  inputSchema:{
    storyId:identifier,revision:libraryRevision,
    reply:z.string().refine(text=>Boolean(text.trim())).describe('Story prose.'),
    storyTime:sceneTimeSchema.optional(),
    updates:sceneUpdatesSchema.optional()
  },
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
}, async ({storyId,revision,reply,storyTime,updates}) => mutateStoryLibrary(revision,library=>{
  const project = findStory(library,storyId);
  const draft = readReply(reply.trim());
  const text = stripSpeakerName(draft.text,narrator.name).trim();
  if (!text) throw Error('The reply must contain story prose.');
  const proposals = [...draft.suggestions,...(updates || [])];
  if (proposals.length > 5) throw Error('Send at most five map updates per reply.');
  const mapOff = project.graphUpdates === false;
  const checked = checkMapUpdates(project,mapOff ? [] : proposals);
  if (checked.problems.length) throw diagnosticError('MAP_UPDATES_INVALID','Fix these map updates or leave them out:\n' + checked.problems.join('\n'));
  const continuityPending = !storyTime && !proposals.length && updates === undefined;
  const turnNumber = appendTurn(project,{
    role:'assistant',content:text,speakerId:narrator.id,speakerName:narrator.name,
    standalone:true,contentSensitivity:'safe',
    ...(continuityPending ? {continuityPending:true} : {storyTime:recordStoryTime(project,storyTime)})
  });
  const {applied,pending} = applyTurnGraphUpdates(project,project.messages.at(-1),checked.updates,{allowAutomatic:true});
  delete project.agentRequest;
  delete project.storyFlow;
  delete project.agentNotice;
  return {storyId,turnNumber,proposedUpdates:checked.updates.length,appliedUpdates:applied,pendingUpdates:pending,
    ...(continuityPending ? {continuityPending:true} : {}),
    ...(mapOff && proposals.length ? {ignoredUpdates:'Graph updates are off, so no facts were saved.'} : {})};
}));

let startup;
async function startStudio() {
  try {
    await readLibrary();
    return {url:origin + '/', started:false};
  } catch {
    let startupError;
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd:appDirectory, detached:true, stdio:'ignore'
    });
    child.once('error', error => { startupError = error; });
    child.unref();
    for (let attempt = 0; attempt < 40; attempt++) {
      if (startupError || child.exitCode !== null) break;
      try {
        await readLibrary();
        return {url:origin + '/', started:true, pid:child.pid};
      } catch {
        await delay(125);
      }
    }
    child.kill();
    log('error','app_launch_failed',{
      port,code:errorCode(startupError,child.exitCode === null ? 'APP_START_TIMEOUT' : 'APP_EXITED'),
      exitCode:child.exitCode
    });
    throw diagnosticError('APP_START_FAILED','Story Studio could not start. Check the server and MCP logs or run the Story Studio launcher.');
  }
}

tool('open_studio', {
  description:'Open the local Book and Graph companion links, starting Story Studio if needed. Use when requested. Pass a story ID to open it directly.',
  inputSchema:{storyId:identifier.optional()},
  annotations:{readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false}
}, async ({storyId}) => {
  startup ??= startStudio().finally(() => { startup = undefined; });
  const opened = await startup;
  return {...opened,url:companionUrl('book',storyId),graphUrl:companionUrl('graph',storyId)};
});

let leaving = false;
function leave() {
  if (leaving) return;
  leaving = true;
  log('info','disconnected');
  process.exit(0);
}
studio.server.onclose = leave;
process.stdin.once('end', leave);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, leave);
try {
  await studio.connect(new StdioServerTransport());
  log('info','started',{port,node:process.versions.node});
} catch (error) {
  log('error','startup_failed',{port,code:errorCode(error,'TRANSPORT_FAILED')});
  process.stderr.write('Story Studio could not start its MCP transport. Check mcp.log.\n');
  process.exit(1);
}
