import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeLibrary, sameValue } from '../public/sync.js';
import { starterStoryId } from '../public/library.js';

const clone = value => structuredClone(value);

function library() {
  return {
    activeId:'ferry',
    projects:[
      {
        id:'ferry', title:'The Ferry', character:'Iona', persona:'', lore:'Fog over the harbour.', notes:'',
        cast:[{id:'ada', name:'Ada', nickname:'', description:'A mechanic.', personality:'', scenario:'', examples:''}],
        relationships:[{from:'ada', to:'speaker', label:'Met at the dock', turn:1, storyTime:'2026-01-01T08:00'}],
        storyStartAt:'2026-01-01T08:00', storyStartSource:'author', nextTurn:4,
        agentRequest:{mode:'send', speakerId:'speaker', turnNumber:3},
        messages:[
          {role:'user', content:'We board.', turnNumber:1},
          {role:'assistant', content:'The ferry sways.', turnNumber:2, speakerId:'speaker', speakerName:'Iona',
            graphSuggestions:[{kind:'character', name:'Ada', note:'Fixes the engine.'}]},
          {role:'user', content:'Ada opens the hatch.', turnNumber:3}
        ]
      },
      {id:'other', title:'Other', character:'', persona:'', lore:'', notes:'', messages:[]}
    ]
  };
}

// What submit_reply saves for the queued turn.
function agentReply(value) {
  const project = value.projects[0];
  project.messages[2].storyTime = '2026-01-01T09:00';
  project.messages.push({role:'assistant', content:'Steam pours out.', turnNumber:4, speakerId:'speaker', speakerName:'Iona', storyTime:'2026-01-01T09:05'});
  project.nextTurn = 5;
  delete project.agentRequest;
  return value;
}

test('deep equality ignores key order and undefined properties', () => {
  assert.ok(sameValue({a:1, b:[{c:2, d:3}]}, {b:[{d:3, c:2}], a:1, e:undefined}));
  assert.ok(!sameValue({a:[1, 2]}, {a:[2, 1]}));
});

test('agent reply merges with cast edits', () => {
  const base = library(), local = clone(base), server = agentReply(clone(base));
  local.projects[0].cast[0].description = 'A mechanic who hates fog.';
  const {library:merged, conflicts} = mergeLibrary(base, local, server);
  assert.deepEqual(conflicts, []);
  const story = merged.projects[0];
  assert.equal(story.cast[0].description, 'A mechanic who hates fog.');
  assert.equal(story.messages.length, 4);
  assert.equal(story.messages[3].content, 'Steam pours out.');
  assert.equal(story.messages[2].storyTime, '2026-01-01T09:00');
  assert.equal(story.nextTurn, 5);
  assert.equal(story.agentRequest, undefined);
});

test('automatic graph updates merge with a concurrent edit to writing notes', () => {
  const base = library(), local = clone(base), server = agentReply(clone(base));
  local.projects[0].notes = 'Stay in Ada’s point of view.';
  server.projects[0].continuity = 'Turn 4: The boiler is hot.';
  server.projects[0].messages[3].appliedGraphUpdates = [{kind:'fact',note:'The boiler is hot.'}];
  const {library:merged,conflicts} = mergeLibrary(base,local,server);
  assert.deepEqual(conflicts,[]);
  assert.equal(merged.projects[0].notes,'Stay in Ada’s point of view.');
  assert.equal(merged.projects[0].continuity,'Turn 4: The boiler is hot.');
  assert.deepEqual(merged.projects[0].messages[3].appliedGraphUpdates,server.projects[0].messages[3].appliedGraphUpdates);
});

test('agent reply merges with a kept map update on an earlier turn', () => {
  const base = library(), local = clone(base), server = agentReply(clone(base));
  const kept = local.projects[0];
  kept.cast[0].description = 'A mechanic. Fixes the engine.';
  delete kept.messages[1].graphSuggestions;
  kept.graphHistory = [{turn:2, cast:kept.cast}];
  const {library:merged, conflicts} = mergeLibrary(base, local, server);
  assert.deepEqual(conflicts, []);
  const story = merged.projects[0];
  assert.equal(story.messages[1].graphSuggestions, undefined);
  assert.equal(story.cast[0].description, 'A mechanic. Fixes the engine.');
  assert.deepEqual(story.messages.map(m => m.turnNumber), [1, 2, 3, 4]);
  assert.equal(story.messages[3].content, 'Steam pours out.');
  assert.ok(story.graphHistory);
});

test('both sides editing the same field is a conflict', () => {
  const base = library(), local = clone(base), server = agentReply(clone(base));
  local.projects[0].lore = 'Clear skies.';
  server.projects[0].lore = 'Snow over the harbour.';
  const result = mergeLibrary(base, local, server);
  assert.equal(result.library, null);
  assert.match(result.conflicts.join(), /The Ferry.*lore/);

  const turnLocal = clone(base), turnServer = clone(base);
  turnLocal.projects[0].messages[1].content = 'The ferry rocks.';
  turnServer.projects[0].messages[1].content = 'The ferry rolls.';
  assert.match(mergeLibrary(base, turnLocal, turnServer).conflicts.join(), /turn 2/);
});

test('agent clearing the queue merges with edits to another story', () => {
  const base = library(), local = clone(base), server = clone(base);
  local.projects[1].notes = 'Write in the past tense.';
  local.activeId = 'other';
  delete server.projects[0].agentRequest;
  server.projects[0].agentNotice = {turnNumber:3, message:'I will not write this scene.'};
  const {library:merged, conflicts} = mergeLibrary(base, local, server);
  assert.deepEqual(conflicts, []);
  assert.equal(merged.activeId, 'other');
  assert.equal(merged.projects[0].agentRequest, undefined);
  assert.equal(merged.projects[0].agentNotice.message, 'I will not write this scene.');
  assert.equal(merged.projects[1].notes, 'Write in the past tense.');
  assert.strictEqual(merged.projects[1], local.projects[1]);
});

test('alternate take merges with an edit to an older turn', () => {
  const base = library();
  base.projects[0].messages.pop();
  base.projects[0].nextTurn = 3;
  base.projects[0].agentRequest = {mode:'alternate', speakerId:'speaker', turnNumber:2};
  const local = clone(base), server = clone(base);
  local.projects[0].messages[0].content = 'We board at dawn.';
  const reply = server.projects[0].messages[1];
  Object.assign(reply, {alternatives:['The ferry sways.', 'The ferry groans.'], selectedAlternative:1, content:'The ferry groans.'});
  delete server.projects[0].agentRequest;
  const {library:merged, conflicts} = mergeLibrary(base, local, server);
  assert.deepEqual(conflicts, []);
  const [first, second] = merged.projects[0].messages;
  assert.equal(first.content, 'We board at dawn.');
  assert.equal(second.content, 'The ferry groans.');
  assert.deepEqual(second.alternatives, ['The ferry sways.', 'The ferry groans.']);
  assert.equal(second.selectedAlternative, 1);
  assert.equal(merged.projects[0].agentRequest, undefined);
});

test('deleting an old turn merges with an agent reply', () => {
  const base = library(), local = clone(base), server = agentReply(clone(base));
  local.projects[0].messages.splice(0, 1);
  const {library:merged, conflicts} = mergeLibrary(base, local, server);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged.projects[0].messages.map(m => m.turnNumber), [2, 3, 4]);

  // A turn deleted on one side but edited on the other is not dropped silently.
  const edited = agentReply(clone(base));
  edited.projects[0].messages[0].content = 'We board quietly.';
  assert.match(mergeLibrary(base, local, edited).conflicts.join(), /turn 1/);
});

test('stories added or removed on one side follow that side', () => {
  const base = library(), local = clone(base), server = clone(base);
  local.projects.push({id:'new', title:'New', character:'', persona:'', lore:'', notes:'', messages:[]});
  server.projects.splice(1, 1);
  const {library:merged} = mergeLibrary(base, local, server);
  assert.deepEqual(merged.projects.map(p => p.id), ['ferry', 'new']);
});

test('an open tab cannot revive stale demo edits but keeps concurrent regular story edits', () => {
  const base = library();
  base.projects.push({id:starterStoryId,title:'The demo',messages:[]});
  const local = clone(base), server = clone(base);
  local.projects[0].notes = 'Unrelated saved-story notes.';
  local.projects.at(-1).messages.push({turnNumber:1,role:'user',content:'Stale demo edit'});
  const {library:merged} = mergeLibrary(base,local,server,{demoReset:true});
  assert.deepEqual(merged.projects.at(-1).messages,[]);
  assert.equal(merged.projects[0].notes,'Unrelated saved-story notes.');
});
