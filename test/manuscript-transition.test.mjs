import assert from 'node:assert/strict';
import test from 'node:test';
import { planManuscriptTransition } from '../manuscript-transition.mjs';

const call = (name,args = {})=>({role:'assistant',tool_calls:[{id:name,type:'function',
  function:{name,arguments:JSON.stringify(args)}}]});
const read = ()=>call('read_transition_context');
const propose = args=>call('propose_transition',args);
const prose = (turnNumber,content,fields)=>({turnNumber,role:'assistant',content,...fields});

test('uses the new reading order with bounded scene excerpts and leaves the manuscript untouched',async()=>{
  const opening = 'Old opening. ', closing = ' The lighthouse went dark.';
  const selected = opening + 'x'.repeat(4200) + 'Not in the excerpt.' + 'y'.repeat(4200) + closing;
  const project = {id:'lantern',messages:[
    prose(1,'First scene as written.'),
    {turnNumber:2,role:'user',content:'Private author direction.'},
    prose(3, selected),
    prose(4,'z'.repeat(2000) + ' The tide is out.'),
    prose(5,'The ferryman arrived.' + 'q'.repeat(2000))
  ],sceneBoard:{chapters:[[1,4],[3,5]]}};
  const before = structuredClone(project);
  let requests = 0;
  const result = await planManuscriptTransition({project,turn:3,complete:async({messages,tools})=>{
    assert.deepEqual(tools.map(tool=>tool.function.name),['read_transition_context','propose_transition']);
    assert.doesNotMatch(JSON.stringify(messages),/Private author direction|Not in the excerpt|First scene as written/u);
    requests++;
    if (requests === 1) {
      assert.equal(messages.length,2);
      return read();
    }
    const context = JSON.parse(messages.at(-1).content);
    assert.equal(context.preceding.chapter,1);
    assert.equal(context.preceding.scene,2);
    assert.ok(context.preceding.excerpt.endsWith('The tide is out.'));
    assert.equal(context.preceding.excerpt.length,1500);
    assert.equal(context.moved.chapter,2);
    assert.equal(context.moved.scene,3);
    assert.ok(context.moved.opening.startsWith(opening));
    assert.ok(context.moved.closing.endsWith(closing));
    assert.equal(context.following.scene,4);
    assert.ok(context.following.excerpt.startsWith('The ferryman arrived.'));
    return propose({operation:'replace',anchor:'Old opening.',text:'Below the ebb-tide line, a lamp flickered.',
      reason:'The opening now picks up the tide cue from the previous chapter.'});
  }});
  assert.equal(requests,2);
  assert.deepEqual(result,{turn:3,original:selected,operation:'replace',
    text:selected.replace('Old opening.','Below the ebb-tide line, a lamp flickered.'),
    reason:'The opening now picks up the tide cue from the previous chapter.'});
  assert.deepEqual(project,before);
});

test('withholds unavailable neighbors and requires a context read before accepting any proposal',async()=>{
  const project = {id:'lantern',messages:[
    prose(1,'Held prose before the scene.',{excludeFromContext:true}),
    prose(2,'A gull settled above the quay.'),
    prose(3,'The ferryman tied the mooring rope.')
  ]};
  let requests = 0;
  const suggestion = await planManuscriptTransition({project,turn:2,complete:async({messages})=>{
    assert.doesNotMatch(JSON.stringify(messages),/Held prose/u);
    requests++;
    if (requests === 1) return propose({operation:'prepend',text:'A lantern burned.',reason:'Orient the reader.'});
    if (requests === 2) {
      assert.match(messages.at(-1).content,/before proposing/u);
      return read();
    }
    if (requests === 3) {
      const context = JSON.parse(messages.at(-1).content);
      assert.deepEqual(context.preceding,{status:'unavailable'});
      assert.match(context.following.excerpt,/mooring rope/u);
      return propose({operation:'prepend',text:'A lantern burned.',reason:'Orient the reader.'});
    }
    assert.match(messages.at(-1).content,/unavailable/u);
    return propose({operation:'append',text:'At the waterline, the mooring ropes began to creak.',
      reason:'The sound leads into the ferryman’s action.'});
  }});
  assert.deepEqual(suggestion,{turn:2,original:'A gull settled above the quay.',operation:'append',
    text:'At the waterline, the mooring ropes began to creak.',reason:'The sound leads into the ferryman’s action.'});
});

test('does not call a model for held targets or a scene with no eligible adjacent prose',async()=>{
  const project = {id:'lantern',messages:[
    prose(1,'Held prose.',{contentSensitivity:'unclassified'}),
    prose(2,'The ferryman arrived.'),
    prose(3,'Private prose.',{excludeFromContext:true})
  ]};
  const complete = ()=>assert.fail('This scene cannot trigger a provider request.');
  await assert.rejects(planManuscriptTransition({project,turn:1,complete}),{status:400,diagnosticCode:'TRANSITION_UNAVAILABLE'});
  assert.deepEqual(await planManuscriptTransition({project,turn:2,complete}),{turn:2,original:'The ferryman arrived.',
    operation:'none',text:'',reason:'There is no adjacent prose available for AI transition review.'});
});

test('rejects ambiguous or fabricated anchors and unrelated tool fields',async()=>{
  const project = {id:'lantern',messages:[prose(1,'A light glimmered.'),prose(2,'Hurry. The ferryman turned. Hurry.')]};
  let requests = 0;
  await assert.rejects(planManuscriptTransition({project,turn:2,complete:async({messages})=>{
    requests++;
    if (requests === 1) return read();
    if (requests === 2) return propose({operation:'replace',anchor:'Hurry.',text:'Wait.',reason:'Slow the transition.'});
    if (requests === 3) {
      assert.match(messages.at(-1).content,/unique opening or closing excerpt/u);
      return propose({operation:'replace',anchor:'Invented anchor.',text:'Wait.',reason:'Slow the transition.'});
    }
    assert.match(messages.at(-1).content,/unique opening or closing excerpt/u);
    return propose({operation:'none',text:'',reason:'No prose issue.',graphUpdate:{something:'No'}});
  }}),{diagnosticCode:'TRANSITION_PLAN_FAILED'});
  assert.equal(requests,4);
});
