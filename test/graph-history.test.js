import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTurnGraphUpdates, captureGraphVersion, graphChangesByTurn, normalizeGraphHistory, readGraphVersion, storyAtTurn } from '../public/graph-history.js';
import { buildWritingContext, migrateStoryFields } from '../public/prompt.js';
import { applyStoryEdits } from '../story-edits.mjs';

function story() {
  return {
    characterName:'Iona',
    characterNickname:'Captain, Ion',
    character:'A navigator who trusts the winter stars.',
    personality:'Direct, generous.',
    scenario:'The crew reaches a coastal town.',
    examples:'“We weigh anchor at first light.”',
    cast:[{id:'ada',name:'Ada',nickname:'The mechanic',description:'Restores old boats.',personality:'Quiet.',scenario:'The workshop.',examples:'“Try the blue lever.”'}],
    lore:'The port is blocked by ice.',
    continuity:'The crew borrowed a flare.'
  };
}

test('turn graph changes use saved source turns and omit pending proposals', () => {
  const project = story();
  project.lore += '\nTurn 7: The south slip is open.';
  project.plotEvents = [{note:'Ada located the missing lantern.',turn:5,storyTime:'1998-01-01T08:05'}];
  project.relationships = [
    {turn:0,from:'primary',to:'ada',label:'They have worked together for years.'},
    {turn:5,from:'primary',to:'ada',label:'Iona lends Ada the spare key.'}
  ];
  project.messages = [{
    turnNumber:5,
    appliedGraphUpdates:[
      {kind:'plot',note:'Ada located the missing lantern.'},
      {kind:'character',name:'Tomas',note:'The night watchman.'}
    ],
    graphSuggestions:[{kind:'plot',note:'Pending fact only.'}]
  }];
  const changes = graphChangesByTurn(project);
  assert.equal(changes.has(0),false);
  assert.deepEqual(changes.get(5),{
    relationships:[project.relationships[1]],
    notes:[project.messages[0].appliedGraphUpdates[1],{kind:'plot',...project.plotEvents[0]}]
  });
  assert.deepEqual(changes.get(7).notes,[{kind:'world',note:'The south slip is open.'}]);
});

test('graph changes reconstruct detailed character and world states by turn', () => {
  const project = story();
  assert.equal(readGraphVersion(project, 0), null);
  assert.equal(captureGraphVersion(project, 0), true);
  assert.equal(captureGraphVersion(project, 1), false);

  project.lore = 'The last ice has melted.';
  assert.equal(captureGraphVersion(project, 6), true);
  assert.deepEqual(project.graphHistory[1], {turn:6,lore:'The last ice has melted.'});

  project.cast[0].description = 'Restores old boats and captains the Breakwater.';
  project.continuity = 'Ada bought the Breakwater.';
  assert.equal(captureGraphVersion(project, 9), true);
  assert.equal(Object.hasOwn(project.graphHistory[2], 'lore'), false);

  const early = readGraphVersion(project, 5);
  assert.equal(early.lore, 'The port is blocked by ice.');
  assert.match(early.cast[1].description, /^Restores old boats\..*Quiet\..*blue lever/s);
  assert.equal(early.cast[0].nickname, 'Captain, Ion');
  assert.match(early.cast[0].description, /We weigh anchor at first light/);
  const latest = readGraphVersion(project, 10);
  assert.equal(latest.lore, 'The last ice has melted.');
  assert.match(latest.cast[1].description, /^Restores old boats and captains the Breakwater\./);
  assert.equal(latest.continuity, undefined);

  latest.cast[1].description = 'Detach this edit from the stored timeline.';
  assert.match(readGraphVersion(project, 10).cast[1].description, /^Restores old boats and captains the Breakwater\./);
  assert.deepEqual(normalizeGraphHistory(JSON.parse(JSON.stringify(project.graphHistory))), project.graphHistory);
});

test('same-turn saves coalesce without changing earlier versions', () => {
  const project = story();
  captureGraphVersion(project, 0);
  project.character = 'A navigator with a new first mate.';
  captureGraphVersion(project, 2);
  project.lore = 'The launch is underwater.';
  captureGraphVersion(project, 2);
  assert.equal(project.graphHistory.length, 2);
  assert.match(readGraphVersion(project, 1).cast[0].description, /^A navigator who trusts the winter stars\./);
  assert.match(readGraphVersion(project, 2).cast[0].description, /^A navigator with a new first mate\./);
  assert.equal(readGraphVersion(project, 2).lore, 'The launch is underwater.');
  assert.throws(() => captureGraphVersion(project, 1), /before the latest version/);
});

test('rewinding a legacy story keeps its separate persona as an ordinary cast member', () => {
  const project = {
    ...story(),
    personaName:'Ren',
    persona:'Repairs radios.',
    messages:[{role:'assistant',content:'The fleet waits at the port.'}],
    graphHistory:[{turn:0,lore:'{{user}} waits for {{char}} at the port.',continuity:'',
      cast:[{id:'primary',name:'Iona',nickname:'',description:'Trusts the winter stars.',personality:'',scenario:'',examples:''}]
    }]
  };
  const snapshot = storyAtTurn(project,0);
  assert.deepEqual(snapshot.cast.map(({name})=>name),['Iona','Ren']);
  assert.equal(snapshot.lore,'Ren waits for Iona at the port.');
  assert.equal(snapshot.personaName,undefined);
  assert.equal(project.graphHistory[0].cast.length,1);
});

test('malformed backups are rejected rather than returning incorrect past states', () => {
  assert.deepEqual(normalizeGraphHistory(undefined), []);
  assert.throws(() => normalizeGraphHistory({}), /array/);
  assert.throws(() => normalizeGraphHistory([{turn:1,lore:'A port.'}]), /complete version/);
  const project = story();
  captureGraphVersion(project, 0);
  assert.throws(() => normalizeGraphHistory([...project.graphHistory,{turn:0,lore:'Duplicate'}]), /strictly increasing/);
  assert.throws(() => normalizeGraphHistory([...project.graphHistory,{turn:1,lore:10}]), /invalid section/);
});

test('a turn snapshot keeps the selected take and past graph state without changing the original', () => {
  const project = story();
  project.messages = [
    {turnNumber:1,role:'user',content:'Look east.'},
    {turnNumber:4,role:'assistant',content:'East is clear.',alternatives:['Ice ahead.','East is clear.'],selectedAlternative:1},
    {turnNumber:7,role:'assistant',content:'The storm hits.'}
  ];
  project.agentRequest = {mode:'alternate',turnNumber:7,speakerId:'primary'};
  project.nextTurn = 8;
  project.relationships = [
    {from:'primary',to:'ada',label:'They met at the port.',turn:0,storyTime:'1998-01-01T08:00'},
    {from:'primary',to:'ada',label:'Iona shares a map.',turn:4,storyTime:'1998-01-01T08:10'},
    {from:'ada',to:'primary',label:'Ada calls a warning.',turn:7,storyTime:'1998-01-01T08:05'}
  ];
  captureGraphVersion(project,0);
  project.lore = 'Both boats have cleared the ice.';
  captureGraphVersion(project,4);
  project.lore = 'The storm blocks the port.';
  project.continuity = 'The crew lost the flare.';
  project.cast[0].description = 'Ada lost her boat in the storm.';
  captureGraphVersion(project,7);

  const snapshot = storyAtTurn(project,1);
  assert.deepEqual(snapshot.messages.map(message => message.turnNumber), [1,4]);
  assert.equal(snapshot.messages[1].selectedAlternative,1);
  assert.equal(snapshot.nextTurn,5);
  assert.equal(snapshot.agentRequest,undefined);
  assert.equal(snapshot.lore,'Both boats have cleared the ice.');
  assert.equal(snapshot.continuity,undefined);
  assert.match(snapshot.cast.find(member=>member.id === 'ada').description,/^Restores old boats\./);
  assert.deepEqual(snapshot.relationships.map(edge => edge.turn),[0,4]);
  assert.deepEqual(snapshot.graphHistory.map(version => version.turn),[0,4]);
  snapshot.messages[1].alternatives[0] = 'Branch-only take.';
  assert.equal(project.messages[1].alternatives[0],'Ice ahead.');
  assert.equal(project.messages.length,3);
  assert.equal(project.lore,'The storm blocks the port.');
});

test('automatic graph updates are saved with their source turn and the prior version', () => {
  const project = story(), message = {role:'assistant',turnNumber:2,storyTime:'1998-01-01T08:05'};
  project.messages = [message];
  const updates = [
    {kind:'relationship',from:'Captain',to:'Tomas',label:'Iona hands Tomas the flare.'},
    {kind:'character',name:'Tomas',note:'A night watchman.'},
    {kind:'plot',note:'Tomas can call for help.'}
  ];
  assert.deepEqual(applyTurnGraphUpdates(project,message,updates,{allowAutomatic:true}),{applied:3,pending:0});
  assert.equal(project.relationships[0].turn,2);
  assert.equal(project.relationships[0].storyTime,'1998-01-01T08:05');
  assert.equal(project.cast.find(member=>member.name === 'Tomas').id,project.relationships[0].to);
  assert.deepEqual(message.appliedGraphUpdates,[updates[1],updates[0],updates[2]]);
  assert.equal(readGraphVersion(project,0).cast.length,2);
  assert.equal(readGraphVersion(project,2).cast.length,3);
  assert.deepEqual(project.plotEvents,[{note:'Tomas can call for help.',turn:2,storyTime:'1998-01-01T08:05'}]);
});

test('updates needing review remain outside the saved graph', () => {
  const project = story(), message = {role:'assistant',turnNumber:2,contentSensitivity:'explicit'};
  const updates = [{kind:'world',note:'The harbor is closed tonight.'}];
  project.messages = [message];
  assert.deepEqual(applyTurnGraphUpdates(project,message,updates,{allowAutomatic:false}),{applied:0,pending:1});
  assert.deepEqual(message.graphSuggestions,updates);
  assert.equal(project.lore,'The port is blocked by ice.');
  assert.equal(project.graphHistory,undefined);
});

test('legacy notes and profile details are consolidated while retired story memory is ignored', () => {
  const project = {
    notes:'Use short sentences.', authorNote:'Define jargon in context.', postHistory:'RETIRED INSTRUCTION',
    continuity:'RETIRED MEMORY', lore:'An island.', cast:[{id:'ada',name:'Ada',nickname:'Pilot',
      description:'Repairs radios.',personality:'Patient.',scenario:'Marooned.',examples:'“Did you hear that?”'}],
    messages:[{role:'assistant',content:'A radio crackled.',appliedGraphUpdates:[{kind:'fact',note:'RETIRED RECEIPT'}]}],
    graphHistory:[{turn:0,cast:[],lore:'An island.',continuity:'RETIRED SNAPSHOT'}]
  };
  migrateStoryFields(project);
  assert.equal(project.notes,'Use short sentences.\n\nDefine jargon in context.');
  assert.deepEqual(Object.keys(project.cast[0]).sort(),['description','id','name','nickname']);
  assert.match(project.cast[0].description,/Patient\..*Marooned\..*Did you hear that/s);
  assert.doesNotMatch(JSON.stringify(project),/RETIRED/);
  assert.doesNotMatch(JSON.stringify(buildWritingContext(project,'Continue.')),/RETIRED/);
});

test('plot events can be added, updated, and excluded by rewinding their source turn', () => {
  const project = {title:'A harbor',messages:[{role:'assistant',content:'Wait.',turnNumber:1},
    {role:'assistant',content:'The ferry docked.',turnNumber:2,storyTime:'1998-01-01T08:05'}],lore:'A port.',notes:''};
  assert.equal(applyStoryEdits(project,[{kind:'plot',note:'The ferry docked.'}]),1);
  assert.deepEqual(project.plotEvents,[{note:'The ferry docked.',turn:2,storyTime:'1998-01-01T08:05'}]);
  assert.equal(applyStoryEdits(project,[{kind:'edit_plot',eventIndex:0,note:'The second ferry docked.'}]),1);
  assert.match(JSON.stringify(buildWritingContext(project,'Continue.')),/The second ferry docked/);
  assert.deepEqual(storyAtTurn(project,0).plotEvents,[]);
  assert.equal(applyStoryEdits(project,[{kind:'remove_plot',eventIndex:0}]),1);
  assert.deepEqual(project.plotEvents,[]);
});
