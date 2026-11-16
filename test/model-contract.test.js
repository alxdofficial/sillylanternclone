import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessages, clipEnds, dateWriterTurn, formatMessages, narrator, replyInput, stripSpeakerName, syncTakeSuggestions } from '../public/prompt.js';
import { canWriteSensitive, isContinuityModel, modelLabel, models } from '../public/models.js';
import { checkMapUpdates } from '../map-updates.mjs';
import { continuityMessages } from '../continuity.mjs';
import { isWritingRefusal, stripWritingPreamble } from '../openrouter-format.mjs';

const story = (messages, agentRequest) => ({
  id:'s', title:'T', characterName:'Mara', character:'An archivist.', persona:'', lore:'', notes:'',
  cast:[{id:'iona', name:'Iona', nickname:'', description:'A pilot.', personality:'', scenario:'', examples:''}],
  messages, agentRequest
});

test('sensitive routing uses separate writer and tool-capable continuity allowlists', () => {
  assert.deepEqual(models.filter(({id})=>canWriteSensitive(id)).map(model=>modelLabel(model)),[
    'Cydonia 24B v4.1 · NSFW-friendly','Dolphin Mistral 24B Venice · NSFW-friendly'
  ]);
  assert.equal(canWriteSensitive('deepseek/deepseek-v4.1-flash'),false);
  assert.equal(canWriteSensitive('someone/custom'),false);
  assert.deepEqual(models.filter(({id})=>isContinuityModel(id,true)).map(({id})=>id),[
    'deepseek/deepseek-v4.1-flash','mistralai/mistral-large-4-0','x-ai/grok-4.7'
  ]);
  assert.equal(isContinuityModel('openai/gpt-6.1-terra',false),true);
  assert.equal(isContinuityModel('openai/gpt-6.1-terra',true),false);
  for (const id of ['nousresearch/hermes-4-70b','nousresearch/hermes-4-405b','thedrummer/valkyrie-49b-v1']) {
    assert.equal(models.some(model=>model.id === id),false);
  }
  assert.equal(models.some(model => model.id === 'gryphe/mythomax-l2-13b'),false);
});

test('OpenRouter strips a specific assignment aside and preserves narration and quoted dialogue', () => {
  const first = 'Lina watched the wharf.';
  const scene = 'Ellis set the ledger on the desk.';
  const aside = 'I’ve been instructed to write approximately 250 words about the incident book.';
  assert.equal(stripWritingPreamble(`${first} ${aside}\n\n${scene}`),`${first}\n\n${scene}`);
  const dialogue = `“Stay here. ${aside} The police are waiting.”\n\n${scene}`;
  assert.equal(stripWritingPreamble(dialogue),dialogue);
});

test('a refusal spoken by a character is still story prose', () => {
  assert.equal(isWritingRefusal('“I can’t help with that request,” said the lighthouse keeper.'),false);
  assert.equal(isWritingRefusal('I cannot help with that request. I can offer a different scene.'),true);
});

test('a reply to the last writer turn uses it as the direction, like a new direction', () => {
  const project = story([{role:'assistant', content:'Mara waits.', turnNumber:1}, {role:'user', content:'Iona arrives with the key.', turnNumber:2}]);
  const input = replyInput(project, 'send');
  assert.equal(input.mode, 'send');
  assert.equal(input.direction, 'Iona arrives with the key.');
  const queued = formatMessages(buildMessages(input.project, input.direction, input.mode));
  const typed = formatMessages(buildMessages({...project, messages:project.messages.slice(0, 1)}, 'Iona arrives with the key.', 'send'));
  assert.equal(queued, typed);
  assert.equal(replyInput(project, 'alternate').project.messages.length, 1);
});

test('replies retain the dated direction without exposing a withheld writer turn', () => {
  const writer = {role:'user',content:'PRIVATE_MARKER',storyTime:'1998-10-25T00:01',contentSensitivity:'explicit'};
  const project = story([writer]);
  const hidden = replyInput(project,'send');
  assert.equal(hidden.direction,'');
  assert.doesNotMatch(formatMessages(buildMessages(hidden.project,hidden.direction,hidden.mode)),/PRIVATE_MARKER/);
  const visible = replyInput(project,'send',{includeSensitive:true});
  assert.equal(visible.direction,writer.content);
  assert.match(formatMessages(buildMessages(visible.project,visible.direction,visible.mode,{includeSensitive:true})),/Dated writer turn:\n1998-10-25T00:01/);
  assert.equal(replyInput(story([{...writer,excludeFromContext:true}]),'send',{includeSensitive:true}).direction,'');
});

test('writer turns share their reply’s scene time and replies lose a copied name prefix', () => {
  const project = story([{role:'user', content:'Go.', turnNumber:1}, {role:'assistant', content:'Gone.', turnNumber:2, storyTime:'1904-09-23T08:30'}]);
  dateWriterTurn(project);
  assert.equal(project.messages[0].storyTime, '1904-09-23T08:30');
  assert.equal(stripSpeakerName('Mara: She waits.', 'Mara'), 'She waits.');
  assert.equal(stripSpeakerName('**Mara**: She waits.', 'Mara'), 'She waits.');
  assert.equal(stripSpeakerName('Mara waits: then runs.', 'Mara'), 'Mara waits: then runs.');
});

test('long notes keep their opening and their newest kept facts', () => {
  const notes = 'Opening setting. ' + 'x'.repeat(20000) + '\nTurn 40: The tide cuts off the footpath.';
  const clipped = clipEnds(notes, 12000);
  assert.ok(clipped.length <= 12000);
  assert.match(clipped, /^Opening setting\./);
  assert.match(clipped, /Turn 40: The tide cuts off the footpath\.$/);
  const project = {...story([]), lore:notes};
  assert.match(formatMessages(buildMessages(project)), /The tide cuts off the footpath/);
});

test('map updates follow the first take and are set aside for other takes', () => {
  const message = {role:'assistant', content:'B', alternatives:['A', 'B'], selectedAlternative:1, graphSuggestions:[{kind:'plot', note:'From A.'}]};
  syncTakeSuggestions(message);
  assert.equal(message.graphSuggestions, undefined);
  message.selectedAlternative = 0;
  syncTakeSuggestions(message);
  assert.equal(message.graphSuggestions[0].note, 'From A.');
  assert.equal(message.firstTakeSuggestions, undefined);
});

test('only the continuity prompt describes map edits and supplies the new draft', () => {
  const prompt = formatMessages(buildMessages(story([{role:'user', content:'Go.', turnNumber:1}])));
  assert.doesNotMatch(prompt,/record_scene|submit_reply’s updates array/);
  const messages = continuityMessages(story([]),'Go.','Mara handed her the log.',{suggest:true,mode:'send'});
  const [analysis] = messages;
  const source = messages.at(-1);
  assert.match(analysis.content,/Use inspect_continuity/);
  assert.match(analysis.content,/Finish with record_scene/);
  assert.match(analysis.content,/Never include or paraphrase graphic/);
  assert.ok(messages.some(message=>message.content === 'Cast:\nMara\nIona'));
  assert.equal(JSON.parse(source.content).draft,'Mara handed her the log.');
});

test('structured updates reject alias-based self-events and report invalid OpenRouter updates', () => {
  const project = story([]);
  project.characterNickname = 'Archivist, Iona';
  const updates = [
    {kind:'relationship',from:'Archivist',to:'Mara',label:'They meet.'},
    {kind:'relationship',from:'Mara',to:'Iona',label:'Mara gives Iona the log.'},
    {kind:'relationship',from:'Unknown',to:'Iona',label:'A name outside the cast.'}
  ];
  const parsed = checkMapUpdates(project,updates);
  assert.equal(parsed.rejections.length,2);
  assert.deepEqual(parsed.updates,[updates[1]]);
});
