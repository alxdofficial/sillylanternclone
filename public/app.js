import { applyTurnGraphUpdates, captureGraphVersion, graphChangesByTurn, normalizeGraphHistory, storyAtTurn } from './graph-history.js';
import { bookChapters, bookMarkdown, maxLibraryStories, starterStoryId, withoutStarter } from './library.js';
import { defaultChapterStarts, manuscriptByteLimit, manuscriptPassages, manuscriptTurns, parseManuscript } from './manuscript.js';
import { mergeLibrary } from './sync.js';
import { createDisplayNameMatcher } from './display-names.js';
import { buildMessages, formatMessages, storyTextFields, narrator, resolveCastName, migrateLegacyCast, castFields, maxCastMembers, validCast, validRelationships, graphSuggestions, nextTurnNumber, appendTurn, maxGraphEvents, recentTurns, recentTokenCap, validSensitivity, isAvailableToMcp, precedingDirection, isStoryTime, localStoryTime, lastStoryTime, relationshipTime, recordStoryTime } from './prompt.js';

import { models, chapterCost, canWriteSensitive, isAgentModel, isModelId, modelLabel, modelContextWindow, proseOutputLimit, setupDraftModel, agentOutputLimit, setupChatOutputLimit, setupDraftOutputLimit } from './models.js';
import { countWords, maxStoryFieldWords, withinStoryFieldLimit, writeInputProblem } from './prompt.js';
import { dateWriterTurn, maxSetupRelationships, maxSetupWords, mcpOmissionReason, queuedTurn, replyInput, setupInputWords, stripSpeakerName, syncTakeSuggestions } from './prompt.js';
import { continuityRecentTokenCap, estimateContextTokens, storyEditContext, storyOverview, storyPromptUsage, writingHistoryLimit, writingPromptLimit } from './prompt.js';

const settingsFields = ['title', 'lore', 'notes', ...storyTextFields];
const castLabels = {name:'Name', nickname:'Aliases', description:'Description', personality:'Personality', scenario:'Scenario', examples:'Example dialogue'};
const $ = s => document.querySelector(s);
let state, revision, pendingWrites = 0, timer, pendingSave = Promise.resolve(), dirty = false, busy = false, editingIndex = null;
let libraryDirty = false, pendingLibraryWrites = 0;
// The library as last loaded from or saved to the server, the base for merging agent writes.
let baseLibrary = null, demoGeneration;
let openRouterKey = '';
let editingCharacter;
let draftRelationships = [], connectingFrom = '', editingRelationship = null;
let draftStartAt = '', draftStartSource = '';
let estimatedEdgeDates = new WeakSet();
let connecting = false, pinnedGraph = null, hoverGraph = null, deletedEvent = null, shownEvents = 12;
let pendingGraphReview = [];
// Live activity: local MCP agents (from /api/agent) and an OpenRouter request in progress.
let agentActivity = [], generatingFor = null;
const watcherInstructions = `Connect this local session to Story Studio. First tell me briefly what you're doing and that I should leave this chat open while I write. If the story-studio tools are missing, follow README.md and MCP.md in the Story Studio repo and register its stdio server in this client. Tell me if you need me to sign in, approve the tools, or open a fresh session. Use open_studio if Studio is not running.

Use the MCP tools directly. This Python example shows how to recognize each job. You don't need to run a Python script.

while True:
    job = call_tool("wait_for_queued_turn")
    if job["status"] == "idle":
        continue
    kind = job["pendingRequest"]["mode"]
    if kind == "setup":
        handle_setup(job)       # submit_setup_response
    elif kind == "edit":
        handle_edit(job)        # edit_story_state
    elif kind == "continuity":
        record_continuity(job)  # record_scene
    else:
        write_scene(job)        # submit_reply or decline_turn

Follow each job's prompt and use the IDs it provides. When submit_reply leaves continuity pending, record it before waiting again. Handle requests across stories and setup wizards from this same session. Stay quiet while waiting. Stop when I ask, or tell me if Studio becomes unreachable. Use only Story Studio's filtered tools for story data.`;

function syncWatcherStatus() {
  const ready = agentActivity.find(agent => agent.state === 'watching');
  const working = agentActivity.find(agent => agent.state === 'writing');
  const label = ready ? `${ready.client} ready` : working ? `${working.client} working` : 'No MCP watcher';
  for (const target of document.querySelectorAll('[data-watcher-status]')) {
    if (target.textContent !== label) target.textContent = label;
    target.dataset.watcherStatus = ready ? 'ready' : working ? 'working' : 'offline';
  }
}

for (const button of document.querySelectorAll('[data-copy-watcher]')) {
  button.onclick = async () => {
    const section = button.closest('.watcher-controls');
    const prompt = section.querySelector('textarea');
    const feedback = section.querySelector('.copy-watcher-feedback');
    try {
      await navigator.clipboard.writeText(watcherInstructions);
      feedback.textContent = 'Copied. Paste into your local agent chat.';
    } catch {
      prompt.value = watcherInstructions;
      prompt.hidden = false;
      prompt.select();
    }
  };
}
const temporarySession = new Map();
function getSession(key) {
  if (temporarySession.has(key)) return temporarySession.get(key);
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function setSession(key, value) {
  temporarySession.set(key, value);
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
    temporarySession.delete(key);
  } catch {
    // Navigation within the current page can still restore the draft.
  }
}
const modeKey = id => 'story-author-mode:' + id;
const authorMode = project => getSession(modeKey(project.id)) === 'agent' ? 'agent' : 'story';
const routeKey = (id, mode = 'story') => (mode === 'agent' ? 'story-agent-route:' : 'story-route:') + id;
const modelKey = (id, mode = 'story') => (mode === 'agent' ? 'story-agent-model:' : 'story-model:') + id;
const retiredPresets = new Set(['anthracite-org/magnum-v4-72b','thedrummer/unslopnemo-12b','sao10k/l3.1-euryale-70b','gryphe/mythomax-l2-13b']);
function writingModel(project, mode = 'story') {
  const model = getSession(modelKey(project.id,mode));
  return model && (mode === 'agent' ? isAgentModel(model) : isPreset(model) || userModels.includes(model)) ? model : '';
}
function writingRoute(project, mode = 'story') {
  const route = getSession(routeKey(project.id,mode));
  return route === 'openrouter' || route === 'manual' && mode === 'story' ? route : 'mcp';
}
const draftKey = (id, mode = 'story') => (mode === 'agent' ? 'story-agent-draft:' : 'story-draft:') + id;
const sensitiveKey = id => 'story-sensitive-draft:' + id;
const sensitiveDraft = project => getSession(sensitiveKey(project.id)) === 'true';
const pendingComposerEdits = new Map();
let composerEdit;
const id = () => globalThis.crypto?.randomUUID?.() || `story-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const current = () => state.projects.find(p => p.id === state.activeId);
function status(text) {
  $('#saveStatus').textContent = text === 'Saved locally' && current().id === starterStoryId
    ? 'Demo · resets on reload' : text;
}
function error(text=''){const box=$('#error');box.hidden=!text;box.textContent=text}
async function api(url, options={}) {
  const response = await fetch(url,options);
  let result;
  try { result = await response.json(); }
  catch { throw Error(`Unexpected server response (${response.status}).`); }
  if (!response.ok) {
    const requestId = response.headers.get('x-story-studio-request-id');
    const message = result.error || `Request failed (${response.status}).`;
    throw Error(response.status >= 500 && requestId ? `${message} Log ID ${requestId}.` : message);
  }
  return result;
}
function markDirty(project = current()) {
  dirty = true;
  libraryDirty ||= project.id !== starterStoryId;
  status(libraryDirty ? 'Saving…' : 'Updating demo…');
  clearTimeout(timer);
  timer = setTimeout(save,450);
}
function save() {
  clearTimeout(timer);
  if (!dirty) return pendingSave;
  dirty = false;
  const writeLibrary = libraryDirty || state.activeId !== starterStoryId;
  libraryDirty = false;
  pendingWrites++;
  if (writeLibrary) pendingLibraryWrites++;
  pendingSave = pendingSave.then(async () => {
    try {
      for (let merges = 0; ; merges++) {
        // Serialize when the write runs, so it includes agent turns merged in by an earlier write.
        const body = JSON.stringify(writeLibrary ? state : state.projects.find(p => p.id === starterStoryId) || current());
        const response = await fetch(writeLibrary ? '/api/state' : '/api/starter', {method:'PUT', headers:{
          'Content-Type':'application/json', 'If-Match':revision
        }, body});
        if (response.status === 409 && merges < 3) {
          await mergeServerLibrary();
          continue;
        }
        let result;
        try { result = await response.json(); } catch { throw Error(`Unexpected server response (${response.status}).`); }
        if (!response.ok) throw Error(result.error || `Request failed (${response.status}).`);
        revision = result.revision;
        const sent = normalize(writeLibrary ? JSON.parse(body) : {activeId:starterStoryId, projects:[JSON.parse(body)]});
        baseLibrary = writeLibrary ? sent : {...baseLibrary,
          projects:[...baseLibrary.projects.filter(p => p.id !== starterStoryId), ...sent.projects]};
        break;
      }
      if (!dirty && pendingWrites === 1) status('Saved locally');
    } catch (e) {
      dirty = true;
      libraryDirty ||= writeLibrary;
      status('Not saved');
      error(`Couldn't save your changes. ${e.message}`);
    } finally {
      pendingWrites--;
      if (writeLibrary) pendingLibraryWrites--;
    }
  });
  return pendingSave;
}
// Copy a merged library into the page's objects, so code holding a story or its turns keeps working.
function adoptLibrary(library) {
  const known = new Map(state.projects.map(project => [project.id, project]));
  const projects = library.projects.map(project => {
    const local = known.get(project.id);
    if (!local || local === project) return project;
    for (const key of Object.keys(local)) if (!(key in project)) delete local[key];
    for (const [key, value] of Object.entries(project)) {
      if (key === 'messages') { if (local.messages !== value) local.messages.splice(0, local.messages.length, ...value); }
      else local[key] = value;
    }
    return local;
  });
  state.projects.splice(0, state.projects.length, ...projects);
  state.activeId = library.activeId;
}
// After a 409, combine the page's edits with what the agent or another tab saved.
async function mergeServerLibrary() {
  const response = await fetch('/api/state');
  if (!response.ok) throw Error(`Couldn't read the latest library (${response.status}).`);
  const etag = response.headers.get('etag');
  const generation = response.headers.get('x-story-studio-demo-generation');
  const server = normalize(await response.json());
  const {library, conflicts} = mergeLibrary(baseLibrary, state, server,{demoReset:generation !== demoGeneration});
  if (!library) throw Error(`Your agent or another tab changed the same part of ${conflicts.join('; ')}. Nothing was overwritten. Export your work in this tab before reloading.`);
  baseLibrary = structuredClone(server);
  revision = etag;
  demoGeneration = generation;
  adoptLibrary(library);
  render();
}
window.addEventListener('beforeunload', event => {
  if (libraryDirty || pendingLibraryWrites) event.preventDefault();
});
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
const transientDisplayNames = new Map();
const displayNameKey = storyId => 'story-display-names:' + storyId;
const displayNameRows = $('#displayNamesRows');
let displayNameStoryId;

function readDisplayNames(storyId) {
  if (transientDisplayNames.has(storyId)) return transientDisplayNames.get(storyId);
  if (storyId === starterStoryId) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(displayNameKey(storyId)) || '[]');
    return Array.isArray(saved) ? saved.filter(row => Array.isArray(row) && row.length === 2 &&
      row.every(name => typeof name === 'string' && name.trim())) : [];
  } catch {
    return [];
  }
}

function saveDisplayNames(storyId, entries) {
  if (storyId !== starterStoryId) {
    try {
      if (entries.length) localStorage.setItem(displayNameKey(storyId),JSON.stringify(entries));
      else localStorage.removeItem(displayNameKey(storyId));
      transientDisplayNames.delete(storyId);
      return true;
    } catch {
      // Display preferences can still work for the current tab.
    }
  }
  transientDisplayNames.set(storyId,entries);
  return false;
}

function readerText(tag, cls, text, match) {
  return el(tag,cls,match ? match(text) : text);
}

function labelDisplayNameRows() {
  Array.from(displayNameRows.rows).forEach((row,index) => {
    const number = index + 1;
    row.cells[0].querySelector('input').setAttribute('aria-label',`Original name ${number}`);
    row.cells[1].querySelector('input').setAttribute('aria-label',`Display name ${number}`);
    row.querySelector('button').setAttribute('aria-label',`Remove name ${number}`);
  });
}

function addDisplayNameRow(original = '', display = '') {
  const row = el('tr'), originalCell = el('td'), displayCell = el('td');
  const displayControls = el('div','display-name-controls');
  const entry = value => {
    const input = el('input');
    input.type = 'text';
    input.value = value;
    input.autocomplete = 'off';
    return input;
  };
  const originalInput = entry(original), displayInput = entry(display);
  const remove = el('button','button subtle display-name-remove','Remove');
  remove.type = 'button';
  remove.onclick = () => {
    const neighbor = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    labelDisplayNameRows();
    clearDisplayNameFeedback();
    (neighbor?.querySelector('input') || $('#addDisplayName')).focus();
  };
  originalCell.append(originalInput);
  displayControls.append(displayInput,remove);
  displayCell.append(displayControls);
  row.append(originalCell,displayCell);
  displayNameRows.append(row);
  labelDisplayNameRows();
  return originalInput;
}

function renderDisplayNames() {
  const storyId = current().id;
  if (storyId === displayNameStoryId) return;
  displayNameStoryId = storyId;
  displayNameRows.replaceChildren();
  $('#displayNamesError').textContent = '';
  $('#displayNamesStatus').textContent = '';
  const entries = readDisplayNames(storyId);
  if (!entries.length) addDisplayNameRow();
  else for (const [original, display] of entries) addDisplayNameRow(original,display);
}

function clearDisplayNameFeedback() {
  $('#displayNamesError').textContent = '';
  $('#displayNamesStatus').textContent = '';
}
$('#addDisplayName').onclick = () => {
  clearDisplayNameFeedback();
  addDisplayNameRow().focus();
};
$('#displayNamesForm').oninput = clearDisplayNameFeedback;
$('#displayNamesForm').onsubmit = event => {
  event.preventDefault();
  if (!state) return;
  const entries = new Map();
  for (const row of displayNameRows.rows) {
    const [originalInput, displayInput] = row.querySelectorAll('input');
    const original = originalInput.value.trim(), display = displayInput.value.trim();
    if (!original && !display) continue;
    const message = !original || !display ? 'Fill in both names or remove the row.'
      : entries.has(original) ? 'Use each original name once.' : '';
    if (message) {
      $('#displayNamesError').textContent = message;
      (!display ? displayInput : originalInput).focus();
      return;
    }
    entries.set(original,display);
  }
  const storyId = current().id;
  const persisted = saveDisplayNames(storyId,[...entries]);
  $('#displayNamesStatus').textContent = persisted ? 'Names saved in this browser.'
    : storyId === starterStoryId ? 'Names saved until the demo resets.' : 'Names saved for this tab.';
  writeNeedsRender = true;
};

function render() {
  const project = current();
  if (!project) return;
  composerEdit = pendingComposerEdits.get(project.id);
  $('#instruction').value = composerEdit?.draft ?? (getSession(draftKey(project.id,authorMode(project))) || '');
  syncRoute();
  $('#storyTitle').textContent = project.title;
  $('#storyActions').hidden = project.id === starterStoryId;
  document.title = project.title + ' · Story Studio';
  const list = $('#projectList');
  list.replaceChildren();
  for (const story of state.projects) {
    const button = el('button','project-item' + (story.id === project.id ? ' active' : ''));
    const label = story.id === starterStoryId ? `${story.title} · Demo` : story.title;
    button.title = label;
    button.append(el('span', 'project-title', label));
    if (story.id === project.id) button.setAttribute('aria-current', 'true');
    button.onclick = () => {
      state.activeId = story.id;
      markDirty();
      error();
      render();
      $('#sidebar').close();
    };
    list.append(button);
  }
  renderMessages();
}
const storyActions = $('#storyActions');
document.addEventListener('pointerdown',event => {
  if (storyActions.open && !storyActions.contains(event.target)) storyActions.open = false;
});
storyActions.addEventListener('focusout',event => {
  if (event.relatedTarget && !storyActions.contains(event.relatedTarget)) storyActions.open = false;
});
storyActions.addEventListener('keydown',event => {
  if (event.key === 'Escape' && storyActions.open) {
    storyActions.open = false;
    storyActions.querySelector('summary').focus();
  }
});
const turnMenu = $('#turnMenu');
let turnMenuTrigger, turnMenuIndex;

function confirmDanger(title, detail, action) {
  const dialog = $('#confirmDanger');
  const previousFocus = document.activeElement;
  $('#dangerTitle').textContent = title;
  $('#dangerDetail').textContent = detail;
  $('#dangerConfirm').textContent = action;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      previousFocus?.focus({preventScroll:true});
      resolve(dialog.returnValue === 'confirm');
    },{once:true});
    dialog.showModal();
  });
}

function closeTurnMenu(returnFocus = false) {
  turnMenu.hidden = true;
  turnMenuTrigger?.setAttribute('aria-expanded','false');
  if (returnFocus) turnMenuTrigger?.focus({preventScroll:true});
  turnMenuTrigger = null;
  turnMenuIndex = null;
}

function openTurnMenu(trigger, index) {
  if (turnMenuTrigger === trigger) return closeTurnMenu(true);
  closeTurnMenu();
  turnMenuTrigger = trigger;
  turnMenuIndex = index;
  trigger.setAttribute('aria-expanded','true');
  const messages = current().messages;
  const message = messages[index];
  const chapterBreak = $('#chapterBreak');
  chapterBreak.hidden = message.role !== 'assistant' || (!message.startsChapter &&
    (!message.content.trim() || !messages.slice(0,index).some(turn => turn.role === 'assistant' && turn.content.trim())));
  chapterBreak.textContent = message.startsChapter ? 'Remove chapter break' : 'Start new chapter here';
  $('#rewindTurn').disabled = index === messages.length - 1;
  turnMenu.hidden = false;
  positionTurnMenu();
  $('#turnDetails').focus({preventScroll:true});
}

$('#chapterBreak').onclick = () => {
  const message = current().messages[turnMenuIndex];
  closeTurnMenu(true);
  if (message?.role !== 'assistant' || busy) return;
  if (message.startsChapter) delete message.startsChapter;
  else message.startsChapter = true;
  const notice = $('#interactionStatus');
  notice.textContent = message.startsChapter ? 'Chapter break added.' : 'Chapter break removed.';
  markDirty();
};

$('#turnDetails').onclick = () => {
  const index = turnMenuIndex;
  closeTurnMenu();
  if (Number.isInteger(index)) openTurnDetails(index);
};

function positionTurnMenu() {
  if (!turnMenuTrigger) return;
  const anchor = turnMenuTrigger.getBoundingClientRect();
  const transcript = $('#messages').getBoundingClientRect();
  if (anchor.bottom <= transcript.top || anchor.top >= transcript.bottom) return closeTurnMenu();
  const {width,height} = turnMenu.getBoundingClientRect();
  turnMenu.style.left = Math.max(8,Math.min(anchor.right - width,window.innerWidth - width - 8)) + 'px';
  turnMenu.style.top = (anchor.bottom + height + 12 <= window.innerHeight
    ? anchor.bottom + 4 : Math.max(8,anchor.top - height - 4)) + 'px';
}

document.addEventListener('pointerdown', event => {
  if (turnMenuTrigger && !turnMenu.contains(event.target) && !turnMenuTrigger.contains(event.target)) closeTurnMenu();
});
document.addEventListener('focusin', event => {
  if (turnMenuTrigger && !turnMenu.contains(event.target) && event.target !== turnMenuTrigger) closeTurnMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && turnMenuTrigger) {
    event.preventDefault();
    closeTurnMenu(true);
  }
});
$('#messages').addEventListener('scroll',positionTurnMenu,{passive:true});
window.addEventListener('resize', () => closeTurnMenu());

$('#branchTurn').onclick = () => {
  const index = turnMenuIndex;
  closeTurnMenu(true);
  if (index == null || busy) return;
  if (state.projects.length - 1 >= maxLibraryStories) {
    alert('Your library has reached its story limit.');
    return;
  }
  const project = current();
  const branch = storyAtTurn(project,index);
  const turn = branch.nextTurn - 1;
  const names = new Set(state.projects.map(story => story.title));
  const base = project.title.slice(0,128);
  const title = base + ' · Branch from turn ' + turn;
  let label = title;
  for (let n = 2; names.has(label); n++) label = title + ' (' + n + ')';
  branch.id = id();
  branch.title = label;
  setSession(routeKey(branch.id),writingRoute(project));
  setSession(modelKey(branch.id),writingModel(project));
  state.projects.unshift(branch);
  state.activeId = branch.id;
  markDirty(branch);
  error();
  render();
  void save();
};

$('#rewindTurn').onclick = async () => {
  const index = turnMenuIndex;
  closeTurnMenu(true);
  if (index == null || busy) return;
  const project = current();
  const count = project.messages.length - index - 1;
  if (count < 1) return;
  const turn = project.messages[index].turnNumber || index + 1;
  if (!await confirmDanger(`Rewind to turn ${turn}?`,
    `This permanently removes ${count} later ${count === 1 ? 'turn' : 'turns'} and their relationship events from “${project.title}”.`, 'Rewind story')) return;
  const rewound = storyAtTurn(project,index);
  state.projects[state.projects.indexOf(project)] = rewound;
  markDirty(rewound);
  error();
  render();
  void save();
};

function attributedSpeaker(message) {
  const name = message.speakerName?.trim();
  return message.role === 'assistant' && message.speakerId !== narrator.id && name?.toLowerCase() !== 'narrator'
    ? name : '';
}

function pairedReply(project, directionIndex) {
  const reply = project.messages[directionIndex + 1];
  return project.messages[directionIndex]?.role === 'user' && reply?.role === 'assistant' ? reply : undefined;
}

function turnPreview(text) {
  const characters = Array.from(text.trimStart().slice(0,256).replace(/\s+/gu,' ').trim());
  return characters.length > 64 ? characters.slice(0,63).join('').trimEnd() + '…' : characters.join('');
}

function* storyTurns(project) {
  let previousDirection;
  for (let index = 0; index < project.messages.length; index++) {
    const message = project.messages[index];
    if (message.role === 'user') previousDirection = message;
    const reply = pairedReply(project,index);
    const messageReason = mcpOmissionReason(message,previousDirection);
    const replyReason = reply && mcpOmissionReason(reply,message);
    const preview = reply && !replyReason ? reply.content : !messageReason ? message.content : '';
    yield {
      selection:{kind:'turn',turn:message.turnNumber || index + 1,...(reply ? {replyTurn:reply.turnNumber || index + 2} : {})},
      time:timelineTime(message,reply), detail:turnPreview(preview), reason:messageReason || replyReason
    };
    if (reply) index++;
  }
}

function appendTurnContextBadge(container, badgeGroup, reason) {
  if (!reason) return;
  const status = reason === 'directionWithheld' ? 'unverified' : reason;
  const labels = {
    explicit:'Explicit · context censored',
    unverified:'Unverified · context censored',
    allRoutes:'Outside AI context'
  };
  container.dataset.contextStatus = status;
  badgeGroup.append(el('span','context-badge',labels[status]));
}

let renderedStoryId, activeStoryTurn, lastRenderedTurn;
function setStoryTurnsOpen(open) {
  $('#storyTurnSidebar').toggleAttribute('data-open',open);
  $('#toggleStoryTurns').setAttribute('aria-expanded',String(open));
}
$('#toggleStoryTurns').onclick = event => setStoryTurnsOpen(event.currentTarget.getAttribute('aria-expanded') !== 'true');
$('#storyTurnSidebar').onkeydown = event => {
  const toggle = $('#toggleStoryTurns');
  if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true' || !toggle.getClientRects().length) return;
  event.preventDefault();
  setStoryTurnsOpen(false);
  toggle.focus();
};

function selectStoryTurn(turn) {
  activeStoryTurn = turn;
  const nav = $('#storyTurns');
  nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
  $('#messages .story-turn-target')?.classList.remove('story-turn-target');
  const target = turn && $('#messages').querySelector(`[data-story-turn="${turn}"]`);
  if (!target) {
    activeStoryTurn = undefined;
    return;
  }
  nav.querySelector(`[data-turn-link="${turn}"]`)?.setAttribute('aria-current','location');
  target.classList.add('story-turn-target');
  return target;
}

function showLatestStoryTurn() {
  const box = $('#messages');
  selectStoryTurn();
  box.scrollTop = box.scrollHeight;
  $('#storyTurns').scrollTop = $('#storyTurns').scrollHeight;
}
$('#latestStoryTurn').onclick = () => {
  setStoryTurnsOpen(false);
  showLatestStoryTurn();
  $('#instruction').focus({preventScroll:true});
};

function renderStoryTurns(project, followLatest, match) {
  const nav = $('#storyTurns'), scrollTop = nav.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const {selection:{turn},detail,reason} of storyTurns(project)) {
    const button = el('button','graph-turn');
    button.type = 'button';
    button.dataset.turnLink = turn;
    button.append(el('strong','',eventTime(turn)));
    if (detail) button.append(readerText('span','timeline-detail',detail,match));
    appendTurnContextBadge(button,button,reason);
    button.onclick = () => {
      const target = selectStoryTurn(turn);
      if (!target) return;
      setStoryTurnsOpen(false);
      const box = $('#messages');
      box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
      target.focus({preventScroll:true});
    };
    fragment.append(button);
  }
  if (!fragment.childElementCount) fragment.append(el('p','form-note','No turns yet.'));
  nav.replaceChildren(fragment);
  $('#latestStoryTurn').disabled = !project.messages.length;
  selectStoryTurn(activeStoryTurn);
  nav.scrollTop = followLatest ? nav.scrollHeight : scrollTop;
}

const bookReader = $('#bookReader');
const bookPages = $('#bookPages');
const bookPaper = $('#bookPaper');
const bookSpreadToggle = $('#bookSpreadToggle');
const bookSpreadExtent = $('#bookSpreadExtent');
const bookPagination = $('#bookPagination');
const desktopBook = matchMedia('(min-width: 1100px) and (min-height: 640px)');
const bookExport = $('#bookExport');
const bookExportToggle = $('#bookExportToggle');
const bookChapter = $('#bookChapter');
const bookFirst = $('#bookFirst');
const bookLast = $('#bookLast');
const bookPositions = new Map();
const spreadPositions = new Map();
const storyViews = [['write','writeTab','writeView'],['book','bookTab','bookView'],['names','displayNamesTab','displayNamesView']];
let bookStoryId, chapters = [], storyView = 'write', writeNeedsRender = false;
let bookSpreadWanted = false, spreadCount = 1;

function goToSpread(index) {
  const page = Math.min(Math.max(0,index),spreadCount - 1);
  const label = `Spread ${page + 1} of ${spreadCount}`;
  bookReader.scrollLeft = page * bookReader.clientWidth;
  spreadPositions.set(bookStoryId,page);
  $('#bookPrevious').disabled = page === 0;
  $('#bookNext').disabled = page === spreadCount - 1;
  if ($('#bookSpreadNumber').textContent !== label) $('#bookSpreadNumber').textContent = label;
}

function updateBookSpread() {
  if (storyView !== 'book') return;
  const available = desktopBook.matches && chapters.length > 0;
  const active = available && bookSpreadWanted;
  const wasActive = bookPages.hasAttribute('data-spread');
  bookSpreadToggle.hidden = !available;
  bookSpreadToggle.setAttribute('aria-pressed',String(active));
  bookPages.toggleAttribute('data-spread',active);
  bookPagination.hidden = !active;
  bookSpreadExtent.hidden = !active;
  if (!active) {
    if (wasActive) {
      bookReader.scrollLeft = 0;
      bookReader.scrollTop = bookPositions.get(bookStoryId) || 0;
    }
    return;
  }
  const lastParagraph = bookPaper.lastElementChild.lastElementChild;
  const lastFragment = Array.from(lastParagraph.getClientRects()).at(-1);
  const width = bookReader.clientWidth;
  const endColumnLeft = lastFragment.left + bookReader.scrollLeft - bookReader.getBoundingClientRect().left;
  spreadCount = Math.max(1,Math.floor(endColumnLeft / width) + 1);
  bookSpreadExtent.style.left = (spreadCount * width - 1) + 'px';
  goToSpread(spreadPositions.get(bookStoryId) || 0);
}

function jumpToChapter(heading) {
  const target = heading.getBoundingClientRect();
  const reader = bookReader.getBoundingClientRect();
  if (bookPages.hasAttribute('data-spread')) {
    goToSpread(Math.floor((target.left - reader.left + bookReader.scrollLeft) / bookReader.clientWidth));
  } else {
    bookReader.scrollTop += target.top - reader.top - 18;
    rememberBookPosition();
  }
}

bookSpreadToggle.onclick = () => {
  const inSpread = bookPages.hasAttribute('data-spread');
  const reader = bookReader.getBoundingClientRect();
  const headings = [...bookPaper.querySelectorAll('h3')];
  const coordinates = heading => heading.getBoundingClientRect();
  const chapter = headings.findLast(heading => inSpread
    ? coordinates(heading).left < reader.left + reader.width
    : coordinates(heading).top <= reader.top + 24);
  bookSpreadWanted = !inSpread;
  updateBookSpread();
  if (chapter) jumpToChapter(chapter);
};
$('#bookPrevious').onclick = () => goToSpread((spreadPositions.get(bookStoryId) || 0) - 1);
$('#bookNext').onclick = () => goToSpread((spreadPositions.get(bookStoryId) || 0) + 1);
desktopBook.addEventListener('change',updateBookSpread);
new ResizeObserver(updateBookSpread).observe(bookPages);

function setBookExport(open) {
  bookExport.hidden = !open;
  bookExportToggle.setAttribute('aria-expanded',String(open));
}

function updateBookRange(first, last) {
  bookFirst.value = String(first);
  bookLast.value = String(last);
  for (const option of bookLast.options) option.disabled = Number(option.value) < first;
}

function renderBook() {
  const project = current();
  const sameStory = bookStoryId === project.id;
  const scrollTop = bookPositions.get(project.id) || 0;
  const oldCount = chapters.length;
  if (!sameStory) setBookExport(false);
  bookStoryId = project.id;
  chapters = bookChapters(project.messages);
  const count = chapters.length;
  $('#bookToolbar').hidden = !count;
  if (!count) {
    setBookExport(false);
    bookPaper.replaceChildren(el('h2','book-title',project.title),
      el('p','book-empty','Story replies appear here. In Write, use Add reply to add your own prose.'));
    updateBookSpread();
    return;
  }
  const first = sameStory ? Math.min(Number(bookFirst.value) || 1,count) : 1;
  const last = sameStory && Number(bookLast.value) < oldCount
    ? Math.max(first,Math.min(Number(bookLast.value),count)) : count;
  if (!sameStory || oldCount !== count) {
    const options = () => chapters.map((_,index) => new Option(String(index + 1),String(index + 1)));
    const choose = new Option('Choose…','');
    choose.disabled = true;
    bookChapter.replaceChildren(choose,...options());
    bookFirst.replaceChildren(...options());
    bookLast.replaceChildren(...options());
  }
  bookChapter.value = '';
  updateBookRange(first,last);
  const manuscript = document.createDocumentFragment();
  const match = createDisplayNameMatcher(readDisplayNames(project.id));
  manuscript.append(el('h2','book-title',project.title));
  chapters.forEach((excerpts,index) => {
    const section = el('section','book-chapter');
    section.id = 'chapter-' + (index + 1);
    const heading = el('h3','',`Chapter ${index + 1}`);
    heading.tabIndex = -1;
    section.append(heading);
    for (const excerpt of excerpts) {
      for (const paragraph of excerpt.trim().split(/\r?\n(?:[\t ]*\r?\n)+/u)) {
        section.append(readerText('p','',paragraph,match));
      }
    }
    manuscript.append(section);
  });
  bookPaper.replaceChildren(manuscript);
  updateBookSpread();
  if (!bookPages.hasAttribute('data-spread')) bookReader.scrollTop = scrollTop;
}

function showStoryView(view) {
  if (storyView === view) return;
  if (storyView === 'book') rememberBookPosition();
  storyView = view;
  closeTurnMenu();
  for (const [name,tab,panel] of storyViews) {
    const selected = name === storyView;
    $(`#${tab}`).setAttribute('aria-selected',String(selected));
    $(`#${tab}`).tabIndex = selected ? 0 : -1;
    $(`#${panel}`).hidden = !selected;
  }
  $('#toggleStoryTurns').hidden = view !== 'write';
  if (view === 'book') renderBook();
  else if (view === 'names') renderDisplayNames();
  else if (writeNeedsRender) renderMessages();
}

function rememberBookPosition() {
  if (bookStoryId && chapters.length && !bookPages.hasAttribute('data-spread')) {
    bookPositions.set(bookStoryId,bookReader.scrollTop);
  }
}
bookReader.addEventListener('scroll',() => { if (storyView === 'book') rememberBookPosition(); },{passive:true});
for (const [view,tab] of storyViews) $(`#${tab}`).onclick = () => { if (state) showStoryView(view); };
$('.story-tabs').addEventListener('keydown',event => {
  if (!state || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const index = storyViews.findIndex(([view])=>view === storyView);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? storyViews.length - 1
    : (index + storyViews.length + (event.key === 'ArrowRight' ? 1 : -1)) % storyViews.length;
  const [view,tab] = storyViews[next];
  showStoryView(view);
  $(`#${tab}`).focus();
});
bookChapter.onchange = () => {
  const heading = $(`#chapter-${bookChapter.value} h3`);
  bookChapter.value = '';
  if (!heading) return;
  jumpToChapter(heading);
  heading.focus({preventScroll:true});
};
bookExportToggle.onclick = () => setBookExport(bookExport.hidden);
bookFirst.onchange = () => updateBookRange(Number(bookFirst.value),Math.max(Number(bookFirst.value),Number(bookLast.value)));
bookExport.onsubmit = event => {
  event.preventDefault();
  const title = current().title;
  const first = Number(bookFirst.value), last = Number(bookLast.value);
  const fileTitle = title.replace(/[^\p{L}\p{N} -]/gu,'').replace(/\s+/gu,' ').trim().slice(0,80) || 'story';
  download(new Blob([bookMarkdown(title,chapters,first,last)],{type:'text/markdown;charset=utf-8'}),
    `${fileTitle} - Chapter ${first}${first === last ? '' : `-${last}`}.md`);
};

function copyProseButton(message, turn, text) {
  const button = el('button','copy-prose');
  button.type = 'button';
  const label = `Copy prose from turn ${turn}`;
  button.setAttribute('aria-label',label);
  button.title = 'Copy prose';
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('aria-hidden','true');
  const path = document.createElementNS(svg.namespaceURI,'path');
  const copy = 'M8 8h12v12H8z M16 4H4v12';
  path.setAttribute('d',copy);
  svg.append(path);
  button.append(svg);
  let reset;
  button.onclick = async () => {
    const status = $('#interactionStatus');
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(message.content);
      status.textContent = 'Prose copied.';
      path.setAttribute('d','m5 12 4 4L19 6');
      button.title = 'Copied';
      clearTimeout(reset);
      reset = setTimeout(() => {
        path.setAttribute('d',copy);
        button.title = 'Copy prose';
      },1600);
    } catch {
      if (text.textContent !== message.content) return error('Clipboard unavailable. Open Edit to copy the original text.');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      error('Prose selected. Use your device’s Copy command.');
    }
  };
  return button;
}

function renderMessages() {
  if (storyView !== 'write') {
    writeNeedsRender = true;
    if (storyView === 'book') renderBook();
    else renderDisplayNames();
    return;
  }
  writeNeedsRender = false;
  closeTurnMenu();
  const project = current(), box = $('#messages');
  const sameStory = renderedStoryId === project.id;
  const scrollTop = box.scrollTop;
  const followLatest = !sameStory || box.scrollHeight - scrollTop - box.clientHeight < 40;
  const latest = project.messages.at(-1);
  if (sameStory && latest?.role === 'assistant' && latest.turnNumber !== lastRenderedTurn) {
    $('#interactionStatus').textContent = 'A new reply is ready.';
  }
  lastRenderedTurn = latest?.turnNumber;
  if (!sameStory) {
    renderedStoryId = project.id;
    activeStoryTurn = undefined;
    setStoryTurnsOpen(false);
  }
  box.replaceChildren();
  if (!project.messages.length) {
    const empty = el('div','empty');
    empty.append(el('strong','','Start your story'),
      el('p','','Set the scene below, or ask your co-writer to begin.'));
    box.append(empty);
    renderStoryTurns(project,followLatest);
    return;
  }
  const graphChanges = graphChangesByTurn(project);
  const match = createDisplayNameMatcher(readDisplayNames(project.id));
  let previousDirection;
  project.messages.forEach((message,index) => {
    const fromAuthor = message.role === 'user';
    if (fromAuthor) previousDirection = message;
    const omittedFromMcp = mcpOmissionReason(message,previousDirection);
    const turn = message.turnNumber || index + 1;
    const row = el('article','message ' + (fromAuthor ? 'user' : 'assistant'));
    row.tabIndex = -1;
    row.dataset.storyTurn = turn;
    row.setAttribute('aria-label',`${fromAuthor ? 'Your input' : 'Story'} · Turn ${turn}`);
    const name = fromAuthor ? 'You' : attributedSpeaker(message);
    const body = el('div','message-body'), head = el('div',name ? 'message-header' : 'message-footer');
    if (message.sourcePrefix?.trim()) body.append(readerText('div','manuscript-heading',message.sourcePrefix.trim(),match));
    if (name) head.append(readerText('strong',fromAuthor ? 'author-label' : '',name,fromAuthor ? null : match));
    appendTurnContextBadge(row,head,omittedFromMcp);
    if (graphChanges.has(turn) || (!message.excludeFromContext && message.graphSuggestions?.length)) {
      const changes = el('button','text-button','View graph changes');
      changes.onclick = () => {
        openSettings();
        pinGraph({kind:'turn-changes',turn});
        $('#closeInspector').focus();
      };
      head.append(changes);
    }

    const actions = el('div','message-actions');
    const edit = el('button','','Edit');
    edit.disabled = busy || Boolean(composerEdit);
    edit.onclick = () => editInComposer(index);
    const remove = el('button','danger','Delete');
    remove.disabled = busy || Boolean(composerEdit);
    remove.setAttribute('aria-label',`Delete turn ${turn}`);
    remove.onclick = async () => {
      const reply = pairedReply(project,index);
      if (!await confirmDanger(`Delete turn ${turn}?`,
        reply ? 'This permanently removes the author direction and its reply, including alternate takes.'
          : 'This permanently removes the text and its alternate takes from the story.', 'Delete turn')) return;
      const deletedTurns = reply ? [turn,reply.turnNumber] : [turn];
      const cancelsRequest = project.agentRequest && (deletedTurns.includes(project.agentRequest.turnNumber)
        || deletedTurns.includes(project.agentRequest.replyTurnNumber));
      if (cancelsRequest) delete project.agentRequest;
      if (project.agentNotice && deletedTurns.includes(project.agentNotice.turnNumber)) delete project.agentNotice;
      project.messages.splice(index,reply ? 2 : 1);
      markDirty(project);
      render();
      if (cancelsRequest) void save();
    };
    const more = el('button','turn-more','…');
    more.type = 'button';
    more.setAttribute('aria-label',`More actions for turn ${turn}`);
    more.setAttribute('aria-controls','turnMenu');
    more.setAttribute('aria-expanded','false');
    more.disabled = busy || Boolean(composerEdit);
    more.onclick = () => openTurnMenu(more,index);
    actions.append(edit,remove,more);
    head.append(actions);
    const text = readerText('div','message-text',message.content,match);
    const prose = fromAuthor ? text : el('div','prose-with-copy');
    if (!fromAuthor) prose.append(text,copyProseButton(message,turn,text));
    body.append(...(name ? [head,prose] : [prose,head]));
    if (message.role === 'assistant' && message.alternatives?.length > 1) {
      const nav = el('div','alternatives');
      const prev = el('button','','← Previous'), next = el('button','','Next →');
      prev.disabled = busy || Boolean(composerEdit) || message.selectedAlternative === 0;
      next.disabled = busy || Boolean(composerEdit) || message.selectedAlternative === message.alternatives.length - 1;
      prev.onclick = () => selectAlternative(message,message.selectedAlternative - 1);
      next.onclick = () => selectAlternative(message,message.selectedAlternative + 1);
      nav.append(prev,el('span','',`${message.selectedAlternative + 1} of ${message.alternatives.length} takes`),next);
      body.append(nav);
    }
    row.append(body);
    box.append(row);
  });
  renderPending();
  box.scrollTop = followLatest ? box.scrollHeight : scrollTop;
  renderStoryTurns(project,followLatest,match);
}
function setSensitivity(message, value) {
  if (validSensitivity(value)) message.contentSensitivity = value;
  else delete message.contentSensitivity;
}
function syncEditedTake(message) {
  if (!message.alternatives) return;
  const selected = message.selectedAlternative;
  message.alternatives[selected] = message.content;
  if (message.alternativeSensitivities) message.alternativeSensitivities[selected] = message.contentSensitivity || null;
  else if (message.contentSensitivity) message.alternativeSensitivities = message.alternatives.map((_,index)=>
    index === selected ? message.contentSensitivity : 'unclassified');
}

function editInComposer(index) {
  const project = current();
  const message = project.messages[index];
  const draft = message.content;
  setSession(modeKey(project.id),'story');
  const canRegenerate = message.role === 'user' && Boolean(pairedReply(project,index) || index === project.messages.length - 1);
  pendingComposerEdits.set(project.id,{storyId:project.id,turnNumber:message.turnNumber,original:draft,draft,canRegenerate});
  render();
  const input = $('#instruction');
  input.focus();
  input.setSelectionRange(draft.length,draft.length);
}

function closeComposerEdit() {
  pendingComposerEdits.delete(current().id);
  $('#instruction').setCustomValidity('');
  render();
  $('#instruction').focus();
}

function saveComposerEdit() {
  const project = current();
  const {turnNumber, original, storyId, verified} = composerEdit;
  const message = project.messages.find(turn => turn.turnNumber === turnNumber);
  if (project.id !== storyId || message?.content !== original) {
    error('This turn changed while you were editing it. Copy your edit before closing it, then reopen the updated turn.');
    return;
  }
  const input = $('#instruction');
  if (!input.value.trim()) {
    input.setCustomValidity('Enter the revised turn text.');
    input.reportValidity();
    return;
  }
  const changed = input.value !== original;
  if (changed || verified && message.contentSensitivity !== 'reviewed-safe') {
    message.content = input.value;
    if (changed) delete message.continuityPending;
    if (verified) setSensitivity(message,'reviewed-safe');
    else if (message.contentSensitivity !== 'explicit') setSensitivity(message,'unclassified');
    syncEditedTake(message);
    const cancelsRequest = project.agentRequest?.turnNumber === turnNumber || project.agentRequest?.replyTurnNumber === turnNumber;
    if (cancelsRequest) delete project.agentRequest;
    if (project.agentNotice?.turnNumber === turnNumber) delete project.agentNotice;
    markDirty(project);
    if (cancelsRequest) void save();
  }
  const regenerate = composerEdit.canRegenerate && writingRoute(project) !== 'manual';
  error();
  closeComposerEdit();
  return regenerate ? message : undefined;
}

function selectAlternative(message, index) {
  if (!message.alternatives || index < 0 || index >= message.alternatives.length) return;
  message.selectedAlternative = index;
  message.content = message.alternatives[index];
  if (message.alternativeSensitivities) setSensitivity(message, message.alternativeSensitivities[index] ?? null);
  syncTakeSuggestions(message);
  markDirty();
  renderMessages();
}
// What the writer should know about MCP for this story: a status line, and
// a placeholder turn while a queued turn waits for or is being written by an agent.
function mcpStatus(project) {
  const queue = queuedTurn(project).request;
  const watcher = agentActivity.find(agent => agent.state === 'watching');
  if (queue) {
    const writer = agentActivity.find(agent => agent.state === 'writing' && agent.storyId === project.id && agent.turnNumber === queue.turnNumber);
    if (writer) return {
      line:`${writer.client} is writing…`,
      pending:{state:'Writing via MCP', active:true}
    };
    if (watcher) return {
      line:`Queued · ${watcher.client} is watching`,
      pending:{state:'Queued for MCP', active:true}
    };
    return {
      line:'Queued · ask your agent to write the queued turn.',
      pending:{state:'Waiting for an agent', active:false}
    };
  }
  if (project.agentRequest) return {line:'The queued turn no longer matches the story, so no agent will write it. Queue a new turn when you are ready.'};
  if (project.agentNotice) return {line:'Your agent did not write the last turn: ' + project.agentNotice.message
    + (project.agentNotice.mode === 'replace' ? ' Click Edit on the author direction to try another rewrite.'
      : project.messages.at(-1)?.role === 'user' && !isAvailableToMcp(project.messages.at(-1))
      ? ' To write it, switch to OpenRouter and click Send & write with an empty box.'
      : ' To try again, click Queue turn with an empty box.')};
  return {line:''};
}
function renderPending() {
  if (storyView !== 'write') return;
  const box = $('#messages');
  $('#pendingTurn')?.remove();
  const project = current();
  if (!project) return;
  const pending = generatingFor?.projectId === project.id
    ? {state:'Writing', active:true}
    : mcpStatus(project).pending;
  if (!pending) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const row = el('article', 'message assistant pending'), body = el('div', 'message-body');
  row.id = 'pendingTurn';
  body.append(el('span','pending-state' + (pending.active ? ' active' : ''),pending.state));
  row.append(body);
  box.append(row);
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function agentEditStatus(project) {
  if (project.agentEditRequest) {
    const editor = agentActivity.find(agent => agent.state === 'writing' && agent.storyId === project.id && agent.speaker === 'Editor');
    return editor ? `${editor.client} is editing metadata…` : 'Metadata edit queued for MCP.';
  }
  return project.agentEditNotice?.message || 'Ask for changes to the world, character profiles, or notes.';
}

function syncRoute() {
  const project = current();
  const mode = authorMode(project);
  const editingStory = mode === 'agent';
  const route = writingRoute(project,mode);
  const model = writingModel(project,mode);
  const rewriting = composerEdit?.canRegenerate && route !== 'manual';
  $('#authorMode').value = mode;
  $('#sensitiveSceneLabel').hidden = editingStory || Boolean(composerEdit && !rewriting);
  $('#sensitiveScene').checked = sensitiveDraft(project);
  $('#sensitiveScene').disabled = busy;
  $('#authorMode').disabled = busy || Boolean(composerEdit);
  $('#sceneProviderLabel').textContent = editingStory ? 'Edit with' : 'Write with';
  $('#manualWriteOption').hidden = editingStory;
  $('#manualWriteOption').disabled = editingStory;
  $('#sceneProvider').value = route;
  const usesOpenRouter = route === 'openrouter';
  $('#sceneModelControl').hidden = !usesOpenRouter;
  $('#composerWatcherStatus').hidden = route !== 'mcp';
  sceneModelChoice.disabled = busy || Boolean(composerEdit);
  syncSceneModel(model,mode);
  $('#routeSummary').textContent = !editingStory && project.agentEditRequest ? 'A metadata edit is queued. Open Agent to manage it.'
    : !editingStory && sensitiveDraft(project) && route !== 'manual' && (!usesOpenRouter || !canWriteSensitive(model))
      ? 'Choose Cydonia to generate a sensitive scene.'
    : composerEdit ? '' : usesOpenRouter
    ? !openRouterKey ? 'Add an API key in Connection' : !model ? 'Pick a model' : editingStory ? agentEditStatus(project) : ''
    : editingStory ? agentEditStatus(project)
    : route === 'manual' ? 'No model calls' : mcpStatus(project).line;
  $('#sceneProvider').disabled = busy || Boolean(composerEdit);
  $('#providerButton').disabled = busy || Boolean(composerEdit);
  $('#composerEditStatus').hidden = !composerEdit;
  $('#composerEditStatus').textContent = composerEdit ? `Editing turn ${composerEdit.turnNumber}` : '';
  $('#verifyComposerEditLabel').hidden = !composerEdit;
  $('#verifyComposerEdit').checked = Boolean(composerEdit?.verified);
  $('#instructionLabel').textContent = composerEdit ? 'Edit turn text' : editingStory ? 'What story information should change?' : 'What happens next?';
  $('#instruction').placeholder = editingStory ? 'Add world information or revise a character profile…' : 'Write the next beat or tell the narrator what happens…';
  $('#pasteReply').hidden = Boolean(composerEdit) || editingStory;
  $('#cancelAgentEdit').hidden = !editingStory || !project.agentEditRequest;
  $('#cancelComposerEdit').hidden = !composerEdit;
  $('#composeShortcut').textContent = rewriting ? '⌘/Ctrl + Enter to rewrite'
    : composerEdit ? '⌘/Ctrl + Enter to save' : '⌘/Ctrl + Enter to send';
  $('#sendButton').disabled = busy || Boolean(project.agentEditRequest);
  $('#sendButton').textContent = editingStory ? busy ? 'Editing…' : route === 'mcp' ? 'Queue edit' : 'Apply edits'
    : busy ? 'Writing…'
    : composerEdit && !rewriting ? 'Save edit'
    : composerEdit ? (route === 'mcp' ? 'Save & queue rewrite' : 'Save & rewrite ↗')
    : route === 'manual' ? 'Save turn' : route === 'mcp' ? 'Queue turn' : 'Send & write ↗';
  updateContextIndicator();
}
function speakerMetadata(speaker) {
  return {speakerId:speaker.id, speakerName:speaker.name};
}

function openRouterSnapshot(project, messages, replyTime, sensitive) {
  return {
    id:project.id,
    ...Object.fromEntries(settingsFields.map(key => [key,project[key] || ''])),
    storyStartAt:project.storyStartAt, storyStartSource:project.storyStartSource, graphUpdates:project.graphUpdates,
    cast:project.cast, relationships:project.relationships, replyTime,
    contextTime:lastStoryTime({...project,messages}),
    messages:recentTurns(messages,recentTokenCap,{includeSensitive:sensitive})
  };
}

function setBusy(value) {
  busy = value;
  syncRoute();
  renderMessages();
}

async function generateAgentEdit(project) {
  if (project.agentEditRequest) return;
  const input = $('#instruction');
  const instruction = input.value.trim();
  if (!instruction) return input.focus();
  if (countWords(instruction) > 20_000) return error('Agent requests can be up to 20,000 words.');
  error();
  const provider = writingRoute(project,'agent');
  const model = writingModel(project,'agent');
  const key = openRouterKey;
  if (provider === 'mcp') {
    delete project.agentEditNotice;
    project.agentEditRequest = {id:id(),instruction};
    setSession(draftKey(project.id,'agent'),'');
    markDirty(project);
    return render();
  }
  if (!model || !key) {
    openConnection();
    return error('Choose an Agent model and enter your OpenRouter key.');
  }
  setBusy(true);
  try {
    await save();
    if (dirty || !state.projects.includes(project)) throw Error('Save the story and try again.');
    await api('/api/story-edits',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({storyId:project.id,revision,model,key,instruction})
    });
    if (getSession(draftKey(project.id,'agent'))?.trim() === instruction) setSession(draftKey(project.id,'agent'),'');
    await mergeServerLibrary();
  } catch (failure) {
    error(failure.message);
  } finally {
    setBusy(false);
  }
}

async function generate() {
  if (busy || !state) return;
  const project = current();
  if (authorMode(project) === 'agent') return generateAgentEdit(project);
  if (project.agentEditRequest) return;
  const provider = writingRoute(project);
  if (composerEdit && (!composerEdit.canRegenerate || provider === 'manual')) return saveComposerEdit();
  const model = writingModel(project);
  const key = openRouterKey;
  const sensitive = sensitiveDraft(project);
  if (sensitive && provider !== 'manual' && (provider !== 'openrouter' || !canWriteSensitive(model))) {
    return error('Choose Cydonia to generate a sensitive scene.');
  }
  const field = $('#instruction');
  const changedDirection = composerEdit?.canRegenerate && field.value !== composerEdit.original;
  const inputProblem = writeInputProblem(field.value,provider === 'openrouter' ? model : '');
  if (inputProblem) {
    error(inputProblem);
    return field.focus();
  }
  const originalDirection = composerEdit?.canRegenerate && project.messages.find(turn=>turn.turnNumber === composerEdit.turnNumber);
  if (originalDirection && provider !== 'manual' && (originalDirection.excludeFromContext ||
    (!sensitive && !composerEdit.verified && !isAvailableToMcp(originalDirection)))) {
    return error('This direction is withheld from the selected model. Verify the edited text as non-explicit if it is eligible.');
  }
  if (composerEdit?.canRegenerate && provider === 'openrouter' && (!model || !key)) return openConnection();
  let editedTurn;
  if (composerEdit) {
    editedTurn = saveComposerEdit();
    if (!editedTurn) return;
  }
  const input = $('#instruction');
  const direction = editedTurn ? '' : input.value.trim();
  // An empty composer answers a writer turn that has no reply yet, such as
  // after a failed request or a turn an agent handed back.
  const lastTurn = project.messages.at(-1);
  const authorTurn = editedTurn ?? (!direction && provider !== 'manual' && lastTurn?.role === 'user' && !lastTurn.excludeFromContext ? lastTurn : undefined);
  const answering = Boolean(authorTurn);
  const directionIndex = answering ? project.messages.indexOf(authorTurn) : project.messages.length;
  const replacement = editedTurn ? pairedReply(project,directionIndex) : undefined;
  if (!direction && !answering) return input.focus();
  error();
  const resumedProblem = authorTurn && writeInputProblem(authorTurn.content,provider === 'openrouter' ? model : '');
  if (resumedProblem) return error(resumedProblem);
  if (authorTurn?.excludeFromContext || (provider !== 'manual' && !sensitive && authorTurn
    && (authorTurn.contentSensitivity === 'explicit' || (!changedDirection && !isAvailableToMcp(authorTurn))))) {
    error('This direction is outside the selected model’s context. Check its label in ⋯ → Time and context.');
    return;
  }
  if (provider === 'openrouter' && (!model || !key)) {
    openConnection();
    error('Enter your OpenRouter key and choose a model, then send again.');
    return;
  }

  // Any new request replaces an earlier queue and notice; MCP sets a new queue below.
  delete project.agentNotice;
  delete project.agentRequest;
  if (answering && provider === 'mcp') {
    if (changedDirection && authorTurn.contentSensitivity === 'unclassified') delete authorTurn.contentSensitivity;
    project.agentRequest = {mode:replacement ? 'replace' : 'send',speakerId:narrator.id,turnNumber:authorTurn.turnNumber,
      ...(replacement ? {replyTurnNumber:replacement.turnNumber} : {})};
    markDirty();
    return render();
  }
  if (!answering) {
    const turnNumber = appendTurn(project, {role:'user', content:direction, ...(sensitive ? {contentSensitivity:'explicit'} : provider === 'openrouter' ? {contentSensitivity:'unclassified'} : {})});
    input.value = '';
    showLatestStoryTurn();
    setSession(draftKey(project.id), '');
    if (provider === 'mcp') project.agentRequest = {mode:'send',speakerId:narrator.id,turnNumber};
    markDirty();
    if (provider !== 'openrouter') {
      setSession(sensitiveKey(project.id),'');
      return render();
    }
  }
  if (answering && (sensitive || !['explicit','reviewed-safe'].includes(authorTurn.contentSensitivity))) {
    setSensitivity(authorTurn,sensitive ? 'explicit' : 'unclassified');
  }
  if (answering) markDirty(project);

  const originalHistory = JSON.stringify(project.messages);
  generatingFor = {projectId:project.id};
  setBusy(true);
  try {
    await save();
    if (dirty || !state.projects.includes(project) || JSON.stringify(project.messages) !== originalHistory) {
      throw Error('The direction could not be saved against the latest transcript. Check the story and try again.');
    }
    const contextProject = replacement ? storyAtTurn(project,directionIndex) : project;
    const history = project.messages.slice(0,directionIndex);
    const snapshot = openRouterSnapshot(contextProject,history,replacement?.storyTime ?? authorTurn?.storyTime,sensitive);
    const response = await api('/api/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        project:snapshot, instruction:authorTurn?.content ?? direction, provider, model, key, sensitive,
        mode:replacement ? 'replace' : 'send'
      })
    });
    const {text} = response;
    setSession(sensitiveKey(project.id),'');
    if (!text?.trim()) throw Error('The co-writer returned an empty response.');
    const target = state.projects.find(item => item.id === project.id);
    if (!target || JSON.stringify(target.messages) !== originalHistory) {
      throw Error('The scene changed while writing. Try again from the updated scene.');
    }
    const savedDirection = target.messages[directionIndex];
    if (savedDirection.contentSensitivity !== 'explicit'
      && (savedDirection.contentSensitivity !== 'reviewed-safe' || response.input === 'explicit')) {
      setSensitivity(savedDirection,validSensitivity(response.input) ? response.input : 'unclassified');
    }
    const prose = stripSpeakerName(text,narrator.name);
    if (replacement) {
      const reply = target.messages[directionIndex + 1];
      reply.content = prose;
      Object.assign(reply,speakerMetadata(narrator));
      setSensitivity(reply,validSensitivity(response.reply) ? response.reply : 'unclassified');
      syncEditedTake(reply);
      delete reply.graphSuggestions;
      delete reply.continuityPending;
      if (!reply.selectedAlternative) delete reply.firstTakeSuggestions;
    }
    const suggestions = target.graphUpdates === false ? [] : graphSuggestions(response.suggestions);
    const contextChanged = JSON.stringify(openRouterSnapshot(target,history,snapshot.replyTime,sensitive)) !== JSON.stringify(snapshot);
    if (!replacement) appendTurn(target, {role:'assistant', content:prose, ...speakerMetadata(narrator),
      contentSensitivity:validSensitivity(response.reply) ? response.reply : 'unclassified',
      storyTime:recordStoryTime(target,response.storyTime)});
    if (!replacement) dateWriterTurn(target);
    if (!replacement) applyTurnGraphUpdates(target,target.messages.at(-1),suggestions,{
      allowAutomatic:!contextChanged && isAvailableToMcp(savedDirection) && response.input === 'safe' && response.reply === 'safe'
        && !(target.id === current().id && $('#settingsDialog').open)
    });
    markDirty(target);
    if (current().id !== project.id) return;
    if (response.truncated) {
      const unverified = response.input === 'unclassified' || response.reply === 'unclassified';
      error('This reply reached Story Studio’s output limit and may end mid-scene.' +
        (unverified ? ' Any unverified text stays outside general AI context until you check its label in ⋯ → Time and context.' : ''));
    } else if (response.metadataFailed) {
      error('Your draft is in the story. DeepSeek could not verify its labels or suggest map updates. Check the labels in ⋯ → Time and context before using this turn with a general model.');
    }
  } catch (e) {
    if (current().id === project.id) {
      const retry = replacement ? 'To retry the rewrite, click Edit on the author direction.'
        : 'To retry an unanswered direction, edit it or check its context label in ⋯ → Time and context.';
      error(`Couldn't write the turn: ${e.message} ${retry}`);
    }
  } finally {
    generatingFor = null;
    setBusy(false);
    render();
  }
}
const settingsTabs = [...$('#settingsForm').querySelectorAll('[role="tab"]')];
function selectSettingsTab(tab, focus = false) {
  for (const choice of settingsTabs) {
    const selected = choice === tab;
    choice.setAttribute('aria-selected', String(selected));
    choice.tabIndex = selected ? 0 : -1;
    document.getElementById(choice.getAttribute('aria-controls')).hidden = !selected;
  }
  $('#settingsBody').scrollTop = 0;
  if (focus) tab.focus();
}
for (const [index, tab] of settingsTabs.entries()) {
  tab.onclick = () => selectSettingsTab(tab);
  tab.onkeydown = event => {
    const offsets = {ArrowLeft:-1, ArrowRight:1};
    if (!(event.key in offsets) && !['Home','End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? settingsTabs.length - 1
      : (index + offsets[event.key] + settingsTabs.length) % settingsTabs.length;
    selectSettingsTab(settingsTabs[target], true);
  };
}

function castEditors() {
  return [...$('#castEditors').children];
}
function editorName(editor) {
  return editor.querySelector('[data-field="name"]').value.trim() || 'New character';
}
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attributes, label) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (label !== undefined) node.textContent = label;
  return node;
}
const narrowGraph = matchMedia('(max-width: 660px)');
const shortGraph = matchMedia('(max-height: 460px) and (orientation: landscape)');
function nodePositions(editors, centerX, centerY, radiusX, radiusY) {
  return new Map(editors.map((editor, index) => {
    const angle = 2 * Math.PI * index / editors.length - Math.PI / 2;
    const point = editors.length === 1 ? [centerX,centerY] : editors.length === 2 ? [centerX + (index - 0.5) * radiusX * 1.25,centerY]
      : [centerX + radiusX * Math.cos(angle),centerY + radiusY * Math.sin(angle)];
    return [editor.dataset.id, point];
  }));
}
const pairKey = (from,to) => JSON.stringify([from,to].sort());
const nameOf = id => {
  const editor = castEditors().find(item => item.dataset.id === id);
  return editor ? editorName(editor) : 'Removed character';
};
const eventTime = turn => turn ? `Turn ${turn}` : 'Setup';
const pairEvents = selection => draftRelationships.filter(edge => pairKey(edge.from,edge.to) === selection.key);
const byStoryTime = (a,b) => (a.storyTime || '').localeCompare(b.storyTime || '') || (a.turn || 0) - (b.turn || 0);
const selectionKey = selection => selection ? JSON.stringify(selection) : '';

function graphAction(node, selection, activate) {
  node.dataset.selection = selectionKey(selection);
  node.onclick = activate;
  node.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };
  const peek = () => {
    if (pinnedGraph || connecting) return;
    hoverGraph = selection;
    renderInspector();
    updateGraphSelection();
  };
  const leave = () => {
    if (selectionKey(hoverGraph) !== selectionKey(selection)) return;
    hoverGraph = null;
    renderInspector();
    updateGraphSelection();
  };
  node.onpointerenter = event => { if (event.pointerType !== 'touch') peek(); };
  node.onpointerleave = () => { if (document.activeElement !== node) leave(); };
  node.onfocus = peek;
  node.onblur = leave;
}

function updateGraphSelection() {
  const selection = pinnedGraph || hoverGraph;
  for (const node of $('#castGraph').querySelectorAll('[data-selection]')) {
    const selected = selectionKey(selection) === node.dataset.selection;
    node.setAttribute('aria-pressed', String(selected && Boolean(pinnedGraph)));
    node.classList.toggle('graph-selected',selected || Boolean(connectingFrom && node.dataset.id === connectingFrom));
    const scoped = ['turn','moment','turn-changes'].includes(selection?.kind);
    const pair = node.dataset.pair;
    node.classList.toggle('graph-dim',scoped && Boolean(pair) && !draftRelationships.some(edge =>
      pairKey(edge.from,edge.to) === pair && matchesTimeline(edge,selection)));
  }
}

function refreshCastGraph() {
  const graph = $('#castGraph');
  const editors = castEditors();
  const narrow = narrowGraph.matches;
  const short = shortGraph.matches;
  graph.setAttribute('viewBox',short ? '0 0 620 285' : narrow ? '0 0 460 460' : '0 0 720 510');
  const bounds = short ? [310,130,205,82] : narrow ? [230,220,145,157] : [360,240,255,172];
  const coordinates = nodePositions(editors,...bounds);
  graph.replaceChildren();
  const pairs = new Map();
  for (const edge of draftRelationships) {
    if (!coordinates.has(edge.from) || !coordinates.has(edge.to)) continue;
    const key = pairKey(edge.from,edge.to);
    if (!pairs.has(key)) pairs.set(key,{from:edge.from,to:edge.to,key,count:0});
    pairs.get(key).count++;
  }
  for (const {from,to,key,count} of pairs.values()) {
    const [x1,y1] = coordinates.get(from), [x2,y2] = coordinates.get(to);
    const description = `${nameOf(from)} and ${nameOf(to)}: ${count} ${count === 1 ? 'event' : 'events'}`;
    const group = svg('g',{class:'graph-link',role:'button',tabindex:'0','aria-label':description});
    group.dataset.pair = key;
    const line = {x1,y1,x2,y2};
    group.append(svg('line',{...line,class:'graph-edge'}),
      svg('line',{...line,class:'graph-edge-hit'}));
    if (count > 1) {
      const x = (x1+x2)/2, y = (y1+y2)/2;
      group.append(svg('circle',{cx:x,cy:y,r:15,class:'graph-edge-count'}),
        svg('text',{x,y:y+5,'text-anchor':'middle',class:'graph-edge-number'},count));
    }
    const selection = {kind:'pair',from,to,key};
    graphAction(group,selection,() => { if (!connecting) pinGraph(selection); });
    graph.append(group);
  }
  for (const editor of editors) {
    const id = editor.dataset.id, name = editorName(editor);
    const [x,y] = coordinates.get(id);
    const node = svg('g',{class:'graph-node',role:'button',tabindex:'0',
      transform:`translate(${x} ${y})`,'aria-label':name});
    node.dataset.id = id;
    const letters = Array.from(name);
    const limit = narrow && editors.length > 7 ? 10 : 17;
    const label = letters.length > limit ? letters.slice(0,limit-1).join('') + '…' : name;
    node.append(svg('circle',{r:narrow ? 31 : 26}),svg('text',{x:0,y:short ? 48 : narrow ? 53 : 50,'text-anchor':'middle'},label));
    const selection = {kind:'character',id};
    graphAction(node,selection,() => {
      if (!connecting) return selectCastEditor(id,true);
      if (!connectingFrom) {
        connectingFrom = id;
        $('#graphStatus').textContent = `Select a second character to connect to ${name}.`;
        updateGraphSelection();
      } else if (connectingFrom !== id) {
        openRelationship(connectingFrom,id);
      } else $('#graphStatus').textContent = 'Choose a different character.';
    });
    graph.append(node);
  }
  const empty = $('#emptyCast');
  empty.hidden = editors.length !== 0;
  graph.hidden = editors.length === 0;
  $('.graph-key').hidden = editors.length === 0;
  $('#addCharacter').disabled = editors.length >= maxCastMembers;
  $('#connectCharacters').disabled = editors.length < 2;
  updateGraphSelection();
}
narrowGraph.onchange = shortGraph.onchange = () => {
  if ($('#settingsDialog').open) refreshCastGraph();
};

const timeLabel = time => time ? time.replace('T',' ') : 'Undated';
const timelineDate = new Intl.DateTimeFormat('en', {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
const matchesTurn = (turn,{turn:primaryTurn,replyTurn}) => turn === primaryTurn || (replyTurn !== undefined && turn === replyTurn);
const matchesTimeline = (edge,selection) => selection.kind === 'moment'
  ? edge.turn && edge.storyTime === selection.time : matchesTurn(edge.turn || 0,selection);
const countEvents = count => `${count} relationship ${count === 1 ? 'event' : 'events'}`;
const timelineTime = (message,reply) => reply?.storyTime || message?.storyTime || '';

function renderGraphTurns() {
  const entries = [{time:draftStartAt, label:'Story setup', selection:{kind:'turn',turn:0},
    detail:countEvents(draftRelationships.filter(edge => !edge.turn).length)}];
  const moments = new Map();
  for (const edge of draftRelationships) {
    if (!edge.turn) continue;
    if (!moments.has(edge.storyTime)) moments.set(edge.storyTime,[]);
    moments.get(edge.storyTime).push(edge);
  }
  for (const [time,edges] of moments) {
    const [first] = edges;
    entries.push({time, label:edges.length === 1 ? `${nameOf(first.from)} → ${nameOf(first.to)}` : 'Relationship events',
      detail:edges.length === 1 ? turnPreview(first.label) : countEvents(edges.length), selection:{kind:'moment',time}});
  }
  for (const turn of storyTurns(current())) entries.push({...turn,label:eventTime(turn.selection.turn)});
  entries.sort((a,b) => Number(!a.time) - Number(!b.time) || a.time.localeCompare(b.time)
    || (a.selection.turn ?? Infinity) - (b.selection.turn ?? Infinity));
  const rail = $('#graphTurns');
  rail.replaceChildren();
  let day, list, lastTime, timeGroup;
  for (const {time,label,detail,reason,selection} of entries) {
    const key = time.slice(0,10);
    if (key !== day) {
      day = key;
      const group = el('section','timeline-day');
      group.append(el('h4','',day ? timelineDate.format(new Date(day + 'T12:00Z')) : 'Undated turns'));
      list = el('ol','timeline-entries');
      group.append(list);
      rail.append(group);
      lastTime = undefined;
    }
    if (!time || lastTime !== time) {
      lastTime = time;
      timeGroup = el('li','timeline-entry');
      if (time) {
        const clock = el('time','timeline-clock',time.slice(11));
        clock.dateTime = time;
        timeGroup.append(clock);
      }
      list.append(timeGroup);
    }
    const button = el('button','graph-turn');
    button.type = 'button';
    button.dataset.timelineSelection = selectionKey(selection);
    button.setAttribute('aria-pressed',String(selectionKey(pinnedGraph) === button.dataset.timelineSelection));
    button.append(el('strong','',label));
    if (detail) button.append(el('span','timeline-detail',detail));
    appendTurnContextBadge(button,button,reason);
    button.onclick = () => {
      if (connecting) clearConnection();
      pinGraph(selection);
      $('#closeInspector').focus({preventScroll:true});
    };
    timeGroup.append(button);
  }
}

function showTimeline(expanded) {
  $('#toggleTimeline').closest('aside').dataset.expanded = String(expanded);
  $('#toggleTimeline').setAttribute('aria-expanded',String(expanded));
  $('#toggleTimeline').textContent = expanded ? 'Hide timeline' : 'Show timeline';
}
$('#toggleTimeline').onclick = () => showTimeline($('#toggleTimeline').getAttribute('aria-expanded') === 'false');

function pinGraph(selection) {
  pinnedGraph = selection;
  hoverGraph = null;
  shownEvents = 12;
  renderInspector();
  updateGraphSelection();
  for (const item of $('#graphTurns').querySelectorAll('[data-timeline-selection]')) item.setAttribute('aria-pressed',
    String(selectionKey(selection) === item.dataset.timelineSelection));
  if (selection) $('#graphInspector').scrollTop = 0;
}

function timelineText(message, label, direction, time) {
  const section = el('details','timeline-text');
  section.open = true;
  const summary = el('summary','',label);
  appendTurnContextBadge(section,summary,mcpOmissionReason(message,direction));
  section.append(summary);
  if ((message.storyTime || '') !== time) {
    const stamp = el(message.storyTime ? 'time' : 'p','event-stamp',timeLabel(message.storyTime));
    if (message.storyTime) stamp.dateTime = message.storyTime;
    section.append(stamp);
  }
  section.append(el('p','inspector-copy',message.content));
  return section;
}

function appendTurnGraphChanges(preview, selection, edges) {
  const changes = graphChangesByTurn(current());
  const notes = [...(changes.get(selection.turn)?.notes || []), ...(changes.get(selection.replyTurn)?.notes || [])];
  const pending = pendingGraphReview.filter(item => matchesTurn(item.turnNumber,selection) && !item.status);
  const showEmpty = selection.kind === 'turn-changes';
  if (notes.length || showEmpty) preview.append(el('h4','','Saved changes'));
  for (const note of notes) {
    const label = note.kind === 'character' ? 'Character added · ' + note.name
      : note.kind === 'profile' ? 'Profile updated · ' + note.name
      : note.kind === 'world' ? 'World setting' : 'Story memory';
    const row = el('div','relationship-row');
    row.append(el('strong','',label),el('p','relationship-copy',note.note));
    preview.append(row);
  }
  if (showEmpty && !notes.length && !edges.length) preview.append(el('p','form-note','No graph changes have been saved for this turn.'));
  if (pending.length) {
    const review = el('button','button subtle',`Review ${pending.length} pending ${pending.length === 1 ? 'proposal' : 'proposals'}`);
    review.type = 'button';
    review.onclick = () => {
      pinGraph({...selection,kind:'review'});
      $('#closeInspector').focus();
    };
    preview.append(review);
  }
}

function renderInspector() {
  const selection = pinnedGraph || hoverGraph;
  const panel = $('#graphInspector');
  const preview = $('#graphPreview');
  const isPinned = Boolean(pinnedGraph);
  panel.hidden = !selection;
  $('#castPanel').dataset.pinned = String(isPinned);
  $('#closeInspector').hidden = !isPinned;
  for (const id of ['graphPreview','graphProfile','relationshipEditor','relationshipList','graphReviewPanel']) {
    document.getElementById(id).hidden = true;
  }
  if (!selection) return;
  const title = $('#inspectorHeading'), type = $('#inspectorType');
  if (selection.kind === 'character') {
    const editor = castEditors().find(item => item.dataset.id === selection.id);
    if (!editor) return;
    type.textContent = 'Character';
    title.textContent = editorName(editor);
    if (isPinned) $('#graphProfile').hidden = false;
    else {
      const aliases = editor.querySelector('[data-field="nickname"]').value.trim();
      const description = editor.querySelector('[data-field="description"]').value.trim();
      preview.replaceChildren(...(aliases ? [el('p','form-note',`Also known as ${aliases}`)] : []),
        el('p','inspector-copy',description ? description.slice(0,360) + (description.length > 360 ? '…' : '') : 'No description yet.'),
        el('p','form-note','Click to pin and edit.'));
      preview.hidden = false;
    }
  } else if (['turn','moment'].includes(selection.kind)) {
    const messages = current().messages;
    const message = messages.find((item,index) => (item.turnNumber || index + 1) === selection.turn);
    const reply = selection.replyTurn && messages.find((item,index) => (item.turnNumber || index + 1) === selection.replyTurn);
    const time = selection.kind === 'moment' ? selection.time : selection.turn ? timelineTime(message,reply) : draftStartAt;
    type.textContent = selection.kind === 'turn' ? eventTime(selection.turn) : 'Timeline';
    title.textContent = timeLabel(time);
    const edges = draftRelationships.filter(edge => matchesTimeline(edge,selection));
    if (message) {
      preview.replaceChildren();
      if (reply) preview.append(timelineText(message,'Direction',message,time),
        timelineText(reply,attributedSpeaker(reply) || 'Prose',message,time));
      else preview.append(el('p','inspector-copy',message.content));
      appendTurnGraphChanges(preview,selection,edges);
      preview.hidden = false;
    }
    renderRelationships(edges,true);
  } else if (selection.kind === 'turn-changes') {
    type.textContent = eventTime(selection.turn);
    title.textContent = 'Graph changes';
    const edges = draftRelationships.filter(edge => matchesTimeline(edge,selection));
    preview.replaceChildren();
    appendTurnGraphChanges(preview,selection,edges);
    preview.hidden = false;
    if (edges.length || deletedEvent && matchesTimeline(deletedEvent,selection)) renderRelationships(edges,true);
  } else if (selection.kind === 'review') {
    type.textContent = 'Agent';
    title.textContent = selection.turn ? `Turn ${selection.turn} proposals` : 'Map updates';
    $('#graphReviewPanel').hidden = false;
    renderGraphReview();
  } else {
    type.textContent = 'Relationship';
    title.textContent = `${nameOf(selection.from)} ↔ ${nameOf(selection.to)}`;
    if (selection.kind === 'edge-edit') $('#relationshipEditor').hidden = false;
    else renderRelationships(pairEvents(selection),isPinned);
  }
}
function selectCastEditor(id, focusEditor = false) {
  const editors = castEditors();
  const selected = editors.find(editor => editor.dataset.id === id);
  if (!selected) return;
  editingCharacter = selected.dataset.id;
  for (const editor of editors) editor.hidden = editor !== selected;
  $('#cardHint').textContent = '';
  pinGraph({kind:'character',id:editingCharacter});
  if (focusEditor) {
    const field = selected.querySelector('input');
    field?.focus({preventScroll:true});
    $('#graphInspector').scrollTop = 0;
  }
  return selected;
}
function refreshEditorName(editor) {
  if (pinnedGraph?.kind === 'character' && pinnedGraph.id === editor.dataset.id) {
    $('#inspectorHeading').textContent = editorName(editor);
  }
  refreshCastGraph();
}

function renderRelationships(edges, editable) {
  const list = $('#relationshipList');
  list.hidden = false;
  list.replaceChildren();
  const ordered = [...edges].sort(byStoryTime);
  const count = ordered.length;
  const summary = el('p','form-note',count ? `${count} ${count === 1 ? 'event' : 'events'}` : 'No relationship events here.');
  list.append(summary);
  const canUndo = deletedEvent && (['turn','moment','turn-changes'].includes(pinnedGraph?.kind) ? matchesTimeline(deletedEvent,pinnedGraph)
    : pairKey(deletedEvent.from,deletedEvent.to) === pinnedGraph?.key);
  if (editable && deletedEvent && canUndo) {
    const undo = el('button','button subtle','Undo last deletion');
    undo.type = 'button';
    undo.onclick = () => {
      draftRelationships.push(deletedEvent);
      deletedEvent = null;
      refreshCastGraph();
      renderGraphTurns();
      renderInspector();
    };
    list.append(undo);
  }
  for (const edge of ordered.slice(editable ? -shownEvents : -5)) {
    const row = el('div','relationship-row');
    const stamp = el('time','event-time',timeLabel(edge.storyTime));
    stamp.dateTime = edge.storyTime;
    const origin = el('div','event-stamp',`${eventTime(edge.turn)} · ${nameOf(edge.from)} → ${nameOf(edge.to)}`);
    row.append(stamp,origin,el('p','relationship-copy',edge.label));
    if (editable) {
      const edit = el('button','text-button','Edit event');
      edit.type = 'button';
      edit.onclick = () => openRelationship(edge.from,edge.to,edge);
      const remove = el('button','text-button danger','Delete event');
      remove.type = 'button';
      remove.onclick = async () => {
        if (!await confirmDanger('Delete relationship event?', edge.label, 'Delete event')) return;
        deletedEvent = edge;
        draftRelationships = draftRelationships.filter(item => item !== edge);
        refreshCastGraph();
        renderGraphTurns();
        renderInspector();
        $('#relationshipList button')?.focus();
      };
      row.append(edit,remove);
    }
    list.append(row);
  }
  if (editable && count > shownEvents) {
    const more = el('button','button subtle','Show earlier events');
    more.type = 'button';
    more.onclick = () => { shownEvents += 12; renderInspector(); };
    list.append(more);
  } else if (!editable) list.append(el('p','form-note','Click to pin and edit events.'));
}

function clearConnection() {
  connecting = false;
  connectingFrom = '';
  editingRelationship = null;
  $('#connectCharacters').setAttribute('aria-pressed','false');
  $('#connectCharacters').textContent = '+ Relationship';
  $('#graphStatus').textContent = '';
  updateGraphSelection();
}
function openRelationship(from,to,edge) {
  clearConnection();
  const pair = {kind:'pair',from,to,key:pairKey(from,to)};
  editingRelationship = {from,to,edge,pair};
  $('#relationshipLabel').textContent = `What happened between ${nameOf(from)} and ${nameOf(to)}?`;
  $('#relationshipText').value = edge?.label || '';
  $('#relationshipText').setCustomValidity('');
  $('#relationshipTime').value = edge?.storyTime || lastStoryTime(current()) || draftStartAt;
  if (!current().messages.length) $('#relationshipTime').value = draftStartAt;
  $('#relationshipTime').setCustomValidity('');
  $('#storeRelationship').textContent = edge ? 'Save event' : 'Add event';
  pinGraph({...pair,kind:'edge-edit'});
  $('#relationshipText').focus();
}
$('#connectCharacters').onclick = () => {
  if (connecting) {
    clearConnection();
    return;
  }
  clearConnection();
  pinGraph(null);
  connecting = true;
  $('#connectCharacters').setAttribute('aria-pressed','true');
  $('#connectCharacters').textContent = 'Cancel connection';
  $('#graphStatus').textContent = 'Select the first character, then the second.';
};
$('#reviewGraphButton').onclick = () => { clearConnection(); pinGraph({kind:'review'}); $('#closeInspector').focus(); };
$('#closeInspector').onclick = () => { clearConnection(); pinGraph(null); $('#addCharacter').focus(); };
$('#cancelRelationship').onclick = () => {
  const pair = editingRelationship?.pair;
  clearConnection();
  pinGraph(pairEvents(pair || {}).length ? pair : null);
  $('#connectCharacters').focus();
};
$('#storeRelationship').onclick = () => {
  if (!editingRelationship) return;
  const {from,to,edge,pair} = editingRelationship;
  const input = $('#relationshipText');
  const label = input.value.trim();
  const clock = $('#relationshipTime');
  const storyTime = clock.value;
  if (!label) {
    input.setCustomValidity('Describe the relationship event.');
    input.reportValidity();
    return;
  }
  if (!isStoryTime(storyTime)) {
    clock.setCustomValidity('Enter an in-story date and time.');
    clock.reportValidity();
    return;
  }
  const project = current();
  const turn = edge ? edge.turn : project.messages.length ? project.messages.at(-1).turnNumber || project.messages.length : 0;
  if (!turn && storyTime !== draftStartAt) setDraftStart(storyTime);
  if (edge) {
    Object.assign(edge,{label,storyTime});
    estimatedEdgeDates.delete(edge);
  }
  else if (draftRelationships.length < maxGraphEvents) {
    draftRelationships.push({from,to,label,turn,storyTime});
  } else {
    $('#graphStatus').textContent = 'This map has reached its event limit.';
    return;
  }
  clearConnection();
  refreshCastGraph();
  renderGraphTurns();
  pinGraph(pair);
  $('#closeInspector').focus();
};
$('#relationshipText').oninput = event => event.target.setCustomValidity('');
$('#relationshipTime').oninput = event => event.target.setCustomValidity('');
$('#relationshipText').onkeydown = event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  $('#storeRelationship').click();
};
$('#castGraph').onclick = event => {
  if (event.target === $('#castGraph') && !connecting) pinGraph(null);
};
function resolveName(name) {
  return resolveCastName(castEditors().map(editor => ({
    id:editor.dataset.id, name:editorName(editor), nickname:editor.querySelector('[data-field="nickname"]').value
  })),name);
}
// A fact counts as recorded when its text appears on any line, whatever turn
// it was dated with, so a re-proposed fact is not added twice.
function addDatedFact(previous, note, turn) {
  const known = previous.split('\n').map(line => line.replace(/^Turn \d+:\s*/, '').trim().toLowerCase());
  if (known.includes(note.trim().toLowerCase())) return previous;
  return [previous.trim(),`Turn ${turn}: ${note}`].filter(Boolean).join('\n');
}
function reviewSuggestion(item) {
  const suggestion = item.suggestion;
  let applied = true;
  if (suggestion.kind === 'character') {
    if (resolveName(suggestion.name)) return 'That character already exists.';
    if (castEditors().length >= maxCastMembers) return 'The cast is full.';
    addCastEditor({id:id(),name:suggestion.name,description:suggestion.note});
  } else if (suggestion.kind === 'profile') {
    const id = resolveName(suggestion.name);
    const editor = castEditors().find(item => item.dataset.id === id);
    if (!editor) return 'Add this character with a distinct name first.';
    const description = editor.querySelector('[data-field="description"]');
    const next = addDatedFact(description.value,suggestion.note,item.turnNumber);
    applied = next !== description.value;
    description.value = next;
  } else if (suggestion.kind === 'world') {
    const input = $('#settingsForm').elements.lore;
    const next = addDatedFact(input.value,suggestion.note,item.turnNumber);
    applied = next !== input.value;
    input.value = next;
  } else if (suggestion.kind === 'relationship') {
    const from = resolveName(suggestion.from), to = resolveName(suggestion.to);
    if (!from || !to || from === to) return 'Add both characters with distinct names first.';
    if (draftRelationships.length >= maxGraphEvents) return 'The map has reached its event limit.';
    if (!draftRelationships.some(edge => edge.from === from && edge.to === to && edge.label === suggestion.label && edge.turn === item.turnNumber)) {
      const storyTime = suggestion.storyTime || relationshipTime(current(),{turn:item.turnNumber},draftStartAt);
      draftRelationships.push({from,to,label:suggestion.label,turn:item.turnNumber,storyTime});
    }
  } else {
    const input = $('#settingsForm').elements.continuity;
    const next = addDatedFact(input.value,suggestion.note,item.turnNumber);
    applied = next !== input.value;
    input.value = next;
  }
  item.status = 'accepted';
  item.applied = applied;
  refreshCastGraph();
  renderGraphTurns();
  renderGraphReview();
  return '';
}
function renderGraphReview() {
  const container = $('#graphSuggestions');
  const allPending = pendingGraphReview.filter(item => !item.status);
  const turn = pinnedGraph?.kind === 'review' ? pinnedGraph.turn : undefined;
  const pending = turn ? allPending.filter(item => matchesTurn(item.turnNumber,pinnedGraph)) : allPending;
  container.hidden = !pending.length;
  $('#reviewGraphButton').textContent = allPending.length ? `Review updates (${allPending.length})` : 'Agent updates';
  container.replaceChildren();
  if (!pending.length) return;
  container.append(el('h3','','Review map updates'), el('p','form-note','Keep only non-explicit facts you want future models to see.'));
  for (const item of pending) {
    const {suggestion} = item;
    const text = suggestion.kind === 'fact' ? suggestion.note : suggestion.kind === 'world' ? 'World: ' + suggestion.note
      : ['character','profile'].includes(suggestion.kind) ? suggestion.name + ': ' + suggestion.note : suggestion.from + ' → ' + suggestion.to + ': ' + suggestion.label;
    const row = el('div','graph-suggestion', `Turn ${item.turnNumber} · ${text}`);
    const add = el('button','text-button','Keep');
    const dismiss = el('button','text-button','Dismiss');
    const feedback = el('p','form-note');
    add.type = dismiss.type = 'button';
    add.onclick = () => { feedback.textContent = reviewSuggestion(item); };
    dismiss.onclick = () => { item.status = 'dismissed'; renderGraphReview(); };
    row.append(el('br'),add,dismiss,feedback);
    container.append(row);
  }
}

function setDraftStart(time) {
  if (!isStoryTime(time) || time === draftStartAt) return;
  draftStartAt = time;
  draftStartSource = 'author';
  $('#storyStartAt').value = time;
  for (const edge of draftRelationships) {
    if (!edge.turn || estimatedEdgeDates.has(edge)) {
      edge.storyTime = relationshipTime(current(),{turn:edge.turn},time);
    }
  }
  renderGraphTurns();
}
$('#storyStartAt').onchange = event => setDraftStart(event.target.value);
$('#storyStartAt').oninput = event => event.target.setCustomValidity('');

function openSettings(initialTab = $('#castTab')) {
  if (!state) return;
  const project = current();
  const form = $('#settingsForm');
  for (const key of settingsFields) {
    form.elements[key].value = project[key] || '';
    form.elements[key].setCustomValidity('');
  }
  $('#castEditors').replaceChildren();
  for (const character of project.cast || []) addCastEditor(character);
  for (const details of form.querySelectorAll('details')) details.open = false;
  draftStartAt = project.storyStartAt || localStoryTime();
  draftStartSource = project.storyStartSource || 'estimate';
  $('#storyStartAt').value = draftStartAt;
  $('#storyStartAt').setCustomValidity('');
  estimatedEdgeDates = new WeakSet();
  draftRelationships = (project.relationships || []).map(edge => {
    const draft = {...edge,storyTime:relationshipTime(project,edge,draftStartAt)};
    if (!edge.storyTime) estimatedEdgeDates.add(draft);
    return draft;
  });
  deletedEvent = null;
  pendingGraphReview = project.messages.flatMap((message, turn) => message.excludeFromContext ? [] :
    (message.graphSuggestions || []).map((suggestion, index) => ({turn,index,suggestion, turnNumber:message.turnNumber || turn + 1, status:''})));
  pendingGraphReview = pendingGraphReview.slice(-30);
  $('#graphUpdates').checked = project.graphUpdates !== false;
  clearConnection();
  showTimeline(false);
  editingCharacter = undefined;
  pinGraph(null);
  refreshCastGraph();
  renderGraphTurns();
  renderGraphReview();
  selectSettingsTab(initialTab);
  $('#settingsDialog').showModal();
  initialTab.focus();
}
function addCastEditor(character) {
  const card = el('fieldset', 'cast-card');
  card.dataset.id = character.id;
  card.hidden = true;
  const details = el('details', 'profile-details');
  details.append(el('summary', '', 'Scenario and example dialogue'));
  for (const [field, labelText] of Object.entries(castLabels)) {
    const label = el('label', '', labelText);
    const input = el(field === 'name' || field === 'nickname' ? 'input' : 'textarea');
    input.value = character[field] || '';
    input.dataset.field = field;
    if (field === 'name' || field === 'nickname') {
      input.maxLength = 100;
      input.oninput = () => { input.setCustomValidity(''); refreshEditorName(card); };
    } else {
      input.rows = field === 'personality' ? 2 : 4;
    }
    label.append(input);
    (['scenario','examples'].includes(field) ? details : card).append(label);
  }
  card.append(details);
  const remove = el('button', 'button subtle danger', 'Remove from cast');
  remove.type = 'button';
  remove.onclick = async () => {
    const count = draftRelationships.filter(edge => edge.from === card.dataset.id || edge.to === card.dataset.id).length;
    const detail = count ? `This also removes ${count} relationship ${count === 1 ? 'event' : 'events'} when you save. The character’s existing turns stay in the transcript.`
      : 'The character will be removed when you save. Their existing turns stay in the transcript.';
    if (!await confirmDanger(`Remove ${editorName(card)} from the cast?`, detail, 'Remove character')) return;
    draftRelationships = draftRelationships.filter(edge => edge.from !== card.dataset.id && edge.to !== card.dataset.id);
    card.remove();
    clearConnection();
    pinGraph(null);
    refreshCastGraph();
    renderGraphTurns();
    $('#addCharacter').focus();
  };
  card.append(remove);
  $('#castEditors').append(card);
  return card;
}
$('#addCharacter').onclick = () => {
  if (castEditors().length >= maxCastMembers) return;
  const card = addCastEditor({id:id()});
  refreshCastGraph();
  selectCastEditor(card.dataset.id,true);
};

function readCast() {
  return [...$('#castEditors').children].map(card => ({
    id:card.dataset.id,
    ...Object.fromEntries([...card.querySelectorAll('[data-field]')].map(input =>
      [input.dataset.field, input.value.trim()]))
  }));
}

function checkLongField(field, previous = '') {
  const text = field.value.trim();
  const valid = text === previous.trim() || withinStoryFieldLimit(text);
  field.setCustomValidity(valid ? '' : `Use up to ${maxStoryFieldWords.toLocaleString()} words in this field.`);
  return valid;
}

let editingSensitivity;
function showEditSensitivity(value, heldForReview = false) {
  editingSensitivity = value;
  $('#turnSensitivity').value = !heldForReview && isAvailableToMcp({contentSensitivity:value}) ? 'include' : 'omit';
  const status = $('#editSensitivityStatus');
  status.hidden = !heldForReview && value !== 'unclassified';
  status.textContent = heldForReview ? 'This reply follows a censored direction. Review the text before including it.'
    : value === 'unclassified' ? 'This text has not been verified.' : '';
}

function openTurnDetails(index) {
  editingIndex = index;
  const {messages} = current();
  const message = messages[index];
  $('#editStoryTime').value = message.storyTime || '';
  $('#editStoryTime').setCustomValidity('');
  $('#excludeTurn').checked = Boolean(message.excludeFromContext);
  const sensitivity = message.contentSensitivity;
  const heldForReview = (!sensitivity || sensitivity === 'safe')
    && !isAvailableToMcp({...message,excludeFromContext:false},precedingDirection(messages,index));
  showEditSensitivity(sensitivity,heldForReview);
  $('#editDialog').showModal();
}
function normalize(data){if(!data||!Array.isArray(data.projects)||!data.projects.length||data.projects.length>maxLibraryStories+1||data.projects.filter(p=>p?.id!==starterStoryId).length>maxLibraryStories)throw Error('This file does not contain a story library.');const projects=data.projects.map(p=>{if(!p||typeof p!=='object'||!Array.isArray(p.messages))throw Error('A story in this file is missing its turns.');if(p.relationships!==undefined&&!validRelationships(p.relationships))throw Error('A story has invalid relationships.');if(p.cast!==undefined&&!validCast(p.cast))throw Error('A story has an invalid cast.');if(p.messages.length>3000||p.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('The library has invalid or too many story turns.');p = migrateLegacyCast({...p});if(p.cast!==undefined&&!validCast(p.cast))throw Error('A story has an invalid cast.');return {id:typeof p.id==='string'?p.id:id(),title:String(p.title||'Untitled story'),lore:String(p.lore||''),notes:String(p.notes||''),...(p.relationships ? {relationships:p.relationships.map(edge=>({...edge,turn:edge.turn||0}))} : {}),...(isStoryTime(p.storyStartAt)?{storyStartAt:p.storyStartAt,storyStartSource:p.storyStartSource||'estimate'}:{}),...(p.graphHistory?{graphHistory:normalizeGraphHistory(p.graphHistory)}:{}),...(p.agentEditRequest && typeof p.agentEditRequest.id==='string' && typeof p.agentEditRequest.instruction==='string' && p.agentEditRequest.instruction.trim() && countWords(p.agentEditRequest.instruction)<=20_000 ? {agentEditRequest:{id:p.agentEditRequest.id,instruction:p.agentEditRequest.instruction}} : {}),...(p.agentEditNotice && typeof p.agentEditNotice.message==='string' ? {agentEditNotice:{message:p.agentEditNotice.message.slice(0,300)}} : {}),...(p.agentRequest&&['send','alternate','replace'].includes(p.agentRequest.mode)&&typeof p.agentRequest.speakerId==='string'&&Number.isSafeInteger(p.agentRequest.turnNumber)&&(p.agentRequest.mode!=='replace'||Number.isSafeInteger(p.agentRequest.replyTurnNumber))?{agentRequest:p.agentRequest}:{}),...(p.agentNotice&&typeof p.agentNotice.message==='string'&&p.agentNotice.message.trim()&&Number.isSafeInteger(p.agentNotice.turnNumber)?{agentNotice:{turnNumber:p.agentNotice.turnNumber,message:p.agentNotice.message.trim().slice(0,300),...(p.agentNotice.mode==='replace'?{mode:'replace',replyTurnNumber:p.agentNotice.replyTurnNumber}:{})}}:{}),...(Number.isSafeInteger(p.nextTurn)&&p.nextTurn>0?{nextTurn:p.nextTurn}:{}),...(typeof p.graphUpdates==='boolean'?{graphUpdates:p.graphUpdates}:{}),...(p.cast ? {cast:p.cast.map(member=>({id:member.id,...Object.fromEntries(castFields.map(field=>[field,member[field]||'']))}))} : {}),...(typeof p.speakerId==='string' ? {speakerId:p.speakerId} : {}),...Object.fromEntries(storyTextFields.map(key=>[key,typeof p[key]==='string'?p[key]:''])),messages:p.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m,index)=>{const result={role:m.role,content:m.content,turnNumber:Number.isSafeInteger(m.turnNumber)&&m.turnNumber>0?m.turnNumber:index+1};if(isStoryTime(m.storyTime))result.storyTime=m.storyTime;if(m.continuityPending===true)result.continuityPending=true;if(m.excludeFromContext===true)result.excludeFromContext=true;if(validSensitivity(m.contentSensitivity))result.contentSensitivity=m.contentSensitivity;const proposals=graphSuggestions(m.graphSuggestions);if(proposals.length)result.graphSuggestions=proposals;const applied=graphSuggestions(m.appliedGraphUpdates);if(applied.length)result.appliedGraphUpdates=applied;const firstTake=graphSuggestions(m.firstTakeSuggestions);if(firstTake.length)result.firstTakeSuggestions=firstTake;
if(m.role==='assistant'&&m.startsChapter===true)result.startsChapter=true;if(m.role==='assistant'&&typeof m.sourcePrefix==='string')result.sourcePrefix=m.sourcePrefix;if(m.role==='assistant'&&typeof m.speakerName==='string'&&typeof m.speakerId==='string')Object.assign(result,{speakerName:m.speakerName,speakerId:m.speakerId});if(m.role==='assistant' && Array.isArray(m.alternatives) && m.alternatives.length && m.alternatives.every(x=>typeof x==='string')){result.alternatives=m.alternatives.slice();result.selectedAlternative=Number.isInteger(m.selectedAlternative)&&m.selectedAlternative>=0&&m.selectedAlternative<result.alternatives.length?m.selectedAlternative:0;if(result.alternatives[result.selectedAlternative]!==m.content){result.alternatives.push(m.content);result.selectedAlternative=result.alternatives.length-1}if(Array.isArray(m.alternativeSensitivities)){result.alternativeSensitivities=result.alternatives.map((_,i)=>i===result.selectedAlternative ? result.contentSensitivity || null : m.alternativeSensitivities[i]===null ? null : validSensitivity(m.alternativeSensitivities[i]) ? m.alternativeSensitivities[i] : 'unclassified')}}return result})};});if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error('Two stories have the same ID.');return {projects,activeId:projects.some(p=>p.id===data.activeId)?data.activeId:projects[0].id}}

const modelChoice = $('#modelPreset');
const sceneModelChoice = $('#sceneModel');
const userModelsKey = 'story-studio-user-openrouter-models';
const isPreset = id => models.some(model => model.id === id);
function readUserModels() {
  try {
    const values = JSON.parse(localStorage.getItem(userModelsKey) || '[]');
    return Array.isArray(values) ? [...new Set(values.filter(value=>typeof value === 'string' &&
      isModelId(value) && !isPreset(value)))] : [];
  } catch {
    return [];
  }
}
let userModels = readUserModels();
let sceneModelOptionsKey = '';
function saveUserModels(values) {
  userModels = values;
  try { localStorage.setItem(userModelsKey,JSON.stringify(values)); } catch { /* Use this tab’s list. */ }
}
function clearRemovedModelSelections() {
  for (const project of state.projects) {
    const key = modelKey(project.id);
    const model = getSession(key);
    if (model && !isPreset(model) && !userModels.includes(model)) setSession(key,'');
  }
}
window.addEventListener('storage', event => {
  if (event.key !== userModelsKey && event.key !== null) return;
  userModels = readUserModels();
  if (state) {
    clearRemovedModelSelections();
    syncRoute();
  }
});
function modelOptions(mode, {priced = false, addModel = false} = {}) {
  const placeholder = new Option('Pick a model','');
  placeholder.disabled = true;
  const list = models.filter(model => mode !== 'agent' || isAgentModel(model.id)).map(model => {
    const name = mode === 'agent' ? model.name : modelLabel(model);
    const label = priced && mode === 'story' ? `${name} · ~$${chapterCost(model).toFixed(5)} / chapter` : name;
    return new Option(label,model.id);
  });
  if (mode !== 'agent') {
    list.push(...userModels.map(id=>new Option(id + ' · User-added',id)));
    if (addModel) list.push(new Option('Add model by ID…','custom'));
  }
  return [placeholder,...list];
}
function syncSceneModel(model,mode) {
  const optionsKey = JSON.stringify([mode,userModels]);
  if (sceneModelOptionsKey !== optionsKey) {
    sceneModelChoice.replaceChildren(...modelOptions(mode,{addModel:true}));
    sceneModelOptionsKey = optionsKey;
  }
  sceneModelChoice.value = model;
}
sceneModelChoice.onchange = () => {
  if (busy || !state) return;
  const mode = authorMode(current());
  const model = sceneModelChoice.value;
  if (model === 'custom' && mode === 'story') {
    syncRoute();
    return openConnection(true);
  }
  if (mode === 'agent' ? !isAgentModel(model) : !isModelId(model)) return;
  setSession(modelKey(current().id,mode),model);
  syncRoute();
};
const providerDialog = $('#providerDialog');
const tokenRateFormat = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});

function showModelPrice() {
  const model = models.find(item => item.id === modelChoice.value);
  $('#customModel').hidden = modelChoice.value !== 'custom';
  $('#removeUserModel').hidden = !userModels.includes(modelChoice.value);
  $('#modelPrice').hidden = !model;
  if (!model) return;
  $('#modelEstimate').textContent = `~$${chapterCost(model).toFixed(5)} per chapter`;
  $('#modelRates').textContent = `$${tokenRateFormat.format(model.input)} input / $${tokenRateFormat.format(model.output)} output per million tokens`;
  $('#modelSource').href = 'https://openrouter.ai/' + model.id;
}
modelChoice.onchange = () => { $('#modelError').textContent = ''; showModelPrice(); };
$('#modelInput').oninput = () => { $('#modelError').textContent = ''; };

function openConnection(addModel = false) {
  if (!state || busy) return;
  const mode = authorMode(current());
  const model = writingModel(current(),mode);
  modelChoice.replaceChildren(...modelOptions(mode,{priced:true,addModel:true}));
  modelChoice.value = addModel === true ? 'custom' : model;
  $('#modelPolicy').textContent = mode === 'agent' ? 'These models can use the story-state editing tools.'
    : 'Choose Cydonia for sensitive scenes. Other artists use general story context.';
  $('#modelEstimate').hidden = mode === 'agent';
  $('#modelChapterAssumption').hidden = mode === 'agent';
  $('#modelBilling').textContent = mode === 'agent'
    ? 'The selected model receives your request and the story metadata. OpenRouter bills that edit.'
    : 'OpenRouter bills the artist and the DeepSeek continuity pass.';
  $('#modelInput').value = '';
  showModelPrice();
  $('#modelError').textContent = '';
  $('#keyInput').value = openRouterKey;
  providerDialog.showModal();
  if (addModel === true) $('#modelInput').focus();
}
$('#providerButton').onclick = openConnection;
$('#closeProvider').onclick = $('#cancelProvider').onclick = () => $('#providerDialog').close();
providerDialog.addEventListener('close', () => {
  $('#keyInput').value = '';
});
$('#providerForm').onsubmit = event => {
  event.preventDefault();
  const project = current();
  const mode = authorMode(project);
  const custom = modelChoice.value === 'custom';
  const modelInput = $('#modelInput');
  const model = custom ? modelInput.value.trim().toLowerCase() : modelChoice.value;
  if (mode === 'agent' ? !isAgentModel(model) : !isModelId(model)) {
    $('#modelError').textContent = mode === 'agent' ? 'Choose a model supported in Agent mode.' : custom
      ? 'Enter a specific model ID in author/model format.'
      : 'Choose an OpenRouter model.';
    (custom ? modelInput : modelChoice).focus();
    return;
  }
  if (custom && !isPreset(model) && !userModels.includes(model)) saveUserModels([...userModels,model]);
  openRouterKey = $('#keyInput').value.trim();
  setSession(modelKey(project.id,mode),model);
  setSession(routeKey(project.id,mode),'openrouter');
  syncRoute();
  renderMessages();
  $('#providerDialog').close();
  error();
};
$('#removeUserModel').onclick = () => {
  const model = modelChoice.value;
  if (!userModels.includes(model)) return;
  saveUserModels(userModels.filter(id=>id !== model));
  clearRemovedModelSelections();
  modelChoice.replaceChildren(...modelOptions('story',{priced:true,addModel:true}));
  modelChoice.value = '';
  showModelPrice();
  syncRoute();
  modelChoice.focus();
};
$('#sceneProvider').onchange = event => {
  setSession(routeKey(current().id,authorMode(current())), event.target.value);
  syncRoute();
  if (event.target.value === 'openrouter' && !openRouterKey) openConnection();
  renderMessages();
};
$('#pasteReply').onclick=()=>{$('#pasteText').value='';$('#pasteDialog').showModal()};
$('#closePaste').onclick=$('#cancelPaste').onclick=()=>$('#pasteDialog').close();
$('#pasteForm').onsubmit=event=>{
  event.preventDefault();
  const text = $('#pasteText').value.trim();
  if (!text) return;
  const project = current();
  delete project.agentRequest;
  delete project.agentNotice;
  appendTurn(project,{role:'assistant',content:text,...speakerMetadata(narrator),
    ...(sensitiveDraft(project) ? {contentSensitivity:'explicit'} : {})});
  setSession(sensitiveKey(project.id),'');
  markDirty();
  $('#pasteDialog').close();
  render();
};
// Import fills only the selected profile draft. Saving is still explicit.
const cardButton = el('button', 'button subtle', 'Import JSON card');
cardButton.type = 'button';
const cardInput = el('input');
cardInput.type = 'file';
cardInput.accept = '.json,application/json';
cardInput.hidden = true;
$('#cardTools').append(cardButton, cardInput);
let importCharacter;
cardButton.onclick = () => { importCharacter = editingCharacter; cardInput.click(); };
cardInput.onchange = async () => {
  const file = cardInput.files[0];
  const characterId = importCharacter;
  if (!file) return;
  const hint = $('#cardHint');
  try {
    if (file.size > 2_000_000) throw Error('The card is too large (maximum 2 MB).');
    const raw = JSON.parse(await file.text());
    const data = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('This is not a supported character card.');
    const fields = {name:'name', nickname:'nickname', description:'description', personality:'personality', scenario:'scenario', examples:'mes_example'};
    if (!Object.values(fields).some(key => typeof data[key] === 'string' && data[key].trim())) throw Error('No supported character fields found.');
    const editor = castEditors().find(item => item.dataset.id === characterId);
    if (!editor || !$('#settingsDialog').open) return;
    for (const [field, key] of Object.entries(fields)) {
      const input = editor.querySelector(`[data-field="${field}"]`);
      input.value = typeof data[key] === 'string' ? data[key].trim() : '';
      input.setCustomValidity('');
    }
    refreshEditorName(editor);
    hint.textContent = 'Card imported. Review and save. Greetings, artwork, lorebooks, and extensions were skipped.';
  } catch (e) {
    hint.textContent = `Could not import card: ${e.message}`;
  } finally {
    cardInput.value = '';
  }
};

$('#settingsButton').onclick = () => openSettings();
$('#closeSettings').onclick = $('#cancelSettings').onclick = () => $('#settingsDialog').close();
$('#settingsForm').noValidate = true;
$('#settingsForm').addEventListener('input', event => {
  if (event.target.matches('textarea')) event.target.setCustomValidity('');
});
$('#settingsForm').onsubmit = event => {
  event.preventDefault();
  const form = event.currentTarget;
  const project = current();
  if (!form.elements.title.value.trim()) {
    selectSettingsTab($('#writingTab'));
    form.elements.title.setCustomValidity('Enter a story title.');
    form.elements.title.reportValidity();
    return;
  }
  form.elements.title.setCustomValidity('');
  for (const key of settingsFields.slice(1)) {
    const field = form.elements[key];
    if (checkLongField(field,project[key])) continue;
    selectSettingsTab(field.closest('#worldPanel') ? $('#worldTab') : $('#writingTab'));
    if (field.closest('details')) field.closest('details').open = true;
    field.reportValidity();
    return;
  }
  if (!isStoryTime($('#storyStartAt').value)) {
    selectSettingsTab($('#worldTab'));
    $('#storyStartAt').setCustomValidity('Enter an in-story starting date and time.');
    $('#storyStartAt').reportValidity();
    return;
  }
  setDraftStart($('#storyStartAt').value);
  for (const editor of castEditors()) {
    const previous = project.cast?.find(member=>member.id === editor.dataset.id);
    for (const field of editor.querySelectorAll('textarea')) {
      if (checkLongField(field,previous?.[field.dataset.field])) continue;
      selectSettingsTab($('#castTab'));
      selectCastEditor(editor.dataset.id);
      if (field.closest('details')) field.closest('details').open = true;
      field.reportValidity();
      return;
    }
  }
  const cast = readCast();
  if (!validCast(cast)) {
    const missingName = [...$('#castEditors').querySelectorAll('[data-field=name]')].find(input => !input.value.trim());
    if (missingName) {
      selectSettingsTab($('#castTab'));
      selectCastEditor(missingName.closest('fieldset').dataset.id);
      missingName.setCustomValidity('Enter a name for this character.');
      missingName.reportValidity();
    }
    return;
  }
  if (!project.graphHistory?.length) captureGraphVersion(project, 0);
  for (const key of settingsFields) project[key] = form.elements[key].value.trim();
  project.cast = cast;
  project.storyStartAt = draftStartAt;
  project.storyStartSource = draftStartSource;
  project.relationships = draftRelationships;
  project.graphUpdates = $('#graphUpdates').checked;
  for (const [index, turn] of project.messages.entries()) {
    if (!turn.graphSuggestions) continue;
    const reviewed = pendingGraphReview.filter(item => item.turn === index && item.status);
    const applied = reviewed.filter(item => item.applied && item.suggestion.kind !== 'relationship').map(item => item.suggestion);
    if (applied.length) turn.appliedGraphUpdates = graphSuggestions([...(turn.appliedGraphUpdates || []),...applied]);
    turn.graphSuggestions = turn.graphSuggestions.filter((_, proposal) => !reviewed.some(item => item.index === proposal));
    if (!turn.graphSuggestions.length) delete turn.graphSuggestions;
  }
  captureGraphVersion(project, Math.max(nextTurnNumber(project)-1, project.graphHistory.at(-1)?.turn || 0));
  markDirty();
  $('#settingsDialog').close();
  render();
};
$('#settingsForm').elements.title.oninput = event => event.target.setCustomValidity('');
$('#closeEdit').onclick = $('#cancelEdit').onclick = () => $('#editDialog').close();
$('#turnSensitivity').onchange = event => showEditSensitivity(event.target.value === 'include' ? 'reviewed-safe' : 'explicit');
$('#editStoryTime').oninput = event => event.target.setCustomValidity('');
$('#editForm').onsubmit = event => {
  event.preventDefault();
  const message = current().messages[editingIndex];
  const clock = $('#editStoryTime');
  if (clock.value && !isStoryTime(clock.value)) {
    clock.setCustomValidity('Enter an in-story date and time.');
    clock.reportValidity();
    return;
  }
  if (clock.value) message.storyTime = clock.value;
  else delete message.storyTime;
  setSensitivity(message,editingSensitivity);
  if ($('#excludeTurn').checked) message.excludeFromContext = true;
  else delete message.excludeFromContext;
  syncEditedTake(message);
  markDirty();
  $('#editDialog').close();
  renderMessages();
};
const setupDialog = $('#setupDialog');
const setupChat = $('#setupChat');
const setupReview = $('#setupReview');
const setupImport = $('#setupImport');
const setupProvider = $('#setupProvider');
const setupModel = $('#setupModel');
const setupKey = $('#setupKey');
const setupMessage = $('#setupMessage');
const setupContext = $('#setupContext');
const setupAttach = $('#setupAttach');
const setupConversation = $('#setupConversation');
const setupChatError = $('#setupChatError');
const setupFeedback = $('#setupFeedback');
const setupCast = $('#setupCast');
const setupAddCharacter = $('#setupAddCharacter');
const setupRelationships = $('#setupRelationships');
const setupAddRelationship = $('#setupAddRelationship');
const maxSetupCast = 8;
let setupMessages = [], setupRequest, setupReviewBack = 'choice', setupImportBack = 'choice';
let setupImportFromMessage = false;
let setupManuscript, setupMcpSession, setupSuggestedChapters = [];

function setupStep(step) {
  $('#setupChoice').hidden = step !== 'choice';
  setupChat.hidden = step !== 'chat';
  setupReview.hidden = step !== 'review';
  setupImport.hidden = step !== 'import';
  const title = $('#setupHeading');
  title.textContent = {choice:'New story',import:'Import an existing story',chat:'Brainstorm your story',
    review:setupReviewBack === 'chat' ? 'Review your setup' : 'Set up your story'}[step];
  title.focus({preventScroll:true});
}

function addSetupCharacter({name='',description=''} = {}) {
  const entry = el('fieldset','setup-character');
  entry.dataset.castId = id();
  const nameField = el('input','setup-character-name');
  nameField.value = name;
  nameField.maxLength = 100;
  nameField.required = true;
  nameField.oninput = syncSetupRelationshipChoices;
  const descriptionField = el('textarea','setup-character-description');
  descriptionField.value = description;
  descriptionField.rows = 2;
  const nameLabel = el('label','','Name'), descriptionLabel = el('label','','Description');
  nameLabel.append(nameField);
  descriptionLabel.append(descriptionField);
  const remove = el('button','text-button','Remove character');
  remove.type = 'button';
  remove.onclick = () => {
    entry.remove();
    setupAddCharacter.disabled = false;
    syncSetupRelationshipChoices();
    setupAddCharacter.focus();
  };
  entry.append(el('legend','','Character'),nameLabel,descriptionLabel,remove);
  setupCast.append(entry);
  setupAddCharacter.disabled = setupCast.children.length >= maxSetupCast;
  syncSetupRelationshipChoices();
  return nameField;
}

function syncSetupRelationshipChoices() {
  const cast = [...setupCast.children].map(entry => [entry.dataset.castId,entry.querySelector('.setup-character-name').value.trim()]);
  const named = cast.filter(([,name])=>name);
  for (const select of setupRelationships.querySelectorAll('select')) {
    const value = select.value;
    select.replaceChildren(new Option('Choose a character',''),...named.map(([key,name])=>new Option(name,key)));
    select.value = named.some(([key])=>key === value) ? value : '';
  }
  setupAddRelationship.disabled = named.length < 2 || setupRelationships.children.length >= maxSetupRelationships;
}

function addSetupRelationship({from='',to='',label=''} = {}) {
  const entry = el('fieldset','setup-character');
  const fromField = el('select','setup-relationship-from');
  const toField = el('select','setup-relationship-to');
  fromField.required = toField.required = true;
  const note = el('input','setup-relationship-note');
  note.value = label;
  note.maxLength = 400;
  note.required = true;
  const fields = [['From',fromField],['To',toField],['Relationship',note]].map(([name,field]) => {
    const wrapper = el('label','',name);
    wrapper.append(field);
    return wrapper;
  });
  const remove = el('button','text-button','Remove relationship');
  remove.type = 'button';
  remove.onclick = () => {
    entry.remove();
    syncSetupRelationshipChoices();
    setupAddRelationship.focus();
  };
  entry.append(el('legend','','Relationship'),...fields,remove);
  setupRelationships.append(entry);
  syncSetupRelationshipChoices();
  fromField.value = from;
  toField.value = to;
  return fromField;
}

function fillSetupReview({title='',scenario='',lore='',notes='',cast=[],continuity='',chapterStarts=[],relationships=[],storyStartAt=''} = {}) {
  $('#setupTitle').value = title;
  $('#setupScenario').value = scenario;
  $('#setupLore').value = lore;
  $('#setupNotes').value = notes;
  $('#setupContinuity').value = continuity;
  for (const field of setupReview.querySelectorAll('textarea')) field.setCustomValidity('');
  $('#setupStartAt').value = storyStartAt;
  setupSuggestedChapters = chapterStarts.length || !setupManuscript ? chapterStarts : defaultChapterStarts(setupManuscript);
  $('#setupUseSuggestions').checked = true;
  $('#setupReviewedAll').checked = false;
  updateManuscriptReview();
  setupCast.replaceChildren();
  setupRelationships.replaceChildren();
  setupAddCharacter.disabled = false;
  cast.forEach(addSetupCharacter);
  const castIds = new Map(cast.map(({name},index)=>[name,setupCast.children[index].dataset.castId]));
  for (const edge of relationships) addSetupRelationship({...edge,from:castIds.get(edge.from),to:castIds.get(edge.to)});
  syncSetupRelationshipChoices();
  $('#setupReviewError').textContent = '';
}

function updateManuscriptReview() {
  $('#setupSourceReview').hidden = !setupManuscript;
  $('#setupContinuityField').hidden = !setupManuscript;
  $('#setupSuggestionField').hidden = !setupSuggestedChapters.length;
  if (!setupManuscript) return;
  const turns = manuscriptTurns(setupManuscript,$('#setupUseSuggestions').checked ? setupSuggestedChapters : []);
  const chapters = turns.filter(turn => turn.startsChapter).length + 1;
  $('#setupReviewSummary').textContent = `${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} · ${chapters} ${chapters === 1 ? 'chapter' : 'chapters'}. All imported prose is kept. MCP context requires review.`;
}

function updateManuscriptSource() {
  $('#setupSource').hidden = !setupManuscript;
  $('#setupReviewLocally').hidden = !setupManuscript;
  const excerpts = $('#setupExcerpts');
  excerpts.replaceChildren();
  $('#setupSource details').open = false;
  if (!setupManuscript) return;
  const count = setupManuscript.turns.length;
  $('#setupSourceSummary').textContent = `${setupManuscript.words.toLocaleString()} words · ${count} ${count === 1 ? 'turn' : 'turns'}`;
  for (const {turn,excerpt} of setupManuscript.passages) {
    const line = el('li');
    line.append(el('strong','',`Turn ${turn}`),el('p','',excerpt));
    excerpts.append(line);
  }
}

function renderSetupChat(messages = setupMessages) {
  setupConversation.hidden = !messages.length;
  setupConversation.replaceChildren(...messages.map(({role,content}) => {
    const turn = el('li',role === 'user' ? 'setup-user' : 'setup-assistant');
    turn.append(el('strong','',role === 'user' ? 'You' : 'Writing assistant'),el('p','',content));
    return turn;
  }));
  setupConversation.scrollTop = setupConversation.scrollHeight;
  $('#setupMessageLabel').textContent = setupManuscript ? 'What should the setup capture?' :
    setupMessages.length ? 'Continue brainstorming' : 'Do you have a story already, or are you starting fresh?';
  setupMessage.placeholder = setupManuscript ? 'Add context, or prepare the setup draft…' :
    setupMessages.length ? 'Add an idea or say what you’d change…' : 'A premise, a character, or even just a mood…';
}

function syncSetupChat() {
  const pending = Boolean(setupRequest);
  const content = setupMessage.value.trim();
  const context = setupContext.value.trim();
  const words = setupInputWords(setupMessages,context,content);
  const tooLong = words > maxSetupWords;
  const canTransferDraft = tooLong && Boolean(content);
  const mcp = setupProvider.value === 'mcp';
  const draftModel = setupDraftModel(setupModel.value);
  const draftName = models.find(({id})=>id === draftModel).name;
  const manuscriptAction = setupManuscript ? 'Replace manuscript' : 'Use as manuscript';
  setupProvider.disabled = pending;
  $('#setupModelField').hidden = mcp;
  $('#setupKeyField').hidden = mcp || Boolean(openRouterKey);
  $('#setupProviderNote').textContent = mcp
    ? 'Your MCP watcher handles setup as well as writing. It receives this chat, your additional context, and the previewed manuscript excerpts.'
    : `OpenRouter receives this chat, any additional context, and the previewed manuscript excerpts. ${draftName} prepares the draft. Both use your OpenRouter credits.`;
  $('#setupAgentInstructions').hidden = !mcp;
  setupModel.disabled = pending;
  setupKey.disabled = pending;
  setupMessage.readOnly = pending;
  setupContext.readOnly = pending;
  $('#setupSend').disabled = pending || tooLong || !content;
  $('#setupDraft').disabled = pending || tooLong || (!setupMessages.length && !content && !context && !setupManuscript);
  setupAttach.disabled = pending;
  setupAttach.hidden = Boolean(setupManuscript) && !canTransferDraft;
  setupAttach.textContent = canTransferDraft ? manuscriptAction : 'Import a manuscript';
  $('#setupReviewLocally').disabled = pending;
  $('#backSetupChat').disabled = pending;
  $('#setupSend').textContent = mcp ? 'Queue message' : 'Send';
  $('#setupWordCount').textContent = `${words.toLocaleString()} / ${maxSetupWords.toLocaleString()} words across your chat and additional context`;
  updateSetupContextUsage(content,context,mcp,draftModel);
  if (!pending) setupFeedback.textContent = tooLong
    ? 'Shorten your current message or additional context to fit the 20,000-word setup limit.' : '';
}

function closeMcpSetup() {
  const sessionId = setupMcpSession;
  setupMcpSession = undefined;
  if (sessionId) void fetch('/api/setup/mcp',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'cancel',sessionId}),keepalive:true}).catch(() => {});
}

async function requestMcpSetup(payload,request) {
  const sessionId = setupMcpSession ||= id();
  const call = (action,body = {}) => api('/api/setup/mcp',{method:'POST',headers:{'Content-Type':'application/json'},
    signal:request.signal,body:JSON.stringify({action,sessionId,...body})});
  await call('queue',payload);
  if (request.signal.aborted || setupMcpSession !== sessionId) return;
  syncSetupChat();
  setupFeedback.textContent = 'Queued for your MCP watcher.';
  const deadline = Date.now() + 8 * 60_000;
  while (!request.signal.aborted && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve,1000));
    if (request.signal.aborted) return;
    const result = await call('status');
    if (result.status === 'done') {
      if (result.error) throw Error(result.error);
      return result;
    }
    if (result.status === 'closed') break;
    if (result.status === 'working') setupFeedback.textContent = 'Your MCP agent is preparing a response…';
  }
  if (request.signal.aborted) return;
  closeMcpSetup();
  throw Error('The MCP setup request expired. Start a watcher if needed, then queue the request again.');
}

async function requestSetup(mode) {
  if (setupRequest) return;
  const content = setupMessage.value.trim();
  const context = setupContext.value.trim();
  if (setupInputWords(setupMessages,context,content) > maxSetupWords) return;
  const mcp = setupProvider.value === 'mcp';
  const key = openRouterKey || setupKey.value.trim();
  setupChatError.textContent = '';
  if (!mcp && (!setupModel.value || !key)) {
    setupChatError.textContent = !setupModel.value ? 'Choose an OpenRouter model.' : 'Enter your OpenRouter API key.';
    (!setupModel.value ? setupModel : setupKey).focus();
    return;
  }
  if (mode === 'chat' && !content) return;
  const messages = content ? [...setupMessages,{role:'user',content}] : setupMessages;
  const request = new AbortController();
  const manuscript = setupManuscript && {turnCount:setupManuscript.turns.length,hasChapters:setupManuscript.hasChapters,
    passages:setupManuscript.passages};
  setupRequest = request;
  if (mode === 'chat') renderSetupChat(messages);
  try {
    syncSetupChat();
    setupFeedback.textContent = mode === 'chat' ? 'Thinking…' : 'Preparing your setup draft…';
    const payload = {mode,messages,manuscript,context};
    const result = mcp ? await requestMcpSetup(payload,request)
      : await api('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},signal:request.signal,
        body:JSON.stringify({...payload,model:setupModel.value,key})});
    if (setupRequest !== request || !setupDialog.open) return;
    if (mode === 'draft') {
      fillSetupReview({...result.draft,title:setupManuscript?.title || result.draft.title});
      setupReviewBack = 'chat';
      setupStep('review');
    } else {
      setupMessages = [...messages,{role:'assistant',content:result.text}];
      setupMessage.value = '';
      renderSetupChat();
      setupMessage.focus({preventScroll:true});
    }
  } catch (failure) {
    if (!request.signal.aborted && setupDialog.open) {
      if (mcp) closeMcpSetup();
      renderSetupChat();
      setupChatError.textContent = failure.message;
    }
  } finally {
    if (setupRequest === request) {
      setupRequest = undefined;
      syncSetupChat();
    }
  }
}

$('#newProject').onclick = () => {
  if (!state) return;
  if (state.projects.length - 1 >= maxLibraryStories) {
    alert('Your library has reached its story limit.');
    return;
  }
  setupMessages = [];
  setupChat.reset();
  setupModel.replaceChildren(...modelOptions('setup'));
  setupModel.value = '';
  $('#setupContextDetails').open = false;
  setupImport.reset();
  setupImportFromMessage = false;
  setupManuscript = undefined;
  $('#setupImportError').textContent = '';
  setupChatError.textContent = '';
  updateManuscriptSource();
  renderSetupChat();
  syncSetupChat();
  fillSetupReview();
  $('#sidebar').close();
  setupDialog.showModal();
  setupStep('choice');
};
$('#closeSetup').onclick = () => setupDialog.close();
setupDialog.addEventListener('close',() => {
  setupRequest?.abort();
  setupRequest = undefined;
  closeMcpSetup();
  setupKey.value = '';
  setupMessage.value = '';
  setupContext.value = '';
  setupMessages = [];
  setupManuscript = undefined;
  setupImport.reset();
  updateManuscriptSource();
  renderSetupChat();
  if (document.activeElement === document.body) $('#openMenu').focus();
});
$('#setupManual').onclick = () => {
  setupManuscript = undefined;
  updateManuscriptSource();
  setupReviewBack = 'choice';
  updateManuscriptReview();
  setupStep('review');
};
$('#setupBrainstorm').onclick = () => { syncSetupChat(); setupStep('chat'); };
$('#setupExisting').onclick = () => {
  setupImportBack = 'choice';
  setupImportFromMessage = false;
  setupStep('import');
};
setupAttach.onclick = () => {
  setupImportBack = 'chat';
  setupImportFromMessage = Boolean(setupMessage.value.trim()) &&
    setupInputWords(setupMessages,setupContext.value,setupMessage.value) > maxSetupWords;
  if (setupImportFromMessage) {
    $('#setupManuscriptFile').value = '';
    $('#setupManuscript').value = setupMessage.value;
    $('#setupImportError').textContent = '';
  }
  setupStep('import');
};
$('#backSetupImport').onclick = () => {
  setupStep(setupImportBack);
  if (setupImportBack === 'chat') setupMessage.focus({preventScroll:true});
};
$('#backSetupChat').onclick = () => setupStep(setupManuscript ? 'import' : 'choice');
$('#backSetupReview').onclick = () => setupStep(setupReviewBack);
setupProvider.onchange = () => { closeMcpSetup(); syncSetupChat(); };
setupModel.onchange = syncSetupChat;
$('#setupUseSuggestions').onchange = updateManuscriptReview;

setupImport.onsubmit = async event => {
  event.preventDefault();
  const error = $('#setupImportError');
  const submit = $('#setupImportContinue');
  error.textContent = '';
  const pasted = $('#setupManuscript').value;
  const file = $('#setupManuscriptFile').files[0];
  submit.disabled = true;
  try {
    if (file && pasted.trim()) throw Error('Choose either the pasted manuscript or a file. Clear the other field to continue.');
    if (file?.size > manuscriptByteLimit) throw Error('The manuscript exceeds 2 MB.');
    const text = file ? await file.text() : pasted;
    if (!setupDialog.open || setupImport.hidden) return;
    const manuscript = parseManuscript(text);
    setupManuscript = {...manuscript,passages:manuscriptPassages(manuscript.turns),
      title:manuscript.title || file?.name.replace(/\.[^.]+$/u,'').slice(0,160) || ''};
    if (setupImportFromMessage) setupMessage.value = '';
    setupImportFromMessage = false;
    updateManuscriptSource();
    renderSetupChat();
    syncSetupChat();
    setupStep('chat');
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    submit.disabled = false;
  }
};

$('#setupReviewLocally').onclick = () => {
  fillSetupReview({title:setupManuscript.title});
  setupReviewBack = 'chat';
  setupStep('review');
};
setupMessage.oninput = syncSetupChat;
setupContext.oninput = syncSetupChat;
setupChat.onsubmit = event => { event.preventDefault(); void requestSetup('chat'); };
$('#setupDraft').onclick = () => void requestSetup('draft');
setupAddCharacter.onclick = () => addSetupCharacter().focus();
setupAddRelationship.onclick = () => addSetupRelationship().focus();
setupReview.addEventListener('input', event => {
  if (event.target.matches('textarea')) event.target.setCustomValidity('');
});
setupReview.onsubmit = event => {
  event.preventDefault();
  const title = $('#setupTitle').value.trim();
  if (!title) {
    $('#setupReviewError').textContent = 'Enter a story title.';
    $('#setupTitle').focus();
    return;
  }
  const cast = [], names = new Set();
  for (const field of setupReview.querySelectorAll('textarea')) {
    if (field.closest('[hidden]') || checkLongField(field)) continue;
    field.reportValidity();
    return;
  }
  for (const card of setupCast.children) {
    const field = card.querySelector('.setup-character-name');
    const name = field.value.trim(), key = name.toLowerCase();
    if (!name || names.has(key)) {
      $('#setupReviewError').textContent = 'Enter a different, non-empty name for each character.';
      field.focus();
      return;
    }
    names.add(key);
    cast.push({id:card.dataset.castId,name,description:card.querySelector('.setup-character-description').value.trim()});
  }
  const setupStart = $('#setupStartAt').value;
  if (setupStart && !isStoryTime(setupStart)) {
    $('#setupReviewError').textContent = 'Use a valid story date and time.';
    $('#setupStartAt').focus();
    return;
  }
  const storyStartAt = setupStart || localStoryTime();
  const actualIds = new Set(cast.map(member=>member.id));
  const relationships = [];
  for (const row of setupRelationships.children) {
    const fromField = row.querySelector('.setup-relationship-from');
    const from = fromField.value;
    const to = row.querySelector('.setup-relationship-to').value;
    const label = row.querySelector('.setup-relationship-note').value.trim();
    if (!actualIds.has(from) || !actualIds.has(to) || from === to || !label) {
      $('#setupReviewError').textContent = 'Choose two different cast members and describe each starting relationship.';
      fromField.focus();
      return;
    }
    relationships.push({from,to,label,turn:0,storyTime:storyStartAt});
  }
  const messages = setupManuscript
    ? manuscriptTurns(setupManuscript,$('#setupUseSuggestions').checked ? setupSuggestedChapters : [],$('#setupReviewedAll').checked)
    : [];
  const projectId = id();
  const newStory = {
    id:projectId,title,
    lore:$('#setupLore').value.trim(),premise:$('#setupScenario').value.trim(),notes:$('#setupNotes').value.trim(),
    storyStartAt,storyStartSource:setupStart ? 'author' : 'estimate',messages,relationships,
    ...(setupManuscript ? {continuity:$('#setupContinuity').value.trim(),nextTurn:messages.length + 1} : {}),
    cast:cast.map(member => ({...Object.fromEntries(castFields.map(field => [field,''])),...member}))
  };
  const [project] = normalize({activeId:projectId,projects:[newStory]}).projects;
  captureGraphVersion(project,0);
  state.projects.unshift(project);
  state.activeId = project.id;
  markDirty();
  setupDialog.close();
  showStoryView('write');
  render();
  $('#instruction').focus();
};
$('#deleteProject').onclick = async () => {
  if (!state) return;
  const project = current();
  storyActions.open = false;
  storyActions.querySelector('summary').focus();
  if (project.id === starterStoryId || !await confirmDanger(`Delete “${project.title}”?`,
    'This permanently removes the story, its turns, and its character and relationship history from the library.', 'Delete story')) return;
  state.projects = state.projects.filter(item => item.id !== project.id);
  pendingComposerEdits.delete(project.id);
  state.activeId = state.projects[0].id;
  markDirty(project);
  render();
  $('#openMenu').focus();
};
$('#sendButton').onclick = () => generate();
$('#authorMode').onchange = event => {
  if (!state || busy || composerEdit) return;
  setSession(modeKey(current().id),event.target.value);
  error();
  render();
};
$('#sensitiveScene').onchange = event => {
  if (!state || busy) return;
  setSession(sensitiveKey(current().id),event.target.checked ? 'true' : '');
  syncRoute();
};
$('#cancelAgentEdit').onclick = () => {
  const project = current();
  const request = project.agentEditRequest;
  if (!request) return;
  if (!$('#instruction').value.trim()) setSession(draftKey(project.id,'agent'),request.instruction);
  delete project.agentEditRequest;
  markDirty(project);
  render();
};
$('#cancelComposerEdit').onclick = closeComposerEdit;
$('#verifyComposerEdit').onchange = event => {
  if (composerEdit) composerEdit.verified = event.target.checked;
};
$('#instruction').oninput = event => {
  const input = event.target;
  input.setCustomValidity('');
  if (composerEdit) {
    composerEdit.draft = input.value;
    composerEdit.verified = false;
    $('#verifyComposerEdit').checked = false;
  }
  else if (state) setSession(draftKey(current().id,authorMode(current())),input.value);
  clearTimeout(contextEstimateTimer);
  contextEstimateTimer = setTimeout(updateContextIndicator,160);
};
$('#instruction').onkeydown = event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void generate();
  }
};
function promptForDraft() {
  const direction = $('#instruction').value.trim();
  const project = current();
  const provider = writingRoute(project);
  const options = {
    model: provider === 'openrouter' ? writingModel(project) : '',
    includeSensitive:provider === 'openrouter' && canWriteSensitive(writingModel(project)) && sensitiveDraft(project),
    openRouter:provider === 'openrouter'
  };
  if (composerEdit?.canRegenerate) {
    const index = project.messages.findIndex(turn=>turn.turnNumber === composerEdit.turnNumber);
    if (index >= 0) {
      const reply = pairedReply(project,index);
      const history = project.messages.slice(0,index);
      const source = reply ? storyAtTurn(project,index) : project;
      const replyTime = reply?.storyTime || project.messages[index].storyTime;
      const context = options.openRouter ? openRouterSnapshot(source,history,replyTime,options.includeSensitive)
        : {...source,messages:history,replyTime};
      return buildMessages(context,direction,reply ? 'replace' : 'send',options);
    }
  }
  // Without a new direction, show what a queued turn or a reply to the last
  // writer turn sends, laid out exactly as the MCP server lays it out.
  const queued = provider === 'mcp' && !direction ? queuedTurn(project).request : null;
  const source = queued?.mode === 'replace'
    ? {...storyAtTurn(project,project.messages.findIndex(turn => turn.turnNumber === queued.turnNumber)),
      messages:project.messages,agentRequest:queued}
    : project;
  const input = direction ? {project:source,direction,mode:'send'}
    : replyInput(source,queued?.mode || 'send',options);
  const context = options.openRouter ? openRouterSnapshot(input.project,input.project.messages,input.project.replyTime,options.includeSensitive) : input.project;
  return buildMessages(context,input.direction,input.mode,options);
}

const contextNumber = new Intl.NumberFormat();
const contextEstimate = tokens => `≈${contextNumber.format(tokens)} input tokens`;
function windowLabel(route,model) {
  if (route === 'mcp') return 'MCP window unknown';
  if (!model) return 'model unselected';
  const limit = modelContextWindow(model);
  return limit ? `${contextNumber.format(limit)} window` : 'model window unknown';
}

function updateSetupContextUsage(content,context,mcp,draftModel) {
  const chatTokens = setupMessages.reduce((sum,{content})=>sum + estimateContextTokens(content),estimateContextTokens(content));
  const contextTokens = estimateContextTokens(context);
  const excerpts = setupManuscript?.passages || [];
  const excerptTokens = excerpts.length ? estimateContextTokens(JSON.stringify(excerpts)) : 0;
  const route = mcp ? 'mcp' : 'openrouter';
  const selectedModel = setupModel.value;
  $('#setupContextUsage').textContent = `Context · ${contextEstimate(chatTokens + contextTokens + excerptTokens)} · ${windowLabel(route,selectedModel)}`;
  $('#setupContextBreakdown').textContent = `Chat and current message ${contextNumber.format(chatTokens)} · Additional context ${contextNumber.format(contextTokens)} · Previewed manuscript excerpts ${contextNumber.format(excerptTokens)} tokens`;
  const draftWindow = modelContextWindow(draftModel);
  const draftName = models.find(({id})=>id === draftModel).name;
  $('#setupContextLimits').textContent = mcp
    ? 'The MCP client controls the model window. The estimate covers what Studio sends to the client.'
    : `Drafts use ${draftName} with a published window of at least ${contextNumber.format(draftWindow)} tokens. Studio allows up to ${contextNumber.format(setupChatOutputLimit)} output tokens for chat and ${contextNumber.format(setupDraftOutputLimit)} per draft call. The estimate covers the supplied text before instructions and tool definitions.`;
}

let contextEstimateTimer;
function updateContextIndicator() {
  if (!state) return;
  clearTimeout(contextEstimateTimer);
  const details = composerContext();
  $('#contextIndicator').textContent = details.summary;
  return details;
}

function composerContext() {
  const project = current();
  const mode = authorMode(project);
  const route = writingRoute(project,mode);
  const model = route === 'openrouter' ? writingModel(project,mode) : '';
  if (route === 'manual' || (composerEdit && !composerEdit.canRegenerate)) {
    return {heading:'Context',summary:'Context · no model call',parts:[],
      limits:'This action saves the text locally. No model sees it.'};
  }
  if (mode === 'story' && sensitiveDraft(project) && (route !== 'openrouter' || !canWriteSensitive(model))) {
    return {heading:'Context',summary:'Context · sensitive route required',parts:[],
      limits:'Choose Cydonia before sending this marked scene to a model.'};
  }
  const edited = composerEdit && project.messages.find(turn=>turn.turnNumber === composerEdit.turnNumber);
  if (edited && (edited.excludeFromContext || (!sensitiveDraft(project) && !isAvailableToMcp(edited)))) {
    return {heading:'Context',summary:'Context · direction withheld',parts:[],
      limits:'This direction stays local until you choose an eligible route or review its context label.'};
  }
  const modelWindow = modelContextWindow(model);
  const windowNote = route === 'mcp' ? 'The MCP client controls the model window and may add its own history.'
    : modelWindow ? `The lowest published provider window is ${contextNumber.format(modelWindow)} tokens, including output.`
      : 'Studio does not have a verified window for this model.';
  let parts, messages, limits;
  if (mode === 'agent') {
    const {recentTurns,...overview} = storyOverview(project);
    const request = project.agentEditRequest?.instruction || $('#instruction').value.trim();
    const story = route === 'mcp' ? {overview,state:storyEditContext(project)} : overview;
    parts = [
      {label:route === 'mcp' ? 'Story state and cast' : 'Cast names and story time',tokens:estimateContextTokens(JSON.stringify(story))},
      {label:'Recent eligible story turns',tokens:recentTurns.length ? estimateContextTokens(JSON.stringify(recentTurns)) : 0},
      {label:'Current edit request',tokens:estimateContextTokens(request)}
    ];
    const output = route === 'openrouter' ? ` Studio allows ${contextNumber.format(agentOutputLimit)} output tokens per call.` : '';
    limits = `${windowNote}${output} Studio includes up to ${contextNumber.format(continuityRecentTokenCap)} tokens of recent eligible story text. The initial estimate excludes instructions, tool definitions, and any additional story state the agent looks up.`;
  } else {
    messages = promptForDraft();
    parts = storyPromptUsage(messages);
    const output = route === 'openrouter' && model ? ` The writer can generate up to ${contextNumber.format(proseOutputLimit(model))} tokens.` : '';
    const continuity = route === 'mcp' ? 'Afterward, the MCP continuity handoff includes the new scene and allows scoped lookups.'
      : `Afterward, DeepSeek gets the new text and up to ${contextNumber.format(continuityRecentTokenCap)} eligible history tokens and can look up story state.`;
    limits = `${windowNote} Studio budgets ${contextNumber.format(writingPromptLimit(model))} input tokens, including up to ${contextNumber.format(writingHistoryLimit(model))} for recent turns.${output} Story state includes world, characters, notes, and graph. ${continuity}`;
  }
  const tokens = parts.reduce((sum,part)=>sum + part.tokens,0);
  return {heading:messages ? 'Prompt preview' : 'Agent context',summary:`Context · ${contextEstimate(tokens)} · ${windowLabel(route,model)}`,
    parts,messages,limits};
}

$('#promptPreview').onclick = $('#contextIndicator').onclick = () => {
  if (!state) return;
  const {heading,summary,parts,messages,limits} = updateContextIndicator();
  $('#promptHeading').textContent = heading;
  $('#contextTotal').textContent = summary;
  $('#contextParts').replaceChildren(...parts.flatMap(({label,tokens})=>[
    el('dt','',label),el('dd','',contextNumber.format(tokens) + ' tokens')
  ]));
  $('#contextLimits').textContent = limits;
  $('#promptTextDetails').hidden = !messages;
  $('#promptTextDetails').open = true;
  $('#promptContents').textContent = messages ? formatMessages(messages) : '';
  $('#promptDialog').showModal();
};
$('#closePrompt').onclick = () => $('#promptDialog').close();
function download(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
$('#exportButton').onclick = async () => {
  if (!state) return;
  const library = withoutStarter(state);
  if (!library.projects.length) {
    alert('Create a story before exporting. The demo is temporary.');
    return;
  }
  const body = JSON.stringify(library);
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body
    });
    if (!response.ok) throw Error('The library could not be archived.');
    download(await response.blob(), 'story-studio-history.zip');
  } catch {
    download(new Blob([body], {type:'application/json'}), 'story-studio-library.json');
    error('ZIP unavailable. A restorable JSON backup was downloaded instead.');
  }
};
$('#importButton').onclick = () => $('#importFile').click();
$('#importFile').onchange = async event => {
  const input = event.target, file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 16_000_000) throw Error('The library exceeds the 16 MB import limit.');
    const incoming = normalize(JSON.parse(await file.text()));
    if (incoming.projects.length > maxLibraryStories) throw Error('The library exceeds the story limit.');
    const reserved = incoming.projects.find(project => project.id === starterStoryId);
    if (reserved) {
      reserved.id = id();
      if (incoming.activeId === starterStoryId) incoming.activeId = reserved.id;
    }
    if (!await confirmDanger('Replace your library?',
      'Import replaces your saved stories with the contents of this file. Cancel and export your current library first if you want a backup.', 'Replace library')) return;
    const demo = state.projects.find(project => project.id === starterStoryId);
    const replacement = incoming.projects.find(project => project.id === incoming.activeId);
    for (const project of [...state.projects,...incoming.projects]) {
      pendingComposerEdits.delete(project.id);
      setSession(draftKey(project.id),'');
      setSession(routeKey(project.id),'');
      setSession(modelKey(project.id),'');
    }
    state = {...incoming,projects:[...incoming.projects,demo]};
    markDirty(replacement);
    render();
    error();
  } catch (err) {
    alert(`Could not import: ${err.message}`);
  } finally {
    input.value = '';
  }
};
const storyDrawer = $('#sidebar');
$('#openMenu').onclick = () => storyDrawer.showModal();
$('#closeMenu').onclick = () => storyDrawer.close();
storyDrawer.addEventListener('click', event => {
  if (event.target !== storyDrawer) return;
  const {left, right, top, bottom} = storyDrawer.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) storyDrawer.close();
});
(async () => {
  try {
    const response = await fetch('/api/starter/reset',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    revision = response.headers.get('etag');
    demoGeneration = response.headers.get('x-story-studio-demo-generation');
    state = normalize(await response.json());
    baseLibrary = structuredClone(state);
    const migration = 'story-model-presets:custom-registry';
    if (!getSession(migration)) {
      const previousCustomModels = state.projects.map(project=>getSession(modelKey(project.id)))
        .filter(model=>model && isModelId(model) && !isPreset(model) && !retiredPresets.has(model));
      if (previousCustomModels.some(model=>!userModels.includes(model))) {
        saveUserModels([...new Set([...userModels,...previousCustomModels])]);
      }
      setSession(migration,'done');
    }
    clearRemovedModelSelections();
    setSession(draftKey(starterStoryId),'');
    render();
    status('Saved locally');
  } catch (e) {
    status('Could not load');
    error(`Couldn't open your stories: ${e.message}`);
  }
})();

// While any turn is queued, pick up agent writes. Unsaved edits are merged by save() on its 409 instead.
let checkingAgent = false;
// Agent activity is cheap to read and never touches the library, so it is
// checked every two seconds while the page is visible.
let activityKey = '';
setInterval(async () => {
  if (!state || document.hidden) return;
  try {
    const result = await (await fetch('/api/agent')).json();
    agentActivity = Array.isArray(result.agents) ? result.agents : [];
  } catch {
    agentActivity = [];
  }
  syncWatcherStatus();
  const project = current();
  if (!project) return;
  const status = authorMode(project) === 'agent' ? {line:agentEditStatus(project)} : mcpStatus(project);
  const key = JSON.stringify([project.id, status.line, status.pending]);
  if (key === activityKey) return;
  activityKey = key;
  syncRoute();
  renderPending();
}, 2000);

setInterval(async () => {
  if (!state || !state.projects.some(p => p.agentRequest || p.agentEditRequest || p.messages.some((turn,index)=>turn.continuityPending && isAvailableToMcp(turn,precedingDirection(p.messages,index)))) || checkingAgent || dirty || pendingWrites || busy || document.querySelector('dialog[open]')) return;
  checkingAgent = true;
  const polledRevision = revision;
  try {
    const response = await fetch('/api/state', {headers:{'If-None-Match':polledRevision}});
    if (response.status !== 200) return;
    const updated = normalize(await response.json());
    if (revision !== polledRevision || dirty || pendingWrites || busy || document.querySelector('dialog[open]')) return;
    const generation = response.headers.get('x-story-studio-demo-generation');
    const {library} = mergeLibrary(baseLibrary, state, updated,{demoReset:generation !== demoGeneration});
    if (!library) return;
    baseLibrary = structuredClone(updated);
    revision = response.headers.get('etag');
    demoGeneration = generation;
    adoptLibrary(library);
    render();
    status('Saved locally');
  } catch {
    // Keep the local state if the server is unavailable.
  } finally {
    checkingAgent = false;
  }
}, 2500);
