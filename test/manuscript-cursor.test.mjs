import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runStoryEdit} from '../continuity.mjs';
import {editorContext} from '../public/agent-context.js';
import {buildWritingContext, lastStoryTime, manuscriptFocus, recordStoryTime} from '../public/prompt.js';
import {applyManuscriptProposal} from '../manuscript-edits.mjs';
import {manuscriptChapters} from '../public/scene-board.js';

const scene = (turnNumber,content,extra={})=>({role:'assistant',turnNumber,content,...extra});
function story() {
  return {title:'Cursor fixture',lore:'The port has one pier.',notes:'Use close third person.',
    plotEvents:[{note:'The morning watch relieves the night watch.',storyTime:'2000-01-02T08:00',turn:7}],
    messages:[scene(1,'Opening watch.'),scene(2,'Private sentence.',{excludeFromContext:true}),
      scene(3,'After the weather turns.'),scene(4,'Before the storm.'),
      scene(5,'Marked sensitive.',{contentSensitivity:'explicit'}),scene(6,'A crew member returns.'),scene(7,'Unrelated ending.')],
    sceneBoard:{chapters:[[1,2,4,3,5,6,7]]}};
}

test('cursor uses edited reading order and keeps private gaps without widening its scope',()=>{
  const project=story(), result=manuscriptFocus(project,3);
  assert.deepEqual(result.nearby.map(({turn,side,withheld})=>[turn,side,!!withheld]),[
    [2,'before',true],[4,'before',false],[3,'after',false],[5,'after',true]
  ]);
  const sensitive=manuscriptFocus(project,3,{includeSensitive:true});
  assert.equal(sensitive.nearby[0].withheld,true);
  assert.equal(sensitive.nearby.at(-1).content,'Marked sensitive.');
  assert.equal(manuscriptFocus(project,900),null);
  assert.equal(manuscriptFocus(project,'3'),null);
});

test('target prompts use the same book graph and keep the changing cursor after a stable prefix',()=>{
  const project=story();
  const prose=buildWritingContext(project,'Add a brief exchange.','insert',{model:'gpt-6-luna',openRouter:true,beforeTurn:3});
  assert.equal(prose.problem,'');
  assert.match(JSON.stringify(prose.messages),/morning watch relieves the night watch/);
  assert.doesNotMatch(JSON.stringify(prose.messages),/Unrelated ending|Private sentence|Marked sensitive/);
  assert.match(prose.messages.at(-1).content,/After the weather turns/);
  const first=editorContext(project,'How is the pacing?', 'gpt-6-luna',3);
  const next=editorContext(project,'What can I tighten?', 'gpt-6-luna',5);
  assert.deepEqual(first.messages.slice(0,first.prefixLength),next.messages.slice(0,next.prefixLength));
  assert.notDeepEqual(first.messages.slice(first.prefixLength),next.messages.slice(next.prefixLength));
  assert.match(editorContext(project,'Edit this.', 'gpt-6-luna',900).problem,/no longer/);
});

test('Agent inserts before the cursor only after approval and records the anchored exchange',async ()=>{
  const project=story();
  const complete=async ()=>({tool_calls:[{id:'fixture-edit',type:'function',function:{name:'edit_story_state',
    arguments:JSON.stringify({changes:[],manuscript:[{kind:'insert_scene',text:'The fog broke.'}],message:'Ready to review.',historySafe:true})}}]});
  const result=await runStoryEdit(project,'Insert a short bridge here.',complete,'gpt-6-luna',3);
  assert.equal(project.agentHistory.at(-1).beforeTurn,3);
  assert.equal(project.messages.length,7);
  const approved=applyManuscriptProposal(project,result.proposalId).project;
  assert.deepEqual(manuscriptChapters(approved).flat().map(item=>item.content).slice(2,5),
    ['Before the storm.','The fog broke.','After the weather turns.']);
});

test('inserting a backdated scene leaves the current story clock in place',()=>{
  const original=scene(1,'The end.',{storyTime:'2000-02-01T09:00'});
  const backdated=scene(2,'Earlier.',{storyTime:'1999-02-01T09:00',insertedAtCursor:true});
  assert.equal(lastStoryTime({messages:[original,backdated]}),original.storyTime);
  assert.doesNotThrow(()=>recordStoryTime({messages:[backdated]}));
});
