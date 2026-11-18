import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLibrary } from '../public/library-normalize.js';

test('library normalization preserves unfamiliar metadata and existing alternate takes',()=>{
  const data = {
    activeId:'draft',futureLibrary:{label:'Imported backup'},
    projects:[{
      id:'draft',title:'Ferry',authorNote:'Keep the bell audible.',
      futureStory:{tags:['harbor']},
      cast:[{id:'mina',name:'Mina',description:'',futureCast:{occupation:'pilot'}}],
      messages:[{
        role:'assistant',content:'The ferry leaves.',turnNumber:3,
        alternatives:['The ferry arrives.','The ferry leaves.'],selectedAlternative:1,
        contentSensitivity:'reviewed-safe',alternativeSensitivities:['unclassified','reviewed-safe'],
        futureTurn:{source:'author'}
      }]
    }]
  };
  const snapshot = structuredClone(data);
  const normalized = normalizeLibrary(data);
  const [project] = normalized.projects;
  assert.deepEqual(data,snapshot);
  assert.deepEqual(normalized.futureLibrary,data.futureLibrary);
  assert.deepEqual(project.futureStory,data.projects[0].futureStory);
  assert.deepEqual(project.cast[0].futureCast,data.projects[0].cast[0].futureCast);
  assert.deepEqual(project.messages,data.projects[0].messages);
  assert.equal(project.notes,'Keep the bell audible.');
  assert.equal(Object.hasOwn(project,'authorNote'),false);
  assert.deepEqual(normalizeLibrary(normalized),normalized);
});
