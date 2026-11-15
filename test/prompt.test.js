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

test('recent prose keeps the newest turns under the estimated token cap', () => {
  const messages = buildMessages({
    messages: Array.from({length:80}, (_, i) => ({role:'user', content:`Turn ${i}: ` + 'X'.repeat(5990)}))
  });
  const text = formatMessages(messages);
  assert.ok(Buffer.byteLength(text) < 49_000);
  assert.doesNotMatch(text, /Turn 0:/);
  assert.match(text, /Turn 79:/);
});

test('alternate directions are separate from stored conversation', () => {
  const messages = buildMessages(story, '', 'alternate');
  assert.match(messages.at(-1).content, /different take/);
  assert.equal(story.messages.length, 6);
});

test('a group reply swaps in the selected card and keeps attributed shared history', () => {
  const project = {
    ...story,
    cast: [
      {id:'mara', name:'Mara', description:'Mara knows the tide calendar.', personality:'Direct.', scenario:'At the dock.', examples:'{{char}}: Look east.'}
    ],
    speakerId:'mara',
    messages:[
      {role:'user', content:'What did the sea bring?'},
      {role:'assistant', content:'A lantern.', speakerId:'primary', speakerName:'Iona'}
    ]
  };
  const prompt = formatMessages(buildMessages(project, 'What next?'));
  assert.match(prompt, /Current speaker:\s+Mara/);
  assert.match(prompt, /Mara knows the tide calendar/);
  assert.match(prompt, /Mara: Look east/);
  assert.match(prompt, /\[ASSISTANT\]\s+Iona: A lantern/);
  assert.match(prompt, /Other cast:\s+Iona: Iona keeps the station lit/);
  assert.doesNotMatch(prompt, /Mara keeps the station lit/);
});

test('excluded text cannot activate lore or appear in an agent handoff', () => {
  const project = {
    ...story,
    loreRules:'private-marker | Secret triggered lore',
    continuity:'At dawn, Ren carries the brass key.',
    messages:[
      {role:'user',content:'private-marker',excludeFromContext:true},
      {role:'user',content:'Take the morning ferry.'}
    ]
  };
  const prompt = formatMessages(buildMessages(project, '', 'continue', {maintainGraph:true}));
  assert.doesNotMatch(prompt, /private-marker|Secret triggered lore/);
  assert.match(prompt, /At dawn, Ren carries the brass key/);
  assert.match(prompt, /Take the morning ferry/);
});

test('known small model gets a tighter budget without losing the latest direction', () => {
  const messages = Array.from({length:600}, (_, i) => ({role:'user', content:`Turn ${i}: ` + 'lamp '.repeat(150)}));
  const project = {...story,messages,lore:'This is the lighthouse. '.repeat(600)};
  const large = buildMessages(project,'Board the ferry');
  const small = buildMessages(project,'Board the ferry','send',{model:'gryphe/mythomax-l2-13b'});
  assert.ok(large.length > small.length);
  assert.equal(small.at(-1).content,'Board the ferry');
  assert.ok(small.reduce((n,m)=> n + Math.ceil(Buffer.byteLength(m.content)/3) + 8,0) <= 5600);
});
