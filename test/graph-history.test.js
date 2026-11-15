import assert from 'node:assert/strict';
import test from 'node:test';
import { captureGraphVersion, normalizeGraphHistory, readGraphVersion } from '../public/graph-history.js';

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
  assert.equal(early.cast[1].description, 'Restores old boats.');
  assert.equal(early.cast[0].nickname, 'Captain, Ion');
  assert.equal(early.cast[0].examples, '“We weigh anchor at first light.”');
  const latest = readGraphVersion(project, 10);
  assert.equal(latest.lore, 'The last ice has melted.');
  assert.equal(latest.cast[1].description, 'Restores old boats and captains the Breakwater.');
  assert.equal(latest.continuity, 'Ada bought the Breakwater.');

  latest.cast[1].description = 'Detach this edit from the stored timeline.';
  assert.equal(readGraphVersion(project, 10).cast[1].description, 'Restores old boats and captains the Breakwater.');
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
  assert.equal(readGraphVersion(project, 1).cast[0].description, 'A navigator who trusts the winter stars.');
  assert.equal(readGraphVersion(project, 2).cast[0].description, 'A navigator with a new first mate.');
  assert.equal(readGraphVersion(project, 2).lore, 'The launch is underwater.');
  assert.throws(() => captureGraphVersion(project, 1), /before the latest version/);
});

test('malformed backups are rejected rather than returning incorrect past states', () => {
  assert.deepEqual(normalizeGraphHistory(undefined), []);
  assert.throws(() => normalizeGraphHistory({}), /array/);
  assert.throws(() => normalizeGraphHistory([{turn:1,lore:'A port.'}]), /complete version/);
  const project = story();
  captureGraphVersion(project, 0);
  assert.throws(() => normalizeGraphHistory([...project.graphHistory,{turn:0,lore:'Duplicate'}]), /strictly increasing/);
  assert.throws(() => normalizeGraphHistory([...project.graphHistory,{turn:1,continuity:10}]), /invalid section/);
});
