import { libraryByteLimit } from './library.js';

export const manuscriptByteLimit = libraryByteLimit;
const turnLength = 6500;
const sampleLimit = 16;
const sampleLength = 620;

function marker(line) {
  if (/^(?:\*\s*\*\s*\*|---+|___+)$/u.test(line.trim())) return 'scene';
  const heading = /^#{1,6}[ \t]+/u.test(line.trim());
  const label = line.trim().replace(/^#{1,6}[ \t]+|[ \t]+#+$/gu,'')
    .replace(/^(?:\*\*|__|\[)|(?:\*\*|__|\])$/gu,'').trim();
  if (label.length > 180) return '';
  if (/^(?:prologue|epilogue)(?:\s*[:.·–—-].*)?$/iu.test(label)) return 'chapter';
  const match = /^(chapter|turn|scene)\s+#?(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*[:.·–—-].*)?$/iu.exec(label);
  if (match) return match[1].toLowerCase();
  return heading && /^(?:\d+|[IVXLCDM]+)(?:\s*[:.·–—-].*)?$/u.test(label) ? 'chapter' : '';
}

// Every character remains in a prose slice or its source heading. The split
// prefers paragraphs and whitespace without breaking a word or surrogate pair.
function* proseSlices(text) {
  let start = 0;
  while (start + turnLength < text.length) {
    let end = start + turnLength;
    const previous = text.slice(start,end);
    const paragraph = previous.lastIndexOf('\n\n');
    if (paragraph > turnLength / 3) end = start + paragraph + 2;
    else {
      const space = previous.search(/\s\S*$/u);
      if (space > turnLength / 3) end = start + space + 1;
      else if (/^[\ud800-\udbff]$/u.test(text[end - 1])) end--;
    }
    yield text.slice(start,end);
    start = end;
  }
  yield text.slice(start);
}

export function parseManuscript(text) {
  if (new TextEncoder().encode(text).length > manuscriptByteLimit) {
    throw new RangeError('The manuscript exceeds the 16 MB library transfer limit.');
  }
  let words = 0;
  for (const _ of text.matchAll(/\S+/gu)) words++;
  if (!words) throw new Error('Paste some story text or choose a text file.');
  const turns = [];
  const titleLine = /^\s*#[ \t]+([^\r\n]+)(?:\r?\n|$)/u.exec(text);
  const title = titleLine && !marker(titleLine[0]) ? titleLine[1].replace(/[ \t]+#+$/u,'').trim() : '';
  let prefix = title ? titleLine[0] : '', startsChapter = false, hasChapters = false, offset = prefix.length;
  const add = content => {
    for (const slice of proseSlices(content)) {
      if (!slice.trim()) {
        prefix += slice;
        continue;
      }
      const turn = {role:'assistant',turnNumber:turns.length + 1,content:slice,
        ...(prefix ? {sourcePrefix:prefix} : {}),
        ...(startsChapter && turns.length ? {startsChapter:true} : {})};
      turns.push(turn);
      prefix = '';
      startsChapter = false;
    }
  };
  for (const match of text.matchAll(/^[^\n]+/gmu)) {
    if (match.index < offset) continue;
    const kind = marker(match[0]);
    if (!kind) continue;
    add(text.slice(offset,match.index));
    offset = match.index + match[0].length;
    if (text[offset] === '\n') offset++;
    prefix += text.slice(match.index,offset);
    startsChapter ||= kind === 'chapter';
    hasChapters ||= kind === 'chapter';
  }
  add(text.slice(offset));
  if (!turns.length) throw new Error('Add story prose below the headings before importing.');
  if (prefix) turns.at(-1).content += prefix;
  return {turns,words,hasChapters,title};
}

export function manuscriptReference(manuscript) {
  if (!manuscript) return undefined;
  return {turnCount:manuscript.turns.length,hasChapters:manuscript.hasChapters,
    turns:manuscript.turns.map(turn=>({turn:turn.turnNumber,text:(turn.sourcePrefix || '') + turn.content}))};
}

export function manuscriptPassages(turns) {
  const count = Math.min(turns.length,sampleLimit);
  return Array.from({length:count},(_,index) => {
    const turn = turns[count === 1 ? 0 : Math.round(index * (turns.length - 1) / (count - 1))];
    const text = turn.content.trim();
    const excerpt = text.length <= sampleLength ? text
      : index === count - 1 && count > 1 ? '…' + text.slice(1 - sampleLength)
        : text.slice(0,sampleLength - 1) + '…';
    return {turn:turn.turnNumber,excerpt};
  });
}

export function manuscriptTurns(manuscript, suggested = [], reviewed = false) {
  const inferred = new Set(manuscript.hasChapters ? [] : suggested);
  return manuscript.turns.map(turn => ({...turn,
    ...(turn.turnNumber > 1 && inferred.has(turn.turnNumber) ? {startsChapter:true} : {}),
    contentSensitivity:reviewed ? 'reviewed-safe' : 'unclassified'}));
}

export function defaultChapterStarts(manuscript) {
  if (manuscript.hasChapters) return [];
  const breaks = [];
  let chapterWords = 0, wordsRead = 0;
  for (const turn of manuscript.turns) {
    if (chapterWords >= 3500 && manuscript.words - wordsRead >= 1750) {
      breaks.push(turn.turnNumber);
      chapterWords = 0;
    }
    const words = turn.content.match(/\S+/gu)?.length || 0;
    chapterWords += words;
    wordsRead += words;
  }
  return breaks;
}
