import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isAgentModel, models } from './public/models.js';
import { starterStoryId } from './public/library.js';
import { estimateContextTokens } from './public/prompt.js';
import { reviewFindingId } from './public/revision.js';
import { analysisBatch, analysisOutputLimit, analysisPairs, analysisVersions, extractAnalysis, hashAnalysis, planAnalysis, verifyAnalysis } from './revision-background-review.mjs';

export const analysisDailyBudget = 1;
const cacheVersion = 1;
const comparisonBatchSize = 6;
const dayOf = time => new Date(time).toISOString().slice(0,10);
const stop = code => Object.assign(new Error(code),{diagnosticCode:code});

export function createBackgroundAnalysis({dataDir,readLibrary,libraryVersion,hasKey,complete,shouldYield = ()=>false,
  reportError = ()=>{},clock = Date.now,intervalMs = 5000,versions = analysisVersions,cache,defaultEnabled = true}) {
  const directory = join(dataDir,'writing-analysis');
  const path = join(directory,'cache.json');
  let records = new Map(), active, writes = Promise.resolve(), ticking = false;
  let timer, snapshot;
  const plans = new WeakMap();
  const progress = new WeakMap();
  const settled = new WeakSet();

  async function library() {
    if (!libraryVersion) return readLibrary();
    const version = await libraryVersion();
    if (snapshot?.version === version) return snapshot.library;
    const saved = await readLibrary();
    snapshot = {version,library:saved};
    return saved;
  }

  async function projectById(id) {
    return (await library()).projects.find(project=>project.id === id);
  }
  const ready = Promise.resolve().then(()=>cache ? cache.read() : readFile(path,'utf8').then(JSON.parse)).then(saved=>{
    if (!saved) return;
    records = new Map(saved.records.map(([id,record])=>[id,{
      ...record, units:new Map(saved.version === cacheVersion ? record.units.map(([key,entry])=>{
        const model = entry.model ?? models.find(candidate=>hashAnalysis([versions.extract,candidate.id,entry.source]) === key)?.id;
        return [key,{...entry,model}];
      }) : []),
      // Legacy link IDs recorded no verifying model. Recheck these once with the selected model.
      links:new Map(saved.version === cacheVersion ? record.links.filter(([,entry])=>entry.model) : [])
    }]));
  }).catch(error=>{ if (error.code !== 'ENOENT') reportError(error); });

  function persist() {
    const operation = writes.then(async ()=>{
      const snapshot = {version:cacheVersion,records:[...records].map(([id,record])=>[id,{
        ...record,units:[...record.units],links:[...record.links]
      }])};
      if (cache) return cache.write(snapshot);
      await mkdir(directory,{recursive:true,mode:0o700});
      const temporary = join(directory,`.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary,JSON.stringify(snapshot),{mode:0o600});
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
    const next = enabled ?? record?.enabled ?? defaultEnabled;
    const selected = model || record?.model;
    if (record && record.enabled === next && record.model === selected && !retry) return;
    if (active?.id === project.id) active.controller.abort();
    const previous = record || {units:new Map(),links:new Map()};
    records.set(project.id,{...previous,enabled:next,model:selected,failures:0,retryAt:0,error:undefined,
      batchLimit:previous.model === selected ? previous.batchLimit : undefined,
      linkBatchLimit:previous.model === selected ? previous.linkBatchLimit : undefined,
      timings:previous.model === selected ? previous.timings : undefined});
    await persist();
  }

  function currentPlan(project,record) {
    // Only disk-versioned snapshots are immutable. Injected readers can return mutable objects.
    const cached = libraryVersion && plans.get(project);
    const generation = progress.get(record) || 0;
    if (cached && cached.record === record && cached.generation === generation) return cached.work;
    const plan = cached?.plan && cached.model === record?.model ? cached.plan : planAnalysis(project,record?.model,versions);
    const saved = record?.units || new Map();
    const available = new Map(saved);
    const reusable = new Map([...saved.values()].filter(entry=>entry.reuseKey).map(entry=>[entry.reuseKey,entry]));
    const refreshed = new Map();
    for (const unit of plan.units) {
      if (!unit.reuseKey) continue;
      const old = saved.get(unit.key);
      const entry = old || reusable.get(unit.reuseKey);
      if (!entry || old?.reuseKey) continue;
      const items = entry.items.map(item=>({...item,ref:{...item.ref,fingerprint:unit.scene.fingerprint}}));
      const current = {...entry,source:unit.source,reuseKey:unit.reuseKey,items};
      available.set(unit.key,current);
      refreshed.set(unit.key,current);
    }
    const missing = plan.units.filter(unit=>!available.has(unit.key));
    const outstanding = new Set(missing.map(unit=>unit.scene.turn));
    const observations = new Map(plan.units.flatMap(unit=>available.has(unit.key) ? [[unit.key,available.get(unit.key).items]] : []));
    const pairs = analysisPairs(plan,observations,versions);
    const work = {plan,available,missing,pairs,outstanding,refreshed};
    if (libraryVersion) plans.set(project,{model:record?.model,plan,record,generation,work});
    return work;
  }

  function findings({plan,available,pairs},record) {
    const result = {pacing:[],themes:[],threads:[],continuity:[]};
    const linked = new Set();
    const previousLinks = new Map([...(record?.links.values() || [])].filter(entry=>entry.model === record?.model).map(entry=>[entry.source,entry.finding]));
    for (const pair of pairs) {
      const found = record?.links.has(pair.id) ? record.links.get(pair.id).finding : previousLinks.get(pair.source);
      if (!found) continue;
      result[found.kind].push(found);
      if (found.kind === 'threads') linked.add(JSON.stringify(found.refs[0]));
    }
    const previousUnits = new Map([...available.values()].filter(entry=>entry.model === record?.model).map(entry=>[entry.source,entry.items]));
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
    const continuityPairs = pairs.filter(pair=>pair.kind === 'continuity');
    const day = dayOf(clock());
    const estimatedUsd = record?.day === day ? record.reserved || 0 : 0;
    let state = 'waiting-model';
    if (!(record?.enabled ?? defaultEnabled)) state = 'paused';
    else if (!total) state = 'empty';
    else if (record?.model && !missing.length && !due) state = 'ready';
    else if (active?.id === project.id) state = 'running';
    else if (record?.error === 'budget' && record.day === day) state = 'budget';
    else if (record?.error === 'failed' && record.retryAt === null) state = 'failed';
    else if (record?.model && await hasKey(record.model)) state = record.error === 'failed' && record.retryAt > clock() ? 'retrying' : 'queued';
    const phase = missing.length ? 'reading' : 'comparing';
    const workTotal = phase === 'reading' ? plan.units.length : pairs.length;
    const remaining = phase === 'reading' ? missing.length : due;
    const samples = record?.timings?.[phase] || [];
    const etaSeconds = (state === 'running' || state === 'queued') && samples.length >= 2
      ? Math.ceil(remaining * samples.reduce((sum,sample)=>sum + sample.ms,0) / samples.reduce((sum,sample)=>sum + sample.count,0) / 1000)
      : undefined;
    return {state,enabled:record?.enabled ?? defaultEnabled,model:record?.model,reviewed:total - outstanding.size,total,
      held:plan.scenes.length - total,linksRemaining:due,continuityPairs:continuityPairs.length,
      continuityChecked:continuityPairs.filter(pair=>record?.links.has(pair.id)).length,
      progress:{phase,completed:workTotal - remaining,total:workTotal,etaSeconds},
      estimatedUsd,dailyBudget:analysisDailyBudget,findings:findings(work,record)};
  }

  function reserve(record,messages,tools) {
    const rates = models.find(item=>item.id === record.model);
    const input = estimateContextTokens(JSON.stringify({messages,tools}));
    const estimate = (input * rates.input + analysisOutputLimit * rates.output) / 1_000_000;
    const day = dayOf(clock());
    if (record.day !== day) { record.day = day; record.reserved = 0; }
    if (record.reserved + estimate > analysisDailyBudget) throw stop('REVIEW_DAILY_BUDGET');
    record.reserved += estimate;
    return {day,estimate};
  }

  async function run(project,record,work) {
    const {missing,pairs} = work;
    const links = missing.length ? [] : pairs.filter(pair=>!record.links.has(pair.id)).slice(0,record.linkBatchLimit ?? comparisonBatchSize);
    const batch = missing.length ? analysisBatch(missing,record.model).slice(0,record.batchLimit) : [];
    if (!batch.length && !links.length) return;
    const id = project.id, controller = new AbortController();
    const started = clock();
    active = {id,controller};
    const current = () => records.get(id) === record && record.enabled && !controller.signal.aborted;
    const verifySources = async (requireAll = true) => {
      if (!current()) throw stop('REVIEW_DEFERRED');
      const latest = await projectById(id);
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
        const {day,estimate} = reserve(record,messages,tools);
        let submitted = false;
        try {
          await persist();
          await verifySources();
          if (shouldYield()) throw stop('REVIEW_DEFERRED');
          submitted = true;
          return await complete({storyId:id,model:record.model,messages,tools,signal:controller.signal});
        } catch (error) {
          // A deferred request never reached the provider. Retain estimates for ambiguous transport failures.
          if (!submitted || ['REVIEW_DEFERRED','AGENT_CONTEXT_FULL'].includes(error.diagnosticCode)) {
            const owner = records.get(id);
            if (owner?.day === day) owner.reserved = Math.max(0,owner.reserved - estimate);
            await persist();
          }
          throw error;
        }
      };
      const results = batch.length ? await extractAnalysis(batch,request) : await verifyAnalysis(links,request);
      const surviving = await verifySources(false);
      if (batch.length) {
        for (const {key,source,reuseKey} of batch) if (surviving.has(key)) {
          record.units.set(key,{model:record.model,source,reuseKey,items:results[key]});
        }
      } else {
        for (const {id,source,evidence} of links) if (surviving.has(id)) {
          record.links.set(id,{model:record.model,source,refs:evidence.map(({item})=>item.ref),finding:results[id]});
        }
      }
      progress.set(record,(progress.get(record) || 0) + 1);
      record.error = undefined;
      record.failures = 0;
      record.retryAt = 0;
      const phase = batch.length ? 'reading' : 'comparing';
      const count = (batch.length ? batch : links).filter(item=>surviving.has(item.key || item.id)).length;
      if (count) {
        record.timings ||= {};
        const history = record.timings[phase] || [];
        record.timings[phase] = [...history.slice(-5),{count,ms:Math.max(intervalMs,clock()-started)}];
      }
    } catch (error) {
      if (!current() || error.diagnosticCode === 'REVIEW_DEFERRED') return;
      if (error.diagnosticCode === 'REVIEW_DAILY_BUDGET') record.error = 'budget';
      else if (batch.length > 1 && /CONTEXT_FULL|AGENT_TOOL_OUTPUT_TRUNCATED|REVIEW_EXTRACTION_FAILED/.test(error.diagnosticCode || '')) {
        record.batchLimit = Math.ceil(batch.length / 2);
      } else if (links.length > 1 && /CONTEXT_FULL|AGENT_TOOL_OUTPUT_TRUNCATED|REVIEW_LINK_FAILED/.test(error.diagnosticCode || '')) {
        record.linkBatchLimit = Math.ceil(links.length / 2);
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
      const {projects} = await library();
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
        if (settled.has(work)) continue;
        const liveUnits = new Map(work.plan.units.map(unit=>[unit.source,unit.key]));
        const fingerprints = new Map(work.plan.scenes.filter(scene=>scene.eligible).map(scene=>[scene.turn,scene.fingerprint]));
        const liveLinks = new Map(work.pairs.map(pair=>[pair.source,pair.id]));
        // Keep cached results for a pause or same-model re-enable. Rewrites and exclusions invalidate their sources.
        let stale = work.refreshed.size > 0;
        for (const [key,entry] of work.refreshed) record.units.set(key,entry);
        for (const [key,{source,model}] of record.units) {
          const current = liveUnits.get(source);
          if (!current || model === record.model && key !== current && record.units.has(current)) { record.units.delete(key); stale = true; }
        }
        for (const [id,{source,model,refs,finding}] of record.links) {
          if (model !== record.model) {
            const evidence = refs || finding?.refs;
            if (!evidence || evidence.some(ref=>fingerprints.get(ref.turn) !== ref.fingerprint)) {
              record.links.delete(id);
              stale = true;
            }
            continue;
          }
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
        settled.add(work);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    configure,status,tick,projectById,
    start() { timer ||= setInterval(()=>void tick().catch(reportError),intervalMs); timer.unref(); },
    stop() { clearInterval(timer); timer = undefined; active?.controller.abort(); }
  };
}
