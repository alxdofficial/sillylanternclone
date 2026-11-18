import assert from 'node:assert/strict';
import test from 'node:test';
import { changedScenes } from '../public/time-machine.js';

test('version comparison distinguishes manuscript moves, prose revisions, additions, and removals',()=>{
  const prose = (turnNumber,content)=>({turnNumber,content,role:'assistant'});
  const before = {messages:[prose(1,'Opening scene.'),prose(2,'The earlier dialogue.'),prose(3,'Cut scene.')]};
  const after = {messages:[prose(1,'Opening scene.'),prose(2,'The new dialogue.'),prose(4,'New scene.')],
    sceneBoard:{chapters:[[2],[1,4]]}};
  assert.deepEqual(changedScenes(before,after).map(scene=>[scene.turn,scene.change]),
    [[2,'Edited and moved'],[1,'Moved'],[4,'Added'],[3,'Removed']]);
  assert.deepEqual(changedScenes(before,before),[]);
});
