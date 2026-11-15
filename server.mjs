import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { join, dirname, extname } from 'node:path';
import { isModelId } from './public/models.js';
import { buildMessages, extraFields, validCast, validRelationships } from './public/prompt.js';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.STORY_STUDIO_DATA || join(homedir(),'Library','Application Support','Story Studio');
const statePath=join(dataDir,'library.json');
const port=Number(process.env.PORT || 4317);
const initial={activeId:'sample',projects:[{id:'sample',title:'The Lantern Room',character:'Mara is a guarded, quick-witted archivist who collects stories she pretends not to believe. She notices details and speaks with dry warmth.',persona:'You are a traveler with a talent for finding things that were meant to stay lost.',lore:'The Lantern Room is a hidden archive beneath a city that never quite sleeps. Its lamps glow when someone tells the truth.',notes:'A slow-burn mystery with warmth and playful banter. Write in close third person, with sensory detail. Leave room for the other writer to choose what happens next.',messages:[{role:'assistant',content:'The last lamp in the archive flickered as you stepped inside.\n\nMara looked up from her desk, one finger marking her place in a crumbling book. “Either you’re very lost,” she said, “or you’ve brought me something interesting.”'}]}]};
const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
async function getState(){try{return JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code==='ENOENT'){if(!process.env.STORY_STUDIO_DATA){try{return JSON.parse(await readFile(join(root,'data','stories.json'),'utf8'));}catch(legacy){if(legacy.code!=='ENOENT')throw legacy;}}return structuredClone(initial);}throw e;}}
let writes = Promise.resolve();
const revisionOf = state => '"' + createHash('sha256').update(JSON.stringify(state)).digest('hex') + '"';

async function saveState(value, expectedRevision) {
  const op = writes.then(async () => {
    if (expectedRevision && revisionOf(await getState()) !== expectedRevision) return null;
    await mkdir(dataDir, {recursive:true});
    const tmp = join(dataDir, `.stories-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(value, null, 2), {mode:0o600});
    await rename(tmp, statePath);
    return revisionOf(value);
  });
  writes = op.catch(() => {});
  return op;
}

async function body(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw Object.assign(Error('The request exceeds the size limit.'), {status:413});
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(Error('Invalid JSON.'), {status:400}); }
}

const libraryLimit = 16_000_000;
function validateState(s){return s && Array.isArray(s.projects) && s.projects.length<=100 && typeof s.activeId==='string' && s.projects.every(p=>p && typeof p.id==='string' && typeof p.title==='string' && (p.cast===undefined || validCast(p.cast)) && (p.relationships===undefined || validRelationships(p.relationships)) && (p.graphUpdates===undefined || typeof p.graphUpdates==='boolean') && (p.speakerId===undefined || typeof p.speakerId==='string') && extraFields.every(k=>p[k]===undefined || typeof p[k]==='string') && ['character','persona','lore','notes'].every(k=>typeof p[k]==='string') && Array.isArray(p.messages) && p.messages.length<=3000 && p.messages.every(m=>m && ['user','assistant'].includes(m.role) && typeof m.content==='string' && (m.speakerId===undefined || typeof m.speakerId==='string') && (m.speakerName===undefined || typeof m.speakerName==='string') && (m.excludeFromContext===undefined || typeof m.excludeFromContext==='boolean')));}
async function generateOpenRouter(messages, model, key) {
  if (typeof key !== 'string' || !/^[!-~]{1,512}$/.test(key)) {
    throw Error('Enter an OpenRouter API key in Connections.');
  }
  if (typeof model !== 'string' || !isModelId(model)) {
    throw Error('Enter a specific OpenRouter model ID (author/model).');
  }
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: {authorization: 'Bearer ' + key, 'content-type': 'application/json'},
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      provider: {data_collection: 'deny'}
    })
  });
  if (!response.ok) {
    const messages = {
      401: 'Check your API key.',
      402: 'Check your balance and key spending limit.',
      403: 'The request was denied by OpenRouter or its provider.',
      404: 'The selected model or an eligible provider is unavailable.',
      429: 'The selected model is rate limited. Try again later.'
    };
    throw Error('OpenRouter returned ' + response.status + '. ' + (messages[response.status] || 'Check the model and try again.'));
  }
  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw Error('OpenRouter returned no prose for this request.');
  return text.trim();
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host))return json(res,403,{error:'Use the local app address.'});const url=new URL(req.url,`http://127.0.0.1:${port}`);if(req.method!=='GET'){const origin=req.headers.origin;if(!origin||!([`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)))return json(res,403,{error:'Request origin is not allowed.'});if(!(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'JSON required.'});}
if (url.pathname === '/api/state' && req.method === 'GET') {
  const library = await getState();
  const revision = revisionOf(library);
  res.setHeader('etag', revision);
  if (req.headers['if-none-match'] === revision) { res.writeHead(304); return res.end(); }
  return json(res, 200, library);
}
if (url.pathname === '/api/state' && req.method === 'PUT') {
  const library = await body(req, libraryLimit);
  if (!validateState(library)) return json(res, 400, {error:'Invalid story data.'});
  const revision = await saveState(library, req.headers['if-match']);
  if (!revision) return json(res, 409, {error:'Another tab saved a newer library. Export your work in this tab before reloading.'});
  return json(res, 200, {ok:true, revision});
}
if (url.pathname === '/api/export' && req.method === 'POST') {
  const library = await body(req, libraryLimit);
  if (!validateState(library)) return json(res, 400, {error: 'Invalid story library.'});
  const files = {'library.json': strToU8(JSON.stringify(library, null, 2))};
  library.projects.forEach((project, index) => {
    const filename = project.title.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 80) || 'Story';
    const notes = [['Character', project.character], ['Persona', project.persona], ['Lore', project.lore], ['Writing notes', project.notes]];
    const turns = project.messages.map(message => {
      const label = message.role === 'user' ? 'Writer' : message.speakerName || 'Co-writer';
      return label + ':\n' + message.content;
    });
    files['Stories/' + (index + 1) + ' - ' + filename + '.txt'] = strToU8(
      [project.title, ...notes.map(([label, value]) => label + ':\n' + value), ...(project.cast || []).map(character => 'Cast: ' + character.name + '\n' + [character.description, character.personality, character.scenario].filter(Boolean).join('\n')), ...turns].join('\n\n')
    );
  });
  const archive = zipSync(files);
  res.writeHead(200, {'content-type': 'application/zip', 'content-disposition': 'attachment; filename="story-studio-history.zip"', 'cache-control': 'no-store'});
  return res.end(Buffer.from(archive));
}
if (url.pathname === '/api/generate' && req.method === 'POST') {
  const {project,instruction,provider,model,key,mode='send'} = await body(req);
  if (!validateState({activeId:project?.id,projects:[project]}) || typeof instruction !== 'string') {
    return json(res, 400, {error:'Invalid story request.'});
  }
  if (provider !== 'openrouter' || !['send','alternate'].includes(mode)) {
    return json(res, 400, {error:'Unsupported browser generation mode.'});
  }
  try {
    const messages = buildMessages(project,instruction,mode,{model});
    return json(res, 200, {text:await generateOpenRouter(messages,model,key)});
  } catch (e) {
    return json(res, 500, {error:e.message});
  }
}
if(req.method!=='GET')return json(res,404,{error:'Not found.'});if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}const path=url.pathname==='/'?'/index.html':url.pathname;if(!/^\/(index\.html|app\.js|prompt\.js|models\.js|graph-history\.js|style\.css)$/.test(path))return json(res,404,{error:'Not found.'});const contents=await readFile(join(root,'public',path));res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(contents);
}catch(e){json(res,e.status||500,{error:e.message});}}).listen(port,'127.0.0.1',()=>console.log(`Story Studio running at http://127.0.0.1:${port}`));
