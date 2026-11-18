import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkpointScene, compareDraftParagraphs, normalizeDraftCheckpoints, restoreDraftText, validDraftCheckpoints
} from '../public/draft-comparison.js';
import { buildWritingContext, isAvailableToMcp } from '../public/prompt.js';

test('checkpoints preserve prose, sensitivity and stable turn identity through reload', ()=>{
  const project = {messages:[{role:'assistant',turnNumber:7,content:'Original scene.',contentSensitivity:'explicit',excludeFromContext:true}]};
  const saved = checkpointScene(project,7,' Before the reveal ',{id:'checkpoint',savedAt:'2026-11-18T00:00:00.000Z'});
  assert.equal(saved.name,'Before the reveal');
  assert.equal(saved.contentSensitivity,'explicit');
  assert.equal(saved.excludeFromContext,true);
  project.messages[0].content = 'Different scene.';
  assert.equal(saved.content,'Original scene.');
  const serialized = JSON.parse(JSON.stringify(project.draftCheckpoints));
  assert.ok(validDraftCheckpoints(serialized));
  assert.deepEqual(normalizeDraftCheckpoints(serialized),[saved]);
  assert.deepEqual(normalizeDraftCheckpoints(undefined),[]);
  assert.equal(validDraftCheckpoints([saved,saved]),false);
  assert.deepEqual(normalizeDraftCheckpoints([null,saved,saved,{...saved,id:'invalid',turn:0}]),[saved]);
});

test('paragraph restore replaces precisely and preserves original line endings and other paragraphs', ()=>{
  const original='Opening.\r\n\r\n  Hollow door.\r\n\r\nLast word.';
  const source={content:'Opening.\n\nTall gate.\n\nNew paragraph.\n\nLast word.'};
  const rows=compareDraftParagraphs(original,source.content);
  assert.deepEqual(rows.map(({before,after})=>[before,after]),[
    ['Opening.','Opening.'],['Hollow door.','Tall gate.'],[undefined,'New paragraph.'],['Last word.','Last word.']
  ]);
  const project={messages:[{role:'assistant',turnNumber:8,content:original,contentSensitivity:'reviewed-safe'}]};
  assert.equal(restoreDraftText(project,8,original,source,rows[1].change),true);
  const wanted='Opening.\r\n\r\n  Tall gate.\r\n\r\nLast word.';
  assert.equal(project.messages[0].content,wanted);
  const insertion=compareDraftParagraphs(wanted,source.content)[2].change;
  assert.equal(restoreDraftText(project,8,wanted,source,insertion),true);
  assert.equal(project.messages[0].content,'Opening.\r\n\r\n  Tall gate.\r\n\r\nNew paragraph.\r\n\r\nLast word.');
  assert.deepEqual(project.messages[0].alternatives.slice(0,2),[original,wanted]);
  assert.equal(isAvailableToMcp(project.messages[0]),false);
});

test('inserting before an indented paragraph preserves its indentation', ()=>{
  const original='First paragraph.\n\n  Indented paragraph.';
  const source={content:'First paragraph.\n\nMiddle paragraph.\n\nIndented paragraph.'};
  const project={messages:[{role:'assistant',turnNumber:1,content:original}]};
  const rows=compareDraftParagraphs(original,source.content);
  restoreDraftText(project,1,original,source,rows[1].change);
  assert.equal(project.messages[0].content,'First paragraph.\n\nMiddle paragraph.\n\n  Indented paragraph.');
});

test('whole-scene restore preserves old takes and graph while flagging continuity and withholding restored text', ()=>{
  const original='First version.';
  const scene={role:'assistant',turnNumber:3,content:original,alternatives:[original,'Second version.'],selectedAlternative:0,
    alternativeSensitivities:['safe','reviewed-safe'],contentSensitivity:'safe',continuityPending:true,graphSuggestions:[{kind:'world'}]};
  const graph=[{turn:3}];
  const project={messages:[scene],plotEvents:graph,storyFlow:{},agentRequest:{replyTurnNumber:3},agentNotice:{turnNumber:3}};
  const source={content:'Previously withheld version.',excludeFromContext:true,contentSensitivity:'explicit'};
  assert.equal(restoreDraftText(project,3,original,source),true);
  assert.equal(scene.continuityNeedsReview,true);
  assert.equal(scene.continuityPending,undefined);
  assert.equal(scene.contentSensitivity,'explicit');
  assert.equal(scene.excludeFromContext,true);
  assert.equal(scene.selectedAlternative,2);
  assert.deepEqual(scene.alternatives,[original,'Second version.',source.content]);
  assert.deepEqual(scene.alternativeSensitivities,['safe','reviewed-safe','explicit']);
  assert.deepEqual(scene.firstTakeSuggestions,[{kind:'world'}]);
  assert.equal(scene.graphSuggestions,undefined);
  assert.equal(project.plotEvents,graph);
  assert.equal(project.storyFlow,undefined);
  assert.equal(project.agentRequest,undefined);
  assert.equal(project.agentNotice,undefined);
  assert.equal(isAvailableToMcp(scene),false);
  assert.throws(()=>restoreDraftText(project,3,original,source),/changed/);
  assert.equal(restoreDraftText(project,3,source.content,source),false);
});

test('large comparisons keep bounded work and exact unchanged paragraph anchors', ()=>{
  const sections=Array.from({length:1100},(_,i)=>`Scene paragraph ${i}`);
  const original=sections.join('\n\n');
  sections[500]='One changed paragraph.';
  const rows=compareDraftParagraphs(original,sections.join('\n\n'));
  assert.equal(rows.length,sections.length);
  assert.deepEqual(rows.filter(({equal})=>!equal).map(({before,after})=>[before,after]),
    [['Scene paragraph 500','One changed paragraph.']]);
});

test('historical checkpoint prose and an excluded restored take stay out of provider context', ()=>{
  const original = 'The readers heard a bell.';
  const project = {lore:'',notes:'',messages:[{
    role:'assistant',turnNumber:1,content:original,contentSensitivity:'reviewed-safe'
  }]};
  project.draftCheckpoints = [{content:'Private snapshot marker'}];
  restoreDraftText(project,1,original,{content:'Private restored marker',excludeFromContext:true});
  for (const includeSensitive of [false,true]) {
    const request = buildWritingContext(project,'Continue.','continue',{includeSensitive});
    assert.doesNotMatch(JSON.stringify(request.messages),/Private snapshot marker|Private restored marker/);
  }
});
