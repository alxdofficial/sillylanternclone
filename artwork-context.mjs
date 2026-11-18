import { createHash } from 'node:crypto';
import { getCast } from './public/prompt.js';
import { sceneIndex } from './public/revision.js';

const maxWords = 1200;
const maxCharacters = 6000;
const rasterKinds = new Set(['character','location','object']);
const styles = ['title','premise','lore','notes'];
const short = (value,limit) => typeof value === 'string' ? value.trim().slice(0,limit) : '';
const key = value => value.toLocaleLowerCase().normalize('NFKC');

function reject(message) {
  throw Object.assign(new Error(message),{status:400,diagnosticCode:'ARTWORK_INPUT'});
}

export function artworkSubject(project,value) {
  if (!value || !rasterKinds.has(value.kind) || typeof value.name !== 'string' || value.name.trim().length > 160) {
    reject('Choose a character, location, or object for the reference.');
  }
  const name = value.name.trim();
  if (!name) reject('Enter the subject of the reference.');
  if (value.kind === 'character') {
    const person = getCast(project).find(member=>key(member.name) === key(name));
    if (!person) reject('Choose a character from this story’s cast.');
    return {kind:value.kind,name:person.name};
  }
  return {kind:value.kind,name};
}

export function artworkPassage(project,ref) {
  const scene = sceneIndex(project).find(item=>item.turn === ref?.turn);
  if (!scene?.eligible) reject('Select prose that is available to the general AI context.');
  if (scene.fingerprint !== ref.fingerprint || !Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) ||
      ref.start < 0 || ref.end <= ref.start || ref.end > scene.text.length) {
    reject('The passage changed. Select it again before generating.');
  }
  const text = scene.text.slice(ref.start,ref.end).trim();
  if (!text || text.length > maxCharacters || text.split(/\s+/u).length > maxWords) {
    reject('Select up to 1,200 words and 6,000 characters.');
  }
  return {text,scene:{turn:scene.turn,fingerprint:scene.fingerprint,start:ref.start,end:ref.end}};
}

export function artworkCanon(project,subject) {
  const selected = subject?.kind === 'character'
    ? getCast(project).filter(member=>key(member.name) === key(subject.name)) : getCast(project);
  return {...Object.fromEntries(styles.map(field=>[field,short(project[field],4000)])),
    cast:selected.slice(0,40).map(({name,nickname,description})=>({name,nickname,description:short(description,900)}))};
}

export function artworkCanonKey(project,subject) {
  return createHash('sha256').update(JSON.stringify(artworkCanon(project,subject))).digest('hex');
}

export function artworkStatus(project,entries) {
  const scenes = new Map(sceneIndex(project).map(scene=>[scene.turn,scene]));
  const stale = new Set();
  const byId = new Set(entries.map(entry=>entry.id));
  const canonKeys = new Map();
  for (const entry of entries) {
    const {source,subject} = entry;
    const subjectKey = subject?.kind === 'character' ? subject.name : '';
    if (!canonKeys.has(subjectKey)) canonKeys.set(subjectKey,artworkCanonKey(project,subject));
    if (source?.canonKey && source.canonKey !== canonKeys.get(subjectKey) ||
        source?.scene && (!scenes.get(source.scene.turn)?.eligible || scenes.get(source.scene.turn)?.fingerprint !== source.scene.fingerprint)) {
      stale.add(entry.id);
    }
  }
  // A deleted or outdated reference can invalidate an illustration that used it.
  for (const entry of entries) if (entry.references?.some(id=>stale.has(id) || !byId.has(id))) stale.add(entry.id);
  return entries.map(entry=>{
    const {prompt,source,...metadata} = entry;
    const placedTurn = scenes.has(entry.placedTurn) ? entry.placedTurn : undefined;
    return {...metadata,placedTurn,sceneTurn:source?.scene?.turn,stale:stale.has(entry.id),
      url:`/api/artwork/image?story=${encodeURIComponent(project.id)}&id=${encodeURIComponent(entry.id)}`};
  });
}
