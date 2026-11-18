import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUpcomingChapter,manuscriptChapters,moveManuscriptScene,normalizeSceneBoard,readingChapterBreak,
  readingChapters,setUpcomingChapter,toggleReadingChapter,validSceneBoard } from '../public/scene-board.js';
import { appendTurn } from '../public/prompt.js';

function story() {
  return {messages:[
    {role:'user',turnNumber:1,content:'Show Vale checking the boat.'},
    {role:'assistant',turnNumber:2,content:'Vale counted the oars.',storyTime:'2025-02-01T12:00'},
    {role:'assistant',turnNumber:4,content:'A gull landed near the lamp.',storyTime:'2025-02-01T15:00',sourcePrefix:'* * *'},
    {role:'assistant',turnNumber:7,content:'Earlier, she aligned the ropes.',startsChapter:true,storyTime:'2025-02-01T10:00'}
  ],relationships:[{turn:7,text:'Vale helped Sen.'}]};
}

const readingOrder = project=>manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn));

test('scene order can move a stable scene across chapters without changing the writing transcript or graph',()=>{
  const project = story();
  const source = structuredClone(project);
  assert.deepEqual(readingOrder(project),[[2,4],[7]]);
  project.sceneBoard = moveManuscriptScene(project,4,{chapter:2,beforeTurn:7});
  assert.equal(validSceneBoard(project.sceneBoard),true);
  assert.deepEqual(readingOrder(project),[[2],[4,7]]);
  assert.deepEqual(readingChapters(project),[[project.messages[1].content],[project.messages[2].content,project.messages[3].content]]);
  const moved = manuscriptChapters(project)[1][0];
  assert.equal(moved.number,2);
  assert.equal(moved.chapter,2);
  assert.equal(moved.storyTime,'2025-02-01T15:00');
  assert.equal(moved.sourcePrefix,'* * *');
  assert.deepEqual(project.messages,source.messages);
  assert.deepEqual(project.relationships,source.relationships);
});

test('legacy messages, edited chapter breaks, and newly written prose use the same manuscript projection',()=>{
  const project = story();
  assert.equal(readingChapterBreak(project,2),null);
  assert.equal(readingChapterBreak(project,4),false);
  assert.equal(readingChapterBreak(project,7),true);
  project.sceneBoard = toggleReadingChapter(project,4);
  assert.deepEqual(readingOrder(project),[[2],[4],[7]]);
  assert.equal(readingChapterBreak(project,4),true);
  assert.equal(toggleReadingChapter(project,4),undefined);
  project.messages.push(
    {role:'assistant',turnNumber:9,content:'She set the candle down.'},
    {role:'assistant',content:'Sen came to the pier.',startsChapter:true}
  );
  assert.deepEqual(readingOrder(project),[[2],[4],[7,9],[6]]);
});

test('scene-board normalization trims entries for removed scenes and prevents duplicate placements',()=>{
  const project = story();
  const raw = {chapters:[[7,2],[4,999,7]],scenes:{
    2:{pov:'  Vale  ',summary:'Oars are missing.\n\nThey look for them.',status:'revising'},
    4:{pov:4,status:'draft'},
    7:{status:'ready'},
    999:{summary:'Stale scene.'}
  }};
  assert.equal(validSceneBoard(raw),false);
  assert.equal(validSceneBoard({scenes:{2:{status:{toString:null}}}}),false);
  project.sceneBoard = normalizeSceneBoard(project,raw);
  assert.deepEqual(project.sceneBoard,{chapters:[[7,2],[4]],scenes:{
    2:{pov:'Vale',summary:'Oars are missing. They look for them.',status:'revising'},
    7:{status:'ready'}
  }});
  assert.equal(validSceneBoard(project.sceneBoard),true);
  project.messages.pop();
  assert.deepEqual(readingOrder(project),[[2],[4]]);
  assert.deepEqual(normalizeSceneBoard(project).scenes,{2:project.sceneBoard.scenes[2]});
});

test('an upcoming chapter survives a round trip without making an empty chapter and starts at the next prose',()=>{
  const project = story();
  project.sceneBoard = moveManuscriptScene(project,4,{chapter:2,beforeTurn:7});
  project.sceneBoard = setUpcomingChapter(project,true);
  assert.equal(validSceneBoard(project.sceneBoard),true);
  assert.deepEqual(normalizeSceneBoard(project,JSON.parse(JSON.stringify(project.sceneBoard))),project.sceneBoard);
  assert.equal(hasUpcomingChapter(project),true);
  assert.deepEqual(readingOrder(project),[[2],[4,7]]);

  appendTurn(project,{role:'user',content:'Take the last ferry.'});
  assert.equal(hasUpcomingChapter(project),true);
  const firstScene = appendTurn(project,{role:'assistant',content:'Vale untied the bow line.'});
  const followingScene = appendTurn(project,{role:'assistant',content:'Sen switched on the radio.'});
  assert.equal(hasUpcomingChapter(project),false);
  assert.deepEqual(readingOrder(project),[[2],[4,7],[firstScene,followingScene]]);
});
