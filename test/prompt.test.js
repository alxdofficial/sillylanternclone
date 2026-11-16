import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessages, buildWritingContext, formatMessages, splitAgentReply, migrateLegacyCast, isStoryTime, recordStoryTime } from '../public/prompt.js';

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
  const order = ['World setting', 'Opening premise', 'Cast:', 'Personality',
    'Example dialogue', 'Relevant lore', 'Turn 1', 'Author’s note', 'Turn 2',
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

test('the narrator includes peer profiles and writing notes beyond the old per-field caps', () => {
  const prose = 'A detailed observation. '.repeat(360);
  const project = {
    cast:[
      {id:'iona',name:'Iona',description:prose + 'IONA_PROFILE_END',personality:prose + 'IONA_PERSONALITY_END'},
      {id:'ren',name:'Ren',description:prose + 'REN_PROFILE_END',personality:prose + 'REN_PERSONALITY_END'}
    ],
    notes:prose + 'WRITING_NOTES_END',
    messages:[]
  };
  const prompt = formatMessages(buildMessages(project,'Keep the ferry at the dock.'));
  for (const label of ['IONA_PROFILE_END','IONA_PERSONALITY_END','REN_PROFILE_END','REN_PERSONALITY_END','WRITING_NOTES_END']) {
    assert.ok(prompt.includes(label),label);
  }
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
  assert.match(prompt, /Follow the latest author direction and its requested style, point of view and tense/);
  assert.match(prompt, /Earlier directions belong to earlier turns/);
  assert.match(prompt, /third-person past-tense prose/);
  assert.match(prompt, /Use first-person present and a dry tone\./);
  assert.doesNotMatch(prompt, /Current speaker:/);
  assert.match(prompt, /Mara knows the tide calendar/);
  assert.match(prompt, /Mara: Look east/);
  assert.match(prompt, /\[ASSISTANT\]\s+Iona: A lantern/);
  assert.match(prompt, /Character profiles:\s+Iona\s+Description: Iona keeps the station lit/);
  assert.match(prompt, /Mara\s+Description: Mara knows the tide calendar/);
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

test('the shared prose budget trims history before it drops any story state', () => {
  const messages = Array.from({length:110},(_,i)=>({role:'user',content:'Beat ' + i + ': ' + 'new boat '.repeat(185)}));
  const project = {...story,messages,lore:'The dock is red. '.repeat(4200)};
  const large = buildWritingContext(project,'Board the ferry','send',{model:'thedrummer/cydonia-24b-v4.1',openRouter:true});
  const small = buildWritingContext(project,'Board the ferry','send',{model:'fixture/writer',openRouter:true});
  assert.equal(large.problem,'');
  assert.equal(small.problem,'');
  assert.ok(large.messages.length > small.messages.length);
  assert.match(small.messages[0].content,/The dock is red/);
  assert.match(small.messages.at(-2).content,/Beat 109:/);
  assert.equal(small.messages.at(-1).content,'Author direction:\nBoard the ferry');
  const oversized = buildWritingContext({...project,lore:'World '.repeat(70_000)},'Another scene','send',{openRouter:true});
  assert.match(oversized.problem,/shared input budget/);
});

test('the prompt fits relationship history around the recent prose', () => {
  const project = {
    ...story,
    cast:[{id:'ren',name:'Ren'},{id:'mara',name:'Mara'}],
    relationships:Array.from({length:300},(_,index) => ({
      from:'primary',to:index === 0 ? 'ren' : 'mara',turn:index + 1,
      storyTime:'1998-10-25T00:13',label:`Event ${index}: An agreement to share the lighthouse watch whenever high seas delay the ferry.`
    }))
  };
  const large = buildMessages(project,'Ren takes the watch.','send',{model:'thedrummer/cydonia-24b-v4.1',openRouter:true});
  const events = messages => [...messages[0].content.matchAll(/Event (\d+):/g)].map(match => Number(match[1]));
  assert.deepEqual(events(large),Array.from({length:300},(_,index)=>index));
  assert.match(large.at(-1).content,/Ren takes the watch/);
});

test('auto-flagged turns stop at the MCP boundary while OpenRouter keeps scene continuity', () => {
  const project = {...story,messages:[
    {role:'user',content:'PRIVATE_WRITER',contentSensitivity:'explicit'},
    {role:'assistant',content:'UNVERIFIED_REPLY',contentSensitivity:'unclassified'},
    {role:'assistant',content:'HIDDEN_EVERYWHERE',excludeFromContext:true},
    {role:'user',content:'NEXT_SCENE',contentSensitivity:'safe'}
  ]};
  const mcp = formatMessages(buildMessages(project));
  const router = formatMessages(buildMessages(project,'', 'send',{includeSensitive:true,openRouter:true}));
  assert.doesNotMatch(mcp,/PRIVATE_WRITER|UNVERIFIED_REPLY|HIDDEN_EVERYWHERE/);
  assert.match(mcp,/NEXT_SCENE/);
  assert.match(router,/PRIVATE_WRITER/);
  assert.match(router,/UNVERIFIED_REPLY/);
  assert.doesNotMatch(router,/HIDDEN_EVERYWHERE/);
  assert.doesNotMatch(router,/JSON Schema|Classify authorDirection/);
  const generalArtist = formatMessages(buildMessages(project,'','send',{openRouter:true}));
  assert.doesNotMatch(generalArtist,/PRIVATE_WRITER|UNVERIFIED_REPLY|HIDDEN_EVERYWHERE/);
});

test('OpenRouter grounds a short follow-up in the latest narration', () => {
  const project = {...story,messages:[
    {role:'user',content:'Ren asks about the radio.'},
    {role:'assistant',content:'Iona set the broken radio on the ticket counter.',contentSensitivity:'explicit'}
  ]};
  const messages = buildMessages(project,'go into more detail','send',{
    model:'thedrummer/cydonia-24b-v4.1',includeSensitive:true,openRouter:true
  });
  assert.deepEqual(messages.map(message=>message.role),['system','user','assistant','user']);
  assert.match(messages[0].content,/“Go into more detail” means expand the relevant beat in place/);
  assert.match(messages[0].content,/Author’s note:\s+Keep it tense/);
  assert.match(messages[0].content,/Post-history instructions:\s+End on a clue/);
  assert.match(messages[0].content,/Keep restatements of the assignment, planning commentary, and speaker labels out of the prose/);
  assert.match(messages.at(-2).content,/Iona set the broken radio on the ticket counter/);
  assert.equal(messages.at(-1).content,'Author direction:\ngo into more detail');
  assert.match(buildMessages(project,'go into more detail','send',{maintainGraph:true})[0].content,
    /“Go into more detail” means expand the relevant beat in place/);
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

test('a saved persona becomes one ordinary cast member in prompts', () => {
  const project = migrateLegacyCast({...story, cast:[{id:'ren',name:'Ren',description:'Repairs radios.'}]});
  assert.equal(project.storyWriterId,undefined);
  assert.equal(project.persona,undefined);
  assert.equal(project.characterName,undefined);
  assert.deepEqual(project.cast.map(({id,name})=>[id,name]),[['primary','Iona'],['ren','Ren']]);
  assert.equal(migrateLegacyCast(project),project);
  const prompt = formatMessages(buildMessages(project));
  assert.match(prompt,/Ren\s+Description: Repairs radios\./);
  assert.doesNotMatch(prompt,/Writer character:|Other cast:/);
});

test('MCP compatibility parser does not save an incomplete graph block as prose', () => {
  assert.deepEqual(splitAgentReply('Prose.\n```story-graph\n{"incomplete":'),{text:'Prose.',suggestions:[]});
});
