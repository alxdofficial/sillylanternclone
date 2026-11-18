import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBackgroundAnalysis } from '../revision-background.mjs';
import { analysisBatch, planAnalysis } from '../revision-background-review.mjs';
import { estimateContextTokens } from '../public/prompt.js';
import { createStarterStory, starterReview } from '../examples/the-late-ferry.mjs';

const model = 'deepseek/deepseek-v4.1-flash';
const scene = (turnNumber,content,extra = {})=>({role:'assistant',standalone:true,content,turnNumber,contentSensitivity:'reviewed-safe',...extra});
const answer = (name,body)=>({role:'assistant',tool_calls:[{id:'fixture-call',type:'function',function:{name,arguments:JSON.stringify(body)}}]});

test('background review resumes checkpoints, backfills long scenes, and refreshes only affected evidence', async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-background-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const opening = 'The brass key waited in an envelope.';
  const payoff = 'The brass key opened the cabinet.';
  const held = 'A private passage which never enters a provider request.';
  const long = 'Wind drove waves past the ferry.\n\n'.repeat(2400);
  const project = {id:'fixture',title:'The Long Ferry',messages:[scene(1,opening),scene(2,long),
    scene(3,held,{excludeFromContext:true}),scene(4,payoff,{startsChapter:true})]};
  const original = structuredClone(project);
  const calls = [];
  const seenPassages = [];
  const options = {dataDir,readLibrary:async()=>({projects:[project]}),hasKey:async id=>id===model,
    complete:async ({messages,tools,model:chosen})=>{
      assert.equal(chosen,model);
      assert.doesNotMatch(JSON.stringify(messages),/private passage/);
      const name = tools[0].function.name;
      calls.push(name);
      const input = JSON.parse(messages[1].content);
      if (name === 'record_passage_observations') {
        seenPassages.push(...input.map(item=>item.text));
        return answer(name,{passages:input.map(({passage,text})=>({passage,observations:
          text===opening ? [{kind:'setup',topic:'the brass key',detail:'An unknown person left a key.',quote:opening}] :
          text===payoff ? [{kind:'payoff',topic:'brass key',detail:'The key opens the cabinet.',quote:payoff}] : []
        }))});
      }
      assert.equal(name,'record_passage_links');
      assert.deepEqual(input[0].evidence.map(({quote})=>quote),[opening,payoff]);
      return answer(name,{links:input.map(({pair})=>({pair,supportsFinding:true,title:'The brass key finds its lock',detail:'The cabinet is opened.'}))});
    }};
  const finish = async engine=>{
    for (let index=0; index<24; index++) {
      await engine.tick();
      const result = await engine.status(project);
      if (result.state === 'ready') return result;
    }
    assert.fail('Background review did not finish its fixture');
  };
  const planned = planAnalysis(project,model);
  assert.ok(estimateContextTokens(long) > 24000);
  assert.ok(planned.units.filter(unit=>unit.scene.turn === 2).length > 2);
  assert.equal(planned.units.filter(unit=>unit.scene.turn === 2).map(unit=>unit.text).join(''),long);
  assert.ok(analysisBatch(planned.units,model).length < planned.units.length);

  let worker = createBackgroundAnalysis(options);
  const initially = await worker.status(project);
  assert.equal(initially.enabled,true);
  assert.equal(initially.state,'waiting-model');
  await worker.configure(project,{model});
  await worker.tick();
  assert.equal(calls.length,1);
  const started = await worker.status(project);
  assert.equal(started.reviewed,1);
  assert.equal(started.progress.phase,'reading');
  assert.equal(started.progress.total,planned.units.length);
  assert.ok(started.progress.completed > 0 && started.progress.completed < started.progress.total);
  assert.equal(started.progress.etaSeconds,undefined);
  await worker.configure(project,{enabled:false});
  worker = createBackgroundAnalysis(options);
  assert.equal((await worker.status(project)).state,'paused');
  await worker.configure(project,{model});
  await worker.tick();
  assert.equal(calls.length,1,'background eligibility alone preserves pause after restart');
  await worker.configure(project,{enabled:true});
  await worker.tick();
  const progressing = await worker.status(project);
  assert.ok(progressing.progress.completed > started.progress.completed);
  assert.ok(progressing.progress.etaSeconds > 0);
  const done = await finish(worker);
  assert.equal(done.progress.completed,done.progress.total);
  assert.equal(done.progress.etaSeconds,undefined);
  assert.equal(done.reviewed,3);
  assert.equal(done.held,1);
  assert.equal(seenPassages.filter(text=>text===opening).length,1);
  assert.equal(done.findings.threads[0].refs[1].turn,4);
  assert.deepEqual(project,original);

  const beforeUpgrade = calls.length;
  worker = createBackgroundAnalysis({...options,versions:{extract:1,link:3}});
  const awaitingUpgrade = await worker.status(project);
  assert.equal(awaitingUpgrade.reviewed,3);
  assert.equal(awaitingUpgrade.linksRemaining,1);
  assert.equal(awaitingUpgrade.findings.threads.length,1,'verified source is still visible while linking refreshes');
  await finish(worker);
  assert.deepEqual(calls.slice(beforeUpgrade),['record_passage_links']);

  project.messages.push(scene(5,'The former passenger went home.'));
  const beforeAppend = seenPassages.length;
  await finish(worker);
  assert.deepEqual(seenPassages.slice(beforeAppend),['The former passenger went home.']);
  project.messages[3].excludeFromContext = true;
  const screened = await finish(worker);
  assert.equal(screened.held,2);
  assert.equal(screened.findings.threads[0].refs.length,1);
  const cache = await readFile(join(dataDir,'writing-analysis','cache.json'),'utf8');
  assert.doesNotMatch(cache,/Wind drove waves|private passage/);
});

test('a passage hidden while its analysis was running never enters saved findings', async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-background-withdrawn-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const text = 'The signal was a long bell.';
  const project = {id:'fixture',messages:[scene(1,text)]};
  const worker = createBackgroundAnalysis({dataDir,readLibrary:async()=>({projects:[project]}),hasKey:async()=>true,
    complete:async()=>{
      project.messages[0].excludeFromContext = true;
      return answer('record_passage_observations',{passages:[{passage:1,observations:[
        {kind:'pacing',topic:'The bell',detail:'A pause ends.',quote:text}
      ]}]});
    }});
  await worker.configure(project,{model});
  await worker.tick();
  assert.deepEqual((await worker.status(project)).findings.pacing,[]);
  project.messages[0].excludeFromContext = false;
  assert.equal((await worker.status(project)).reviewed,0);
});

test('starter evidence is present without a provider and drops an edited anchor',()=>{
  const story = createStarterStory();
  const result = starterReview(story);
  assert.equal(result.state,'demo');
  assert.equal(result.findings.pacing.length,6);
  assert.equal(result.findings.themes[0].refs.length,2);
  assert.equal(result.continuityExample.refs.length,2);
  assert.match(result.findings.continuity[0].title,/horn/iu);
  story.messages.find(turn=>turn.turnNumber === 8).content += ' Dawn was coming.';
  assert.equal(starterReview(story).findings.themes.length,2);
});

test('background continuity reports checked pairs and links differently phrased claims about the same subject',async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-continuity-pairs-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const sources = ['Only twelve passengers boarded the night ferry.','Twenty passengers boarded the night ferry.'];
  const project = {id:'fixture',messages:sources.map((content,i)=>scene(i+1,content,{storyTime:'1998-10-25T00:10'}))};
  const worker = createBackgroundAnalysis({dataDir,readLibrary:async()=>({projects:[project]}),hasKey:async()=>true,
    complete:async({messages,tools})=>{
      const name = tools[0].function.name;
      if (name === 'record_passage_observations') return answer(name,{passages:sources.map((quote,index)=>({passage:index+1,
        observations:[{kind:'continuity',topic:index ? 'night ferry headcount' : 'night ferry passengers',detail:'Passenger count at 00:10.',quote}]}))});
      const [pair] = JSON.parse(messages[1].content);
      assert.deepEqual(pair.evidence.map(item=>item.quote),sources);
      return answer(name,{links:[{pair:1,supportsFinding:true,title:'Passenger count differs',detail:'The two scenes report different counts at the same time.'}]});
    }});
  await worker.configure(project,{model});
  await worker.tick();
  const comparing = await worker.status(project);
  assert.equal(comparing.continuityChecked,0);
  assert.deepEqual(comparing.progress,{phase:'comparing',completed:0,total:1,etaSeconds:undefined});
  await worker.tick();
  const result = await worker.status(project);
  assert.equal(result.state,'ready');
  assert.equal(result.continuityPairs,1);
  assert.equal(result.continuityChecked,1);
  assert.deepEqual(result.findings.continuity[0].refs.map(ref=>ref.turn),[1,2]);
});

test('editing the end of a long scene reuses unchanged passages with current citation anchors',async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-passage-reuse-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const opening = 'The red flag fell.';
  const project = {id:'fixture',messages:[scene(1,opening + '\n' + 'Rain crossed the deck.\n'.repeat(2200))]};
  const seen = [];
  const options = {dataDir,readLibrary:async()=>({projects:[project]}),hasKey:async()=>true,
    complete:async({messages})=>{
      const batch = JSON.parse(messages[1].content);
      seen.push(...batch.map(row=>row.text));
      return answer('record_passage_observations',{passages:batch.map(({passage,text})=>({passage,
        observations:text.includes(opening) ? [{kind:'pacing',topic:'The flag',detail:'The signal interrupts the crossing.',quote:opening}] : []}))});
    }};
  let worker = createBackgroundAnalysis(options);
  await worker.configure(project,{model});
  for (let i=0;i<8;i++) await worker.tick();
  assert.equal((await worker.status(project)).state,'ready');
  const before = seen.length;
  worker = createBackgroundAnalysis(options);
  project.messages[0].content += 'Morning arrived.';
  await worker.tick();
  const result = await worker.status(project);
  assert.equal(result.state,'ready');
  assert.equal(seen.length - before,1);
  assert.ok(seen.at(-1).endsWith('Morning arrived.'));
  assert.equal(result.findings.pacing[0].refs[0].fingerprint,planAnalysis(project,model).scenes[0].fingerprint);
});

test('multibyte prose and JSON escapes fit the background batch estimate without losing characters',()=>{
  const text = ('渡'.repeat(5) + '🚢\u0001').repeat(4000);
  const {units} = planAnalysis({id:'many-bytes',messages:[scene(1,text)]},model);
  assert.equal(units.map(unit=>unit.text).join(''),text);
  for (const unit of units) {
    assert.ok(estimateContextTokens(JSON.stringify(unit.text)) + 80 <= 9200);
    assert.doesNotMatch(unit.text,/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  }
});

test('idle polls reuse disk-versioned sources and deferred calls release their budget reservation',async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-review-idle-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  let version = 1, reads = 0, attempts = 0;
  const story = {id:'fixture',messages:[scene(1,'A signal from shore.')]};
  const worker = createBackgroundAnalysis({dataDir,libraryVersion:async()=>version,
    readLibrary:async()=>{ reads++; return {projects:[structuredClone(story)]}; },
    hasKey:async()=>true,complete:async()=>{
      if (++attempts === 1) throw Object.assign(new Error('foreground request'),{diagnosticCode:'REVIEW_DEFERRED'});
      return answer('record_passage_observations',{passages:[{passage:1,observations:[]}]});
    }});
  const current = ()=>worker.projectById(story.id);
  await worker.configure(await current(),{model});
  await worker.tick();
  assert.equal((await worker.status(await current())).estimatedUsd,0);
  await worker.tick();
  const completed = await worker.status(await current());
  assert.equal(completed.state,'ready');
  assert.ok(completed.estimatedUsd > 0);
  for (let i=0;i<12;i++) {
    await worker.tick();
    assert.equal((await worker.status(await current())).state,'ready');
  }
  assert.equal(attempts,2);
  assert.equal(reads,1);
  story.messages[0].excludeFromContext = true;
  version++;
  await worker.tick();
  assert.equal((await worker.status(await current())).held,1);
  assert.equal(reads,2);
});

test('a model switch verifies its own links and restores previous paid work when switched back',async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-review-models-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const story = {id:'fixture',messages:[scene(1,'The gate was sealed.'),scene(2,'The gate was unlocked.'),scene(3,'The gate was welded shut.')]};
  const batches = [];
  const options = {dataDir,readLibrary:async()=>({projects:[story]}),hasKey:async()=>true,
    complete:async({model:selected,messages,tools})=>{
      const rows = JSON.parse(messages[1].content);
      const name = tools[0].function.name;
      batches.push([selected,name,rows.length]);
      if (name === 'record_passage_observations') return answer(name,{passages:rows.map(({passage,text})=>({passage,
        observations:[{kind:'continuity',topic:'Gate state',detail:'A described gate condition.',quote:text}]}))});
      if (rows.length > 1) throw Object.assign(new Error('cut short'),{diagnosticCode:'AGENT_TOOL_OUTPUT_TRUNCATED'});
      return answer(name,{links:[{pair:1,supportsFinding:true,title:selected,detail:'Check the gate.'}]});
    }};
  let worker = createBackgroundAnalysis(options);
  const other = 'gpt-6.1-terra';
  for (const selected of [model,other]) {
    await worker.configure(story,{model:selected});
    assert.equal((await worker.status(story)).findings.continuity.length,0);
    for (let i=0;i<10;i++) await worker.tick();
    const result = await worker.status(story);
    assert.equal(result.state,'ready');
    assert.equal(result.findings.continuity.length,3);
    assert.ok(result.findings.continuity.every(item=>item.title === selected));
    assert.deepEqual(batches.filter(row=>row[0]===selected && row[1]==='record_passage_links').map(row=>row[2]),[3,2,1,1,1]);
  }
  const count = batches.length;
  worker = createBackgroundAnalysis(options);
  await worker.configure(story,{model});
  await worker.tick();
  assert.equal((await worker.status(story)).state,'ready');
  assert.equal(batches.length,count);
});

test('legacy cache keeps paid passage extractions and verifies links whose model was never recorded',async t=>{
  const dataDir = await mkdtemp(join(tmpdir(),'studio-review-legacy-'));
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const story = {id:'fixture',messages:[scene(1,'The gate was sealed.'),scene(2,'The gate stood open.')]};
  const stages = [];
  const options = {dataDir,readLibrary:async()=>({projects:[story]}),hasKey:async()=>true,complete:async({messages,tools})=>{
    const name = tools[0].function.name;
    stages.push(name);
    if (name === 'record_passage_observations') return answer(name,{passages:JSON.parse(messages[1].content).map(({passage,text})=>({passage,
      observations:[{kind:'continuity',topic:'Gate state',detail:'The gate condition was observed.',quote:text}]}))});
    return answer(name,{links:[{pair:1,supportsFinding:false,title:'',detail:''}]});
  }};
  let worker = createBackgroundAnalysis(options);
  await worker.configure(story,{model});
  await worker.tick();
  await worker.tick();
  const path = join(dataDir,'writing-analysis','cache.json');
  const cache = JSON.parse(await readFile(path,'utf8'));
  const record = cache.records[0][1];
  record.units = record.units.map(([key,{source,items}])=>[key,{source,items}]);
  record.links = record.links.map(([key,{source,finding}])=>[key.slice(model.length+1),{source,finding}]);
  await writeFile(path,JSON.stringify(cache));
  worker = createBackgroundAnalysis(options);
  const restored = await worker.status(story);
  assert.equal(restored.reviewed,2);
  assert.equal(restored.linksRemaining,1);
  await worker.tick();
  assert.equal((await worker.status(story)).state,'ready');
  assert.deepEqual(stages,['record_passage_observations','record_passage_links','record_passage_links']);
});
