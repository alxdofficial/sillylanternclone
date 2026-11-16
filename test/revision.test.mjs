import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReview, createRevisionReviewer } from '../revision-review.mjs';
import { branchRevisionNotes, continuityChecks, motifOccurrences, pacingRows, reference, resolveReference, sceneIndex } from '../public/revision.js';

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
  assert.match(discovery.messages[0].content,/Suggest distinct themes or motifs/);
  const source = JSON.parse(discovery.messages[1].content);
  assert.equal(source.theme,undefined);
  assert.equal(source.passages.length,1);
  assert.equal(source.passages[0].chapter,2);
  const search = buildReview(story,{...options,query:'blue light'});
  assert.match(search.messages[0].content,/requested motif or theme/);
  assert.equal(JSON.parse(search.messages[1].content).theme,'blue light');
});
