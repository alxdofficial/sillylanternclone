// Three-way merge of the story library. The browser uses it when an agent (or another tab)
// saved while the page had unsaved edits: base is the library the page last loaded or saved,
// local is the page's library and server is the latest saved library.

const unresolved = Symbol('conflict');

// Structural equality that ignores key order and treats undefined properties as absent, like JSON.
export function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length
    && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

function pick(base, local, server) {
  if (sameValue(local, base)) return server;
  if (sameValue(server, base) || sameValue(local, server)) return local;
  return unresolved;
}

// Merge an object field by field. Returns the local object itself when nothing changes.
function mergeFields(base, local, server, special = {}) {
  const result = {}, conflicts = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(server), ...Object.keys(base)])) {
    const value = (special[key] || pick)(base[key], local[key], server[key]);
    if (value === unresolved) conflicts.push(key);
    else if (value !== undefined) result[key] = value;
  }
  return {value:sameValue(result, local) ? local : result, conflicts};
}

function byTurn(messages) {
  const turns = new Map();
  for (const message of messages) {
    if (!Number.isSafeInteger(message?.turnNumber) || turns.has(message.turnNumber)) return null;
    turns.set(message.turnNumber, message);
  }
  return turns;
}

// Turns are matched by turnNumber and merged field by field.
function mergeMessages(base, local, server) {
  const b = byTurn(base), l = byTurn(local), s = byTurn(server);
  if (!b || !l || !s) {
    const value = pick(base, local, server);
    return value === unresolved ? {conflicts:['turns']} : {value, conflicts:[]};
  }
  const merged = [], conflicts = [];
  const numbers = [...new Set([...b.keys(), ...l.keys(), ...s.keys()])].sort((x, y) => x - y);
  for (const number of numbers) {
    const before = b.get(number), mine = l.get(number), theirs = s.get(number);
    if (mine && theirs) {
      const turn = before ? mergeFields(before, mine, theirs) : sameValue(mine, theirs) ? {value:mine, conflicts:[]} : {conflicts:['added']};
      if (turn.conflicts.length) conflicts.push(`turn ${number}`);
      else merged.push(turn.value);
    } else if (mine || theirs) {
      const kept = mine || theirs;
      if (!before) merged.push(kept); // Added on one side.
      else if (!sameValue(kept, before)) conflicts.push(`turn ${number}`); // Deleted on one side, edited on the other.
      // Otherwise it was deleted on one side and unchanged on the other.
    }
  }
  const unchanged = merged.length === local.length && merged.every((message, index) => message === local[index]);
  return {value:unchanged ? local : merged, conflicts};
}

function mergeProject(base = {}, local, server) {
  const messages = mergeMessages(base.messages || [], local.messages || [], server.messages || []);
  const {value, conflicts} = mergeFields(base, local, server, {
    messages:() => messages.conflicts.length ? unresolved : messages.value,
    // Both sides appending turns only needs the next number to stay ahead of both.
    nextTurn:(b, l, s) => {
      const picked = pick(b, l, s);
      return picked === unresolved && Number.isSafeInteger(l) && Number.isSafeInteger(s) ? Math.max(l, s) : picked;
    }
  });
  return {value, conflicts:[...messages.conflicts, ...conflicts.filter(key => key !== 'messages')]};
}

// Returns {library, conflicts}. library is null when any change could not be combined.
export function mergeLibrary(base, local, server) {
  const byId = projects => new Map((projects || []).map(project => [project.id, project]));
  const b = byId(base?.projects), l = byId(local.projects), s = byId(server.projects);
  const projects = [], conflicts = [];
  for (const id of new Set([...l.keys(), ...s.keys()])) {
    const before = b.get(id), mine = l.get(id), theirs = s.get(id);
    const title = `“${(mine || theirs).title}”`;
    if (mine && theirs) {
      const story = mergeProject(before, mine, theirs);
      if (story.conflicts.length) conflicts.push(`${title} (${story.conflicts.join(', ')})`);
      else projects.push(story.value);
    } else {
      const kept = mine || theirs;
      if (!before) projects.push(kept);
      else if (!sameValue(kept, before)) conflicts.push(`${title} (deleted in one place, changed in another)`);
    }
  }
  if (conflicts.length) return {library:null, conflicts};
  const ids = new Set(projects.map(project => project.id));
  const activeId = ids.has(local.activeId) ? local.activeId : ids.has(server.activeId) ? server.activeId : projects[0]?.id ?? '';
  return {library:{...local, activeId, projects}, conflicts};
}
