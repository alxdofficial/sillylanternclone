import assert from 'node:assert/strict';
import test from 'node:test';
import {bookChapters,bookMarkdown} from '../public/library.js';

test('book chapters follow marked prose turns and include only the selected take', () => {
  const messages = [
    {role:'user',content:'private direction',startsChapter:true},
    {role:'assistant',content:'First passage.'},
    {role:'assistant',content:'  ',startsChapter:true},
    {role:'assistant',content:'Second passage.'},
    {role:'user',content:'another direction'},
    {role:'assistant',startsChapter:true,content:'Chosen version.',alternatives:['Old version.','Chosen version.']},
    {role:'assistant',content:'Fourth passage.',excludeFromContext:true}
  ];
  assert.deepEqual(bookChapters(messages),[['First passage.','Second passage.'],['Chosen version.','Fourth passage.']]);
  assert.deepEqual(bookChapters(messages.slice(0,1)),[]);
});

test('Markdown chapter ranges are inclusive and retain original numbering', () => {
  const chapters = [['One.'],['Two.\n\nAnother paragraph.','Next passage.'],['Three.'],['Four.']];
  assert.equal(bookMarkdown('Rain * at the ferry',chapters,2,3),
    '# Rain \\* at the ferry\n\n## Chapter 2\n\nTwo.\n\nAnother paragraph.\n\nNext passage.\n\n## Chapter 3\n\nThree.\n');
  assert.throws(() => bookMarkdown('Rain',chapters,4,2),RangeError);
  assert.throws(() => bookMarkdown('Rain',chapters,2,5),RangeError);
});
