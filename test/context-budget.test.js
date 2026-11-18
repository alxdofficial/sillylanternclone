import assert from 'node:assert/strict';
import test from 'node:test';
import { editorContext } from '../public/agent-context.js';
import { continuityModel, defaultDirectModel, isAgentModel, modelContextWindow, modelProvider, models, sensitiveArtist, setupDraftModel } from '../public/models.js';
import { estimateContextTokens, storyOverview, storyPromptUsage, writingHistoryLimit, writingPromptLimit } from '../public/prompt.js';

test('the context budget separates provider windows, prompt budgets, and history limits', () => {
  assert.equal(modelContextWindow(sensitiveArtist),131_072);
  assert.equal(modelContextWindow('z-ai/glm-5.3'),262_144);
  assert.equal(modelContextWindow('user/custom-model'),undefined);
  assert.equal(writingPromptLimit(sensitiveArtist),112_000);
  assert.equal(writingHistoryLimit(sensitiveArtist),16_000);
  assert.equal(writingPromptLimit('user/custom-model'),28_000);
  assert.equal(setupDraftModel(sensitiveArtist),continuityModel);
  assert.equal(setupDraftModel('user/custom-model'),continuityModel);
  assert.equal(setupDraftModel('z-ai/glm-5.3'),'z-ai/glm-5.3');
});

test('direct providers expose two models each and prefer Haiku or Luna', () => {
  const claude = 'claude-haiku-5-5', openai = 'gpt-6-luna';
  for (const [provider,preferred,secondary] of [
    ['anthropic',claude,'claude-sonnet-5-5'],['openai',openai,'gpt-6.1-terra']
  ]) {
    assert.deepEqual(models.filter(model=>model.provider === provider).map(model=>model.id),[preferred,secondary]);
    assert.equal(defaultDirectModel(new Set([provider,'openrouter'])),preferred);
    assert.equal(modelProvider(preferred),provider);
    assert.equal(isAgentModel(preferred),true);
    assert.equal(setupDraftModel(preferred),preferred);
  }
  const enabled = new Set(['openai','anthropic']);
  assert.equal(defaultDirectModel(enabled),claude);
  assert.equal(defaultDirectModel(enabled,'openai'),openai);
  assert.equal(defaultDirectModel(new Set(['openrouter'])),'');
});

test('the Story estimate counts each artist prompt message once', () => {
  const messages = [
    {role:'system',content:'Instructions and world'},
    {role:'user',content:'Prior direction'},
    {role:'system',content:'Author note'},
    {role:'assistant',content:'Prior reply'},
    {role:'user',content:'Current direction'}
  ];
  const parts = storyPromptUsage(messages);
  const size = index=>estimateContextTokens(messages[index].content);
  assert.deepEqual(parts.map(({tokens})=>tokens),[size(0) + size(2),size(1) + size(3),size(4)]);
});

test('the Agent estimate and structure pass share the same eligible recent text', () => {
  const project = {
    characterName:'Iona',
    messages:[
      {role:'user',content:'PRIVATE INPUT',contentSensitivity:'explicit'},
      {role:'assistant',content:'PRIVATE RESULT',contentSensitivity:'unclassified'},
      {role:'user',content:'Safe input'},
      {role:'assistant',content:'Safe reply',storyTime:'2026-11-16T12:08'}
    ]
  };
  const overview = storyOverview(project);
  assert.deepEqual(overview.recentTurns,[{role:'user',content:'Safe input'},{role:'assistant',content:'Safe reply'}]);
  assert.equal(overview.knownTime,'2026-11-16T12:08');
});

test('the editor cuts complete old exchanges in batches and keeps its cached prefix between turns', () => {
  const model = 'anthropic/claude-sonnet-5.5';
  const cast = Array.from({length:30},(_,index)=>({id:'cast-' + index,name:'Character ' + index,
    description:'Full profile of character ' + index}));
  const project = {
    title:'Lanterns',lore:'Canonical tower notes.',notes:'Write in present tense.',cast,
    relationships:[{from:'cast-0',to:'cast-29',label:'They share the key.',turn:0,storyTime:'1998-10-25T00:00'}],
    setupHistory:{context:'Original setup pack. '.repeat(31_000),reviewed:true,messages:[]},
    messages:Array.from({length:330},(_,index)=>({turnNumber:index + 1,role:index % 2 ? 'assistant' : 'user',
      content:'Beat ' + index + ': ' + 'The harbor light shines. '.repeat(351)})),
    agentHistory:[
      {afterTurn:330,request:'Add a note about the lighthouse.',message:'The world notes include the lighthouse.',count:1},
      {afterTurn:330,request:'HELD EDITOR REQUEST',message:'HELD EDITOR REPLY',count:0,historySafe:false}
    ]
  };
  project.messages[320].contentSensitivity = 'explicit';
  project.messages[320].content = 'HELD INPUT';
  project.messages[321].content = 'HELD PAIRED PROSE';
  project.messages[321].contentSensitivity = 'safe';
  const first = editorContext(project,'Change the date',model);
  assert.equal(first.problem,'');
  assert.ok(first.omitted > 10);
  assert.ok(first.omittedTokens >= 300_000);
  assert.ok(first.parts.reduce((sum,part)=>sum + part.tokens,0) < first.inputLimit);
  assert.match(JSON.stringify(first.messages),/Full profile of character 29/);
  assert.match(JSON.stringify(first.messages),/They share the key/);
  assert.match(JSON.stringify(first.messages),/edit_story_state applied 1 changes/);
  assert.match(JSON.stringify(first.messages),/Canonical tower notes/);
  assert.doesNotMatch(JSON.stringify(first.messages),/HELD INPUT|HELD PAIRED PROSE|HELD EDITOR|Original setup pack/);
  const next = editorContext({...project,lore:'Updated tower notes.',messages:[
    ...project.messages,{turnNumber:331,role:'assistant',content:'The ferry arrived.',standalone:true}
  ]},'Change the time',model);
  assert.equal(next.omitted,first.omitted);
  assert.deepEqual(next.messages.slice(0,first.prefixLength),first.messages.slice(0,first.prefixLength));
  assert.match(JSON.stringify(next.messages),/Updated tower notes/);
  assert.equal(project.messages.length,330);
});

test('reviewed setup notes are eligible early history and unreviewed notes stay local', () => {
  const project = {messages:[],setupHistory:{context:'Reference marker',reviewed:false,messages:[{role:'user',content:'Chat marker'}]}};
  const prompt = () => editorContext(project,'Inspect the cast','openai/gpt-6.1-terra').messages;
  assert.doesNotMatch(JSON.stringify(prompt()),/Reference marker|Chat marker/);
  project.setupHistory.reviewed = true;
  assert.match(JSON.stringify(prompt()),/Reference marker.*Chat marker/);
});

test('structured prompts use the current graph after an applied event has been corrected', () => {
  const project = {messages:[{role:'assistant',standalone:true,content:'The ferry docked.',
    appliedGraphUpdates:[{kind:'plot',note:'Superseded receipt'}]}],
    plotEvents:[{storyTime:'1998-10-25T00:10',note:'Corrected event'}]};
  const content = JSON.stringify(editorContext(project,'Inspect the crossing','unknown').messages);
  assert.match(content,/Corrected event/);
  assert.doesNotMatch(content,/Superseded receipt/);
});

test('editor sees the opening anchor and the current graph setting when asked to change them', () => {
  const project = {storyStartAt:'1998-10-25T00:10',graphUpdates:false,
    messages:[{role:'assistant',content:'Afternoon.',storyTime:'1998-10-25T15:00'}]};
  const {messages} = editorContext(project,'Toggle automatic updates','unknown');
  assert.match(messages.at(-1).content,/"openingStoryTime":"1998-10-25T00:10","automaticGraphUpdates":false/);
  assert.ok(messages.at(-1).content.endsWith('Toggle automatic updates'));
});
