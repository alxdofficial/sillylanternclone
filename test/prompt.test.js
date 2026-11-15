import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessages, formatMessages } from '../public/prompt.js';

const story = {
  characterName: 'Iona', personaName: 'Ren',
  character: '{{char}} keeps the station lit.',
  persona: '{{user}} repairs radios.',
  personality: 'Dry wit.',
  lore: 'The coast has seven signal towers.',
  loreRules: 'key | The key is made of ice.\nbrass compass, astrolabe | True north is wrong.\n* | All maps are handwritten.\na+b | A literal marker.',
  scenario: 'A storm arrives.',
  examples: '{{user}}: Is the harbor shut?\n{{char}}: It is now.',
  authorNote: 'Keep it tense.',
  postHistory: 'End on a clue.',
  messages: Array.from({length: 6}, (_, i) => ({role:i % 2 ? 'assistant' : 'user', content:'Turn ' + i}))
};

test('prompt orders context around role-preserved history and the current direction', () => {
  const messages = buildMessages(story, 'Ren checks the BRASS COMPASS by the monkey statue. a+b');
  const text = formatMessages(messages);
  const order = ['World Info · before character', 'Writer persona', 'Character description', 'Character personality',
    'Scenario', 'World Info · activated entries', 'Example dialogue', 'Turn 1', 'Author’s note', 'Turn 2',
    'Turn 5', 'Post-history instructions', 'Ren checks'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(text.indexOf(order[i-1]) >= 0 && text.indexOf(order[i]) > text.indexOf(order[i-1]), order[i]);
  }
  assert.match(text, /Iona keeps the station lit/);
  assert.match(text, /Ren: Is the harbor shut/);
  assert.match(text, /True north is wrong/);
  assert.match(text, /All maps are handwritten/);
  assert.match(text, /A literal marker/);
  assert.doesNotMatch(text, /made of ice/);
  assert.equal(messages.find(message => message.content === 'Turn 5').role, 'assistant');
  assert.equal(messages.at(-1).role, 'user');
});

test('only the newest history is retained under the character budget', () => {
  const messages = buildMessages({
    messages: Array.from({length:80}, (_, i) => ({role:'user', content:`Turn ${i}: ` + 'X'.repeat(5990)}))
  });
  const text = formatMessages(messages);
  assert.ok(text.length < 17_000);
  assert.doesNotMatch(text, /Turn 0:/);
  assert.match(text, /Turn 79:/);
});

test('alternate directions are separate from stored conversation', () => {
  const messages = buildMessages(story, '', 'alternate');
  assert.match(messages.at(-1).content, /different take/);
  assert.equal(story.messages.length, 6);
});
