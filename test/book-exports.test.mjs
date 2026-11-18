import assert from 'node:assert/strict';
import test from 'node:test';
import {unzipSync,zipSync,strFromU8} from 'fflate';
import {bookAo3File,bookDocx,copyBookForAo3,docxMimeType} from '../public/book-exports.js';
import {bookMarkdown} from '../public/library.js';
import {parseManuscript} from '../public/manuscript.js';

const title = 'Ferry < Night & Day 🛳️';
const imported = parseManuscript('# Chapter 2\n\nNora said *quietly* and then **loudly**.\n\n***\n\nCaptain _stayed_ put.');
const chapters = [
  ['First chapter is outside the range.'],
  [...imported.turns, {content:'Next line.\nSame paragraph.',sourcePrefix:'## Scene 8\n\n'}],
  ['***Both***. **Outer *inner***. A \\*literal\\* star, case_name and an _open marker.\n\n<img src=x onerror=alert(1)> & goodbye.\n----\nThe end.']
];

test('AO3 export preserves numbered chapters, emphasis, dialogue line breaks and imported scene breaks',()=>{
  const html = bookAo3File(title,chapters,2,3);
  assert.match(html,/<title>Ferry &lt; Night &amp; Day 🛳️<\/title>/u);
  assert.deepEqual(html.match(/<h2>Chapter \d+<\/h2>/gu),['<h2>Chapter 2</h2>','<h2>Chapter 3</h2>']);
  assert.doesNotMatch(html,/outside the range|Scene 8|# Chapter 2/u);
  assert.match(html,/<em>quietly<\/em> and then <strong>loudly<\/strong>/u);
  assert.match(html,/<em>stayed<\/em>/u);
  assert.match(html,/<strong><em>Both<\/em><\/strong>/u);
  assert.match(html,/<strong>Outer <\/strong><strong><em>inner<\/em><\/strong>/u);
  assert.match(html,/\*literal\* star, case_name and an _open marker\./u);
  assert.match(html,/Next line\.<br>Same paragraph\./u);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt; &amp; goodbye\./u);
  assert.doesNotMatch(html,/<img/u);
  assert.equal(html.match(/<hr>/gu)?.length,3);
  assert.throws(()=>bookAo3File(title,chapters,3,2),RangeError);
});

test('Markdown export retains imported scene breaks and leaves prose markup intact',()=>{
  const markdown = bookMarkdown(title,chapters,2,2);
  assert.equal(markdown.match(/^\* \* \*$/gmu)?.length,2);
  assert.match(markdown,/said \*quietly\* and then \*\*loudly\*\*/u);
  assert.match(markdown,/\* \* \*\n{2,}Captain _stayed_ put\./u);
  assert.doesNotMatch(markdown,/# Chapter 2\n\n# Chapter|Scene 8|outside the range/u);
});

test('AO3 copy includes rich and plain representations and reports clipboard failures',async()=>{
  class Item {
    constructor(parts) { this.parts = parts; }
  }
  let parts;
  const clipboard = {async write([item]) { parts = item.parts; }};
  await copyBookForAo3(chapters,2,2,{Clipboard:Item,clipboard});
  assert.deepEqual(Object.keys(parts),['text/html','text/plain']);
  const html = await parts['text/html'].text();
  const plain = await parts['text/plain'].text();
  assert.match(html,/^<h2>Chapter 2<\/h2>/u);
  assert.match(html,/<em>quietly<\/em>/u);
  assert.match(plain,/Chapter 2\n\nNora said quietly and then loudly\./u);
  assert.match(plain,/\n\n\* \* \*\n\n/u);
  await assert.rejects(copyBookForAo3(chapters,2,2,{Clipboard:Item,clipboard:null}),/formatted text/u);
  await assert.rejects(copyBookForAo3(chapters,2,2,{Clipboard:Item,clipboard:{
    async write() { throw Error('Permission denied'); }
  }}),/Permission denied/u);
});

test('DOCX contains the OOXML document, style relationships, range and formatted Word runs',()=>{
  assert.equal(docxMimeType,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const bytes = bookDocx(title,chapters,2,3,zipSync);
  const files = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name,file])=>[name,strFromU8(file)]));
  assert.deepEqual(Object.keys(files).sort(),[
    '[Content_Types].xml','_rels/.rels','word/_rels/document.xml.rels','word/document.xml','word/styles.xml'
  ]);
  assert.match(files['[Content_Types].xml'],/wordprocessingml\.document\.main\+xml/u);
  assert.match(files['_rels/.rels'],/officeDocument" Target="word\/document\.xml"/u);
  assert.match(files['word/_rels/document.xml.rels'],/styles" Target="styles\.xml"/u);
  const body = files['word/document.xml'];
  assert.match(body,/Ferry &lt; Night &amp; Day 🛳️/u);
  assert.match(body,/w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Chapter 2/u);
  assert.match(body,/w:val="Heading1"\/><w:pageBreakBefore\/><\/w:pPr><w:r><w:t xml:space="preserve">Chapter 3/u);
  assert.match(body,/<w:i\/><\/w:rPr><w:t xml:space="preserve">quietly<\/w:t>/u);
  assert.match(body,/<w:b\/><w:i\/><\/w:rPr><w:t xml:space="preserve">Both<\/w:t>/u);
  assert.match(body,/Next line\.<\/w:t><w:br\/><w:t xml:space="preserve">Same paragraph\./u);
  assert.match(body,/&lt;img src=x onerror=alert\(1\)&gt; &amp; goodbye\./u);
  assert.equal(body.match(/w:val="SceneBreak"/gu)?.length,3);
  assert.doesNotMatch(body,/outside the range|Scene 8|# Chapter 2/u);
  assert.throws(()=>bookDocx(title,chapters,0,2,zipSync),RangeError);
});
