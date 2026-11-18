export const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const blank = character => !character || /\s/u.test(character);
const punctuation = character => /[\p{P}\p{S}]/u.test(character);
const ruler = /^(?:\*(?:\s*\*){2,}|-(?:\s*-){2,}|_(?:\s*_){2,})$/u;
const importedSceneHeading = /^(?:#{1,6}\s+)?(?:\*\*|__|\[)?scene\s+#?(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\*\*|__|\])?(?:\s*[:.·–—-].*|\s*#*)$/iu;
const xmlOpen = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const officeRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships';
const entities = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeMarkup = text => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu,'\uFFFD')
  .replace(/[&<>"']/gu,character=>entities[character]);

function titleText(title) {
  return title.replace(/\s+/gu,' ').trim() || 'Untitled story';
}

// Pair inline emphasis delimiters only. Raw markup, links and other Markdown remain prose.
function inlineRuns(text) {
  const tokens = [];
  const openers = [];
  const lastOpener = new Map();
  const appendText = value => { if (value) tokens.push({text:value}); };
  function popOpener() {
    const opener = openers.pop();
    lastOpener.set(opener.marker,opener.previous);
  }

  let offset = 0;
  for (const {0:delimiter,index} of text.matchAll(/\\[\\*_]|\*+|_+/gu)) {
    appendText(text.slice(offset,index));
    offset = index + delimiter.length;
    if (delimiter[0] === '\\' || delimiter.length > 3) {
      appendText(delimiter[0] === '\\' ? delimiter[1] : delimiter);
      continue;
    }
    const marker = delimiter[0];
    const before = text[index - 1], after = text[offset];
    const left = !blank(after) && (!punctuation(after) || blank(before) || punctuation(before));
    const right = !blank(before) && (!punctuation(before) || blank(after) || punctuation(after));
    const canOpen = left && (marker === '*' || !right || punctuation(before));
    const canClose = right && (marker === '*' || !left || punctuation(after));
    const token = {marker,remaining:delimiter.length,opens:[],closes:[]};
    tokens.push(token);
    while (canClose && token.remaining && lastOpener.get(marker)) {
      const opener = lastOpener.get(marker);
      while (openers.at(-1) !== opener) popOpener();
      const width = Math.min(opener.remaining, token.remaining);
      opener.remaining -= width;
      token.remaining -= width;
      opener.opens.unshift(width);
      token.closes.push(width);
      if (opener.remaining === 0) popOpener();
    }
    if (canOpen && token.remaining) {
      token.previous = lastOpener.get(marker);
      lastOpener.set(marker,token);
      openers.push(token);
    }
  }
  appendText(text.slice(offset));

  const runs = [];
  let bold = 0, italic = 0;
  function addRun(value) {
    if (!value) return;
    const prior = runs.at(-1);
    if (prior?.bold === Boolean(bold) && prior.italic === Boolean(italic)) {
      prior.text += value;
    } else runs.push({text:value,bold:Boolean(bold),italic:Boolean(italic)});
  }
  function move(width, amount) {
    if (width >= 2) bold += amount;
    if (width !== 2) italic += amount;
  }
  for (const token of tokens) {
    if ('text' in token) addRun(token.text);
    else {
      for (const width of token.closes) move(width,-1);
      addRun(token.marker.repeat(token.remaining));
      for (const width of token.opens) move(width,1);
    }
  }
  return runs;
}

export function sourceSceneBreaks(prefix = '') {
  return prefix.split(/\r\n?|\n/u).filter(line=>ruler.test(line.trim()) || importedSceneHeading.test(line.trim()));
}

function* chapterBlocks(chapter) {
  for (const excerpt of chapter) {
    const {content,sourcePrefix} = typeof excerpt === 'string' ? {content:excerpt} : excerpt;
    for (const _ of sourceSceneBreaks(sourcePrefix)) yield {kind:'break'};
    let lines = [];
    for (const line of content.split(/\r\n?|\n/u)) {
      const trimmed = line.trim();
      const isBreak = ruler.test(trimmed);
      if (trimmed && !isBreak) lines.push(line);
      else {
        if (lines.length) yield {kind:'prose',runs:inlineRuns(lines.join('\n'))};
        if (isBreak) yield {kind:'break'};
        lines = [];
      }
    }
    if (lines.length) yield {kind:'prose',runs:inlineRuns(lines.join('\n'))};
  }
}

function* bookBlocks(chapters,first,last) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > last || last > chapters.length) {
    throw new RangeError('Choose an existing chapter range.');
  }
  for (let number = first; number <= last; number++) {
    yield {kind:'chapter',number};
    yield* chapterBlocks(chapters[number - 1]);
  }
}

function ao3ClipboardData(chapters,first,last) {
  const html = [], plain = [];
  for (const block of bookBlocks(chapters,first,last)) {
    if (block.kind === 'chapter') {
      html.push(`<h2>Chapter ${block.number}</h2>`);
      plain.push(`Chapter ${block.number}`);
    } else if (block.kind === 'break') {
      html.push('<hr>');
      plain.push('* * *');
    } else {
      html.push('<p>' + block.runs.map(({text,bold,italic})=>{
        const safe = escapeMarkup(text).replaceAll('\n','<br>');
        const emphasis = italic ? `<em>${safe}</em>` : safe;
        return bold ? `<strong>${emphasis}</strong>` : emphasis;
      }).join('') + '</p>');
      plain.push(block.runs.map(({text})=>text).join(''));
    }
  }
  return {html:html.join('\n'),plain:plain.join('\n\n') + '\n'};
}

export function bookAo3File(title, chapters, first, last) {
  const {html} = ao3ClipboardData(chapters,first,last);
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeMarkup(titleText(title))}</title></head>\n<body>\n${html}\n</body></html>\n`;
}

export async function copyBookForAo3(chapters, first, last,
  {clipboard = globalThis.navigator?.clipboard, Clipboard = globalThis.ClipboardItem} = {}) {
  if (!clipboard?.write || typeof Clipboard !== 'function') {
    throw new Error('This browser does not support copying formatted text.');
  }
  const {html,plain} = ao3ClipboardData(chapters,first,last);
  await clipboard.write([new Clipboard({
    'text/html':new Blob([html],{type:'text/html'}),
    'text/plain':new Blob([plain],{type:'text/plain'})
  })]);
}

function wordRun({text,bold,italic}) {
  const formatting = bold || italic ? `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>` : '';
  const content = text.split('\n').map(line=>`<w:t xml:space="preserve">${escapeMarkup(line)}</w:t>`).join('<w:br/>');
  return `<w:r>${formatting}${content}</w:r>`;
}

function wordParagraph(runs, style = '', pageBreak = false) {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/>${pageBreak ? '<w:pageBreakBefore/>' : ''}</w:pPr>` : '';
  return `<w:p>${properties}${runs.map(wordRun).join('')}</w:p>`;
}

const wordStyles = xmlOpen + `<w:styles xmlns:w="${wordNamespace}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/><w:ind w:firstLine="720"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:after="360"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="SceneBreak">
    <w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
    <w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>
  </w:style>
</w:styles>`;

export function bookDocx(title, chapters, first, last, zipSync) {
  const paragraphs = [wordParagraph([{text:titleText(title)}],'Title')];
  for (const block of bookBlocks(chapters,first,last)) {
    if (block.kind === 'chapter') {
      paragraphs.push(wordParagraph([{text:`Chapter ${block.number}`}],'Heading1',block.number !== first));
    } else if (block.kind === 'break') paragraphs.push(wordParagraph([{text:'* * *'}],'SceneBreak'));
    else paragraphs.push(wordParagraph(block.runs));
  }
  const document = xmlOpen + `<w:document xmlns:w="${wordNamespace}"><w:body>
    ${paragraphs.join('')}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body></w:document>`;
  const contentTypes = xmlOpen + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="${docxMimeType}.main+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  </Types>`;
  const relationship = (kind,target)=>xmlOpen + `<Relationships xmlns="${packageRelations}">
    <Relationship Id="rId1" Type="${officeRelations}/${kind}" Target="${target}"/>
  </Relationships>`;
  const encoder = new TextEncoder();
  const files = {
    '[Content_Types].xml':contentTypes,
    '_rels/.rels':relationship('officeDocument','word/document.xml'),
    'word/document.xml':document,
    'word/_rels/document.xml.rels':relationship('styles','styles.xml'),
    'word/styles.xml':wordStyles
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,encoder.encode(text)])),{level:3});
}
