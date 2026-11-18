import { reference } from './revision.js';
import { getCast } from './prompt.js';

const ignored = new Set('a above across after against along among an and are around as at be been before behind below beneath beside between beyond but by can could did do does down for from had has have he her here him his how i if in inside into is it its just me more my near no not of on one or our out over past said she so some than that the their them then there these they this those through to toward under up upon us was we were what when where which who will with within without would you your'.split(' '));
const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
const paragraphPattern = /\S(?:[^\n]|\n(?!\s*\n))*?(?=\n\s*\n|\s*$)/gu;
const sceneCache = new Map();
const cacheLimit = 350;

function scan(scene) {
  const key = JSON.stringify([scene.storyId,scene.turn,scene.fingerprint]);
  const existing = sceneCache.get(key);
  if (existing) {
    sceneCache.delete(key);
    sceneCache.set(key,existing);
    return existing;
  }

  const phrases = new Map(), paragraphs = [];
  for (const paragraph of scene.text.matchAll(paragraphPattern)) {
    const words = [...paragraph[0].matchAll(wordPattern)].map(match=>({
      value:match[0].toLowerCase(), start:match.index, end:match.index + match[0].length
    }));
    const keywords = new Set(words.map(({value})=>value).filter(value=>value.length > 2 && !ignored.has(value)));
    if (keywords.size >= 6) {
      const start = paragraph.index, end = start + paragraph[0].length;
      const excerptEnd = words.length > 35 ? start + words[34].end : end;
      paragraphs.push({keywords,ref:reference(scene,start,excerptEnd)});
    }
    for (let index = 0; index + 1 < words.length; index++) {
      for (let length = 2; length <= 3 && index + length <= words.length; length++) {
        const sequence = words.slice(index,index + length);
        if (ignored.has(sequence[0].value) || ignored.has(sequence.at(-1).value)) continue;
        if (sequence.filter(({value})=>value.length > 2 && !ignored.has(value)).length < 2) continue;
        const start = sequence[0].start, end = sequence.at(-1).end;
        const phrase = paragraph[0].slice(start,end);
        const normalized = sequence.map(({value})=>value).join(' ');
        if (!/^[\p{L}\p{N}\s'’\-]+$/u.test(phrase) || phrases.has(normalized)) continue;
        phrases.set(normalized,{term:phrase,ref:reference(scene,paragraph.index + start,paragraph.index + end)});
      }
    }
  }

  const data = {phrases,paragraphs};
  sceneCache.set(key,data);
  if (sceneCache.size > cacheLimit) sceneCache.delete(sceneCache.keys().next().value);
  return data;
}

export function findRecurringDetails(scenes) {
  const occurrences = new Map();
  for (const scene of scenes) {
    for (const [phrase,{term,ref}] of scan(scene).phrases) {
      const entry = occurrences.get(phrase);
      if (entry) entry.refs.push(ref);
      else occurrences.set(phrase,{term,refs:[ref]});
    }
  }
  const ranked = [...occurrences.values()].filter(({refs})=>refs.length > 1)
    .sort((a,b)=>b.refs.length - a.refs.length || b.term.length - a.term.length);
  const details = [];
  for (const {term,refs} of ranked) {
    const phrase = ` ${term.toLowerCase().replace(/\s+/gu,' ')} `;
    if (details.some(detail=>` ${detail.term.toLowerCase().replace(/\s+/gu,' ')} `.includes(phrase) && detail.count === refs.length)) continue;
    details.push({term,count:refs.length,refs});
    if (details.length === 8) break;
  }
  return details;
}

function overlap(a,b) {
  const shared = [...a].filter(word=>b.has(word));
  return {shared,score:shared.length / Math.sqrt(a.size * b.size)};
}

export function passageSignals(scenes) {
  const previousScenes = [], echoes = [];
  for (const scene of scenes) {
    const {paragraphs} = scan(scene);
    let echo, strongest = 0;
    for (const [index,paragraph] of paragraphs.entries()) {
      if (index >= 24) continue;
      for (const earlier of previousScenes) {
        const {score,shared} = overlap(paragraph.keywords,earlier.keywords);
        if (score >= .48 && shared.length >= 5 && score > strongest) {
          strongest = score;
          echo = {kind:'echo',label:`Repeated wording around ${shared.slice(0,3).join(', ')}`,
            ref:paragraph.ref,comparison:earlier.ref};
        }
      }
    }
    if (echo) echoes.push(echo);
    previousScenes.push(...paragraphs.slice(0,24));
    if (previousScenes.length > 72) previousScenes.splice(0,previousScenes.length - 72);
  }
  return echoes.slice(-4);
}

const keyWord = word => word.toLowerCase().normalize('NFC').replaceAll('’',"'");
const distinctive = word => word.length >= 4 && !ignored.has(word) && /\p{L}/u.test(word);
const phraseText = /^[\p{L}\p{M}\p{N}\s'’\-]+$/u;
const recentWordLimit = 900;

function castTerms(project) {
  const terms = new Map();
  for (const member of getCast(project)) {
    const names = [member.name,...(member.nickname || '').split(/[\n,;/]+/u)];
    for (const name of names) {
      const words = (name.match(wordPattern) || []).map(keyWord);
      if (!words.length) continue;
      const list = terms.get(words[0]) || [];
      list.push({words,key:`cast:${member.id}`});
      terms.set(words[0],list);
    }
  }
  return terms;
}

function paragraphDensity(text,words,cast,recent) {
  const values = words.map(word=>word.value);
  const terms = new Set(values.filter(distinctive));
  const anchors = new Set([...text.matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,:/-]\d+)*/gu)].map(([number])=>`number:${number}`));
  for (const [index,word] of values.entries()) {
    for (const name of cast.get(word) || []) {
      if (name.words.every((part,offset)=>values[index+offset] === part)) anchors.add(name.key);
    }
  }
  const fresh = set => [...set].filter(item=>!recent.some(past=>past.has(item))).length;
  const newAnchors = fresh(anchors);
  const score = (fresh(terms) + 3 * newAnchors) / Math.max(16,words.length);
  recent.push(new Set([...terms,...anchors]));
  if (recent.length > 6) recent.shift();
  return {score,newAnchors};
}

function densityBands(paragraphs) {
  const ranked = [...paragraphs].sort((a,b)=>b.score-a.score);
  const middle = Math.floor(ranked.length / 2);
  const median = ranked.length % 2 ? ranked[middle].score
    : ((ranked[middle-1]?.score || 0) + (ranked[middle]?.score || 0)) / 2;
  const strongLimit = Math.max(1,Math.floor(ranked.length * .10));
  const moreLimit = Math.max(1,Math.floor(ranked.length * .25));
  // A single paragraph has no baseline to compare against.
  const strongScore = ranked.length === 1 ? .67 : Math.max(.52,median + .10);
  const high = ranked.filter(({score,newAnchors})=>score >= strongScore && newAnchors >= (ranked.length === 1 ? 2 : 1))
    .slice(0,strongLimit);
  const strongest = new Set(high);
  const medium = ranked.filter(paragraph=>ranked.length > 1 &&
    paragraph.score >= Math.max(.40,median + .06) && !strongest.has(paragraph))
    .slice(0,moreLimit-high.length);
  const inOrder = items => items.sort((a,b)=>a.ref.turn-b.ref.turn || a.ref.start-b.ref.start).map(({ref})=>ref);
  return {high:inOrder(high),medium:inOrder(medium)};
}

function paragraphRepeats(text,words,offset,history,scene,include) {
  const repeats = [];
  let lastEnd = 0;
  for (const [index,word] of words.entries()) {
    const position = offset + index;
    let previousMatch;
    for (let count = Math.min(5,words.length-index); count >= 3; count--) {
      const phrase = words.slice(index,index+count);
      if (phrase.filter(item=>distinctive(item.value)).length < 2 || !phraseText.test(text.slice(word.start,phrase.at(-1).end))) continue;
      const key = phrase.map(item=>item.value).join(' ');
      const occurrences = history.get(key) || [];
      const earlier = occurrences.findLast(previous=>position - previous >= count);
      occurrences.push(position);
      if (occurrences.length > 5) occurrences.shift();
      history.delete(key);
      history.set(key,occurrences);
      if (!previousMatch && include && word.start >= lastEnd && Number.isInteger(earlier) && position - earlier <= recentWordLimit) {
        previousMatch = {start:word.start,end:phrase.at(-1).end,weight:count >= 4 ? 'strong' : 'subtle'};
      }
    }
    if (previousMatch) {
      lastEnd = previousMatch.end;
      repeats.push({...previousMatch,scene});
    }
  }
  while (history.size && offset + words.length - history.values().next().value.at(-1) > recentWordLimit) history.delete(history.keys().next().value);
  return repeats;
}

export function manuscriptHeatmap(project,scenes,selected,{density = true,repetition:repeatsEnabled = true} = {}) {
  const included = new Set(selected.map(scene=>scene.turn));
  const last = scenes.findLastIndex(scene=>included.has(scene.turn));
  const cast = density ? castTerms(project) : undefined;
  const recent = [], history = new Map();
  const paragraphs = [], repetition = {strong:[],subtle:[]};
  let position = 0;
  for (let index = 0; index <= last; index++) {
    const scene = scenes[index];
    const include = included.has(scene.turn);
    for (const paragraph of scene.text.matchAll(paragraphPattern)) {
      const [text] = paragraph;
      const words = [...text.matchAll(wordPattern)].map(match=>({value:keyWord(match[0]),start:match.index,end:match.index+match[0].length}));
      if (!words.length) continue;
      if (density) {
        const score = paragraphDensity(text,words,cast,recent);
        if (include) paragraphs.push({...score,ref:reference(scene,paragraph.index,paragraph.index+text.length)});
      }
      if (repeatsEnabled) {
        const repeats = paragraphRepeats(text,words,position,history,scene,include);
        for (const {start,end,weight} of repeats) repetition[weight].push(reference(scene,paragraph.index+start,paragraph.index+end));
        position += words.length;
      }
    }
  }
  return {...(density ? {density:densityBands(paragraphs)} : {}),...(repeatsEnabled ? {repetition} : {})};
}
