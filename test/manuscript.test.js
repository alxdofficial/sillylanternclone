import assert from 'node:assert/strict';
import test from 'node:test';
import { bookChapters } from '../public/library.js';
import { defaultChapterStarts, manuscriptPassages, manuscriptReference, manuscriptTurns, parseManuscript } from '../public/manuscript.js';
import { isAvailableToMcp } from '../public/prompt.js';
import { validateSetupDraft, setupMessages } from '../setup-chat.mjs';

const original = turns => turns.map(turn => (turn.sourcePrefix || '') + turn.content).join('');

test('a marked manuscript becomes ordered native turns and numbered chapters while preserving the source', () => {
  const text = '# Harbor Lights\r\n\r\n## Chapter I — Fog\r\n\n**Turn 2**\nFirst passage.\n\n***\nSecond passage.\n\nChapter Two\n\nThird passage.\n';
  const manuscript = parseManuscript(text);
  assert.equal(manuscript.title,'Harbor Lights');
  assert.deepEqual(manuscript.turns.map(turn => turn.turnNumber),[1,2,3]);
  assert.equal(manuscript.turns[2].startsChapter,true);
  assert.equal(original(manuscript.turns),text);
  assert.equal(manuscriptReference(manuscript).turns.map(turn=>turn.text).join(''),text);
  assert.deepEqual(bookChapters(manuscript.turns).map(items=>items.map(item=>item.trim())),
    [['First passage.','Second passage.'],['Third passage.']]);
  assert.deepEqual(defaultChapterStarts(manuscript),[]);
  assert.equal(manuscriptTurns(manuscript,[2])[1].startsChapter,undefined);
  assert.ok(manuscriptTurns(manuscript).every(turn => !isAvailableToMcp(turn)));
  assert.ok(manuscriptTurns(manuscript,[],true).every(turn => isAvailableToMcp(turn)));
});

test('100,000 unmarked words round-trip, with a full model reference, preview samples and fallback chapter breaks', () => {
  const text = 'harbor '.repeat(99_999) + 'landed';
  const manuscript = parseManuscript(text);
  assert.equal(manuscript.words,100_000);
  assert.equal(original(manuscript.turns),text);
  assert.equal(manuscriptReference(manuscript).turns.map(turn=>turn.text).join(''),text);
  assert.ok(defaultChapterStarts(manuscript).length > 20);
  assert.equal(manuscriptPassages(manuscript.turns).length,16);
  assert.match(manuscriptPassages(manuscript.turns).at(-1).excerpt,/landed$/);
  assert.equal(parseManuscript(text+' late').words,100_001);
  assert.throws(()=>parseManuscript('😀'.repeat(4_000_001)),/16 MB/);
  assert.throws(()=>parseManuscript('Chapter 1\n'),/story prose/);
});

test('a setup model can only suggest breaks at sampled turn boundaries, never override marked chapters', () => {
  const source = {turnCount:4,hasChapters:false,passages:[{turn:2,excerpt:'The storm begins.'}]};
  const draft = {title:'The Storm',scenario:'',lore:'',notes:'',cast:[],continuity:'',chapterStarts:[2,2,3]};
  assert.deepEqual(validateSetupDraft(draft,source).chapterStarts,[2]);
  assert.deepEqual(validateSetupDraft(draft,{...source,hasChapters:true}).chapterStarts,[]);
  assert.match(setupMessages([],'draft',source)[0].content,/untrusted story reference/);
  assert.equal(setupMessages([],'draft',{...source,turnCount:1}),null);
});
