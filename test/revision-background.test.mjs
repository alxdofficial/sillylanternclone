import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  assert.equal((await worker.status(project)).reviewed,1);
  await worker.configure(project,{enabled:false});
  worker = createBackgroundAnalysis(options);
  assert.equal((await worker.status(project)).state,'paused');
  await worker.configure(project,{model});
  await worker.tick();
  assert.equal(calls.length,1,'background eligibility alone preserves pause after restart');
  await worker.configure(project,{enabled:true});
  const done = await finish(worker);
  assert.equal(done.reviewed,3);
  assert.equal(done.held,1);
  assert.equal(seenPassages.filter(text=>text===opening).length,1);
  assert.equal(done.findings.threads[0].refs[1].turn,4);
  assert.deepEqual(project,original);

  const beforeUpgrade = calls.length;
  worker = createBackgroundAnalysis({...options,versions:{extract:1,link:2}});
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
  assert.equal(result.findings.pacing.length,4);
  assert.equal(result.findings.themes[0].refs.length,2);
  story.messages.find(turn=>turn.turnNumber === 8).content += ' Dawn was coming.';
  assert.equal(starterReview(story).findings.themes.length,1);
});
