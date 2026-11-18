import http from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { join, dirname, extname } from 'node:path';
import { agentOutputLimit, canWriteSensitive, continuityModel, isAgentModel, isContinuityModel, isWriterModel, modelProvider, models, providerNames, proseOutputLimit, setupChatOutputLimit, setupDraftModel, setupDraftOutputLimit, usesSensitiveContinuity } from './public/models.js';
import { buildWritingContext, getCast, legacyCastFields, migrateLegacyCast, migrateStoryFields, validPlotEvents, storyTextFields, validCast, validRelationships, validSensitivity, isStoryTime, estimateContextTokens, nextTurnNumber } from './public/prompt.js';
import { libraryByteLimit, maxLibraryStories, starterStoryId, withoutStarter } from './public/library.js';
import { createStarterStory, starterReview } from './examples/the-late-ferry.mjs';
import { listStarterArtwork, listStarterVersions, readStarterArtwork, readStarterVersion } from './examples/the-late-ferry-extras.mjs';
import { isWritingRefusal, stripWritingPreamble } from './openrouter-format.mjs';
import { runContinuity, runStoryEdit } from './continuity.mjs';
import { validStoryEditInstruction } from './story-edits.mjs';
import { agentBudget } from './public/agent-context.js';
import { runStoryFlow, storyFlowOutputLimit } from './story-flow.mjs';
import { runChunkedSetup, runSetup, setupMessages, setupPromptFits } from './setup-chat.mjs';
import { createLogger, createTrace, diagnosticError, errorCode, storyReference } from './diagnostics.mjs';
import { fileURLToPath } from 'node:url';
import { providerAdapters, rememberProviderOutput } from './provider-api.mjs';
import { createSpendLedger } from './provider-spend.mjs';
import { createCredentialStore, validKey } from './provider-credentials.mjs';
import { createRevisionReviewer, reviewOutputLimit } from './revision-review.mjs';
import { createBackgroundAnalysis } from './revision-background.mjs';
import { analysisOutputLimit } from './revision-background-review.mjs';
import { normalizeRevisionNotes, sceneIndex } from './public/revision.js';
import { normalizeSceneBoard, validSceneBoard } from './public/scene-board.js';
import { normalizeDraftCheckpoints, validDraftCheckpoints } from './public/draft-comparison.js';
import { artworkCanon, artworkCanonKey, artworkPassage, artworkStatus, artworkSubject } from './artwork-context.mjs';
import { createArtworkStore } from './artwork-store.mjs';
import { artworkPlannerOutputLimit, generateArtwork } from './artwork-generation.mjs';
import { createStoryVersions } from './story-versions.mjs';
import { planManuscriptTransition, transitionPlannerOutputLimit } from './manuscript-transition.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.STORY_STUDIO_DATA || join(homedir(),'Library','Application Support','Story Studio');
const spend = createSpendLedger(dataDir);
const artwork = createArtworkStore(dataDir);
const versions = createStoryVersions(dataDir);
const credentials = createCredentialStore(dataDir);
const reviewStory = createRevisionReviewer();
const statePath=join(dataDir,'library.json');
const port=Number(process.env.PORT || 4317);
const log = createLogger('server');
const traces = new Map(Object.keys(providerNames).map(provider=>[provider,createTrace(provider)]));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  log('error','startup_failed',{code:'INVALID_PORT'});
  console.error('Story Studio: PORT must be a number from 1 to 65535.');
  process.exit(1);
}
const apiEndpoints = new Set(['/api/state','/api/starter','/api/starter/reset','/api/generate','/api/story-edits','/api/story-flow','/api/setup','/api/export','/api/provider-keys','/api/revision','/api/writing-analysis','/api/artwork','/api/artwork/image']);
const foregroundEndpoints = new Set(['/api/generate','/api/story-edits','/api/story-flow','/api/setup','/api/revision']);
const generatingArt = new Set();
apiEndpoints.add('/api/story-versions');
apiEndpoints.add('/api/manuscript-transition');
foregroundEndpoints.add('/api/manuscript-transition');
let foregroundRequests = 0;
const background = createBackgroundAnalysis({dataDir,readLibrary:readSavedLibrary,libraryVersion:savedLibraryVersion,
  hasKey:async model=>Boolean((await credentials.keys([[modelProvider(model)]]))[0]),
  shouldYield:()=>foregroundRequests > 0,
  async complete({storyId,model,messages,tools,signal}) {
    const provider = modelProvider(model);
    const [key] = await credentials.keys([[provider]]);
    if (!key || foregroundRequests) throw diagnosticError('REVIEW_DEFERRED','Background review will resume shortly.');
    const diagnostics = {requestId:randomUUID(),storyRef:storyReference(storyId),provider,model};
    return generateCompletion(messages,model,key,diagnostics,{stage:'revision-background',tools,signal,maxOutputTokens:analysisOutputLimit});
  },
  reportError: (error,id)=>log('warn','background_review_failed',{storyRef:id && storyReference(id),code:errorCode(error,'BACKGROUND_REVIEW_FAILED')})
});
const methodNames = new Set(['GET','POST','PUT']);
const modelIds = new Set(models.map(model => model.id));
let starter = createStarterStory();
let starterSelected = false;
let starterGeneration = randomUUID();
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
function disconnectSignal(res) {
  const controller = new AbortController();
  if (res.destroyed) controller.abort();
  else res.once('close',() => { if (!res.writableFinished) controller.abort(); });
  return controller.signal;
}
async function parseLibrary(path) {
  const text = await readFile(path,'utf8');
  let library;
  try {
    library = JSON.parse(text);
  } catch {
    throw diagnosticError('LIBRARY_JSON_INVALID','The saved library is not valid JSON.');
  }
  return migrateLibrary(library);
}
function migrateLibrary(library) {
  for (const project of library.projects) {
    migrateStoryFields(migrateLegacyCast(project));
    if (project.revisionNotes !== undefined) project.revisionNotes = normalizeRevisionNotes(project.revisionNotes);
    if (project.sceneBoard !== undefined) {
      const board = normalizeSceneBoard(project);
      if (board) project.sceneBoard = board;
      else delete project.sceneBoard;
    }
    if (project.draftCheckpoints !== undefined) {
      const checkpoints = normalizeDraftCheckpoints(project.draftCheckpoints);
      if (checkpoints?.length) project.draftCheckpoints = checkpoints;
      else delete project.draftCheckpoints;
    }
  }
  return library;
}
async function savedLibraryVersion() {
  const paths = process.env.STORY_STUDIO_DATA ? [statePath] : [statePath,join(root,'data','stories.json')];
  for (const path of paths) {
    try {
      const file = await stat(path,{bigint:true});
      return [path,file.dev,file.ino,file.size,file.mtimeNs,file.ctimeNs].join(':');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return 'empty';
}
async function readSavedLibrary() {
  try {
    return await parseLibrary(statePath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!process.env.STORY_STUDIO_DATA) {
      try {
        return await parseLibrary(join(root,'data','stories.json'));
      } catch (legacy) {
        if (legacy.code !== 'ENOENT') throw legacy;
      }
    }
    return {activeId:'',projects:[]};
  }
}

function withStarter(saved) {
  const activeId = starterSelected || !saved.projects.length ? starterStoryId : saved.activeId;
  return {...saved,activeId,projects:[...saved.projects,starter]};
}

async function getState() {
  return withStarter(await readSavedLibrary());
}

let writes = Promise.resolve();
const revisionOf = state => '"' + createHash('sha256').update(JSON.stringify(state)).digest('hex') + '"';
const liveRevision = library => revisionOf([starterGeneration,library]);

function updateState(operation) {
  const op = writes.then(operation);
  writes = op.catch(() => {});
  return op;
}

function versionSnapshot(project) {
  const snapshot = structuredClone(project);
  for (const field of ['agentRequest','agentEditRequest','agentNotice']) delete snapshot[field];
  for (const turn of snapshot.messages) if (turn.continuityPending) {
    delete turn.continuityPending;
    turn.continuityNeedsReview = true;
  }
  return snapshot;
}

function versionLabel(previous, project) {
  if (!previous) return 'Story created';
  if (JSON.stringify(previous.sceneBoard?.chapters) !== JSON.stringify(project.sceneBoard?.chapters)) return 'Reordered manuscript';
  if (project.messages.length > previous.messages.length) return 'Added story turns';
  if (project.messages.length < previous.messages.length) return 'Removed story turns';
  if (previous.sceneBoard?.nextChapterAfter !== project.sceneBoard?.nextChapterAfter) {
    return project.sceneBoard?.nextChapterAfter === undefined ? 'Removed chapter divider' : 'Set chapter divider';
  }
  if (JSON.stringify(previous.draftCheckpoints) !== JSON.stringify(project.draftCheckpoints)) return 'Updated draft checkpoints';
  if (JSON.stringify(previous.messages) !== JSON.stringify(project.messages)) return 'Revised story turns';
  return 'Updated story state';
}

function saveState(value, expectedRevision, starterOnly, restoration) {
  return updateState(async () => {
    const previous = await readSavedLibrary();
    if (expectedRevision && liveRevision(withStarter(previous)) !== expectedRevision) return null;
    const selectedDemo = value.activeId === starterStoryId;
    const saved = starterOnly ? previous : withoutStarter(value);
    if (!starterOnly && selectedDemo && saved.projects.some(project => project.id === previous.activeId)) {
      saved.activeId = previous.activeId;
    }
    if (!starterOnly && revisionOf(previous) !== revisionOf(saved)) {
      await mkdir(dataDir, {recursive:true});
      const tmp = join(dataDir, `.stories-${randomUUID()}.tmp`);
      await writeFile(tmp, JSON.stringify(saved, null, 2), {mode:0o600});
      await rename(tmp, statePath);
      const before = new Map(previous.projects.map(project=>[project.id,project]));
      for (const project of saved.projects) {
        const older = before.get(project.id);
        if (older && revisionOf(older) === revisionOf(project)) continue;
        try {
          if (older) await versions.record(versionSnapshot(older),{label:'Before update'});
          const restoredFrom = restoration?.storyId === project.id ? restoration.versionId : undefined;
          await versions.record(versionSnapshot(project),{label:restoredFrom ? 'Restored an earlier version' : versionLabel(older,project),restoredFrom});
        } catch (failure) {
          log('warn','story_version_failed',{storyRef:storyReference(project.id),code:errorCode(failure,'STORY_VERSION_FAILED')});
        }
      }
    }
    starter = value.projects.find(project => project.id === starterStoryId) || starter;
    starterSelected = selectedDemo;
    return liveRevision(withStarter(saved));
  });
}

function sendLibrary(req,res,library) {
  const revision = liveRevision(library);
  res.setHeader('etag', revision);
  res.setHeader('x-story-studio-demo-generation',starterGeneration);
  if (req.headers['if-none-match'] === revision) {
    res.writeHead(304);
    return res.end();
  }
  return json(res,200,library);
}

async function body(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw Object.assign(diagnosticError('BODY_TOO_LARGE','The request exceeds the size limit.'), {status:413});
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(diagnosticError('INVALID_JSON','Invalid JSON.'), {status:400}); }
}

const libraryLimit = libraryByteLimit;
function validateState(s){return s && Array.isArray(s.projects) && s.projects.length<=maxLibraryStories+1 && s.projects.filter(p=>p?.id!==starterStoryId).length<=maxLibraryStories && new Set(s.projects.map(p=>p?.id)).size===s.projects.length && typeof s.activeId==='string' && s.projects.every(p=>p && typeof p.id==='string' && typeof p.title==='string' && (p.cast===undefined || validCast(p.cast)) && (p.relationships===undefined || validRelationships(p.relationships)) && (p.plotEvents===undefined || validPlotEvents(p.plotEvents)) && (p.sceneBoard===undefined || validSceneBoard(p.sceneBoard)) && (p.draftCheckpoints===undefined || validDraftCheckpoints(p.draftCheckpoints)) && (p.storyStartAt===undefined || isStoryTime(p.storyStartAt)) && (p.graphUpdates===undefined || typeof p.graphUpdates==='boolean') && (p.speakerId===undefined || typeof p.speakerId==='string') && [...storyTextFields,...legacyCastFields].every(k=>p[k]===undefined || typeof p[k]==='string') && ['lore','notes'].every(k=>typeof p[k]==='string') && Array.isArray(p.messages) && p.messages.every(m=>m && ['user','assistant'].includes(m.role) && typeof m.content==='string' && (m.standalone===undefined || m.role==='assistant' && m.standalone===true) && (m.sourcePrefix===undefined || typeof m.sourcePrefix==='string') && (m.speakerId===undefined || typeof m.speakerId==='string') && (m.speakerName===undefined || typeof m.speakerName==='string') && (m.excludeFromContext===undefined || typeof m.excludeFromContext==='boolean') && (m.contentSensitivity===undefined || validSensitivity(m.contentSensitivity)) && (m.storyTime===undefined || isStoryTime(m.storyTime)) && (m.continuityNeedsReview===undefined || m.role==='assistant' && m.continuityNeedsReview===true) && (m.alternativeSensitivities===undefined || Array.isArray(m.alternativeSensitivities) && m.alternativeSensitivities.length<=5000 && m.alternativeSensitivities.every(value=>value===null||validSensitivity(value)))));}
const apiStatusHints = {
  401:'Check your API key.',
  402:'Check your balance and key spending limit.',
  403:'The provider denied the request.',
  404:'The selected model or an eligible provider is unavailable.',
  429:'The selected model is rate limited. Try again later.'
};

const keyRequired = provider => 'Add your ' + providerNames[provider] + ' key in Settings.';

async function generateCompletion(messages, model, key, diagnostics, {
  stage = 'prose', maxOutputTokens = proseOutputLimit(model), tools, signal, prefixLength
} = {}) {
  if (stage !== 'prose' && estimateContextTokens(JSON.stringify({messages,tools})) >
      (prefixLength ? agentBudget(model,maxOutputTokens).window * 0.97 - maxOutputTokens : agentBudget(model,maxOutputTokens).inputLimit)) {
    throw Object.assign(diagnosticError('AGENT_CONTEXT_FULL','The setup, story state, or tool results exceed this model’s shared input budget.'),{status:400});
  }
  const provider = modelProvider(model);
  const providerName = providerNames[provider];
  const adapter = providerAdapters.get(provider);
  const trace = traces.get(provider);
  const code = reason => provider.toUpperCase() + '_' + reason;
  const started = Date.now();
  const metadata = stage === 'metadata';
  const details = diagnostics[stage] = {provider,model:modelIds.has(model) ? model : 'custom',maxOutputTokens};
  log('info','generation_started',{requestId:diagnostics.requestId,storyRef:diagnostics.storyRef,
    stage,...details});
  const timeout = AbortSignal.timeout(tools || maxOutputTokens > 2048 ? 240_000 : 120_000);
  const upstreamSignal = signal ? AbortSignal.any([signal,timeout]) : timeout;
  const timedOut = error => errorCode(error) === 'TIMEOUT' || upstreamSignal.reason?.name === 'TimeoutError';
  const exchange = {requestId:diagnostics.requestId,storyRef:diagnostics.storyRef,stage,provider,exchangeId:randomUUID()};
  const payload = adapter.request({model,messages,tools,maxOutputTokens,stage,prefixLength,storyRef:diagnostics.storyRef});
  trace('request',{...exchange,payload},key);
  let response;
  try {
    response = await fetch(adapter.url, {
      method: 'POST',
      redirect: 'error',
      headers: {...adapter.headers(key),'content-type':'application/json'},
      signal:upstreamSignal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    details.durationMs = Date.now() - started;
    trace('transport_error',{...exchange,message:error.message,code:errorCode(error,code('CONNECTION_FAILED'))},key);
    if (timedOut(error)) throw diagnosticError(code('TIMEOUT'),providerName + ' took too long to reply.');
    throw diagnosticError(code('CONNECTION_FAILED'),'Could not connect to ' + providerName + '.');
  }
  details.durationMs = Date.now() - started;
  diagnostics[metadata ? 'metadataUpstreamStatus' : 'upstreamStatus'] = details.status = response.status;
  let raw, result, responseFailure;
  try {
    raw = await response.text();
    result = JSON.parse(raw);
  } catch (error) {
    responseFailure = error;
  } finally {
    details.durationMs = Date.now() - started;
    trace('response',{...exchange,httpStatus:response.status,payload:result,
      ...(responseFailure ? {body:raw,readError:responseFailure.message} : {})},key);
  }
  if (!responseFailure && (response.ok || result?.usage)) {
    try {
      const usd = spend.record({provider,model,result});
      if (usd !== null) details.costUsd = usd;
    } catch (failure) {
      log('warn','spend_record_failed',{requestId:diagnostics.requestId,provider,code:errorCode(failure,'SPEND_WRITE_FAILED')});
    }
  }
  if (!response.ok) {
    if (stage === 'revision-background' && response.status === 400 &&
        /context.{0,40}(?:window|length|limit)|too many (?:input )?tokens/i.test(result?.error?.message || '')) {
      throw diagnosticError('REVIEW_CONTEXT_FULL','The provider needs a smaller background review batch.');
    }
    const balanceExhausted = provider === 'openai' && ['credit_balance_exhausted','insufficient_quota'].includes(result?.error?.code)
      || provider === 'anthropic' && response.status === 400 && /credit balance is too low/i.test(result?.error?.message || '');
    if (balanceExhausted) {
      throw diagnosticError(code('CREDIT_BALANCE_EXHAUSTED'),providerName + ' reports an exhausted credit balance. Check the linked organization’s billing page.');
    }
    const hint = apiStatusHints[response.status] || 'Check the model and try again.';
    throw diagnosticError(code('HTTP_ERROR'),`${providerName} returned ${response.status}. ${hint}`);
  }
  if (responseFailure) {
    if (timedOut(responseFailure)) throw diagnosticError(code('TIMEOUT'),providerName + ' took too long to finish the reply.');
    throw diagnosticError(code('INVALID_RESPONSE'),providerName + ' returned an unreadable response.');
  }
  result = adapter.normalize(result);
  if (typeof result?.provider === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .+&()/\-]{0,59}$/.test(result.provider)) {
    details.host = result.provider;
  }
  if (Number.isSafeInteger(result?.usage?.prompt_tokens) && result.usage.prompt_tokens >= 0) {
    details.inputTokens = result.usage.prompt_tokens;
  }
  if (Number.isSafeInteger(result?.usage?.completion_tokens) && result.usage.completion_tokens >= 0) {
    details.outputTokens = result.usage.completion_tokens;
  }
  const cache = result?.usage?.prompt_tokens_details;
  if (Number.isSafeInteger(cache?.cached_tokens)) details.cachedInputTokens = cache.cached_tokens;
  if (Number.isSafeInteger(cache?.cache_write_tokens)) details.cacheWriteTokens = cache.cache_write_tokens;
  if (Number.isFinite(result?.usage?.cost) && result.usage.cost >= 0) details.costUsd = result.usage.cost;
  const choice = result?.choices?.[0];
  const finish = choice?.finish_reason;
  if (['stop','length','content_filter','error','tool_calls'].includes(finish)) {
    diagnostics[metadata ? 'metadataFinishReason' : 'finishReason'] = details.finishReason = finish;
  }
  const upstreamError = result?.error || choice?.error;
  if (upstreamError) {
    const status = upstreamError.code;
    if (Number.isInteger(status) && status >= 400 && status <= 599) details.errorStatus = status;
    const hint = apiStatusHints[details.errorStatus] || 'Check the model and try again.';
    throw diagnosticError(code('UPSTREAM_ERROR'),`${providerName} reported a provider error. ${hint}`);
  }
  if (finish === 'content_filter') {
    throw diagnosticError(code('CONTENT_FILTERED'),providerName + ' reported that the response was filtered.');
  }
  if (finish === 'error') {
    throw diagnosticError(code('INCOMPLETE_REPLY'),providerName + ' reported an incomplete response.');
  }
  if (tools?.length && finish === 'length') {
    throw diagnosticError('AGENT_TOOL_OUTPUT_TRUNCATED',providerName + ' reached the output limit before completing its tool response.');
  }
  const text = choice?.message?.content;
  const refusal = choice?.message?.refusal;
  if (tools && Array.isArray(choice?.message?.tool_calls) && finish === 'tool_calls' && !refusal) {
    const {content,tool_calls,reasoning_details} = choice.message;
    const allowedNames = new Set(tools.map(tool => tool.function.name));
    details.tools = tool_calls.slice(0,4).map(call => allowedNames.has(call?.function?.name) ? call.function.name : 'unknown');
    return rememberProviderOutput({role:'assistant',content:content ?? null,tool_calls,
      ...(reasoning_details ? {reasoning_details} : {})},result);
  }
  if (!metadata && ((typeof refusal === 'string' && refusal.trim())
    || (stage === 'prose' && typeof text === 'string' && isWritingRefusal(text.trim())))) {
    throw diagnosticError(code('WRITING_DECLINED'),'The selected ' + providerName + ' model declined this direction.');
  }
  if (typeof text !== 'string' || !text.trim()) throw diagnosticError(code('EMPTY_REPLY'),providerName + ' returned no text for this request.');
  return {text:text.trim(), truncated:finish === 'length'};
}
async function generateSetup(req,res,diagnostics) {
  const {mode,model,key:requestKey,messages,manuscript,context,provider = 'openrouter'} = await body(req,libraryLimit) || {};
  const prompt = setupMessages(messages,mode,manuscript,context,'prepare_story_setup');
  if (!prompt) {
    diagnostics.code = 'INVALID_SETUP_CONVERSATION';
    return json(res,400,{error:'Check the setup conversation and manuscript reference.'});
  }
  if (!isWriterModel(model) || modelProvider(model) !== provider) {
    diagnostics.code = 'SETUP_MODEL_INVALID';
    return json(res,400,{error:'Choose a model from the selected API provider.'});
  }
  const [key] = await credentials.keys([[provider,requestKey]]);
  if (!validKey(key)) return json(res,400,{error:keyRequired(provider)});
  const drafting = mode === 'draft';
  const selected = drafting ? setupDraftModel(model) : model;
  diagnostics.provider = provider;
  diagnostics.mode = mode;
  diagnostics.model = modelIds.has(selected) ? selected : 'custom';
  const signal = disconnectSignal(res);
  try {
    const complete = drafting ? storyToolCompletion(selected,key,diagnostics,'setup-draft',signal,setupDraftOutputLimit)
      : messages => generateCompletion(messages,selected,key,diagnostics,{stage:'setup-chat',maxOutputTokens:setupChatOutputLimit,signal});
    const inputLimit = agentBudget(selected,drafting ? setupDraftOutputLimit : setupChatOutputLimit).inputLimit;
    if (setupPromptFits(prompt,mode,manuscript,inputLimit)) {
      return json(res,200,await runSetup(prompt,mode,manuscript,complete));
    }
    if (!drafting) {
      return json(res,400,{error:'The setup exceeds this model’s chat budget. Prepare the setup draft to process the source in sections.'});
    }
    const extract = storyToolCompletion(selected,key,diagnostics,'setup-extract',signal,agentOutputLimit,{taskTimeout:false});
    const prepare = storyToolCompletion(selected,key,diagnostics,'setup-draft',signal,setupDraftOutputLimit,{taskTimeout:false});
    const result = await runChunkedSetup({messages,mode,manuscript,context,complete:extract,prepare,inputLimit});
    diagnostics.setupSections = result.sections;
    return json(res,200,result);
  } catch (error) {
    if (signal.aborted) return;
    diagnostics.code = errorCode(error,'SETUP_GENERATION_FAILED');
    return json(res,error.status || 502,{error:error.diagnosticCode ? error.message : 'Story Studio could not prepare a setup reply.'});
  }
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const staticAssets = new Set([
  '/index.html','/app.js','/prompt.js','/models.js','/graph-history.js','/library.js',
  '/manuscript.js','/agent-context.js','/model-picker.js','/story-flow.js','/display-names.js','/sync.js','/revision.js','/revision-view.js','/style.css',
  '/workspace.js','/workspace.css','/expanded-editor.js','/expanded-editor.css','/revision-signals.js','/revision-panels.css','/passage-selection.js',
  '/scene-board.js','/scene-board.css','/draft-comparison.js','/draft-comparison.css','/book-exports.js','/fflate.js',
  '/artwork-view.js','/artwork.css','/time-machine.js','/time-machine.css'
]);
function storyToolCompletion(model,key,diagnostics,stage,signal,maxOutputTokens = agentOutputLimit,{taskTimeout = true} = {}) {
  const budget = taskTimeout ? AbortSignal.timeout(300_000) : undefined;
  const combined = budget && signal ? AbortSignal.any([signal,budget]) : budget || signal;
  return async (messages,tools,prefixLength) => {
    diagnostics.toolRounds = (diagnostics.toolRounds || 0) + 1;
    try {
      return await generateCompletion(messages,model,key,diagnostics,{stage,maxOutputTokens,tools,signal:combined,prefixLength});
    } finally {
      (diagnostics.toolCalls ||= []).push(diagnostics[stage]);
    }
  };
}

async function generateStoryEdits(req,res,diagnostics) {
  const {storyId,revision,model,key:requestKey,instruction,provider = 'openrouter'} = await body(req,libraryLimit) || {};
  if (typeof storyId !== 'string' || typeof revision !== 'string' || !validStoryEditInstruction(instruction)) {
    return json(res,400,{error:'Enter a story edit request.'});
  }
  if (!isAgentModel(model) || modelProvider(model) !== provider) return json(res,400,{error:'Choose a supported model for Agent mode.'});
  const [key] = await credentials.keys([[provider,requestKey]]);
  if (!validKey(key)) return json(res,400,{error:keyRequired(provider)});
  const library = await getState();
  if (liveRevision(library) !== revision) return json(res,409,{error:'The story changed. Reload the latest version and try again.'});
  const index = library.projects.findIndex(item => item.id === storyId);
  if (index < 0) return json(res,404,{error:'Story not found.'});
  const project = structuredClone(library.projects[index]);
  Object.assign(diagnostics,{provider,mode:'story-edit',storyRef:storyReference(storyId),model});
  const signal = disconnectSignal(res);
  try {
    const result = await runStoryEdit(project,instruction,storyToolCompletion(model,key,diagnostics,'story-edit',signal),model);
    if (signal.aborted) return;
    delete project.agentEditRequest;
    library.projects[index] = project;
    if (!await saveState(library,revision,false)) return json(res,409,{error:'The story changed before saving the edit. Try again from the latest version.'});
    diagnostics.appliedEdits = result.count;
    return json(res,200,result);
  } catch (failure) {
    if (signal.aborted) return;
    diagnostics.code = errorCode(failure,'STORY_EDIT_FAILED');
    return json(res,failure.status || (failure.diagnosticCode === 'AGENT_CONTEXT_FULL' ? 400 : 502),{error:failure.diagnosticCode ? failure.message : 'Story Studio could not edit the story metadata.'});
  }
}

function flowCompletion(model,key,diagnostics,signal) {
  return storyToolCompletion(model,key,diagnostics,'story-flow',signal,storyFlowOutputLimit);
}

async function suggestStoryFlow(req,res,diagnostics) {
  const {project,agentModel = continuityModel,key:requestKey,sensitive = false,provider = 'openrouter'} = await body(req,libraryLimit) || {};
  if (!validateState({activeId:project?.id,projects:[project]}) || typeof sensitive !== 'boolean'
      || !isContinuityModel(agentModel,sensitive) || modelProvider(agentModel) !== provider) {
    return json(res,400,{error:'Choose a supported continuity agent and story for Story Flow.'});
  }
  const [key] = await credentials.keys([[provider,requestKey]]);
  if (!validKey(key)) return json(res,400,{error:keyRequired(provider)});
  Object.assign(diagnostics,{provider,storyRef:storyReference(project.id),model:agentModel});
  const signal = disconnectSignal(res);
  try {
    const options = await runStoryFlow(project,flowCompletion(agentModel,key,diagnostics,signal),{model:agentModel,sensitive});
    if (!signal.aborted) return json(res,200,{options});
  } catch (failure) {
    if (signal.aborted) return;
    diagnostics.code = errorCode(failure,'STORY_FLOW_FAILED');
    return json(res,failure.status || 502,{error:failure.diagnosticCode ? failure.message : 'Story Studio could not suggest directions.'});
  }
}

async function runRevisionReview(req,res,diagnostics) {
  const {storyId,revision,kind,scope,query = '',comparisonId,model} = await body(req,16000) || {};
  if (typeof storyId !== 'string' || typeof revision !== 'string' ||
      !['themes','continuity','threads'].includes(kind) ||
      typeof scope !== 'string' || !/^(?:book|(?:scene|chapter):[1-9][0-9]{0,15})$/.test(scope) ||
      typeof query !== 'string' || query.length > 4000 ||
      comparisonId !== undefined && (kind !== 'continuity' || typeof comparisonId !== 'string' || comparisonId === storyId) ||
      !isAgentModel(model)) return json(res,400,{error:'Check the selected review scope and model.'});
  const provider = modelProvider(model);
  const [key] = await credentials.keys([[provider]]);
  if (!key) return json(res,400,{error:keyRequired(provider)});
  const library = await getState();
  if (revision !== liveRevision(library)) return json(res,409,{error:'The library changed. Try reviewing the latest version.'});
  const project = library.projects.find(item=>item.id === storyId);
  const comparison = library.projects.find(item=>item.id === comparisonId);
  if (!project || comparisonId && !comparison) return json(res,404,{error:'The selected story is no longer available.'});
  Object.assign(diagnostics,{provider,model,reviewKind:kind,storyRef:storyReference(storyId)});
  const signal = disconnectSignal(res);
  try {
    const result = await reviewStory(project,{kind,scope,query,comparison,model,signal},
      storyToolCompletion(model,key,diagnostics,'revision-review',signal,reviewOutputLimit));
    if (signal.aborted) return;
    if (revision !== liveRevision(await getState())) return json(res,409,{error:'The library changed during the review. Run it again for the latest version.'});
    diagnostics.cached = result.cached === true;
    diagnostics.findings = result.findings.length;
    return json(res,200,result);
  } catch (failure) {
    if (signal.aborted) return;
    diagnostics.code = errorCode(failure,'REVISION_REVIEW_FAILED');
    return json(res,failure.status || (['REVISION_NO_PASSAGES','REVISION_SCOPE_TOO_LARGE'].includes(diagnostics.code) ? 400 : 502),
      {error:failure.diagnosticCode ? failure.message : 'Studio could not review this scope.'});
  }
}

async function routeArtwork(req,res,url,diagnostics) {
  const input = req.method === 'GET' ? undefined : await body(req,20_000);
  const storyId = input?.storyId || url.searchParams.get('story');
  const library = await getState();
  const project = library.projects.find(item=>item.id === storyId);
  if (!project) return json(res,404,{error:'Story not found.'});
  const demo = storyId === starterStoryId;
  if (url.pathname === '/api/artwork/image' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    const image = demo ? await readStarterArtwork(id) : await artwork.file(storyId,id);
    if (!image) return json(res,404,{error:'Artwork not found.'});
    res.writeHead(200,{'content-type':image.mime,'cache-control':'no-store',
      'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'});
    return res.end(image.bytes);
  }
  if (url.pathname !== '/api/artwork') return json(res,405,{error:'Unsupported artwork request.'});
  if (req.method === 'GET') {
    const entries = demo ? await listStarterArtwork() : await artwork.list(storyId);
    return json(res,200,artworkStatus(project,entries));
  }
  if (demo) return json(res,400,{error:'Branch the demo to keep artwork in your own story.'});
  if (req.method === 'PUT') {
    const {id,action,turn} = input || {};
    if (action === 'place' && !sceneIndex(project).some(scene=>scene.turn === turn)) return json(res,400,{error:'Choose an existing prose scene.'});
    const updated = await artwork.update(storyId,id,{action,turn});
    if (!updated) return json(res,404,{error:'Artwork not found.'});
    return json(res,200,artworkStatus(project,await artwork.list(storyId)));
  }
  if (req.method !== 'POST' || !['reference','illustration','comic'].includes(input?.kind)) {
    return json(res,400,{error:'Choose a reference, illustration, or comic.'});
  }
  if (input.revision !== liveRevision(library)) return json(res,409,{error:'The story changed. Reload the passage and try again.'});
  const {kind,model,ref} = input;
  if (!isAgentModel(model)) return json(res,400,{error:'Choose an editor or continuity model to plan the artwork.'});
  const provider = modelProvider(model);
  const [planKey,imageKey] = await credentials.keys([[provider],['openrouter']]);
  if (!planKey || !imageKey) return json(res,400,{error:'Set an OpenRouter key for rendering and a key for the selected planning model in Settings.'});
  const subject = kind === 'reference' ? artworkSubject(project,input.subject) : undefined;
  const passage = kind === 'reference' ? undefined : artworkPassage(project,ref);
  if (generatingArt.has(storyId)) return json(res,409,{error:'Artwork is already generating for this story.'});
  generatingArt.add(storyId);
  foregroundRequests++;
  const signal = disconnectSignal(res);
  try {
    diagnostics.storyRef = storyReference(storyId);
    const saved = await artwork.list(storyId);
    const ready = artworkStatus(project,saved).filter(item=>item.kind === 'reference' && item.status === 'approved' && !item.stale);
    const availableRefs = passage ? ready.filter(item=>item.subject).map(item=>({id:item.id,subject:item.subject,async loadDataUrl() {
      const image = await artwork.file(storyId,item.id);
      return image ? `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}` : undefined;
    }})) : [];
    await generateArtwork({kind,subject,passage:passage?.text,canon:artworkCanon(project,subject),
      style:typeof input.style === 'string' ? input.style : undefined,availableRefs,imageKey,signal,
      complete:({messages,tools})=>generateCompletion(messages,model,planKey,diagnostics,{
        stage:'artwork-plan',maxOutputTokens:artworkPlannerOutputLimit,tools,signal
      }),
      onUsage:usage=>spend.record(usage),
      onImage:({image,...item})=>artwork.put(storyId,[{...item,bytes:image,source:{
        canonKey:artworkCanonKey(project,item.subject),...(passage ? {scene:passage.scene} : {})
      }}])
    });
    const latest = (await getState()).projects.find(item=>item.id === storyId) || project;
    return json(res,200,artworkStatus(latest,await artwork.list(storyId)));
  } finally {
    generatingArt.delete(storyId);
    foregroundRequests--;
  }
}

async function routeStoryVersions(req,res,url) {
  if (req.method === 'GET') {
    const storyId = url.searchParams.get('story'), versionId = url.searchParams.get('version');
    if (storyId === starterStoryId) {
      if (!versionId) return json(res,200,await listStarterVersions());
      const snapshot = await readStarterVersion(versionId);
      return snapshot ? json(res,200,snapshot) : json(res,404,{error:'Version not found.'});
    }
    return await updateState(async ()=>{
      const project = (await readSavedLibrary()).projects.find(item=>item.id === storyId);
      if (!project) return json(res,404,{error:'Story not found.'});
      if (versionId) {
        const snapshot = await versions.get(storyId,versionId);
        return snapshot ? json(res,200,snapshot) : json(res,404,{error:'Version not found.'});
      }
      let history = await versions.list(storyId);
      if (!history.length) {
        await versions.record(versionSnapshot(project),{label:'First saved version'});
        history = await versions.list(storyId);
      }
      return json(res,200,history);
    });
  }
  if (req.method !== 'PUT') return json(res,405,{error:'Unsupported version request.'});
  const {storyId,versionId,revision} = await body(req,4096) || {};
  if (storyId === starterStoryId) return json(res,400,{error:'The demo’s saved versions are read-only.'});
  const library = await getState();
  const index = library.projects.findIndex(item=>item.id === storyId);
  if (index < 0) return json(res,404,{error:'Story not found.'});
  if (revision !== liveRevision(library)) return json(res,409,{error:'The story changed. Reload its latest version before restoring.'});
  const snapshot = await versions.get(storyId,versionId);
  if (!snapshot) return json(res,404,{error:'Version not found.'});
  const previous = library.projects[index];
  const restored = versionSnapshot(snapshot);
  // An older version can remove turns, but their IDs must never be reused.
  restored.nextTurn = Math.max(nextTurnNumber(previous),nextTurnNumber(restored));
  library.projects[index] = restored;
  library.activeId = storyId;
  const saved = await saveState(migrateLibrary(library),revision,false,{storyId,versionId});
  return saved ? json(res,200,{revision:saved}) : json(res,409,{error:'The story changed before the restore was saved.'});
}

async function routeRequest(req,res,url,diagnostics) {
if (url.pathname === '/api/artwork' || url.pathname === '/api/artwork/image') return routeArtwork(req,res,url,diagnostics);
if (url.pathname === '/api/story-versions') return routeStoryVersions(req,res,url);
if (url.pathname === '/api/manuscript-transition' && req.method === 'POST') {
  const {storyId,turn,model,revision} = await body(req,4096) || {};
  const library = await getState();
  const project = library.projects.find(item=>item.id === storyId);
  if (!project || !Number.isSafeInteger(turn) || !isAgentModel(model)) {
    return json(res,400,{error:'Choose a prose scene and a configured review model.'});
  }
  if (revision !== liveRevision(library)) return json(res,409,{error:'The story changed. Reopen the scene and try again.'});
  const [key] = await credentials.keys([[modelProvider(model)]]);
  if (!key) return json(res,400,{error:'Add the review model’s provider key in Settings.'});
  const signal = disconnectSignal(res);
  diagnostics.storyRef = storyReference(storyId);
  const proposal = await planManuscriptTransition({project,turn,signal,complete:({messages,tools})=>
    generateCompletion(messages,model,key,diagnostics,{stage:'transition-review',maxOutputTokens:transitionPlannerOutputLimit,tools,signal})});
  return json(res,200,proposal);
}
if (url.pathname === '/api/writing-analysis') {
  const settings = req.method === 'PUT' ? await body(req,4096) : undefined;
  if (req.method !== 'GET' && req.method !== 'PUT') return json(res,405,{error:'Unsupported analysis request.'});
  if (req.method === 'PUT' && (!settings || typeof settings.storyId !== 'string' ||
      settings.enabled !== undefined && typeof settings.enabled !== 'boolean' ||
      settings.model !== undefined && !isAgentModel(settings.model) ||
      settings.retry !== undefined && typeof settings.retry !== 'boolean')) return json(res,400,{error:'Check the analysis settings.'});
  const id = settings?.storyId || url.searchParams.get('story');
  const project = id === starterStoryId ? starter : await background.projectById(id);
  if (!project) return json(res,404,{error:'The selected story is no longer available.'});
  if (id === starterStoryId) return json(res,200,starterReview(project));
  if (settings) await background.configure(project,settings);
  return json(res,200,await background.status(project));
}
if (url.pathname === '/api/provider-keys') {
  if (req.method === 'GET') return json(res,200,{enabled:await credentials.status()});
  if (req.method === 'PUT') return json(res,200,{enabled:await credentials.update(await body(req,4096))});
}
if (url.pathname === '/api/spend' && req.method === 'GET') {
  let timeZone = url.searchParams.get('timeZone') || 'UTC';
  try { new Intl.DateTimeFormat('en',{timeZone}); } catch { timeZone = 'UTC'; }
  return json(res,200,{days:await spend.recent(timeZone)});
}
if (url.pathname === '/api/state' && req.method === 'GET') {
  return sendLibrary(req,res,await getState());
}
if (url.pathname === '/api/starter/reset' && req.method === 'POST') {
  return await updateState(async () => {
    const saved = await readSavedLibrary();
    // A delayed write from a demo that just reloaded cannot restore its old draft.
    if (starterSelected || !saved.projects.length) starterGeneration = randomUUID();
    starter = createStarterStory();
    return sendLibrary(req,res,withStarter(saved));
  });
}
if (['/api/state','/api/starter'].includes(url.pathname) && req.method === 'PUT') {
  const value = await body(req, libraryLimit);
  const starterOnly = url.pathname === '/api/starter';
  const library = starterOnly ? {activeId:starterStoryId,projects:[value]} : value;
  if (!validateState(library)) {
    diagnostics.code = 'INVALID_STORY_DATA';
    return json(res,400,{error:'Invalid story data.'});
  }
  if (starterOnly && value.id !== starterStoryId) return json(res,400,{error:'Invalid starter story.'});
  const revision = await saveState(migrateLibrary(library), req.headers['if-match'], starterOnly);
  if (!revision) {
    diagnostics.code = 'REVISION_CONFLICT';
    return json(res,409,{error:'Another tab saved a newer library. Export your work in this tab before reloading.'});
  }
  return json(res, 200, {ok:true, revision});
}
if (url.pathname === '/api/export' && req.method === 'POST') {
  const value = await body(req, libraryLimit);
  if (!validateState(value)) return json(res, 400, {error: 'Invalid story library.'});
  const library = migrateLibrary(withoutStarter(value));
  if (!library.projects.length) return json(res,400,{error:'Create a story before exporting. The demo is temporary.'});
  const files = {'library.json': strToU8(JSON.stringify(library, null, 2))};
  library.projects.forEach((project, index) => {
    const filename = project.title.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 80) || 'Story';
    const notes = [['Lore', project.lore], ['Opening premise', project.premise], ['Writing notes', project.notes]];
    const cast = getCast(project);
    const names = new Map(cast.map(member => [member.id,member.name]));
    const events = [...(project.relationships || [])]
      .sort((a,b) => (a.storyTime || '').localeCompare(b.storyTime || '') || (a.turn || 0) - (b.turn || 0))
      .map(({storyTime,turn,from,to,label}) => [
        storyTime?.replace('T',' '), turn ? `Turn ${turn}` : 'Setup', `${names.get(from) || from} → ${names.get(to) || to}: ${label}`
      ].filter(Boolean).join(' · '));
    const turns = project.messages.map(message => {
      const label = message.role === 'user' ? 'Writer' : message.speakerName || 'Narrator';
      return (message.storyTime ? message.storyTime.replace('T',' ') + ' · ' : '') + label + ':\n' + (message.sourcePrefix || '') + message.content;
    });
    files['Stories/' + (index + 1) + ' - ' + filename + '.txt'] = strToU8(
      [project.title, ...notes.filter(([,value]) => value).map(([label,value]) => label + ':\n' + value),
        ...cast.map(character => 'Cast: ' + character.name + '\n' + [character.nickname,character.description,character.personality,character.scenario,character.examples].filter(Boolean).join('\n')),
        ...(events.length ? ['Relationship timeline:\n' + events.join('\n')] : []), ...turns].join('\n\n')
    );
  });
  const storyIds = library.projects.map(project=>project.id);
  Object.assign(files,await artwork.archive(storyIds),await versions.archive(storyIds));
  const archive = zipSync(files);
  res.writeHead(200, {'content-type': 'application/zip', 'content-disposition': 'attachment; filename="story-studio-history.zip"', 'cache-control': 'no-store'});
  return res.end(Buffer.from(archive));
}
if (url.pathname === '/api/setup' && req.method === 'POST') return generateSetup(req,res,diagnostics);
if (url.pathname === '/api/story-edits' && req.method === 'POST') return generateStoryEdits(req,res,diagnostics);
if (url.pathname === '/api/story-flow' && req.method === 'POST') return suggestStoryFlow(req,res,diagnostics);
if (url.pathname === '/api/revision' && req.method === 'POST') return runRevisionReview(req,res,diagnostics);
if (url.pathname === '/api/generate' && req.method === 'POST') {
  const {project,instruction,provider,model,key:requestKey,mode='send',sensitive=false,agentModel=continuityModel,agentProvider=provider,agentKey:separateKey,flow=false} = await body(req, libraryLimit) || {};
  if (!validateState({activeId:project?.id,projects:[project]}) || typeof instruction !== 'string') {
    diagnostics.code = 'INVALID_STORY_REQUEST';
    return json(res,400,{error:'Invalid story request.'});
  }
  migrateStoryFields(migrateLegacyCast(project));
  if (!Object.hasOwn(providerNames,provider) || !['send','alternate','replace'].includes(mode)) {
    diagnostics.code = 'UNSUPPORTED_GENERATION_MODE';
    return json(res,400,{error:'Unsupported browser generation mode.'});
  }
  diagnostics.provider = provider;
  diagnostics.mode = mode;
  diagnostics.storyRef = storyReference(project.id);
  const signal = disconnectSignal(res);
  try {
    const [key,agentKey] = await credentials.keys([[provider,requestKey],[agentProvider,agentProvider === provider ? requestKey : separateKey]]);
    if (!validKey(key)) return json(res,400,{error:keyRequired(provider)});
    if (!isWriterModel(model) || modelProvider(model) !== provider) {
      diagnostics.code = 'WRITER_MODEL_INVALID';
      return json(res,400,{error:'Choose a prose model from the selected API provider.'});
    }
    if (typeof sensitive !== 'boolean' || (sensitive && !canWriteSensitive(model))) {
      diagnostics.code = 'SENSITIVE_ARTIST_REQUIRED';
      return json(res,400,{error:'Choose an NSFW-friendly writer for a sensitive scene.'});
    }
    const restricted = usesSensitiveContinuity(model,sensitive);
    if (!isContinuityModel(agentModel,restricted) || modelProvider(agentModel) !== agentProvider) {
      diagnostics.code = 'CONTINUITY_MODEL_REQUIRED';
      return json(res,400,{error:restricted ? 'Choose a supported sensitive-scene continuity agent.'
        : 'Choose a supported continuity agent.'});
    }
    if (!validKey(agentKey)) return json(res,400,{error:keyRequired(agentProvider)});
    diagnostics.model = modelIds.has(model) ? model : 'custom';
    diagnostics.outputFormat = 'text';
    const {messages,problem} = buildWritingContext(project,instruction,mode,{model,includeSensitive:sensitive,openRouter:true});
    if (problem) {
      diagnostics.code = 'WRITE_INPUT_TOO_LONG';
      return json(res,400,{error:problem});
    }
    const output = await generateCompletion(messages,model,key,diagnostics,{signal});
    if (signal.aborted) return;
    const text = stripWritingPreamble(output.text);
    if (text !== output.text) diagnostics.prosePreambleRemoved = true;
    if (/^\[(?:removed|redacted)\][.!]?$/i.test(text)) {
      throw diagnosticError(provider.toUpperCase() + '_REMOVAL_PLACEHOLDER','The writing provider returned a removal placeholder. No story reply came back.');
    }
    if (!text) throw diagnosticError('PROSE_EMPTY_REPLY','The provider returned no story prose for this request.');
    diagnostics.truncated = output.truncated;
    const draft = {text,input:sensitive ? 'explicit' : 'unclassified',reply:'unclassified',storyTime:'',suggestions:[]};
    if (output.truncated) draft.truncated = true;
    const suggest = !output.truncated && project.graphUpdates !== false && mode === 'send';
    try {
      diagnostics.metadataModel = agentModel;
      const parsed = await runContinuity(project,instruction,text,{suggest,truncated:output.truncated,mode,sensitive,model:agentModel},
        storyToolCompletion(agentModel,agentKey,diagnostics,'metadata',signal),
        rejections => {
          diagnostics.mapUpdateRejections = rejections;
          diagnostics.invalidMapUpdates = rejections.length;
        });
      Object.assign(draft,parsed);
    } catch (e) {
      if (signal.aborted) return;
      diagnostics.metadataCode = errorCode(e,'CONTINUITY_FAILED');
      draft.metadataFailed = true;
    }
    diagnostics.inputSensitivity = draft.input;
    diagnostics.replySensitivity = draft.reply;
    diagnostics.mapProposals = draft.suggestions.length;
    diagnostics.unverifiedLabels = draft.input === 'unclassified' || draft.reply === 'unclassified';
    if (flow === true && !output.truncated) {
      try {
        const held = sensitive || draft.input !== 'safe' || draft.reply !== 'safe';
        draft.flowOptions = await runStoryFlow(project,flowCompletion(agentModel,agentKey,diagnostics,signal),{
          model:agentModel,instruction,prose:text,sensitive:held,updates:held ? [] : draft.suggestions
        });
      } catch (failure) {
        if (signal.aborted) return;
        diagnostics.flowCode = errorCode(failure,'STORY_FLOW_FAILED');
        draft.flowUnavailable = true;
      }
    }
    return json(res, 200, draft);
  } catch (e) {
    if (signal.aborted) return;
    diagnostics.code = errorCode(e,'GENERATION_FAILED');
    return json(res,e.status || 500,{error:e.diagnosticCode ? e.message : 'Story Studio could not generate a reply.'});
  }
}
if (req.method !== 'GET') return json(res,404,{error:'Not found.'});
if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
const path = url.pathname === '/' ? '/index.html' : url.pathname;
if (!staticAssets.has(path)) return json(res,404,{error:'Not found.'});
const contents = await readFile(path === '/fflate.js' ? join(root,'node_modules','fflate','esm','browser.js') : join(root,'public',path));
res.writeHead(200,{
  'content-type':types[extname(path)],
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'self'; base-uri 'none'; frame-ancestors 'none'"
});
res.end(contents);
}

const server = http.createServer(async (req,res) => {
  const started = Date.now();
  const diagnostics = {requestId:randomUUID(), method:methodNames.has(req.method) ? req.method : 'other', endpoint:'other'};
  res.setHeader('x-story-studio-request-id',diagnostics.requestId);
  res.once('finish', () => {
    const status = res.statusCode;
    const mutation = diagnostics.method !== 'GET' && apiEndpoints.has(diagnostics.endpoint);
    if (status < 400 && !mutation) return;
    const level = status >= 500 ? 'error' : status >= 400 || diagnostics.truncated || diagnostics.unverifiedLabels || diagnostics.invalidMapUpdates ? 'warn' : 'info';
    log(level,status >= 400 ? 'request_failed' : 'request_completed',{...diagnostics,status,durationMs:Date.now()-started});
  });
  res.once('close', () => {
    if (!res.writableFinished && ['/api/generate','/api/setup','/api/story-edits'].includes(diagnostics.endpoint)) {
      log('warn','generation_disconnected',{...diagnostics,durationMs:Date.now()-started});
    }
  });
  try {
    if (![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host)) {
      diagnostics.code = 'INVALID_HOST';
      return json(res,403,{error:'Use the local app address.'});
    }
    const url = new URL(req.url,`http://127.0.0.1:${port}`);
    if (apiEndpoints.has(url.pathname)) diagnostics.endpoint = url.pathname;
    if (req.method !== 'GET') {
      if (![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) {
        diagnostics.code = 'INVALID_ORIGIN';
        return json(res,403,{error:'Request origin is not allowed.'});
      }
      if (!(req.headers['content-type'] || '').startsWith('application/json')) {
        diagnostics.code = 'EXPECTED_JSON';
        return json(res,415,{error:'JSON required.'});
      }
    }
    const foreground = req.method === 'POST' && foregroundEndpoints.has(url.pathname);
    if (foreground) foregroundRequests++;
    try { await routeRequest(req,res,url,diagnostics); }
    finally { if (foreground) foregroundRequests--; }
  } catch (error) {
    diagnostics.code = errorCode(error,'INTERNAL_ERROR');
    if (!res.headersSent) json(res,error.status || 500,{error:error.diagnosticCode ? error.message : 'Story Studio could not complete the request.'});
    else res.destroy();
  }
});
server.on('error', error => {
  const code = errorCode(error,'STARTUP_FAILED');
  log('error','startup_failed',{code,port});
  console.error(`Story Studio could not listen on port ${port} (${code}).`);
  process.exitCode = 1;
});
server.listen(port,'127.0.0.1', () => {
  background.start();
  log('info','started',{port,node:process.versions.node});
  console.log(`Story Studio running at http://127.0.0.1:${port}`);
});
server.once('close',()=>background.stop());
