import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessages, formatMessages, splitOpenRouterReply, splitAgentReply, migratePersona, isStoryTime, recordStoryTime } from '../public/prompt.js';

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
  const order = ['World Info · before character', 'Writer character', 'Character description', 'Character personality',
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

test('narration uses the cast and retains legacy attribution without a character reply mode', () => {
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
  const prompt = formatMessages(buildMessages(project, 'Use first-person present and a dry tone.'));
  assert.match(prompt, /You are the narrator/);
  assert.match(prompt, /Follow the writer’s requested style, point of view and tense/);
  assert.match(prompt, /third-person past-tense prose/);
  assert.match(prompt, /Use first-person present and a dry tone\./);
  assert.doesNotMatch(prompt, /Current speaker:/);
  assert.match(prompt, /Mara knows the tide calendar/);
  assert.match(prompt, /Mara: Look east/);
  assert.match(prompt, /\[ASSISTANT\]\s+Iona: A lantern/);
  assert.match(prompt, /Character description:\s+Iona\s+Iona keeps the station lit/);
  assert.match(prompt, /Other cast:\s+Mara: Mara knows the tide calendar/);
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

test('OpenRouter labels are stripped from prose and missing or invalid labels stay unverified', () => {
  assert.deepEqual(splitOpenRouterReply('Scene text.\n\n```story-safety\n{"input":"safe","reply":"explicit"}\n```'),
    {text:'Scene text.',input:'safe',reply:'explicit',storyTime:'',suggestions:[]});
  assert.deepEqual(splitOpenRouterReply('Scene text.\n```story-safety\n{"input":"safe"'),
    {text:'Scene text.',input:'unclassified',reply:'unclassified',storyTime:'',suggestions:[]});
  assert.deepEqual(splitOpenRouterReply('Scene text without any label.'),
    {text:'Scene text without any label.',input:'unclassified',reply:'unclassified',storyTime:'',suggestions:[]});
});

test('OpenRouter accepts a plain JSON fence only for a recognizable final classification block', () => {
  const storyJson = 'The screen showed:\n```json\n{"input":"radio","reply":"tape"}\n```';
  const update = {kind:'fact',note:'The ferry reached the pier.'};
  const footer = JSON.stringify({input:'safe',reply:'explicit',storyTime:'1998-10-25T00:12',updates:[update]});
  assert.deepEqual(splitOpenRouterReply(storyJson + '\n\n```json\n' + footer + '\n```\n'), {
    text:storyJson,input:'safe',reply:'explicit',storyTime:'1998-10-25T00:12',suggestions:[update]
  });
  assert.equal(splitOpenRouterReply(storyJson).text,storyJson);
  const nonterminal = '```json\n' + footer + '\n```\nHe closed the log.';
  assert.equal(splitOpenRouterReply(nonterminal).text,nonterminal);
});

test('auto-flagged turns stop at the MCP boundary while OpenRouter keeps scene continuity', () => {
  const project = {...story,messages:[
    {role:'user',content:'PRIVATE_WRITER',contentSensitivity:'explicit'},
    {role:'assistant',content:'UNVERIFIED_REPLY',contentSensitivity:'unclassified'},
    {role:'assistant',content:'HIDDEN_EVERYWHERE',excludeFromContext:true},
    {role:'user',content:'NEXT_SCENE',contentSensitivity:'safe'}
  ]};
  const mcp = formatMessages(buildMessages(project));
  const router = formatMessages(buildMessages(project,'', 'send',{includeSensitive:true,classifySafety:true}));
  assert.doesNotMatch(mcp,/PRIVATE_WRITER|UNVERIFIED_REPLY|HIDDEN_EVERYWHERE/);
  assert.match(mcp,/NEXT_SCENE/);
  assert.match(router,/PRIVATE_WRITER/);
  assert.match(router,/UNVERIFIED_REPLY/);
  assert.doesNotMatch(router,/HIDDEN_EVERYWHERE/);
  assert.match(router,/fenced story-safety block/);
});

test('story time validates dates, shares the setup anchor, and rolls over at midnight', () => {
  assert.equal(isStoryTime('2025-02-29T18:12'), false);
  assert.equal(isStoryTime('2024-02-29T24:00'), false);
  const project = {messages:[],storyStartAt:'2026-01-01T09:00',storyStartSource:'estimate',
    relationships:[{turn:0,storyTime:'2026-01-01T09:00'}]};
  const first = recordStoryTime(project,'1980-08-31T23:59');
  assert.equal(project.storyStartAt,first);
  assert.equal(project.relationships[0].storyTime,first);
  project.messages.push({storyTime:first});
  assert.equal(recordStoryTime(project,''),'1980-09-01T00:00');
});

test('a saved persona becomes one cast member and remains the writer in prompts', () => {
  const project = migratePersona({...story, cast:[{id:'ren',name:'Ren',description:'Repairs radios.'}]});
  assert.equal(project.storyWriterId,'ren');
  assert.equal(project.persona,'');
  assert.equal(project.cast.length,1);
  assert.match(formatMessages(buildMessages(project)),/Writer character:\nRen\nRepairs radios\./);
});

test('provider footers keep dates and non-explicit updates separate from prose', () => {
  const update = {kind:'relationship',from:'Iona',to:'Ren',label:'They agree to share the map.',storyTime:'1950-03-01T09:00'};
  const footer = JSON.stringify({input:'safe',reply:'explicit',storyTime:'1950-03-01T09:15',updates:[update]});
  assert.deepEqual(splitOpenRouterReply('Prose.\n```story-safety\n' + footer + '\n```'),
    {text:'Prose.',input:'safe',reply:'explicit',storyTime:'1950-03-01T09:15',suggestions:[update]});
  assert.deepEqual(splitAgentReply('Prose.\n```story-graph\n{"incomplete":'),{text:'Prose.',suggestions:[]});
});
