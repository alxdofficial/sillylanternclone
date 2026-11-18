import assert from 'node:assert/strict';
import test from 'node:test';
import { runStoryFlow } from '../story-flow.mjs';
import { normalizeStoryFlow } from '../public/story-flow.js';

const options = [
  {title:'Check the ledger',direction:'Have Lina privately compare the dispatch entry with the timetable.'},
  {title:'Talk to Noor',direction:'Send Sam to ask Noor who borrowed the emergency radio.'},
  {title:'Meet the passenger',direction:'Focus the next scene on the last passenger approaching the dock.'}
];
const project = {
  title:'The Late Ferry',lore:'The night ferry is overdue.',notes:'Use third person.',
  messages:[
    {role:'assistant',content:'Lina arrived at the empty dock.',standalone:true},
    {role:'assistant',content:'WITHHELD PROSE MARKER',contentSensitivity:'explicit',standalone:true},
    {role:'assistant',content:'EXCLUDED PROSE MARKER',excludeFromContext:true,standalone:true}
  ]
};
function offer(choices,id = 'directions') {
  return {role:'assistant',content:null,tool_calls:[{
    id,type:'function',function:{name:'offer_story_directions',arguments:JSON.stringify({options:choices})}
  }]};
}

test('Story Flow offers options from current canon without mutating story state', async () => {
  const before = structuredClone(project);
  let round = 0;
  const result = await runStoryFlow(project,async (messages,tools)=>{
    assert.deepEqual(tools.map(tool=>tool.function.name),['inspect_continuity','offer_story_directions']);
    const context = JSON.stringify(messages);
    assert.match(context,/The night ferry is overdue/);
    assert.match(context,/Lina arrived at the empty dock/);
    assert.match(context,/Find the missing ticket/);
    assert.match(context,/A brass key lay under the ticket/);
    assert.doesNotMatch(context,/WITHHELD PROSE MARKER|EXCLUDED PROSE MARKER/);
    if (++round === 1) return {role:'assistant',content:null,tool_calls:[{
      id:'world',type:'function',function:{name:'inspect_continuity',arguments:'{"section":"world"}'}
    }]};
    assert.deepEqual(JSON.parse(messages.at(-1).content),{world:'The night ferry is overdue.'});
    return offer(options);
  }, {instruction:'Find the missing ticket.',prose:'A brass key lay under the ticket.'});
  assert.deepEqual(result,options);
  assert.deepEqual(project,before);
});

test('Story Flow uses safe continuity for a held scene and retries duplicate options', async () => {
  let attempts = 0;
  const result = await runStoryFlow(project,async messages=>{
    const context = JSON.stringify(messages);
    assert.match(context,/Lina decided to go home/);
    assert.doesNotMatch(context,/LATEST HELD (?:DIRECTION|PROSE)|WITHHELD PROSE MARKER|EXCLUDED PROSE MARKER/);
    if (++attempts === 1) return offer([options[0],{...options[1],title:'CHECK  THE LEDGER'},options[2]],'duplicate');
    assert.equal(messages.at(-1).tool_call_id,'duplicate');
    assert.match(messages.at(-1).content,/different title/);
    return offer(options);
  },{sensitive:true,instruction:'LATEST HELD DIRECTION',prose:'LATEST HELD PROSE',
    updates:[{kind:'plot',note:'Lina decided to go home.'}]});
  assert.equal(attempts,2);
  assert.deepEqual(result,options);
});

test('manual Story Flow uses the end of reading order and withholds a held ending',async()=>{
  const reordered = {...project,sceneBoard:{chapters:[[2,3,1]]}};
  await runStoryFlow(reordered,async messages=>{
    assert.equal(JSON.parse(messages.at(-1).content).latestProse,'Lina arrived at the empty dock.');
    return offer(options);
  });
  await runStoryFlow({...project,sceneBoard:{chapters:[[3,1,2]]}},async messages=>{
    assert.match(JSON.parse(messages.at(-1).content).scene,/latest passage is held/);
    assert.doesNotMatch(JSON.stringify(messages),/WITHHELD PROSE MARKER|EXCLUDED PROSE MARKER/);
    return offer(options);
  });
});

test('manual Story Flow checks the manuscript ending without a saved Scene Board',async()=>{
  await runStoryFlow({...project,messages:[project.messages[0]]},async messages=>{
    assert.equal(JSON.parse(messages.at(-1).content).latestProse,'Lina arrived at the empty dock.');
    return offer(options);
  });
  await runStoryFlow(project,async messages=>{
    assert.match(JSON.parse(messages.at(-1).content).scene,/latest passage is held/);
    assert.doesNotMatch(JSON.stringify(messages),/WITHHELD PROSE MARKER|EXCLUDED PROSE MARKER/);
    return offer(options);
  });
});

test('Story Flow rejects a prose-only response instead of accepting it as options', async () => {
  await assert.rejects(runStoryFlow(project,async()=>({text:'The ferry finally arrived.'})),{diagnosticCode:'STORY_FLOW_NOT_OFFERED'});
});

test('Story Flow retries four new options and preserves a selected fourth legacy option', async () => {
  const fourth = {title:'Call dispatch',direction:'Ask dispatch to confirm when the ferry cleared the harbor.'};
  const legacy = {source:'mcp',afterTurn:3,options:[...options,fourth]};
  let attempts = 0;
  const result = await runStoryFlow(project,async messages=>{
    if (++attempts === 1) return offer(legacy.options);
    assert.equal(messages.at(-1).role,'tool');
    return offer(options);
  });
  assert.equal(attempts,2);
  assert.deepEqual(result,options);
  assert.deepEqual(normalizeStoryFlow(legacy).options,options);
  const selected = normalizeStoryFlow({...legacy,selected:3});
  assert.equal(selected.options.length,3);
  assert.deepEqual(selected.options[selected.selected],fourth);
});
