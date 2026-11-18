import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isAgentModel, models } from './public/models.js';
import { starterStoryId } from './public/library.js';
import { estimateContextTokens } from './public/prompt.js';
import { reviewFindingId } from './public/revision.js';
import { analysisBatch, analysisOutputLimit, analysisPairs, analysisVersions, extractAnalysis, planAnalysis, verifyAnalysis } from './revision-background-review.mjs';

export const analysisDailyBudget = 1;
const cacheVersion = 1;
const dayOf = time => new Date(time).toISOString().slice(0,10);
const stop = code => Object.assign(new Error(code),{diagnosticCode:code});

export function createBackgroundAnalysis({dataDir,readLibrary,hasKey,complete,shouldYield = ()=>false,
  reportError = ()=>{},clock = Date.now,intervalMs = 5000,versions = analysisVersions}) {
  const directory = join(dataDir,'writing-analysis');
  const path = join(directory,'cache.json');
  let records = new Map(), active, writes = Promise.resolve(), ticking = false;
  let timer;
  const ready = readFile(path,'utf8').then(text=>{
    const saved = JSON.parse(text);
    records = new Map(saved.records.map(([id,record])=>[id,{
      ...record, units:new Map(saved.version === cacheVersion ? record.units : []),
      links:new Map(saved.version === cacheVersion ? record.links : [])
    }]));
  }).catch(error=>{ if (error.code !== 'ENOENT') reportError(error); });

  function persist() {
    const operation = writes.then(async ()=>{
      await mkdir(directory,{recursive:true,mode:0o700});
      const snapshot = JSON.stringify({version:cacheVersion,records:[...records].map(([id,record])=>[id,{
        ...record,units:[...record.units],links:[...record.links]
      }])});
      const temporary = join(directory,`.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary,snapshot,{mode:0o600});
        await rename(temporary,path);
      } finally {
        await unlink(temporary).catch(()=>{});
      }
    });
    writes = operation.catch(()=>{});
    return operation;
  }

  async function configure(project,{enabled,model,retry = false}) {
    await ready;
    if (project.id === starterStoryId) return;
    const record = records.get(project.id);
    // Initial browser enrollment preserves the stored on/off choice across tabs.
    const next = enabled ?? record?.enabled ?? true;
    const selected = model || record?.model;
    if (record && record.enabled === next && record.model === selected && !retry) return;
    if (active?.id === project.id) active.controller.abort();
    const previous = record || {units:new Map(),links:new Map()};
    records.set(project.id,{...previous,enabled:next,model:selected,failures:0,retryAt:0,error:undefined,
      batchLimit:previous.model === selected ? previous.batchLimit : undefined});
    await persist();
  }

  function currentPlan(project,record) {
    const plan = planAnalysis(project,record?.model,versions);
    const available = record?.units || new Map();
    const missing = plan.units.filter(unit=>!available.has(unit.key));
    const outstanding = new Set(missing.map(unit=>unit.scene.turn));
    const observations = new Map(plan.units.flatMap(unit=>available.has(unit.key) ? [[unit.key,available.get(unit.key).items]] : []));
    const pairs = analysisPairs(plan,observations,versions);
    return {plan,available,missing,pairs,outstanding};
  }

  function findings({plan,available,pairs},record) {
    const result = {pacing:[],themes:[],threads:[],continuity:[]};
    const linked = new Set();
    const previousLinks = new Map([...(record?.links.values() || [])].map(entry=>[entry.source,entry.finding]));
    for (const pair of pairs) {
      const found = record?.links.has(pair.id) ? record.links.get(pair.id).finding : previousLinks.get(pair.source);
      if (!found) continue;
      result[found.kind].push(found);
      if (found.kind === 'threads') linked.add(JSON.stringify(found.refs[0]));
    }
    const previousUnits = new Map([...available.values()].map(entry=>[entry.source,entry.items]));
    for (const unit of plan.units) {
      for (const item of available.get(unit.key)?.items || previousUnits.get(unit.source) || []) {
        if (item.kind !== 'pacing' && (item.kind !== 'setup' || linked.has(JSON.stringify(item.ref)))) continue;
        const {topic:title,detail,ref} = item;
        result[item.kind === 'pacing' ? 'pacing' : 'threads'].push({id:reviewFindingId(title,[ref]),title,detail,refs:[ref]});
      }
    }
    return result;
  }

  async function status(project) {
    await ready;
    if (project.id === starterStoryId) return {state:'demo'};
    const record = records.get(project.id);
    const work = currentPlan(project,record);
    const {plan,missing,pairs,outstanding} = work;
    const due = pairs.filter(pair=>!record?.links.has(pair.id)).length;
    const total = plan.scenes.filter(scene=>scene.eligible).length;
    const day = dayOf(clock());
    const estimatedUsd = record?.day === day ? record.reserved || 0 : 0;
    let state = 'waiting-model';
    if (record?.enabled === false) state = 'paused';
    else if (!total) state = 'empty';
    else if (record?.model && !missing.length && !due) state = 'ready';
    else if (active?.id === project.id) state = 'running';
    else if (record?.error === 'budget' && record.day === day) state = 'budget';
    else if (record?.error === 'failed' && record.retryAt === null) state = 'failed';
    else if (record?.model && await hasKey(record.model)) state = record.error === 'failed' && record.retryAt > clock() ? 'retrying' : 'queued';
    return {state,enabled:record?.enabled !== false,model:record?.model,reviewed:total - outstanding.size,total,
      held:plan.scenes.length - total,linksRemaining:due,estimatedUsd,dailyBudget:analysisDailyBudget,findings:findings(work,record)};
  }

  function reserve(record,messages,tools) {
    const rates = models.find(item=>item.id === record.model);
    const input = estimateContextTokens(JSON.stringify({messages,tools}));
    const estimate = (input * rates.input + analysisOutputLimit * rates.output) / 1_000_000;
    const day = dayOf(clock());
    if (record.day !== day) { record.day = day; record.reserved = 0; }
    if (record.reserved + estimate > analysisDailyBudget) throw stop('REVIEW_DAILY_BUDGET');
    record.reserved += estimate;
    return persist();
  }

  async function run(project,record,work) {
    const {missing,pairs} = work;
    const links = pairs.filter(pair=>!record.links.has(pair.id)).slice(0,6);
    const batch = missing.length ? analysisBatch(missing,record.model).slice(0,record.batchLimit) : [];
    if (!batch.length && !links.length) return;
    const id = project.id, controller = new AbortController();
    active = {id,controller};
    const current = () => records.get(id) === record && record.enabled && !controller.signal.aborted;
    const verifySources = async (requireAll = true) => {
      if (!current()) throw stop('REVIEW_DEFERRED');
      const latest = (await readLibrary()).projects.find(story=>story.id === id);
      if (!latest || !current()) throw stop('REVIEW_DEFERRED');
      const next = currentPlan(latest,record);
      const source = new Set((batch.length ? next.plan.units : next.pairs).map(item=>item.key || item.id));
      if (requireAll && (batch.length ? batch : links).some(item=>!source.has(item.key || item.id))) throw stop('REVIEW_DEFERRED');
      return source;
    };
    try {
      const request = async (messages,tools)=>{
        if (shouldYield()) throw stop('REVIEW_DEFERRED');
        await verifySources();
        await reserve(record,messages,tools);
        await verifySources();
        return complete({storyId:id,model:record.model,messages,tools,signal:controller.signal});
      };
      const results = batch.length ? await extractAnalysis(batch,request) : await verifyAnalysis(links,request);
      const surviving = await verifySources(false);
      if (batch.length) {
        for (const {key,source} of batch) if (surviving.has(key)) record.units.set(key,{source,items:results[key]});
      } else {
        for (const {id,source} of links) if (surviving.has(id)) record.links.set(id,{source,finding:results[id]});
      }
      record.error = undefined;
      record.failures = 0;
      record.retryAt = 0;
    } catch (error) {
      if (!current() || error.diagnosticCode === 'REVIEW_DEFERRED') return;
      if (error.diagnosticCode === 'REVIEW_DAILY_BUDGET') record.error = 'budget';
      else if (batch.length > 1 && /CONTEXT_FULL|REVIEW_EXTRACTION_FAILED/.test(error.diagnosticCode || '')) {
        record.batchLimit = Math.ceil(batch.length / 2);
      } else {
        record.error = 'failed';
        record.failures++;
        record.retryAt = record.failures >= 3 ? null : clock() + 60_000 * record.failures;
        reportError(error,id);
      }
    } finally {
      try {
        if (records.get(id) === record) {
          record.lastRun = clock();
          await persist();
        }
      } finally { active = undefined; }
    }
  }

  async function tick() {
    await ready;
    if (ticking || !records.size || shouldYield()) return;
    ticking = true;
    try {
      const {projects} = await readLibrary();
      const byId = new Map(projects.map(project=>[project.id,project]));
      let removed = false;
      for (const [id] of records) if (!byId.has(id)) { records.delete(id); removed = true; }
      if (removed) await persist();
      for (const [id,record] of [...records].sort((a,b)=>(a[1].lastRun || 0) - (b[1].lastRun || 0))) {
        if (!record.enabled || !isAgentModel(record.model) || record.retryAt === null || record.retryAt > clock() ||
            record.error === 'budget' && record.day === dayOf(clock())) continue;
        if (records.get(id) !== record || shouldYield()) continue;
        const project = byId.get(id);
        const work = currentPlan(project,record);
        const liveUnits = new Map(work.plan.units.map(unit=>[unit.source,unit.key]));
        const liveLinks = new Map(work.pairs.map(pair=>[pair.source,pair.id]));
        // Keep cached results for a pause or same-model re-enable. Rewrites and exclusions invalidate their sources.
        let stale = false;
        for (const [key,{source}] of record.units) {
          const current = liveUnits.get(source);
          if (!current || key !== current && record.units.has(current)) { record.units.delete(key); stale = true; }
        }
        for (const [id,{source}] of record.links) {
          const current = liveLinks.get(source);
          if (!current && !work.missing.length || current && id !== current && record.links.has(current)) {
            record.links.delete(id);
            stale = true;
          }
        }
        if (stale) await persist();
        if (work.missing.length || work.pairs.some(pair=>!record.links.has(pair.id))) {
          if (!await hasKey(record.model) || records.get(id) !== record || shouldYield()) continue;
          await run(project,record,work);
          break;
        }
      }
    } finally {
      ticking = false;
    }
  }

  return {
    configure,status,tick,
    start() { timer ||= setInterval(()=>void tick().catch(reportError),intervalMs); timer.unref(); },
    stop() { clearInterval(timer); timer = undefined; active?.controller.abort(); }
  };
}
