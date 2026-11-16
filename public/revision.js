import { getCast, isAvailableToMcp, isStoryTime } from './prompt.js';

const words = text => text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length || 0;
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function signature(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index),16777619);
  return text.length.toString(36) + '-' + (hash >>> 0).toString(36);
}

export function sceneIndex(project) {
  const scenes = [];
  let chapter = 0, direction;
  const graphCounts = new Map();
  for (const event of [...(project.plotEvents || []),...(project.relationships || [])]) {
    graphCounts.set(event.turn,(graphCounts.get(event.turn) || 0) + 1);
  }
  for (const [index, turn] of project.messages.entries()) {
    if (turn.role === 'user') { direction = turn; continue; }
    if (turn.role !== 'assistant' || !turn.content.trim()) continue;
    if (!chapter || turn.startsChapter) chapter++;
    const turnNumber = turn.turnNumber || index + 1;
    scenes.push({
      storyId:project.id,turn:turnNumber,number:scenes.length + 1,chapter,text:turn.content,
      fingerprint:signature(turn.content),time:isStoryTime(turn.storyTime) ? turn.storyTime : '',
      eligible:isAvailableToMcp(turn,direction),events:graphCounts.get(turnNumber) || 0
    });
  }
  return scenes;
}

export function selectScenes(scenes, scope) {
  if (scope === 'book') return scenes;
  const [type,value] = scope.split(':');
  if (type === 'chapter') return scenes.filter(scene=>scene.chapter === Number(value));
  return scenes.filter(scene=>scene.turn === Number(value));
}

export function reference(scene, start = 0, end = Math.min(180,scene.text.length)) {
  return {storyId:scene.storyId,turn:scene.turn,fingerprint:scene.fingerprint,start,end};
}

export function resolveReference(ref, scene) {
  if (!scene || scene.storyId !== ref.storyId || scene.turn !== ref.turn ||
      scene.fingerprint !== ref.fingerprint || ref.end > scene.text.length) return undefined;
  return scene.text.slice(ref.start,ref.end);
}

const phrasePattern = term => new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegex(term.trim()).replace(/\s+/gu,'\\s+') + '(?![\\p{L}\\p{N}])','giu');

export function motifOccurrences(scenes, term) {
  if (!term.trim()) return [];
  const pattern = phrasePattern(term);
  const results = [];
  for (const scene of scenes) {
    for (const match of scene.text.matchAll(pattern)) {
      const ref = reference(scene,match.index,match.index + match[0].length);
      const excerpt = scene.text.slice(Math.max(0,ref.start - 85),Math.min(scene.text.length,ref.end + 85));
      results.push({ref,excerpt});
    }
  }
  return results;
}

export function pacingRows(project, scenes) {
  const names = getCast(project).flatMap(member=>{
    const aliases = (member.nickname || '').split(/[\n,;/]+/u).map(name=>name.trim()).filter(Boolean);
    return [{name:member.name,patterns:[member.name,...aliases].filter(Boolean).map(phrasePattern)}];
  });
  return scenes.map(scene=>{
    const length = words(scene.text);
    const dialogueWords = [...scene.text.matchAll(/“[^”]+”|"[^"]+"/gu)].reduce((sum,match)=>sum + words(match[0]),0);
    const mentions = names.filter(member=>member.patterns.some(pattern=>scene.text.search(pattern) !== -1)).map(({name})=>name);
    return {scene,length,dialogue:Math.min(100,length ? Math.round(dialogueWords * 100 / length) : 0),mentions};
  });
}

export function continuityChecks(project, scenes, scope, notes = []) {
  const included = new Set(selectScenes(scenes,scope).map(scene=>scene.turn));
  const byTurn = new Map(scenes.map(scene=>[scene.turn,scene]));
  const findings = [];
  const report = (title,detail,refs,subject = detail) => {
    findings.push({id:'check-' + signature(JSON.stringify([title,subject,refs])),title,detail,refs});
  };
  const turns = new Set(project.messages.map((turn,index)=>turn.turnNumber || index + 1));
  const castIds = new Set(getCast(project).map(member=>member.id));
  for (const event of [...(project.plotEvents || []),...(project.relationships || [])]) {
    const label = event.note || event.label;
    if (scope === 'book' && event.turn > 0 && !turns.has(event.turn)) {
      report('Graph event has a missing source',label,[],[event.id,event.turn,label]);
    }
    if (scope === 'book' && event.from && (!castIds.has(event.from) || !castIds.has(event.to))) {
      report('Relationship points to a missing character',label,[],[event.from,event.to,event.turn,label]);
    }
  }
  for (const note of notes.filter(note=>note.kind === 'thread' && note.refs.length === 2)) {
    const [first,last] = note.refs.map(ref=>byTurn.get(ref.turn));
    if (!first || !last || !included.has(first.turn) && !included.has(last.turn) ||
        !resolveReference(note.refs[0],first) || !resolveReference(note.refs[1],last)) continue;
    if (first.time && last.time && first.time > last.time) {
      report('Payoff is dated before its setup',note.title + '. Check whether this is intentional.',note.refs,[first.time,last.time,note.title]);
    }
  }
  return [...new Map(findings.map(item=>[item.id,item])).values()];
}

function validRef(ref) {
  return ref && typeof ref.storyId === 'string'
    && Number.isSafeInteger(ref.turn) && ref.turn > 0 && typeof ref.fingerprint === 'string'
    && /^[a-z0-9]+-[a-z0-9]+$/.test(ref.fingerprint)
    && Number.isSafeInteger(ref.start) && ref.start >= 0 && Number.isSafeInteger(ref.end) && ref.end > ref.start;
}

export function normalizeRevisionNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes.filter(note=>note && typeof note.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(note.id) &&
    ['theme','thread','continuity'].includes(note.kind) &&
    typeof note.title === 'string' && note.title.trim() && note.title.length <= 300 &&
    Array.isArray(note.refs) && note.refs.length <= 2 && note.refs.every(validRef) &&
    (note.kind === 'continuity' ? ['intentional','dismissed'].includes(note.status) :
      note.kind === 'theme' ? note.refs.length === 1 : note.refs.length > 0)
  ).map(({id,kind,title,refs,status})=>({id,kind,title,refs:refs.map(({storyId,turn,fingerprint,start,end})=>({storyId,turn,fingerprint,start,end})),
    ...(kind === 'continuity' ? {status} : {})}));
}

export function reviewFindingId(title, refs) {
  return 'review-' + signature(JSON.stringify([title,refs]));
}

export function branchRevisionNotes(branch, sourceId) {
  if (!branch.revisionNotes) return;
  const turns = new Set(sceneIndex(branch).map(scene=>scene.turn));
  branch.revisionNotes = normalizeRevisionNotes(branch.revisionNotes).filter(note=>note.kind !== 'continuity' &&
    note.refs.every(ref=>ref.storyId === sourceId && turns.has(ref.turn))).map(note=>({
    ...note,refs:note.refs.map(ref=>({...ref,storyId:branch.id}))
  }));
  if (!branch.revisionNotes.length) delete branch.revisionNotes;
}
