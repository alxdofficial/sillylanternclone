import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { join, dirname, extname } from 'node:path';
import { isModelId, models, proseOutputLimit } from './public/models.js';
import { buildMessages, buildMetadataMessages, extraFields, getCast, getWriter, validCast, validRelationships, validSensitivity, isStoryTime, maxDirectionCharacters } from './public/prompt.js';
import { maxLibraryStories, starterStoryId, withoutStarter } from './public/library.js';
import { createStarterStory } from './examples/the-late-ferry.mjs';
import { checkMapUpdates } from './map-updates.mjs';
import { isWritingRefusal, metadataModel, readStoryMetadata, storyMetadataFormat, stripWritingPreamble } from './openrouter-format.mjs';
import { manuscriptDraftFormat, readSetupDraft, setupDraftFormat, setupMessages } from './setup-chat.mjs';
import { setupQueue } from './setup-queue.mjs';
import { createLogger, diagnosticError, errorCode, storyReference } from './diagnostics.mjs';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.STORY_STUDIO_DATA || join(homedir(),'Library','Application Support','Story Studio');
const statePath=join(dataDir,'library.json');
const port=Number(process.env.PORT || 4317);
const log = createLogger('server');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  log('error','startup_failed',{code:'INVALID_PORT'});
  console.error('Story Studio: PORT must be a number from 1 to 65535.');
  process.exit(1);
}
const apiEndpoints = new Set(['/api/state','/api/starter','/api/starter/reset','/api/agent','/api/generate','/api/setup','/api/setup/mcp','/api/export']);
const methodNames = new Set(['GET','POST','PUT']);
const modelIds = new Set(models.map(model => model.id));
let starter = createStarterStory();
let starterSelected = false;
let starterGeneration = randomUUID();
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
async function parseLibrary(path) {
  const text = await readFile(path,'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw diagnosticError('LIBRARY_JSON_INVALID','The saved library is not valid JSON.');
  }
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

function saveState(value, expectedRevision, starterOnly) {
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

// What connected MCP agents are doing, so the page can tell the writer
// whether anyone is watching for a queued turn. Kept in memory only: it is
// never saved, so it cannot conflict with library saves. Entries expire
// when an agent stops reporting.
const agentLifetimes = {watching:60_000, writing:15 * 60_000};
const agentPresence = new Map();
const shortText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function liveAgents(now = Date.now()) {
  for (const [id, agent] of agentPresence) if (agent.expires <= now) agentPresence.delete(id);
  return [...agentPresence.values()].map(({expires, ...agent}) => agent);
}
function reportAgent(report) {
  const {id, state} = report || {};
  if (typeof id !== 'string' || !/^[a-z0-9-]{8,64}$/.test(id) || !['watching','writing','done'].includes(state)) return false;
  if (state === 'done') return agentPresence.delete(id), true;
  const now = Date.now();
  const previous = agentPresence.get(id);
  const turn = state === 'writing'
    ? {storyId:shortText(report.storyId, 200), turnNumber:Number.isSafeInteger(report.turnNumber) ? report.turnNumber : null, speaker:shortText(report.speaker, 100)}
    : {};
  const same = previous?.state === state && previous.storyId === turn.storyId && previous.turnNumber === turn.turnNumber;
  agentPresence.set(id, {id, client:shortText(report.client, 60) || 'Your agent', state, ...turn, since:same ? previous.since : now, expires:now + agentLifetimes[state]});
  return true;
}

const libraryLimit = 16_000_000;
function validateState(s){return s && Array.isArray(s.projects) && s.projects.length<=maxLibraryStories+1 && s.projects.filter(p=>p?.id!==starterStoryId).length<=maxLibraryStories && new Set(s.projects.map(p=>p?.id)).size===s.projects.length && typeof s.activeId==='string' && s.projects.every(p=>p && typeof p.id==='string' && typeof p.title==='string' && (p.cast===undefined || validCast(p.cast)) && (p.relationships===undefined || validRelationships(p.relationships)) && (p.storyStartAt===undefined || isStoryTime(p.storyStartAt)) && (p.graphUpdates===undefined || typeof p.graphUpdates==='boolean') && (p.speakerId===undefined || typeof p.speakerId==='string') && extraFields.every(k=>p[k]===undefined || typeof p[k]==='string') && ['character','persona','lore','notes'].every(k=>typeof p[k]==='string') && Array.isArray(p.messages) && p.messages.length<=3000 && p.messages.every(m=>m && ['user','assistant'].includes(m.role) && typeof m.content==='string' && (m.sourcePrefix===undefined || typeof m.sourcePrefix==='string') && (m.speakerId===undefined || typeof m.speakerId==='string') && (m.speakerName===undefined || typeof m.speakerName==='string') && (m.excludeFromContext===undefined || typeof m.excludeFromContext==='boolean') && (m.contentSensitivity===undefined || validSensitivity(m.contentSensitivity)) && (m.storyTime===undefined || isStoryTime(m.storyTime)) && (m.alternativeSensitivities===undefined || Array.isArray(m.alternativeSensitivities) && m.alternativeSensitivities.length<=5000 && m.alternativeSensitivities.every(value=>value===null||validSensitivity(value)))));}
const openRouterStatusHints = {
  401:'Check your API key.',
  402:'Check your balance and key spending limit.',
  403:'The request was denied by OpenRouter or its provider.',
  404:'The selected model or an eligible provider is unavailable.',
  429:'The selected model is rate limited. Try again later.'
};

async function generateOpenRouter(messages, model, key, diagnostics, {
  stage = 'prose', maxOutputTokens = proseOutputLimit(model), responseFormat, signal
} = {}) {
  const started = Date.now();
  const metadata = stage === 'metadata';
  const details = diagnostics[stage] = {model:modelIds.has(model) ? model : 'custom',maxOutputTokens};
  log('info','generation_started',{requestId:diagnostics.requestId,storyRef:diagnostics.storyRef,
    provider:'openrouter',stage,...details});
  let response;
  try {
    const timeout = AbortSignal.timeout(responseFormat ? 45_000 : maxOutputTokens > 2048 ? 240_000 : 120_000);
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      headers: {authorization: 'Bearer ' + key, 'content-type': 'application/json'},
      signal:signal ? AbortSignal.any([signal,timeout]) : timeout,
      body: JSON.stringify({
        model,
        messages,
        max_tokens:maxOutputTokens,
        provider: {data_collection:'deny',...(responseFormat ? {require_parameters:true} : {})},
        ...(responseFormat ? {response_format:responseFormat,reasoning:{enabled:false}} : {})
      })
    });
  } catch (error) {
    details.durationMs = Date.now() - started;
    const timeout = errorCode(error) === 'TIMEOUT';
    throw diagnosticError(timeout ? 'OPENROUTER_TIMEOUT' : 'OPENROUTER_CONNECTION_FAILED',
      timeout ? 'OpenRouter took too long to reply.' : 'Could not connect to OpenRouter.');
  }
  details.durationMs = Date.now() - started;
  diagnostics[metadata ? 'metadataUpstreamStatus' : 'upstreamStatus'] = details.status = response.status;
  if (!response.ok) {
    const hint = openRouterStatusHints[response.status] || 'Check the model and try again.';
    throw diagnosticError('OPENROUTER_HTTP_ERROR',`OpenRouter returned ${response.status}. ${hint}`);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw diagnosticError('OPENROUTER_INVALID_RESPONSE','OpenRouter returned an unreadable response.');
  } finally {
    details.durationMs = Date.now() - started;
  }
  if (typeof result?.provider === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .+&()/\-]{0,59}$/.test(result.provider)) {
    details.host = result.provider;
  }
  if (Number.isSafeInteger(result?.usage?.prompt_tokens) && result.usage.prompt_tokens >= 0) {
    details.inputTokens = result.usage.prompt_tokens;
  }
  if (Number.isSafeInteger(result?.usage?.completion_tokens) && result.usage.completion_tokens >= 0) {
    details.outputTokens = result.usage.completion_tokens;
  }
  const choice = result?.choices?.[0];
  const finish = choice?.finish_reason;
  if (['stop','length','content_filter','error','tool_calls'].includes(finish)) {
    diagnostics[metadata ? 'metadataFinishReason' : 'finishReason'] = details.finishReason = finish;
  }
  const upstreamError = result?.error || choice?.error;
  if (upstreamError) {
    const {code} = upstreamError;
    if (Number.isInteger(code) && code >= 400 && code <= 599) details.errorStatus = code;
    const hint = openRouterStatusHints[details.errorStatus] || 'Check the model and try again.';
    throw diagnosticError('OPENROUTER_UPSTREAM_ERROR',`OpenRouter reported a provider error. ${hint}`);
  }
  if (finish === 'content_filter') {
    throw diagnosticError('OPENROUTER_CONTENT_FILTERED','OpenRouter reported that the response was filtered.');
  }
  if (finish === 'error') {
    throw diagnosticError('OPENROUTER_INCOMPLETE_REPLY','OpenRouter reported an incomplete response.');
  }
  const text = choice?.message?.content;
  const refusal = choice?.message?.refusal;
  if (!metadata && ((typeof refusal === 'string' && refusal.trim())
    || (stage === 'prose' && typeof text === 'string' && isWritingRefusal(text.trim())))) {
    throw diagnosticError('OPENROUTER_WRITING_DECLINED','The selected OpenRouter model declined this direction.');
  }
  if (typeof text !== 'string' || !text.trim()) throw diagnosticError('OPENROUTER_EMPTY_REPLY','OpenRouter returned no text for this request.');
  return {text:text.trim(), truncated:finish === 'length'};
}
async function generateSetup(req,res,diagnostics) {
  const {mode,model,key,messages,manuscript} = await body(req,250_000) || {};
  const prompt = setupMessages(messages,mode,manuscript);
  if (!prompt) {
    diagnostics.code = 'INVALID_SETUP_CONVERSATION';
    return json(res,400,{error:'Enter a setup message or prepare a draft from the discussion so far. The brainstorm allows up to 21 writer messages and 36,000 characters.'});
  }
  if (typeof key !== 'string' || !/^[!-~]{1,512}$/.test(key)) {
    diagnostics.code = 'OPENROUTER_KEY_REQUIRED';
    return json(res,400,{error:'Enter an OpenRouter API key to brainstorm.'});
  }
  if (typeof model !== 'string' || !isModelId(model)) {
    diagnostics.code = 'OPENROUTER_MODEL_INVALID';
    return json(res,400,{error:'Choose an OpenRouter model for brainstorming.'});
  }
  const drafting = mode === 'draft';
  const selected = drafting ? metadataModel : model;
  diagnostics.provider = 'openrouter';
  diagnostics.mode = mode;
  diagnostics.model = modelIds.has(selected) ? selected : 'custom';
  const request = new AbortController();
  res.once('close',() => { if (!res.writableFinished) request.abort(); });
  try {
    const output = await generateOpenRouter(prompt,selected,key,diagnostics,{
      stage:drafting ? 'setup-draft' : 'setup-chat',
      maxOutputTokens:drafting ? 4096 : 768,
      signal:request.signal,
      ...(drafting ? {responseFormat:manuscript ? manuscriptDraftFormat : setupDraftFormat} : {})
    });
    if (drafting) return json(res,200,{draft:readSetupDraft(output,manuscript)});
    if (output.truncated || output.text.length > 6000) {
      throw diagnosticError('SETUP_CHAT_TRUNCATED','OpenRouter cut off the brainstorm reply. Try a narrower question.');
    }
    return json(res,200,{text:output.text});
  } catch (error) {
    if (request.signal.aborted) return;
    diagnostics.code = errorCode(error,'SETUP_GENERATION_FAILED');
    return json(res,502,{error:error.diagnosticCode ? error.message : 'Story Studio could not prepare a setup reply.'});
  }
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
async function routeRequest(req,res,url,diagnostics) {
if (url.pathname === '/api/state' && req.method === 'GET') {
  return sendLibrary(req,res,await getState());
}
if (url.pathname === '/api/agent' && req.method === 'GET') {
  return json(res, 200, {now:Date.now(), agents:liveAgents()});
}
if (url.pathname === '/api/agent' && req.method === 'POST') {
  return reportAgent(await body(req, 4000)) ? json(res, 200, {ok:true}) : json(res, 400, {error:'Invalid agent status.'});
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
  const revision = await saveState(library, req.headers['if-match'], starterOnly);
  if (!revision) {
    diagnostics.code = 'REVISION_CONFLICT';
    return json(res,409,{error:'Another tab saved a newer library. Export your work in this tab before reloading.'});
  }
  return json(res, 200, {ok:true, revision});
}
if (url.pathname === '/api/export' && req.method === 'POST') {
  const value = await body(req, libraryLimit);
  if (!validateState(value)) return json(res, 400, {error: 'Invalid story library.'});
  const library = withoutStarter(value);
  if (!library.projects.length) return json(res,400,{error:'Create a story before exporting. The demo is temporary.'});
  const files = {'library.json': strToU8(JSON.stringify(library, null, 2))};
  library.projects.forEach((project, index) => {
    const filename = project.title.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 80) || 'Story';
    const writer = getWriter(project);
    const notes = [['Character', project.character], ['Writer character', writer.name], ['Lore', project.lore], ['Writing notes', project.notes]];
    if (!project.storyWriterId && writer.description) notes.push(['Writer description',writer.description]);
    const cast = getCast(project);
    const names = new Map(cast.map(member => [member.id,member.name]));
    const events = [...(project.relationships || [])]
      .sort((a,b) => (a.storyTime || '').localeCompare(b.storyTime || '') || (a.turn || 0) - (b.turn || 0))
      .map(({storyTime,turn,from,to,label}) => [
        storyTime?.replace('T',' '), turn ? `Turn ${turn}` : 'Setup', `${names.get(from) || from} → ${names.get(to) || to}: ${label}`
      ].filter(Boolean).join(' · '));
    const turns = project.messages.map(message => {
      const label = message.role === 'user' ? writer.name || 'Writer' : message.speakerName || 'Co-writer';
      return (message.storyTime ? message.storyTime.replace('T',' ') + ' · ' : '') + label + ':\n' + (message.sourcePrefix || '') + message.content;
    });
    files['Stories/' + (index + 1) + ' - ' + filename + '.txt'] = strToU8(
      [project.title, ...notes.filter(([,value]) => value).map(([label,value]) => label + ':\n' + value),
        ...cast.slice(1).map(character => 'Cast: ' + character.name + '\n' + [character.description, character.personality, character.scenario].filter(Boolean).join('\n')),
        ...(events.length ? ['Relationship timeline:\n' + events.join('\n')] : []), ...turns].join('\n\n')
    );
  });
  const archive = zipSync(files);
  res.writeHead(200, {'content-type': 'application/zip', 'content-disposition': 'attachment; filename="story-studio-history.zip"', 'cache-control': 'no-store'});
  return res.end(Buffer.from(archive));
}
if (url.pathname === '/api/setup' && req.method === 'POST') return generateSetup(req,res,diagnostics);
if (url.pathname === '/api/setup/mcp' && req.method === 'POST') {
  const request = await body(req,250_000);
  if (request?.action === 'status' || request?.action === 'claim') diagnostics.readOnly = true;
  return json(res,200,setupQueue(request));
}
if (url.pathname === '/api/generate' && req.method === 'POST') {
  const {project,instruction,provider,model,key,mode='send'} = await body(req);
  if (!validateState({activeId:project?.id,projects:[project]}) || typeof instruction !== 'string') {
    diagnostics.code = 'INVALID_STORY_REQUEST';
    return json(res,400,{error:'Invalid story request.'});
  }
  if (provider !== 'openrouter' || !['send','alternate','replace'].includes(mode)) {
    diagnostics.code = 'UNSUPPORTED_GENERATION_MODE';
    return json(res,400,{error:'Unsupported browser generation mode.'});
  }
  diagnostics.provider = 'openrouter';
  diagnostics.mode = mode;
  diagnostics.storyRef = storyReference(project.id);
  try {
    if (typeof key !== 'string' || !/^[!-~]{1,512}$/.test(key)) {
      diagnostics.code = 'OPENROUTER_KEY_REQUIRED';
      return json(res,400,{error:'Enter an OpenRouter API key in Connection.'});
    }
    if (typeof model !== 'string' || !isModelId(model)) {
      diagnostics.code = 'OPENROUTER_MODEL_INVALID';
      return json(res,400,{error:'Enter a specific OpenRouter model ID (author/model).'});
    }
    diagnostics.model = modelIds.has(model) ? model : 'custom';
    diagnostics.outputFormat = 'text';
    const messages = buildMessages(project,instruction,mode,{model,includeSensitive:true,openRouter:true});
    const output = await generateOpenRouter(messages,model,key,diagnostics);
    const text = stripWritingPreamble(output.text);
    if (text !== output.text) diagnostics.prosePreambleRemoved = true;
    if (/^\[(?:removed|redacted)\][.!]?$/i.test(text)) {
      throw diagnosticError('OPENROUTER_REMOVAL_PLACEHOLDER','The writing provider returned a removal placeholder. No story reply came back.');
    }
    if (!text) throw diagnosticError('OPENROUTER_EMPTY_REPLY','OpenRouter returned no story prose for this request.');
    diagnostics.truncated = output.truncated;
    const draft = {text,input:'unclassified',reply:'unclassified',storyTime:'',suggestions:[]};
    if (output.truncated) draft.truncated = true;
    const suggest = !output.truncated && project.graphUpdates !== false && mode === 'send';
    const validateUpdates = value => checkMapUpdates(project,suggest ? value : undefined);
    try {
      diagnostics.metadataModel = metadataModel;
      const metadataPrompt = buildMetadataMessages(project,instruction,text,mode,{truncated:output.truncated});
      const metadata = await generateOpenRouter(metadataPrompt,metadataModel,key,diagnostics,{
        stage:'metadata',maxOutputTokens:1536,responseFormat:storyMetadataFormat
      });
      const {invalidFields, ...parsed} = readStoryMetadata(metadata,validateUpdates);
      Object.assign(draft,parsed);
      if (invalidFields.length) {
        diagnostics.metadataCode = 'OPENROUTER_METADATA_INCOMPLETE';
        diagnostics.metadataInvalidFields = invalidFields;
        draft.metadataFailed = true;
      }
    } catch (e) {
      diagnostics.metadataCode = errorCode(e,'OPENROUTER_METADATA_FAILED');
      draft.metadataFailed = true;
    }
    if (mode !== 'alternate' && instruction.trim().length > maxDirectionCharacters) {
      diagnostics.inputTruncated = draft.inputTruncated = true;
      if (draft.input !== 'explicit') draft.input = 'unclassified';
    }
    diagnostics.inputSensitivity = draft.input;
    diagnostics.replySensitivity = draft.reply;
    diagnostics.mapProposals = draft.suggestions.length;
    diagnostics.unverifiedLabels = draft.input === 'unclassified' || draft.reply === 'unclassified';
    if (draft.updateProblems) {
      diagnostics.invalidMapUpdates = draft.updateProblems;
      diagnostics.mapUpdateRejections = draft.updateRejections;
    }
    return json(res, 200, draft);
  } catch (e) {
    diagnostics.code = errorCode(e,'GENERATION_FAILED');
    return json(res,e.status || 500,{error:e.diagnosticCode ? e.message : 'Story Studio could not generate a reply.'});
  }
}
if(req.method!=='GET')return json(res,404,{error:'Not found.'});if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}const path=url.pathname==='/'?'/index.html':url.pathname;if(!/^\/(index\.html|app\.js|prompt\.js|models\.js|graph-history\.js|library\.js|manuscript\.js|sync\.js|style\.css)$/.test(path))return json(res,404,{error:'Not found.'});const contents=await readFile(join(root,'public',path));res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(contents);
}

const server = http.createServer(async (req,res) => {
  const started = Date.now();
  const diagnostics = {requestId:randomUUID(), method:methodNames.has(req.method) ? req.method : 'other', endpoint:'other'};
  res.setHeader('x-story-studio-request-id',diagnostics.requestId);
  res.once('finish', () => {
    const status = res.statusCode;
    const mutation = diagnostics.method !== 'GET' && apiEndpoints.has(diagnostics.endpoint) && diagnostics.endpoint !== '/api/agent';
    if (status < 400 && (!mutation || diagnostics.readOnly)) return;
    const level = status >= 500 ? 'error' : status >= 400 || diagnostics.truncated || diagnostics.unverifiedLabels || diagnostics.invalidMapUpdates ? 'warn' : 'info';
    log(level,status >= 400 ? 'request_failed' : 'request_completed',{...diagnostics,status,durationMs:Date.now()-started});
  });
  res.once('close', () => {
    if (!res.writableFinished && ['/api/generate','/api/setup'].includes(diagnostics.endpoint)) {
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
    await routeRequest(req,res,url,diagnostics);
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
  log('info','started',{port,node:process.versions.node});
  console.log(`Story Studio running at http://127.0.0.1:${port}`);
});
