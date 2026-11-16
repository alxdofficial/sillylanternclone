import assert from 'node:assert/strict';
import test from 'node:test';
import { continuityModel, modelContextWindow, sensitiveArtist, setupDraftModel } from '../public/models.js';
import { estimateContextTokens, storyOverview, storyPromptUsage, writingHistoryLimit, writingPromptLimit } from '../public/prompt.js';

test('the context budget separates provider windows, prompt budgets, and history limits', () => {
  assert.equal(modelContextWindow(sensitiveArtist),131_072);
  assert.equal(modelContextWindow('z-ai/glm-5.3'),262_144);
  assert.equal(modelContextWindow('user/custom-model'),undefined);
  assert.equal(writingPromptLimit(sensitiveArtist),48_000);
  assert.equal(writingHistoryLimit(sensitiveArtist),16_000);
  assert.equal(writingHistoryLimit('gryphe/mythomax-l2-13b'),0);
  assert.equal(setupDraftModel(sensitiveArtist),continuityModel);
  assert.equal(setupDraftModel('user/custom-model'),continuityModel);
  assert.equal(setupDraftModel('z-ai/glm-5.3'),'z-ai/glm-5.3');
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
