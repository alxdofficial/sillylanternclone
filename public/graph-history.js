import { castFields, getCast, graphSuggestions, migrateLegacyCast, relationshipTime, resolveCastName, validCast, localStoryTime, migrateStoryFields, simpleCharacter } from './prompt.js';

const requiredSections = ['cast', 'lore'];
const sections = [...requiredSections,'notes'];
const castKeys = new Set(['id', ...castFields]);
const revisionKeys = new Set(['turn', ...sections]);
const validTurn = turn => Number.isSafeInteger(turn) && turn >= 0;
const owns = (value, key) => Object.hasOwn(value, key);
const copyCast = cast => cast.map(simpleCharacter).map(member => ({
  id:member.id,
  ...Object.fromEntries(castFields.map(field => [field, member[field] || '']))
}));

function validCastSnapshot(cast) {
  if (!validCast(cast)) return false;
  return cast.every(member => member && Object.keys(member).every(key => castKeys.has(key))
    && castFields.every(field => typeof member[field] === 'string')
    && member.name.trim());
}

// Each entry replaces only the sections changed at its turn. A full baseline
// plus sparse changes avoids copying the cast into every world-setting edit.
export function normalizeGraphHistory(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('Graph history must be an array.');
  let previousTurn = -1;
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Invalid graph version.');
    const {continuity,...entry} = raw;
    if (Array.isArray(entry.cast)) entry.cast = entry.cast.map(simpleCharacter);
    if (!entry || Array.isArray(entry) || typeof entry !== 'object'
      || !validTurn(entry.turn) || entry.turn <= previousTurn
      || Object.keys(entry).some(key => !revisionKeys.has(key))) {
      throw new TypeError('Graph history turns must be valid and strictly increasing.');
    }
    const present = sections.filter(section => owns(entry, section));
    if (!present.length && typeof continuity === 'string' && index > 0) { previousTurn = entry.turn; return []; }
    if (!present.length || (index === 0 && !requiredSections.every(section=>owns(entry,section)))) {
      throw new TypeError('Graph history must start with a complete version and record only nonempty changes.');
    }
    previousTurn = entry.turn;
    const normalized = {turn:entry.turn};
    for (const section of present) {
      if (section === 'cast' ? !validCastSnapshot(entry.cast) : typeof entry[section] !== 'string') {
        throw new TypeError('Graph history contains an invalid section.');
      }
      normalized[section] = section === 'cast' ? copyCast(entry.cast) : entry[section];
    }
    return normalized;
  });
}

export function readGraphVersion(project, turn = Infinity) {
  if (turn !== Infinity && !validTurn(turn)) throw new TypeError('Invalid graph version turn.');
  const snapshot = {};
  for (const entry of project.graphHistory || []) {
    if (entry.turn > turn) break;
    for (const section of sections) {
      if (owns(entry, section)) snapshot[section] = entry[section];
    }
  }
  return snapshot.cast ? {...snapshot, cast:copyCast(snapshot.cast)} : null;
}

export function graphChangesByTurn(project) {
  const changes = new Map();
  const forTurn = turn => {
    if (!changes.has(turn)) changes.set(turn, {relationships:[],notes:[]});
    return changes.get(turn);
  };
  for (const edge of project.relationships || []) {
    if (edge.turn) forTurn(edge.turn).relationships.push(edge);
  }
  project.messages.forEach((message,index) => {
    for (const note of graphSuggestions(message.appliedGraphUpdates)) {
      if (!['relationship','plot'].includes(note.kind)) forTurn(message.turnNumber || index + 1).notes.push(note);
    }
  });
  // Older libraries preserved the source of kept facts as a dated line.
  const addDatedNotes = (value,kind,name) => {
    for (const match of (value || '').matchAll(/^Turn (\d+):[ \t]*(\S[^\n]*)$/gm)) {
      const turn = Number(match[1]);
      if (!validTurn(turn)) continue;
      const note = match[2].trim();
      const notes = forTurn(turn).notes;
      if (!notes.some(item => item.kind === kind && item.name === name && item.note === note)) {
        notes.push({kind,...(name ? {name} : {}),note});
      }
    }
  };
  for (const member of getCast(project)) addDatedNotes(member.description,'profile',member.name);
  addDatedNotes(project.lore,'world');
  for (const event of project.plotEvents || []) forTurn(event.turn).notes.push({kind:'plot',...event});
  addDatedNotes(project.notes,'writing');
  return changes;
}

export function storyAtTurn(project, index) {
  const ending = project.messages[index];
  if (!ending) throw new RangeError('That story turn is no longer available.');
  const turn = ending.turnNumber || index + 1;
  const story = migrateStoryFields(migrateLegacyCast(structuredClone(project)));
  story.messages.length = index + 1;
  story.nextTurn = turn + 1;
  if (story.agentHistory) story.agentHistory = story.agentHistory.filter(entry=>entry.afterTurn <= turn);
  delete story.storyFlow;
  delete story.agentRequest;
  delete story.agentNotice;
  delete story.agentEditRequest;

  const version = readGraphVersion(story,turn);
  if (version) {
    story.cast = version.cast;
    story.lore = version.lore;

    if (version.notes !== undefined) story.notes = version.notes;
  }
  if (story.graphHistory) story.graphHistory = story.graphHistory.filter(entry => entry.turn <= turn);
  const castIds = new Set(getCast(story).map(member => member.id));
  if (story.plotEvents) story.plotEvents = story.plotEvents.filter(event=>event.turn <= turn);
  if (story.relationships) story.relationships = story.relationships.filter(edge =>
    (edge.turn || 0) <= turn && castIds.has(edge.from) && castIds.has(edge.to));
  return story;
}

export function captureGraphVersion(project, turn) {
  if (!validTurn(turn)) throw new TypeError('Invalid graph version turn.');
  const history = project.graphHistory || [];
  const last = history.at(-1);
  if (last && turn < last.turn) throw new TypeError('Cannot record a graph revision before the latest version.');

  const snapshot = {
    cast:copyCast(getCast(project)),
    lore:project.lore || '',
    notes:project.notes || ''
  };
  const current = readGraphVersion(project);
  const equal = (before, after) => JSON.stringify(before) === JSON.stringify(after);
  if (equal(current, snapshot)) return false;

  // The time index exposes one state per turn. Further saves at that turn
  // replace its delta rather than growing a series of same-turn records.
  const sameTurn = last?.turn === turn;
  const prior = sameTurn ? (turn > 0 ? readGraphVersion(project, turn - 1) : null) : current;
  const delta = {turn};
  for (const section of sections) {
    if (!equal(prior?.[section], snapshot[section])) delta[section] = snapshot[section];
  }
  const updated = sameTurn ? history.slice(0, -1) : history.slice();
  if (sections.some(section => owns(delta, section))) updated.push(delta);
  project.graphHistory = updated;
  return true;
}

// Capture the state before the first edit. Older histories did not track writing notes.
export function ensureGraphBaseline(project) {
  const history = project.graphHistory;
  if (!history?.length) {
    captureGraphVersion(project,0);
  } else if (!history.some(entry=>owns(entry,'notes'))) {
    project.graphHistory = [{...history[0],notes:project.notes || ''},...history.slice(1)];
  }
}

function addDatedFact(previous = '', note, turn) {
  const normalized = note.toLowerCase();
  if (previous.split('\n').some(line => line.replace(/^Turn \d+:\s*/, '').trim().toLowerCase() === normalized)) return previous;
  return [previous.trim(), `Turn ${turn}: ${note}`].filter(Boolean).join('\n');
}

// Return true for a change, false for a duplicate, and null for a proposal
// that still needs the writer's attention (for example, an unknown cast name).
export function applyGraphUpdate(project, update, turn) {
  migrateLegacyCast(project);
  const cast = getCast(project);
  const resolve = name => resolveCastName(cast,name);
  if (update.kind === 'character') {
    if (resolve(update.name)) return null;
    const member = Object.fromEntries(castFields.map(field=>[field,'']));
    (project.cast ||= []).push({...member,id:globalThis.crypto.randomUUID(),name:update.name,description:update.note});
    return true;
  }
  if (update.kind === 'relationship') {
    const from = resolve(update.from), to = resolve(update.to);
    if (!from || !to || from === to) return null;
    const events = project.relationships || [];
    if (events.some(edge=>edge.from === from && edge.to === to && edge.label === update.label && edge.turn === turn)) return false;
    const storyTime = update.storyTime || relationshipTime(project,{turn});
    (project.relationships ||= []).push({from,to,label:update.label,turn,storyTime});
    return true;
  }
  if (update.kind === 'profile') {
    const id = resolve(update.name);
    if (!id) return null;
    const member = cast.find(entry=>entry.id === id);
    const text = addDatedFact(member.description,update.note,turn);
    if (member.description === text) return false;
    member.description = text;
    return true;
  }
  if (update.kind === 'plot') {
    const events = project.plotEvents ||= [];
    if (events.some(event=>event.note.trim().toLowerCase() === update.note.trim().toLowerCase())) return false;
    events.push({note:update.note,turn,storyTime:update.storyTime || relationshipTime(project,{turn}) || localStoryTime()});
    return true;
  }
  if (!['world','writing'].includes(update.kind)) return null;
  const field = update.kind === 'world' ? 'lore' : 'notes';
  const text = addDatedFact(project[field],update.note,turn);
  if (project[field] === text) return false;
  project[field] = text;
  return true;
}

export function applyTurnGraphUpdates(project, message, proposals, {allowAutomatic} = {}) {
  if (!proposals.length) return {applied:0,pending:0};
  if (!allowAutomatic) {
    message.graphSuggestions = proposals;
    return {applied:0,pending:proposals.length};
  }
  ensureGraphBaseline(project);
  const applied = [], pending = [];
  // Add characters first so events can reference a name introduced this turn.
  const ordered = [...proposals.filter(update=>update.kind === 'character'), ...proposals.filter(update=>update.kind !== 'character')];
  for (const update of ordered) {
    const outcome = applyGraphUpdate(project,update,message.turnNumber);
    if (outcome === true) applied.push(update);
    else if (outcome === null) pending.push(update);
  }
  if (applied.length) {
    message.appliedGraphUpdates = applied;
    captureGraphVersion(project,Math.max(message.turnNumber,project.graphHistory.at(-1)?.turn || 0));
  }
  if (pending.length) message.graphSuggestions = pending;
  return {applied:applied.length,pending:pending.length};
}
