import assert from 'node:assert/strict';
import test from 'node:test';
import { createStarterStory } from '../examples/the-late-ferry.mjs';
import { buildReview, createRevisionReviewer } from '../revision-review.mjs';
import { branchRevisionNotes, continuityChecks, motifOccurrences, normalizeRevisionNotes, pacingRows, reference, resolveReference, resolveReferenceRange, sceneIndex, selectScenes } from '../public/revision.js';
import { findRecurringDetails, manuscriptHeatmap, passageSignals, proseHighlights } from '../public/revision-signals.js';

const story = {
  id:'fixture',title:'The Pier',lore:'The pier has a storeroom.',notes:'',
  cast:[{id:'ada',name:'Ada',nickname:'Adele',description:''}],
  plotEvents:[{turn:100,note:'The lantern was moved.',storyTime:'2001-05-01T00:30'}],
  messages:[
    {role:'assistant',turnNumber:1,storyTime:'2001-05-01T21:30',content:'Ada said, “The blue light is mine.”'},
    {role:'assistant',turnNumber:2,storyTime:'2001-05-01T20:30',startsChapter:true,content:'The blue light was in Adele’s store.'},
    {role:'user',turnNumber:3,contentSensitivity:'unclassified',content:'Private direction.'},
    {role:'assistant',turnNumber:4,content:'This passage follows a withheld direction.'},
    {role:'assistant',turnNumber:5,contentSensitivity:'explicit',content:'Private prose.'},
    {role:'assistant',turnNumber:6,excludeFromContext:true,content:'Do not send this text.'}
  ]
};

test('review scope follows the manuscript order while context eligibility follows the original direction',()=>{
  const project = {...story,sceneBoard:{chapters:[[4,2],[1,6,5]]}};
  const scenes = sceneIndex(project);
  assert.deepEqual(scenes.map(scene=>scene.turn),[4,2,1,6,5]);
  assert.deepEqual(selectScenes(scenes,'chapter:1').map(scene=>scene.eligible),[false,true]);
  assert.deepEqual(story.messages.map(turn=>turn.turnNumber),[1,2,3,4,5,6]);
});

test('scene index follows the book and revision references detect prose edits', () => {
  const scenes = sceneIndex(story);
  assert.deepEqual(scenes.map(scene=>[scene.turn,scene.chapter,scene.eligible]),[
    [1,1,true],[2,2,true],[4,2,false],[5,2,false],[6,2,false]
  ]);
  assert.equal(pacingRows(story,scenes)[1].mentions[0],'Ada');
  assert.ok(pacingRows(story,scenes)[0].dialogue > 0);
  const refs = motifOccurrences(scenes,'Blue Light').map(({ref})=>ref);
  assert.equal(refs.length,2);
  assert.equal(resolveReference(refs[0],scenes[0]),'blue light');
  const edited = structuredClone(story);
  edited.messages[0].content += ' New line.';
  assert.equal(resolveReference(refs[0],sceneIndex(edited)[0]),undefined);
  const notes = [{id:'thread',kind:'thread',title:'A light goes missing',refs:scenes.slice(0,2).map(scene=>reference(scene))}];
  assert.deepEqual(continuityChecks(story,scenes,'chapter:1',notes).map(({title})=>title),['Payoff is dated before its setup']);
  assert.equal(continuityChecks(story,scenes,'book',notes).length,2);
  const branch = {...story,id:'branch',revisionNotes:notes};
  branchRevisionNotes(branch,story.id);
  assert.equal(branch.revisionNotes[0].refs[0].storyId,'branch');
});

test('saved passage anchors relocate uniquely and grouped notes retain surviving evidence on a branch', () => {
  const scenes = sceneIndex(story);
  const refs = motifOccurrences(scenes.slice(0,2),'blue light').map(({ref})=>({...ref,quote:'blue light'}));
  const saved = normalizeRevisionNotes([
    {id:'theme',kind:'theme',title:'Light',refs},
    {id:'thread',kind:'thread',title:'Light returns',refs,status:'shelved'}
  ]);
  assert.equal(saved[0].refs.length,2);
  assert.equal(saved[1].status,'shelved');
  const edited = structuredClone(story);
  edited.messages[0].content = 'Earlier. ' + edited.messages[0].content;
  const shifted = sceneIndex(edited)[0];
  assert.deepEqual(resolveReferenceRange(saved[0].refs[0],shifted),{start:refs[0].start + 9,end:refs[0].end + 9});
  edited.messages[0].content += ' The blue light.';
  assert.equal(resolveReference(saved[0].refs[0],sceneIndex(edited)[0]),undefined);
  const branch = {...story,id:'branch',messages:story.messages.slice(0,1),revisionNotes:saved};
  branchRevisionNotes(branch,story.id);
  assert.deepEqual(branch.revisionNotes.map(note=>[note.id,note.refs.length,note.refs[0].storyId]),[
    ['theme',1,'branch'],['thread',1,'branch']
  ]);
});

test('AI review filters held passages, rejects invented quotes, and reuses identical reads', async () => {
  const review = createRevisionReviewer();
  let calls = 0;
  const run = async messages=>{
    calls++;
    const source = JSON.parse(messages[1].content);
    assert.equal(source.passages.length,2);
    assert.doesNotMatch(messages[1].content,/Private|withheld direction|Do not send/);
    if (calls === 2) assert.match(messages.at(-1).content,/exact quotes/);
    return {tool_calls:[{type:'function',id:String(calls),function:{
      name:'submit_revision_findings',
      arguments:JSON.stringify({findings:[{title:'Light',detail:'Check whether this is the same light.',
        citations:[{passage:1,quote:calls === 1 ? 'Invented quote.' : 'The blue light is mine.'},{passage:2,quote:'The blue light was in Adele’s store.'}]}]})
    }}]};
  };
  const options = {kind:'continuity',scope:'book',model:'gpt-6.1-terra'};
  const result = await review(story,options,run);
  assert.equal(result.findings[0].refs.length,2);
  assert.equal((await review(story,options,run)).cached,true);
  assert.equal(calls,2);
});

test('theme discovery needs no search phrase and respects the selected chapter', () => {
  const options = {kind:'themes',scope:'chapter:2',model:'gpt-6.1-terra'};
  const discovery = buildReview(story,options);
  assert.match(discovery.messages[2].content,/Suggest distinct themes or motifs/);
  const source = JSON.parse(discovery.messages[1].content);
  assert.equal(source.theme,undefined);
  assert.equal(source.passages.length,1);
  assert.equal(source.passages[0].chapter,2);
  const search = buildReview(story,{...options,query:'blue light'});
  assert.match(search.messages[2].content,/requested motif or theme/);
  assert.equal(JSON.parse(search.messages[2].content).theme,'blue light');
});
test('local signals cite exact recurring details across scenes and refresh after an edit', () => {
  const project = {id:'signals',messages:[
    {role:'assistant',content:'The brass key lay on the folded chart inside the narrow drawer.\n\nThe brass key was cold.'},
    {role:'assistant',content:'Hana recovered the brass key under the folded chart beside the narrow drawer.'}
  ]};
  const scenes = sceneIndex(project);
  assert.equal(findRecurringDetails(scenes.slice(0,1)).length,0);
  const detail = findRecurringDetails(scenes).find(detail=>detail.term === 'brass key');
  assert.equal(detail.count,2);
  assert.deepEqual(detail.refs.map((ref,index)=>resolveReference(ref,scenes[index])),['brass key','brass key']);
  const echo = passageSignals(scenes).find(signal=>signal.kind === 'echo');
  assert.equal(echo.ref.turn,2);
  assert.equal(echo.comparison.turn,1);
  assert.ok(resolveReference(echo.ref,scenes[1]).startsWith('Hana recovered'));
  project.messages[1].content = 'Rain filled the harbor.';
  assert.deepEqual(findRecurringDetails(sceneIndex(project)),[]);
  assert.deepEqual(passageSignals(sceneIndex(project)),[]);
});

test('manuscript heatmap marks exact later phrases and distinguishes stronger anchored density',()=>{
  const project = {id:'heatmap',cast:[{id:'ada',name:'Ada Bell',description:''}],messages:[
    {role:'assistant',content:'The brass cabinet key fell beside the lamp.'},
    {role:'assistant',startsChapter:true,content:'She lifted the brass cabinet key.\n\nAt 23:15 Ada Bell counted 37 passengers, located both exits, and recorded the departure alongside the dockmaster.\n\nSlowly, waves smoothed loose stones around the headland as distant sparrows gathered near driftwood.'}
  ]};
  const scenes = sceneIndex(project);
  const result = manuscriptHeatmap(project,scenes,[scenes[1]]);
  assert.deepEqual(result.repetition.strong.map(ref=>resolveReference(ref,scenes[1])),['the brass cabinet key']);
  assert.ok(result.density.high.some(ref=>resolveReference(ref,scenes[1]).includes('37 passengers')));
  assert.ok(result.density.high.every(ref=>!resolveReference(ref,scenes[1]).includes('sparrows')));
  assert.deepEqual(manuscriptHeatmap(project,scenes,[scenes[0]]).repetition.strong,[]);
});

test('ordinary prose stays mostly unshaded even when subtler detail density is enabled',()=>{
  const project = createStarterStory();
  const scenes = sceneIndex(project);
  const paragraphs = scenes.flatMap(scene=>scene.text.trim().split(/\n\s*\n/u)).length;
  const {density} = manuscriptHeatmap(project,scenes,scenes);
  assert.deepEqual(manuscriptHeatmap(project,scenes,scenes,{repetition:false}),{density});
  assert.ok(density.high.length > 0);
  assert.ok(density.high.length <= Math.floor(paragraphs * .10));
  assert.ok(density.high.length + density.medium.length <= Math.floor(paragraphs * .25));
});

test('local prose signals cite long sentences, repeated openings, and contiguous dialogue only',()=>{
  const long = 'The harbor crew waited ' + 'while the tide rose behind the breakwater '.repeat(6).trim() + '.';
  const exchange = '“Listen.”\n\n“Which bell?”\n\n“The outer one.”\n\n“Then stay here.”';
  const content = `${long} Then Mara checked the door. Then Mara read the figures. Then Mara walked out.\n\n${exchange}\n\nA bell rang.\n\n"One."\n\n"Two."\n\n"Three."`;
  const [scene] = sceneIndex({id:'signals',messages:[{role:'assistant',content}]});
  const groups = proseHighlights([scene]);
  const excerpts = (key,strength)=>groups[key][strength].map(ref=>resolveReference(ref,scene));
  assert.deepEqual(excerpts('long-sentences','strong'),[long]);
  assert.deepEqual(excerpts('repeated-openings','strong'),['Then Mara','Then Mara']);
  assert.deepEqual(excerpts('dialogue-runs','strong'),[exchange]);
  assert.deepEqual(excerpts('dialogue-runs','subtle'),['"One."\n\n"Two."\n\n"Three."']);
});

test('manual queries share a stable manuscript prefix and concurrent identical calls pay once',async()=>{
  const options = {kind:'themes',scope:'book',model:'gpt-6.1-terra',query:'light'};
  const one = buildReview(story,options);
  const two = buildReview({...story,notes:'Other background instructions.'},{...options,query:'memory'});
  assert.deepEqual(one.messages.slice(0,2),two.messages.slice(0,2));
  assert.notEqual(one.messages[2].content,two.messages[2].content);
  assert.equal(JSON.parse(one.messages[1].content).canon,undefined);
  const review = createRevisionReviewer();
  let calls = 0;
  const complete = async (messages,tools,prefixLength)=>{
    calls++;
    assert.equal(prefixLength,2);
    return {tool_calls:[{id:'ok',type:'function',function:{name:tools[0].function.name,arguments:'{"findings":[]}'}}]};
  };
  const [first,second] = await Promise.all([review(story,options,complete),review(story,options,complete)]);
  assert.equal(first.sceneCount,2);
  assert.equal(second.cached,true);
  assert.equal(calls,1);
  await assert.rejects(review(story,{...options,kind:'continuity',scope:'scene:1'},complete),/two eligible prose scenes/);
  assert.equal(calls,1);
});

test('continuity review projects declared canon fields for both manuscripts',()=>{
  const marker = 'Synthetic private annotation';
  const project = {...story,cast:story.cast.map(member=>({...member,annotation:marker})),
    plotEvents:story.plotEvents.map(event=>({...event,annotation:marker})),
    relationships:[{from:'ada',to:'ira',label:'Ada calls Ira.',annotation:marker}]};
  const review = buildReview(project,{kind:'continuity',scope:'book',comparison:project});
  const {canon,comparisonCanon} = JSON.parse(review.messages[1].content);
  for (const reference of [canon,comparisonCanon]) {
    assert.equal(reference.cast[0].name,'Ada');
    assert.equal(reference.plot[0].note,story.plotEvents[0].note);
    assert.equal(reference.relationships[0].label,'Ada calls Ira.');
    assert.equal(JSON.stringify(reference).includes(marker),false);
  }
});
