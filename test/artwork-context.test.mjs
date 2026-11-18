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
  const passage = artworkPassage(project,reference(scene));
  assert.throws(()=>artworkPassage(project,reference(held)),/available to the general AI context/);
  const mood = {id:'reference',kind:'reference',source:{canonKey:artworkCanonKey(project)},status:'approved'};
  const panel = {id:'illustration',kind:'illustration',placedTurn:1,source:{scene:passage.scene},references:[mood.id],status:'approved'};
  assert.deepEqual(artworkStatus(project,[mood,panel]).map(asset=>asset.stale),[false,false]);
  assert.equal(artworkStatus(project,[panel])[0].stale,true);
  const updated = structuredClone(project);
  updated.messages[0].content = 'The early ferry waited.';
  assert.deepEqual(artworkStatus(updated,[mood,panel]).map(asset=>asset.stale),[false,true]);
  assert.throws(()=>artworkPassage(updated,reference(scene)),/passage changed/);
  assert.equal(project.messages[0].content,'The late ferry waited.');
});
