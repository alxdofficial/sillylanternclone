import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessages, clipEnds, dateWriterTurn, formatMessages, queuedTurn, replyInput, splitOpenRouterReply, stripSpeakerName, syncTakeSuggestions } from '../public/prompt.js';
import { checkMapUpdates } from '../map-updates.mjs';

const story = (messages, agentRequest) => ({
  id:'s', title:'T', characterName:'Mara', character:'An archivist.', persona:'', lore:'', notes:'',
  cast:[{id:'iona', name:'Iona', nickname:'', description:'A pilot.', personality:'', scenario:'', examples:''}],
  messages, agentRequest
});

test('a queued turn is only valid while it still matches the story, its speaker and MCP context', () => {
  const writer = {role:'user', content:'Cross the bridge.', turnNumber:2};
  const reply = {role:'assistant', content:'Mara crosses.', turnNumber:1};
  assert.deepEqual(queuedTurn(story([reply, writer], {mode:'send', speakerId:'iona', turnNumber:2})).request,
    {mode:'send', speakerId:'iona', turnNumber:2});
  assert.match(queuedTurn(story([reply, writer], {mode:'send', speakerId:'gone', turnNumber:2})).problem, /no longer in the cast/);
  assert.match(queuedTurn(story([reply, writer], {mode:'send', speakerId:'iona', turnNumber:1})).problem, /queued turn changed/);
  assert.match(queuedTurn(story([reply, {...writer, contentSensitivity:'explicit'}], {mode:'send', speakerId:'iona', turnNumber:2})).problem, /outside MCP context/);
  assert.equal(queuedTurn(story([reply])).request, null);
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
  const message = {role:'assistant', content:'B', alternatives:['A', 'B'], selectedAlternative:1, graphSuggestions:[{kind:'fact', note:'From A.'}]};
  syncTakeSuggestions(message);
  assert.equal(message.graphSuggestions, undefined);
  message.selectedAlternative = 0;
  syncTakeSuggestions(message);
  assert.equal(message.graphSuggestions[0].note, 'From A.');
  assert.equal(message.firstTakeSuggestions, undefined);
});

test('the MCP map-update instruction names the updates array and event-style relationships', () => {
  const prompt = formatMessages(buildMessages(story([{role:'user', content:'Go.', turnNumber:1}]), '', 'continue', {maintainGraph:true}));
  assert.match(prompt, /submit_reply’s updates array/);
  assert.match(prompt, /One sentence: what happened between them/);
  assert.match(prompt, /Exact cast names: Mara, Iona/);
  const openRouter = formatMessages(buildMessages(story([]), 'Go.', 'send', {classifySafety:true}));
  assert.match(openRouter, /under about 1,200 words/);
  assert.match(openRouter, /what happened between them/);
  assert.match(openRouter, /Exact cast names: Mara, Iona/);
});

test('structured updates reject alias-based self-events and report invalid OpenRouter updates', () => {
  const project = story([]);
  project.characterNickname = 'Archivist, Iona';
  const updates = [
    {kind:'relationship',from:'Archivist',to:'Mara',label:'They meet.'},
    {kind:'relationship',from:'Mara',to:'Iona',label:'Mara gives Iona the log.'},
    {kind:'relationship',from:'Unknown',to:'Iona',label:'A name outside the cast.'}
  ];
  const content = 'Mara handed her the log.\n```story-safety\n' + JSON.stringify({input:'safe',reply:'safe',updates}) + '\n```';
  const parsed = splitOpenRouterReply(content,value=>checkMapUpdates(project,value));
  assert.equal(parsed.reply,'safe');
  assert.equal(parsed.updateProblems,2);
  assert.deepEqual(parsed.suggestions,[updates[1]]);
  const malformed = splitOpenRouterReply(content + '\nAnother line of prose.');
  assert.equal(malformed.reply,'unclassified');
  assert.match(malformed.text,/Another line of prose\.$/);
});
