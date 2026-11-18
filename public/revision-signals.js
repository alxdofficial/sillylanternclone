import { reference } from './revision.js';

const ignored = new Set('a above across after against along among an and are around as at be been before behind below beneath beside between beyond but by can could did do does down for from had has have he her here him his how i if in inside into is it its just me more my near no not of on one or our out over past said she so some than that the their them then there these they this those through to toward under up upon us was we were what when where which who will with within without would you your'.split(' '));
const wordPattern = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
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
  for (const paragraph of scene.text.matchAll(/\S(?:[^\n]|\n(?!\s*\n))*?(?=\n\s*\n|\s*$)/gu)) {
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
