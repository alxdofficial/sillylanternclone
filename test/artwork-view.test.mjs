import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTWORK_MAX_CHARACTERS, ARTWORK_MAX_WORDS, artworkPassageSize } from '../public/artwork-view.js';

test('artwork passages enforce the word and character limits independently',()=>{
  const wordBoundary = Array.from({length:ARTWORK_MAX_WORDS},()=> 'cat').join(' ');
  assert.deepEqual(artworkPassageSize(wordBoundary),{words:1200,characters:4799,fits:true});
  assert.equal(artworkPassageSize(wordBoundary + ' cat').fits,false);
  assert.equal(artworkPassageSize('a'.repeat(ARTWORK_MAX_CHARACTERS)).fits,true);
  assert.equal(artworkPassageSize('a'.repeat(ARTWORK_MAX_CHARACTERS + 1)).fits,false);
  assert.deepEqual(artworkPassageSize(' \n\t  '),{words:0,characters:0,fits:false});
});
