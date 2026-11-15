import { castFields, getCast, primarySpeaker, validCast } from './prompt.js';

const sections = ['cast', 'lore', 'continuity'];
const castKeys = new Set(['id', ...castFields]);
const revisionKeys = new Set(['turn', ...sections]);
const validTurn = turn => Number.isSafeInteger(turn) && turn >= 0;
const owns = (value, key) => Object.hasOwn(value, key);
const copyCast = cast => cast.map(member => ({
  id:member.id,
  ...Object.fromEntries(castFields.map(field => [field, member[field] || '']))
}));

function validCastSnapshot(cast) {
  if (!Array.isArray(cast) || cast[0]?.id !== primarySpeaker || !validCast(cast.slice(1))) return false;
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
  return value.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object'
      || !validTurn(entry.turn) || entry.turn <= previousTurn
      || Object.keys(entry).some(key => !revisionKeys.has(key))) {
      throw new TypeError('Graph history turns must be valid and strictly increasing.');
    }
    const present = sections.filter(section => owns(entry, section));
    if (!present.length || (index === 0 && present.length !== sections.length)) {
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

export function storyAtTurn(project, index) {
  const ending = project.messages[index];
  if (!ending) throw new RangeError('That story turn is no longer available.');
  const turn = ending.turnNumber || index + 1;
  const story = structuredClone(project);
  story.messages.length = index + 1;
  story.nextTurn = turn + 1;
  delete story.agentRequest;

  const version = readGraphVersion(story,turn);
  if (version) {
    const [primary, ...cast] = version.cast;
    story.characterName = primary.name;
    story.characterNickname = primary.nickname;
    story.character = primary.description;
    story.personality = primary.personality;
    story.scenario = primary.scenario;
    story.examples = primary.examples;
    story.cast = cast;
    story.lore = version.lore;
    story.continuity = version.continuity;
  }
  if (story.graphHistory) story.graphHistory = story.graphHistory.filter(entry => entry.turn <= turn);
  const castIds = new Set(getCast(story).map(member => member.id));
  if (!castIds.has(story.speakerId)) story.speakerId = primarySpeaker;
  if (!castIds.has(story.storyWriterId)) delete story.storyWriterId;
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
    continuity:project.continuity || ''
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
