import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStoryEdit } from '../continuity.mjs';
import { applyManuscriptProposal, proposeManuscriptEdit } from '../manuscript-edits.mjs';
import { normalizeAgentHistory } from '../public/agent-context.js';
import { manuscriptChapters } from '../public/scene-board.js';

const book = () => ({id:'book',title:'Night Shift',lore:'The harbor goes quiet at dusk.',notes:'',
  messages:[
    {role:'assistant',turnNumber:1,content:'The ferry waited in fog.'},
    {role:'assistant',turnNumber:2,content:'The bell rang once.'},
    {role:'assistant',turnNumber:3,content:'A private draft.',excludeFromContext:true}
  ]});
const call = (name,args,round)=>({role:'assistant',tool_calls:[{id:'call-' + round,type:'function',
  function:{name,arguments:JSON.stringify(args)}}]});
const final = (manuscript,changes = [])=>({changes,manuscript,message:'Changes prepared.',historySafe:true});

test('Agent requires a scene read, then saves a reviewable proposal with no early mutations',async()=>{
  const story = book(), original = structuredClone(story);
  const manuscript = [{kind:'revise_scene',turn:1,anchor:'waited in fog',text:'drifted in silver fog'}];
  const notes = [{kind:'notes',action:'append',text:'Use ferry terminology.'}];
  let round = 0;
  const result = await runStoryEdit(story,'Revise the opening and add a standing note.',async messages=>{
    round++;
    if (round === 1) return call('edit_story_state',final(manuscript,notes),round);
    if (round === 2) {
      assert.match(JSON.parse(messages.at(-1).content).error,/Read the target scene/);
      return call('inspect_manuscript',{turn:1},round);
    }
    assert.equal(JSON.parse(messages.at(-1).content).text,original.messages[0].content);
    return call('edit_story_state',final(manuscript,notes),round);
  },'claude-sonnet-5-5');
  assert.equal(result.count,0);
  assert.deepEqual(story.messages,original.messages);
  assert.equal(story.notes,'');
  const proposal = normalizeAgentHistory(story.agentHistory)[0].proposal;
  assert.equal(proposal.id,result.proposalId);
  assert.equal(proposal.previews[0].before,'waited in fog');
  assert.equal(proposal.previews[0].after,'drifted in silver fog');

  const stale = structuredClone(story);
  stale.messages[0].content = 'Different draft.';
  assert.throws(()=>applyManuscriptProposal(stale,proposal.id),/story changed/i);

  const {project:applied,count} = applyManuscriptProposal(story,proposal.id);
  assert.equal(count,2);
  assert.equal(applied.notes,'Use ferry terminology.');
  assert.deepEqual(applied.messages[0].alternatives,[original.messages[0].content,'The ferry drifted in silver fog.']);
  assert.equal(applied.messages[0].continuityNeedsReview,true);
  assert.equal(applied.agentHistory[0].resolution,'applied');
  assert.throws(()=>applyManuscriptProposal(applied,proposal.id),/no longer pending/i);
});

test('manuscript tool omits withheld text, and duplicate anchors reject the whole proposal',async()=>{
  const story = book();
  let round = 0;
  await runStoryEdit(story,'What is in the last scene?',async messages=>{
    round++;
    if (round === 1) return call('inspect_manuscript',{},round);
    if (round === 2) {
      const {scenes} = JSON.parse(messages.at(-1).content);
      assert.deepEqual(scenes.at(-1),{turn:3,chapter:1,scene:3,available:false});
      return call('inspect_manuscript',{turn:3},round);
    }
    assert.match(JSON.parse(messages.at(-1).content).error,/unavailable/);
    return call('edit_story_state',{changes:[],message:'The last scene is unavailable.'},round);
  },'claude-sonnet-5-5');
  story.messages[0].content = 'fog, fog.';
  assert.throws(()=>proposeManuscriptEdit(story,[{kind:'revise_scene',turn:3,text:'Revised.'}],[]),/withheld/);
  const before = structuredClone(story);
  assert.throws(()=>proposeManuscriptEdit(story,[
    {kind:'delete_scene',turn:2},{kind:'revise_scene',turn:1,anchor:'fog',text:'mist'}
  ],[]),/exact, unique passage/);
  assert.deepEqual(story,before);
});

test('approved structural proposal keeps stable turns and updates reading order',()=>{
  const story = book();
  const proposal = proposeManuscriptEdit(story,[
    {kind:'move_scene',turn:3,beforeTurn:1},{kind:'chapter_break',turn:1,enabled:true},
    {kind:'insert_scene',beforeTurn:2,text:'The rope slipped.'},{kind:'delete_scene',turn:2},
    {kind:'scene_details',turn:1,heading:'Low tide',pov:'Sana',status:'ready'}
  ],[]);
  story.agentHistory = [{proposal}];
  const {project,count} = applyManuscriptProposal(story,proposal.id);
  assert.equal(count,5);
  assert.deepEqual(manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn)),[[3],[1,4]]);
  assert.equal(project.messages.find(item=>item.turnNumber === 1).sourcePrefix,'Low tide');
  assert.equal(project.sceneBoard.scenes[1].pov,'Sana');
  assert.equal(project.messages.find(item=>item.turnNumber === 4).continuityNeedsReview,true);
});

test('chapter edits and passage removal are applied without renumbering surviving scenes',()=>{
  const story = book();
  story.messages[1].startsChapter = story.messages[2].startsChapter = true;
  const proposal = proposeManuscriptEdit(story,[
    {kind:'move_chapter',turn:3,beforeTurn:1},
    {kind:'delete_chapter',turn:2},
    {kind:'revise_scene',turn:1,anchor:' in fog',text:''}
  ],[]);
  story.agentHistory = [{proposal}];
  const {project} = applyManuscriptProposal(story,proposal.id);
  assert.deepEqual(manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn)),[[3],[1]]);
  assert.equal(project.messages[0].content,'The ferry waited.');
});

test('a deleted chapter opener preserves the chapter and shifts surviving graph indices correctly',()=>{
  const story=book();
  story.messages[1].startsChapter=true;
  story.plotEvents=[
    {turn:2,note:'The bell was first heard.'},
    {turn:3,note:'The second signal arrived.'},
    {turn:1,note:'The ferry waited.'}
  ];
  const edits=[{kind:'delete_scene',turn:2}];
  const proposal=proposeManuscriptEdit(story,edits,[{kind:'edit_plot',eventIndex:1,note:'The captain heard the second signal.'}]);
  story.agentHistory=[{proposal}];
  const {project}=applyManuscriptProposal(story,proposal.id);
  assert.deepEqual(manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn)),[[1],[3]]);
  assert.deepEqual(project.plotEvents.map(event=>event.note),['The captain heard the second signal.','The ferry waited.']);
  assert.throws(()=>proposeManuscriptEdit(story,edits,[{kind:'edit_plot',eventIndex:0,note:'A new title'}]),/targets an event removed/);
});

test('an insertion starts its own chapter before an opener and preserves a queued final chapter divider',()=>{
  const story=book();
  story.messages[1].startsChapter=true;
  story.sceneBoard={nextChapterAfter:3};
  const proposal=proposeManuscriptEdit(story,[{kind:'insert_scene',newChapter:true,beforeTurn:1,text:'New opening.'}],[]);
  story.agentHistory=[{proposal}];
  const {project}=applyManuscriptProposal(story,proposal.id);
  assert.deepEqual(manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn)),[[4],[1],[2,3]]);
  assert.equal(project.sceneBoard.nextChapterAfter,4);
  const append=proposeManuscriptEdit(project,[{kind:'insert_scene',text:'Another opening.'}],[]);
  project.agentHistory.push({proposal:append});
  const {project:extended}=applyManuscriptProposal(project,append.id);
  assert.deepEqual(manuscriptChapters(extended).map(chapter=>chapter.map(scene=>scene.turn)),[[4],[1],[2,3],[5]]);
  assert.equal(extended.sceneBoard.nextChapterAfter,undefined);
});

test('Agent retries a prose edit after a plain reply and accepts a read anchor across consecutive pages',async()=>{
  const story=book();
  story.messages[0].content='x'.repeat(5998)+'anchor ends here.';
  let round=0;
  const result=await runStoryEdit(story,'Replace the words “anchor ends” with “signal starts”.',async messages=>{
    round++;
    if (round === 1) return {role:'assistant',content:'I know what to change.'};
    if (round === 2) {
      assert.match(messages.at(-1).content,/required edit_story_state/);
      return call('inspect_manuscript',{turn:1},round);
    }
    if (round === 3) return call('inspect_manuscript',{turn:1,offset:JSON.parse(messages.at(-1).content).nextOffset},round);
    return call('edit_story_state',final([{kind:'revise_scene',turn:1,anchor:'anchor ends',text:'signal starts'}]),round);
  },'claude-sonnet-5-5');
  assert.ok(result.proposalId);
});
