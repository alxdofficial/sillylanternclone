import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkCanonKey, artworkPassage, artworkStatus } from '../artwork-context.mjs';
import { reference, sceneIndex } from '../public/revision.js';

test('artwork revisions track the passage and referenced artwork without mutating the manuscript',()=>{
  const project = {id:'fixture',title:'Night watch',lore:'A rainy harbor.',messages:[
    {role:'assistant',content:'The late ferry waited.'},
    {role:'assistant',content:'Held fixture.',excludeFromContext:true}
  ]};
  const [scene,held] = sceneIndex(project);
  const passage = artworkPassage(project,reference(scene,4,14));
  assert.throws(()=>artworkPassage(project,reference(held)),/available to the general AI context/);
  const mood = {id:'reference',kind:'reference',source:{canonKey:artworkCanonKey(project)},status:'approved'};
  const panel = {id:'illustration',kind:'illustration',placedTurn:1,source:{scene:passage.scene},references:[mood.id],status:'approved'};
  const original = artworkStatus(project,[mood,panel]);
  assert.deepEqual(original.map(asset=>asset.stale),[false,false]);
  assert.equal(original[0].passageRef,undefined);
  assert.deepEqual(original[1].passageRef,passage.scene);
  assert.equal(artworkStatus(project,[panel])[0].stale,true);
  const updated = structuredClone(project);
  updated.messages[0].content = 'The early ferry waited.';
  const changed = artworkStatus(updated,[mood,panel]);
  assert.deepEqual(changed.map(asset=>asset.stale),[false,true]);
  assert.equal(changed[1].passageRef,undefined);
  assert.equal(changed[1].sceneTurn,scene.turn);
  assert.throws(()=>artworkPassage(updated,reference(scene)),/passage changed/);
  assert.equal(project.messages[0].content,'The late ferry waited.');
});
