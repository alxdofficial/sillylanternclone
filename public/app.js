import { createWorkspace } from './workspace.js';
import { activeStoryFlow, normalizeStoryFlow, storyFlowTurn, validStoryFlowOptions } from './story-flow.js';
import { applyGraphUpdate, applyTurnGraphUpdates, captureGraphVersion, ensureGraphBaseline, graphChangesByTurn, normalizeGraphHistory, storyAtTurn } from './graph-history.js';
import { bookChapters, bookMarkdown, libraryByteLimit, maxLibraryStories, starterStoryId, withoutStarter } from './library.js';
import { defaultChapterStarts, manuscriptByteLimit, manuscriptPassages, manuscriptReference, manuscriptTurns, parseManuscript } from './manuscript.js';
import { mergeLibrary } from './sync.js';
import { createDisplayNameMatcher } from './display-names.js';
import { enhanceSelect } from './model-picker.js';
import { createRevisionViews } from './revision-view.js';
import { installExpandedEditors } from './expanded-editor.js';
import { createPassageSelection } from './passage-selection.js';
import { branchRevisionNotes, normalizeRevisionNotes } from './revision.js';
import { buildWritingContext, formatMessages, storyTextFields, narrator, resolveCastName, migrateLegacyCast, migrateStoryFields, simpleCharacter, castFields, validCast, validRelationships, validPlotEvents, graphSuggestions, nextTurnNumber, appendTurn, validSensitivity, isAvailableToMcp, precedingDirection, isStoryTime, localStoryTime, lastStoryTime, relationshipTime, recordStoryTime } from './prompt.js';

import { models, chapterCost, canWriteSensitive, continuityModel, isAgentModel, isContinuityModel, isModelId, isWriterModel, modelLabel, modelTag, modelContextWindow, modelProvider, providerNames, setupDraftModel, setupChatOutputLimit, setupDraftOutputLimit, usesSensitiveContinuity } from './models.js';
import { dateWriterTurn, mcpOmissionReason, replyInput, stripSpeakerName, syncTakeSuggestions } from './prompt.js';
import { estimateContextTokens, writingHistoryLimit } from './prompt.js';
import { agentBudget, continuityContext, editorContext, normalizeAgentHistory, normalizeSetupHistory } from './agent-context.js';

const settingsFields = ['title', 'lore', 'notes', ...storyTextFields];
const castLabels = {name:'Name', nickname:'Aliases', description:'Description'};
const $ = s => document.querySelector(s);
let state, revision, pendingWrites = 0, timer, pendingSave = Promise.resolve(), dirty = false, busy = false, editingIndex = null;
let libraryDirty = false, pendingLibraryWrites = 0;
// The library as last loaded from or saved to the server, the base for merging agent writes.
let baseLibrary = null, demoGeneration;
const configuredProviders = new Set();
const hasApiKey = () => configuredProviders.size > 0;
const hasModelProvider = model => configuredProviders.has(modelProvider(model));
const providerOrder = ['anthropic','openai','openrouter'];
const enabledProviders = () => providerOrder.filter(provider=>configuredProviders.has(provider)).join(',');
let editingCharacter;
let draftPlotEvents = [];
let draftRelationships = [], connectingFrom = '', editingRelationship = null;
let draftStartAt = '', draftStartSource = '';
let estimatedEdgeDates = new WeakSet();
let connecting = false, pinnedGraph = null, hoverGraph = null, deletedEvent = null, shownEvents = 12;
let pendingGraphReview = [];
let generatingFor = null;
let editingStateFor;
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
const modelKey = (id, mode = 'story') => (mode === 'agent' ? 'story-agent-model:' : 'story-model:') + id;
const retiredPresets = new Set(['anthracite-org/magnum-v4-72b','thedrummer/unslopnemo-12b','sao10k/l3.1-euryale-70b','gryphe/mythomax-l2-13b']);
function writingModel(project, mode = 'story') {
  const model = getSession(modelKey(project.id,mode));
  return hasModelProvider(model) && (mode === 'agent' ? isAgentModel(model) : isPreset(model) || userModels.includes(model)) ? model : '';
}
const continuityKey = (storyId,sensitive) => 'story-continuity-model:' + (sensitive ? 'sensitive:' : '') + storyId;
function selectedContinuityModel(project, sensitive = sensitiveContinuity(project)) {
  const model = getSession(continuityKey(project.id,sensitive));
  if (model && isContinuityModel(model,sensitive)) return hasModelProvider(model) ? model : '';
  const available = models.filter(({id})=>hasModelProvider(id) && isContinuityModel(id,sensitive));
  const writerProvider = modelProvider(writingModel(project));
  return (available.find(({id})=>modelProvider(id) === writerProvider)
    || available.find(({id})=>id === continuityModel) || available[0])?.id || '';
}
const draftKey = (id, mode = 'story') => (mode === 'agent' ? 'story-agent-draft:' : 'story-draft:') + id;
const flowNotice = new Map();
const sensitiveKey = id => 'story-sensitive-draft:' + id;
function sensitiveDraft(project) {
  const saved = getSession(sensitiveKey(project.id));
  return saved == null ? canWriteSensitive(writingModel(project)) : saved === 'true';
}
const sensitiveContinuity = project => usesSensitiveContinuity(writingModel(project),sensitiveDraft(project));
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
      if (key === 'messages') {
        if (local.messages === value) continue;
        local.messages.length = value.length;
        value.forEach((turn,index)=>{ local.messages[index] = turn; });
      } else local[key] = value;
    }
    return local;
  });
  state.projects.splice(0, state.projects.length, ...projects);
  state.activeId = library.activeId;
}
// After a 409, combine the page's edits with what the agent or another tab saved.
async function mergeServerLibrary({ifChanged = false} = {}) {
  const response = await fetch('/api/state',ifChanged ? {headers:{'If-None-Match':revision}} : {});
  if (response.status === 304) return;
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
  if (libraryDirty || pendingLibraryWrites || (state && settingsDraftChanged())) event.preventDefault();
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
  const remove = el('button','icon display-name-remove');
  remove.type = 'button';
  remove.title = 'Remove name';
  remove.innerHTML = '<svg class="tool-mark" aria-hidden="true"><use href="#icon-close"/></svg>';
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
  if (storyId !== displayNameStoryId) {
    displayNameStoryId = storyId;
    displayNameRows.replaceChildren();
    clearDisplayNameFeedback();
    const entries = readDisplayNames(storyId);
    if (!entries.length) addDisplayNameRow();
    else for (const [original, display] of entries) addDisplayNameRow(original,display);
  }
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
  const demo = state.projects.find(story=>story.id === starterStoryId);
  const openStory = async story => {
    if (story.id !== current().id && settingsDraftChanged()) {
      $('#sidebar').close();
      showStoryView('graph');
      if (!await confirmGraphNavigation()) return;
    }
    state.activeId = story.id;
    const url = new URL(location.href);
    url.searchParams.set('story',story.id);
    history.replaceState(null,'',url);
    markDirty();
    error();
    render();
    $('#sidebar').close();
  };
  if (demo) {
    const feature = el('section','library-feature');
    const cover = el('div','library-cover');
    cover.setAttribute('aria-hidden','true');
    cover.append(el('span','','Story Studio'),el('strong','',demo.title),el('span','','Bellwether Harbor'));
    const summary = el('div','library-demo-summary');
    const open = el('button','button primary','Open demo');
    open.onclick = () => openStory(demo);
    summary.append(el('h3','',demo.title),
      el('p','','A held ferry, an unreliable beacon, and an altered harbor log.'),
      el('p','library-counts',`${demo.cast.length} characters · ${demo.messages.length} turns`),open);
    feature.append(cover,summary,el('p','library-demo-note','Explore the chapters, graph, and saved Revision examples. The demo resets when you reload.'));
    list.append(feature);
  }
  const yours = el('section','library-collection');
  yours.append(el('h3','','Your own stories'));
  for (const story of state.projects.filter(story=>story.id !== starterStoryId)) {
    const button = el('button','project-item' + (story.id === project.id ? ' active' : ''));
    button.title = story.title;
    const chapters = bookChapters(story.messages).length;
    button.append(el('span','project-title',story.title),
      el('span','library-counts',`${chapters} ${chapters === 1 ? 'chapter' : 'chapters'} · ${story.messages.length} ${story.messages.length === 1 ? 'turn' : 'turns'}`));
    if (story.id === project.id) button.setAttribute('aria-current', 'true');
    button.onclick = () => openStory(story);
    yours.append(button);
  }
  if (yours.childElementCount === 1) yours.append(el('p','form-note','Start with a premise or import a manuscript from New story.'));
  list.append(yours);
  if (storyView === 'graph' && !settingsDraftChanged()) loadSettings();
  renderMessages();
  void syncBackgroundReview();
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
  branchRevisionNotes(branch,project.id);
  branch.title = label;
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
  return project.messages[directionIndex]?.role === 'user' && reply?.role === 'assistant' && !reply.standalone ? reply : undefined;
}

function turnPreview(text) {
  const characters = Array.from(text.trimStart().slice(0,256).replace(/\s+/gu,' ').trim());
  return characters.length > 64 ? characters.slice(0,63).join('').trimEnd() + '…' : characters.join('');
}

function shortExcerpt(text, limit) {
  const clean = text.trim().replace(/\s+/gu,' ');
  if (clean.length <= limit) return clean;
  const prefix = clean.slice(0,limit);
  const breakAt = prefix.lastIndexOf(' ');
  return (breakAt > limit * .75 ? prefix.slice(0,breakAt) : prefix) + '…';
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
      authorOnly:message.role === 'user' && !reply,
      time:timelineTime(message,reply), detail:turnPreview(preview), reason:messageReason || replyReason,
      replyPreview:reply && !replyReason ? reply.content : '', replyReason,
      startsChapter:message.startsChapter || reply?.startsChapter, preview
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

let renderedStoryId, activeStoryTurn, lastRenderedTurn, outlineScenes = new Map();
$('#inspectSceneLore').onclick = () => openSettings();

function renderSceneInspector(turn) {
  const project = current();
  const scene = outlineScenes.get(turn) || Array.from(outlineScenes.values()).at(-1);
  const content = $('#sceneInspectorContent');
  const match = createDisplayNameMatcher(readDisplayNames(project.id));
  content.replaceChildren();
  if (scene?.time) {
    content.append(el('p','scene-clock',scene.time.slice(11)),
      el('p','scene-date',timelineDate.format(new Date(scene.time + 'Z'))));
  }
  const sceneText = scene?.preview.toLowerCase() || '';
  const present = (project.cast || []).filter(member=>[member.name,...(member.nickname || '').split(',')]
    .some(name=>name.trim() && sceneText.includes(name.trim().toLowerCase())));
  if (present.length) {
    const list = el('ul','scene-cast');
    for (const member of present) list.append(readerText('li','',member.name,match));
    content.append(el('h3','','On the page'),list);
  }
  if (project.lore.trim()) content.append(el('h3','','World setting'),el('p','',shortExcerpt(project.lore,150)));
  if (project.notes.trim()) content.append(el('h3','','Writing notes'),el('p','scene-writing-notes',shortExcerpt(project.notes,150)));
  if (!content.childElementCount) content.append(el('p','form-note','Scene times and story notes appear here.'));
}
function selectStoryTurn(turn) {
  const nav = $('#storyTurns');
  nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
  $('#messages .story-turn-target')?.classList.remove('story-turn-target');
  const target = turn && $('#messages').querySelector(`[data-story-turn="${turn}"]`);
  activeStoryTurn = target ? turn : undefined;
  if (target) {
    nav.querySelector(`[data-turn-link="${turn}"]`)?.setAttribute('aria-current','location');
    target.classList.add('story-turn-target');
  }
  updateWritingTools();
  return target;
}

function showLatestStoryTurn() {
  const box = $('#messages');
  selectStoryTurn();
  box.scrollTop = box.scrollHeight;
  $('#storyTurns').scrollTop = $('#storyTurns').scrollHeight;
}
$('#latestStoryTurn').onclick = () => {
  workspaceTools.dismissOutline();
  showLatestStoryTurn();
  $('#messages').querySelector('.message:last-of-type')?.focus({preventScroll:true});
  syncJumpButton();
};

function syncJumpButton() {
  const box = $('#messages');
  $('#latestStoryTurn').hidden = box.scrollHeight - box.scrollTop - box.clientHeight <= 32;
}
$('#messages').addEventListener('scroll',syncJumpButton,{passive:true});
const transcriptResize = new ResizeObserver(syncJumpButton);
for (const selector of ['#messages','#messageList','.manual-prose']) transcriptResize.observe($(selector));

function renderStoryTurns(project, followLatest, match) {
  const nav = $('#storyTurns'), scrollTop = nav.scrollTop;
  const fragment = document.createDocumentFragment();
  outlineScenes = new Map();
  let chapter = 0;
  for (const scene of storyTurns(project)) {
    const {selection,startsChapter,detail,reason,preview} = scene;
    const turn = selection.turn;
    if (!chapter || startsChapter) fragment.append(el('h3','outline-chapter',`Chapter ${++chapter}`));
    outlineScenes.set(turn,{...scene,chapter,preview:scene.replyPreview || preview});
    const button = el('button','graph-turn');
    button.type = 'button';
    button.dataset.turnLink = turn;
    button.append(el('span','sr-only',eventTime(turn)));
    if (detail) button.append(readerText('span','timeline-detail',detail,match));
    appendTurnContextBadge(button,button,reason);
    button.onclick = () => {
      const target = selectStoryTurn(turn);
      if (!target) return;
      workspaceTools.dismissOutline();
      const box = $('#messages');
      box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
      target.focus({preventScroll:true});
    };
    fragment.append(button);
  }
  if (!fragment.childElementCount) fragment.append(el('p','form-note','No turns yet.'));
  nav.replaceChildren(fragment);
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
const bookChapterPicker = enhanceSelect(bookChapter,{minWidth:152});
const bookFirst = $('#bookFirst');
const bookLast = $('#bookLast');
const bookPositions = new Map();
const spreadPositions = new Map();
const storyViews = [['write','writeTab','writeView'],['book','bookTab','bookView'],
  ['graph','graphTab','graphView'],['names','displayNamesTab','displayNamesView']];
const backgroundReviews = new Map();
let backgroundRequest;
const revisionViews = createRevisionViews({
  activeStory:current,
  stories:()=>state.projects,
  currentTurn:()=>outlineScenes.get(activeStoryTurn)?.selection.replyTurn || activeStoryTurn,
  openTool:tool=>workspaceTools.open(tool),
  readManuscript:()=>workspaceTools.backToManuscript({focus:true}),
  highlight:refs=>passageSelection.highlight(refs),
  paintHeatmap:layers=>passageSelection.heatmap(layers),
  canPaintHeatmap:()=>passageSelection.supportsHeatmap,
  backgroundReview:project=>backgroundReviews.get(project.id),
  setBackgroundReview:settings=>syncBackgroundReview(settings),
  reviewModel() {
    const model = models.find(model=>model.id === revisionModel(current()));
    return model ? {id:model.id,label:model.name} : undefined;
  },
  writeNotes(notes) {
    const project = current();
    if (notes.length) project.revisionNotes = notes;
    else delete project.revisionNotes;
    markDirty(project);
    updateWritingTools();
  },
  async openScene(storyId,turn,view = 'write',ref,{mark = true} = {}) {
    if (storyView !== view && !await navigateStoryView(view)) return;
    if (current().id !== storyId) {
      if (!state.projects.some(story=>story.id === storyId)) return;
      state.activeId = storyId;
      const url = new URL(location.href);
      url.searchParams.set('story',storyId);
      history.replaceState(null,'',url);
      render();
    }
    if (view === 'graph') {
      pinGraph({kind:'turn-changes',turn});
      $('#closeInspector').focus({preventScroll:true});
      return;
    }
    workspaceTools.backToManuscript();
    const outlineTurn = [...outlineScenes].find(([,scene])=>scene.selection.replyTurn === turn)?.[0];
    const target = $('#messages').querySelector(`[data-story-turn="${turn}"]`);
    if (!target) return;
    selectStoryTurn(outlineTurn || turn);
    passageSelection.focus(ref,target,mark);
  },
  async requestReview(payload,signal) {
    const project = current();
    const model = revisionModel(project);
    if (!model) throw Error('Add a provider key in Settings and choose a continuity agent or editor model in Write.');
    await save();
    if (signal.aborted) throw signal.reason;
    if (dirty || current().id !== payload.storyId) throw Error('Save the story before reviewing it.');
    return await api('/api/revision',{method:'POST',headers:{'Content-Type':'application/json'},signal,
      body:JSON.stringify({...payload,revision,model})});
  }
});
const passageSelection = createPassageSelection({
  transcript:$('#messages'),getStory:()=>state && storyView === 'write' ? current() : undefined,
  getActions:ref=>revisionViews.selectionActions(ref)
});

function revisionModel(project) {
  return authorMode(project) === 'agent' ? writingModel(project,'agent') : selectedContinuityModel(project,false);
}

async function syncBackgroundReview(settings) {
  if (!state) return;
  const project = current();
  if (!settings && backgroundRequest) return;
  // A toggle/model choice wins over an in-flight status read.
  const request = {};
  backgroundRequest = request;
  const url = '/api/writing-analysis';
  const update = changes=>api(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:project.id,...changes})});
  try {
    let result = settings ? await update(settings) : await api(`${url}?story=${encodeURIComponent(project.id)}`);
    if (backgroundRequest !== request) return;
    const selected = revisionModel(project) || selectedContinuityModel(project,false);
    if (!settings && result.enabled && !result.model && result.state !== 'demo' && selected) result = await update({model:selected});
    if (backgroundRequest !== request) return;
    const previous = backgroundReviews.get(project.id);
    if (JSON.stringify(previous) !== JSON.stringify(result)) {
      backgroundReviews.set(project.id,result);
      if (current().id === project.id && storyView === 'write') revisionViews.render();
    }
  } catch (failure) {
    if (settings && current().id === project.id) error(failure.message);
  } finally {
    if (backgroundRequest === request) backgroundRequest = undefined;
  }
}

function updateWritingTools() {
  const project = current();
  const turn = outlineScenes.get(activeStoryTurn)?.selection.replyTurn || activeStoryTurn;
  workspaceTools.renderCatalogue(revisionViews.getPreviews(project,turn));
  renderSceneInspector(activeStoryTurn);
  revisionViews.render();
  passageSelection.render();
}
let bookStoryId, chapters = [], storyView = 'write', writeNeedsRender = false;
let showGraphDirections = getSession('studio-show-directions') === 'true';
const workspaceTools = createWorkspace({
  onToolChange(tool) {
    revisionViews.open(tool);
    if (tool === 'scene') renderSceneInspector(activeStoryTurn);
  },
  onComposerChange: syncRoute,
  onResize() {
    const transcript = $('#messages');
    if (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40) {
      return () => { transcript.scrollTop = transcript.scrollHeight; };
    }
  }
});
$('#checkContinuity').onclick = async () => {
  if (await navigateStoryView('write')) workspaceTools.open('continuity');
};
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
  const outline = $('#bookOutline');
  outline.replaceChildren();
  chapters.forEach((_,index) => {
    const number = index + 1;
    const button = el('button','graph-turn',`Chapter ${number}`);
    button.type = 'button';
    button.onclick = () => {
      bookChapter.value = String(number);
      bookChapter.dispatchEvent(new Event('change'));
    };
    outline.append(button);
  });
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
    const choose = new Option('Chapters','');
    choose.disabled = true;
    bookChapter.replaceChildren(choose,...chapters.map((_,index)=>new Option(`Chapter ${index + 1}`,String(index + 1))));
    bookFirst.replaceChildren(...options());
    bookLast.replaceChildren(...options());
  }
  bookChapter.value = '';
  bookChapterPicker.sync();
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
  workspaceTools.setWritingView(view === 'write');
  if (view !== 'write') passageSelection.highlight([]);
  const url = new URL(location.href);
  url.searchParams.set('view',view);
  history.replaceState(null,'',url);
  if (view === 'graph' && !settingsDraftChanged()) loadSettings();
  if (view === 'book') renderBook();
  else if (view === 'names') renderDisplayNames();
  else if (writeNeedsRender) renderMessages();
  else updateWritingTools();
}

function rememberBookPosition() {
  if (bookStoryId && chapters.length && !bookPages.hasAttribute('data-spread')) {
    bookPositions.set(bookStoryId,bookReader.scrollTop);
  }
}
bookReader.addEventListener('scroll',() => { if (storyView === 'book') rememberBookPosition(); },{passive:true});
let viewSlide;
async function navigateStoryView(view,slide = false) {
  if (!state || view === storyView) return false;
  if (storyView === 'graph' && !await confirmGraphNavigation()) {
    $('#graphTab').focus();
    return false;
  }
  const currentIndex = storyViews.findIndex(([name])=>name === storyView);
  const nextIndex = storyViews.findIndex(([name])=>name === view);
  viewSlide?.cancel();
  showStoryView(view);
  if (slide && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const panel = document.getElementById(storyViews[nextIndex][2]);
    const offset = nextIndex > currentIndex ? 14 : -14;
    viewSlide = panel.animate([{transform:'translateX(' + offset + 'px)',opacity:.8},
      {transform:'translateX(0)',opacity:1}],
      {duration:160,easing:getComputedStyle(panel).getPropertyValue('--ease-out').trim()});
  }
  return true;
}
for (const [view,tab] of storyViews) $(`#${tab}`).onclick = event => void navigateStoryView(view,event.detail > 0);
$('.story-tabs').addEventListener('keydown',async event => {
  if (!state || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const index = storyViews.findIndex(([view])=>view === storyView);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? storyViews.length - 1
    : (index + storyViews.length + (event.key === 'ArrowRight' ? 1 : -1)) % storyViews.length;
  const [view,tab] = storyViews[next];
  if (await navigateStoryView(view)) $(`#${tab}`).focus();
});
bookChapter.onchange = () => {
  const heading = $(`#chapter-${bookChapter.value} h3`);
  bookChapter.value = '';
  bookChapterPicker.sync();
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
    else if (storyView === 'names') renderDisplayNames();
    return;
  }
  writeNeedsRender = false;
  closeTurnMenu();
  const project = current(), box = $('#messages');
  const messageList = $('#messageList');
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
    passageSelection.highlight([]);
    workspaceTools.dismissOutline();
  }
  messageList.replaceChildren();
  if (!sameStory) syncManualProse();
  const editorTurns = normalizeAgentHistory(project.agentHistory).sort((a,b)=>a.afterTurn - b.afterTurn);
  const pendingEdit = editingStateFor?.projectId === project.id ? editingStateFor.instruction : '';
  if (!project.messages.length && !editorTurns.length && !pendingEdit) {
    const empty = el('div','empty');
    empty.append(el('strong','','Start your story'),
      el('p','','Set the scene below, or ask your co-writer to begin.'));
    messageList.append(empty);
    renderStoryTurns(project,followLatest);
    return;
  }
  const graphChanges = graphChangesByTurn(project);
  const match = createDisplayNameMatcher(readDisplayNames(project.id));
  let editorIndex = 0;
  function appendEditorTurns(through) {
    while (editorTurns[editorIndex]?.afterTurn <= through) {
      const {request,message} = editorTurns[editorIndex++];
      if (request) messageList.append(editorMessage('user',request));
      messageList.append(editorMessage('assistant',message));
    }
  }
  let previousDirection;
  project.messages.forEach((message,index) => {
    const fromAuthor = message.role === 'user';
    if (fromAuthor) previousDirection = message;
    const omittedFromMcp = mcpOmissionReason(message,previousDirection);
    const turn = message.turnNumber || index + 1;
    appendEditorTurns(turn - 1);
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
      changes.title = 'See what this turn added to the story graph.';
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
      if (project.plotEvents) project.plotEvents = project.plotEvents.filter(event=>!deletedTurns.includes(event.turn));
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
    const text = fromAuthor ? readerText('div','message-text',message.content,match) : el('div','message-text');
    if (!fromAuthor) passageSelection.register(text,message.content,match);
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
    messageList.append(row);
  });
  appendEditorTurns(Infinity);
  if (pendingEdit) messageList.append(editorMessage('user',pendingEdit),editorMessage('assistant','Working…',true));
  renderPending();
  box.scrollTop = followLatest ? box.scrollHeight : scrollTop;
  renderStoryTurns(project,followLatest,match);
}
function editorMessage(role, text, pending = false) {
  const row = el('article','message ' + role + ' editor-message');
  const fromAuthor = role === 'user';
  const label = fromAuthor ? 'You · Editor request' : 'Editor agent';
  row.setAttribute('aria-label',label);
  const body = el('div','message-body');
  const head = el('div','message-header');
  head.append(el('strong','author-label',label));
  body.append(head,el('div',pending ? 'pending-state active' : 'message-text',text));
  row.append(body);
  return row;
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

function saveComposerEdit(rewrite = false) {
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
    if (changed || verified) delete project.storyFlow;
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
  error();
  closeComposerEdit();
  return rewrite ? message : undefined;
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
function renderPending() {
  if (storyView !== 'write') return;
  const box = $('#messages');
  $('#pendingTurn')?.remove();
  const project = current();
  if (!project) return;
  const pending = generatingFor?.projectId === project.id ? {state:'Writing', active:true} : null;
  if (!pending) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const row = el('article', 'message assistant pending'), body = el('div', 'message-body');
  row.id = 'pendingTurn';
  body.append(el('span','pending-state' + (pending.active ? ' active' : ''),pending.state));
  row.append(body);
  $('#messageList').append(row);
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function syncRoute() {
  const transcript = $('#messages');
  const followLatest = storyView === 'write' && transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
  const project = current();
  const mode = authorMode(project);
  const editingStory = mode === 'agent';
  const model = writingModel(project,mode);
  const rewriting = composerEdit?.canRegenerate && Boolean(model && hasModelProvider(model));
  workspaceTools.setComposerEditing(Boolean(composerEdit));
  if (hasApiKey() || composerEdit || !workspaceTools.composerOpen) clearComposerConnectionWarning();
  $('#authorMode').value = mode;
  $('#routeModels').classList.toggle('editor-route',editingStory);
  $('#routeModels').hidden = Boolean(composerEdit && !rewriting);
  $('#sensitiveSceneLabel').hidden = editingStory || Boolean(composerEdit && !rewriting);
  $('#sensitiveScene').checked = sensitiveDraft(project);
  $('#sensitiveScene').disabled = busy;
  $('#authorMode').disabled = busy || Boolean(composerEdit);
  modePicker.sync();
  $('#sceneModelControl').hidden = Boolean(composerEdit && !rewriting);
  sceneModelChoice.disabled = busy || Boolean(composerEdit);
  $('#sceneModelLabel').textContent = editingStory ? 'Editor model' : 'Prose artist';
  sceneModelChoice.title = editingStory ? 'This model updates the story details you ask it to change.'
    : 'This model writes the next scene.';
  syncSceneModel(model,mode);
  $('#continuityModelControl').hidden = editingStory || Boolean(composerEdit && !rewriting);
  continuityModelChoice.disabled = busy;
  syncContinuityModel(project);
  $('#routeSummary').textContent = !composerEdit && !editingStory && sensitiveDraft(project) && model && !canWriteSensitive(model)
    ? 'Choose an NSFW-friendly writer.' : '';
  $('#providerButton').disabled = busy || Boolean(composerEdit);
  $('#pasteReply').disabled = busy || Boolean(composerEdit);
  $('#saveManualProse').disabled = busy || Boolean(composerEdit);
  $('#composerEditStatus').hidden = !composerEdit;
  $('#composerEditStatus').textContent = composerEdit ? `Editing turn ${composerEdit.turnNumber}` : '';
  $('#verifyComposerEditLabel').hidden = !composerEdit;
  $('#verifyComposerEdit').checked = Boolean(composerEdit?.verified);
  $('#instructionLabel').textContent = composerEdit ? 'Edit turn text' : editingStory ? 'What story information should change?' : 'What happens next?';
  $('#instruction').placeholder = editingStory ? 'Add world information or revise a character profile…' : 'Write the next beat or tell the narrator what happens…';
  $('#cancelComposerEdit').hidden = !composerEdit;
  $('#saveComposerOnly').hidden = !rewriting;
  $('#composeShortcut').textContent = rewriting ? '⌘/Ctrl + Enter to rewrite'
    : composerEdit ? '⌘/Ctrl + Enter to save' : '⌘/Ctrl + Enter to send';
  $('#sendButton').disabled = busy;
  $('#sendButton').setAttribute('aria-busy',String(busy));
  syncStoryFlow(project);
  updateContextIndicator();
  if (storyView === 'write' && workspaceTools.activeTool) revisionViews.render();
  if (followLatest) transcript.scrollTop = transcript.scrollHeight;
}
function speakerMetadata(speaker) {
  return {speakerId:speaker.id, speakerName:speaker.name};
}

function syncStoryFlow(project) {
  const flow = activeStoryFlow(project);
  const request = $('#requestStoryFlow');
  $('#storyFlowActionLabel').hidden = Boolean(flow);
  const options = $('#storyFlowOptions');
  const status = $('#storyFlowStatus');
  request.disabled = busy || Boolean(composerEdit);
  request.title = flow ? 'Suggest different directions for the next scene.' : 'Suggest directions for the next scene.';
  request.setAttribute('aria-label',flow ? 'New directions' : 'Get AI recommendations');
  options.replaceChildren(...(flow?.options || []).map(({title,direction},index)=>{
    const button = el('button','story-flow-choice');
    button.type = 'button';
    button.append(el('span','story-flow-title',title),el('span','story-flow-description',direction));
    button.disabled = busy || Boolean(composerEdit);
    if (flow.selected === index) button.setAttribute('aria-pressed','true');
    button.setAttribute('aria-haspopup','dialog');
    button.onclick = () => previewStoryFlow(project,flow,index);
    return button;
  }));
  status.textContent = flowNotice.get(project.id) || '';
  status.hidden = !status.textContent;
  workspaceTools.syncFlow();
}

const flowPreview = $('#storyFlowPreview');
let selectedFlowPreview;
function previewStoryFlow(project, flow, index) {
  const {title,direction,consequence} = flow.options[index];
  const field = $('#instruction');
  const writing = authorMode(project) === 'story';
  const draft = writing ? field.value : getSession(draftKey(project.id)) || '';
  selectedFlowPreview = {
    project, flow, index, draft,
    start: writing ? field.selectionStart : draft.length,
    end: writing ? field.selectionEnd : draft.length
  };
  $('#flowPreviewTitle').textContent = title;
  $('#flowPreviewDirection').textContent = direction;
  $('#useFlowDirection').textContent = draft.trim() ? 'Insert at cursor' : 'Use direction';
  $('#replaceWithFlowDirection').hidden = !draft.trim();
  const detail = $('#flowPreviewConsequence');
  detail.textContent = consequence || '';
  detail.hidden = !consequence;
  flowPreview.showModal();
}
$('#useFlowDirection').onclick = () => void chooseStoryFlow(selectedFlowPreview, false);
$('#replaceWithFlowDirection').onclick = () => void chooseStoryFlow(selectedFlowPreview, true);

async function chooseStoryFlow(preview, replace) {
  const {project,flow,index,draft,start,end} = preview;
  flowPreview.close();
  if (busy || current() !== project || JSON.stringify(activeStoryFlow(project)) !== JSON.stringify(flow)) return;
  const direction = flow.options[index].direction;
  const field = $('#instruction');
  const wasEditing = authorMode(project) === 'agent';
  if (wasEditing) setSession(modeKey(project.id),'story');
  if (replace || !draft.trim()) {
    field.value = direction;
    field.setSelectionRange(direction.length, direction.length);
  } else {
    // Keep the selection and the rest of the draft when adding another direction.
    const before = draft.slice(0,start);
    const after = draft.slice(start);
    const addition = (before && !/\s$/.test(before) ? '\n\n' : '') + direction
      + (after && !/^\s/.test(after) ? '\n\n' : '');
    if (wasEditing) field.value = draft;
    field.setRangeText(addition,start,start,'end');
    if (start === end) field.setSelectionRange(start + addition.length,start + addition.length);
  }
  setSession(draftKey(project.id),field.value);
  project.storyFlow = {...flow,selected:index};
  workspaceTools.setComposerOpen(true);
  markDirty(project);
  syncRoute();
  field.focus();
  await save();
}

async function requestStoryFlow() {
  if (!state || busy || composerEdit) return;
  const project = current();
  const agentModel = selectedContinuityModel(project);
  if (!hasApiKey()) return openAppSettings();
  if (!agentModel) {
    workspaceTools.showComposerModels();
    continuityModelPicker.focus();
    return error('Choose a continuity agent for Story Flow.');
  }
  const trigger = $('#requestStoryFlow');
  const restoreFocus = document.activeElement === trigger;
  const transcript = JSON.stringify(project.messages);
  flowNotice.set(project.id,'Suggesting directions…');
  setBusy(true);
  try {
    const {options} = await api('/api/story-flow',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project:openRouterSnapshot(project,project.messages),
        provider:modelProvider(agentModel),agentModel,sensitive:sensitiveContinuity(project)})
    });
    await mergeServerLibrary({ifChanged:true});
    if (!state.projects.includes(project) || JSON.stringify(project.messages) !== transcript) {
      throw Error('The story changed while the directions were prepared. Ask for new directions.');
    }
    if (!validStoryFlowOptions(options)) throw Error('The model did not return three distinct directions.');
    project.storyFlow = {source:modelProvider(agentModel),afterTurn:storyFlowTurn(project),options};
    flowNotice.delete(project.id);
    markDirty(project);
    await save();
  } catch (failure) {
    flowNotice.set(project.id,failure.message);
  } finally {
    setBusy(false);
    if (restoreFocus && document.activeElement === document.body && !trigger.hidden) {
      trigger.focus({preventScroll:true});
    }
  }
}

$('#requestStoryFlow').onclick = () => void requestStoryFlow();
function openRouterSnapshot(project, messages, replyTime) {
  return {
    id:project.id,
    ...Object.fromEntries(settingsFields.map(key => [key,project[key] || ''])),
    storyStartAt:project.storyStartAt, storyStartSource:project.storyStartSource, graphUpdates:project.graphUpdates,
    cast:project.cast, relationships:project.relationships, plotEvents:project.plotEvents, replyTime,
    contextTime:lastStoryTime({...project,messages}),
    messages, agentHistory:project.agentHistory, setupHistory:project.setupHistory
  };
}

function setBusy(value) {
  busy = value;
  syncRoute();
  renderMessages();
}

async function generateAgentEdit(project) {
  const input = $('#instruction');
  const instruction = input.value.trim();
  if (!instruction) return input.focus();
  error();
  const model = writingModel(project,'agent');
  if (!hasApiKey()) return showComposerConnectionWarning();
  if (!model) {
    sceneModelPicker.focus();
    return error('Choose an editor model, then send again.');
  }
  const budgetProblem = editorContext(project,instruction,model).problem;
  if (budgetProblem) return error(budgetProblem);
  editingStateFor = {projectId:project.id,instruction};
  showLatestStoryTurn();
  setBusy(true);
  try {
    await save();
    if (dirty || !state.projects.includes(project)) throw Error('Save the story and try again.');
    await api('/api/story-edits',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({storyId:project.id,revision,provider:modelProvider(model),model,instruction})
    });
    if (getSession(draftKey(project.id,'agent'))?.trim() === instruction) setSession(draftKey(project.id,'agent'),'');
    editingStateFor = undefined;
    await mergeServerLibrary();
  } catch (failure) {
    error(failure.message);
  } finally {
    editingStateFor = undefined;
    setBusy(false);
  }
}

async function generate() {
  if (busy || !state) return;
  const project = current();
  if (authorMode(project) === 'agent') return generateAgentEdit(project);
  const model = writingModel(project);
  if (composerEdit && (!composerEdit.canRegenerate || !model || !hasModelProvider(model))) return saveComposerEdit();
  if (!hasApiKey()) return showComposerConnectionWarning();
  if (!model) {
    sceneModelPicker.focus();
    return error('Choose a prose artist, then send again.');
  }
  const activeFlow = activeStoryFlow(project);
  const refreshDirections = Boolean(activeFlow && activeFlow.source !== 'mcp');
  const sensitive = sensitiveDraft(project);
  const agentModel = selectedContinuityModel(project);
  if (!agentModel) {
    continuityModelPicker.focus();
    return error('Choose a continuity agent, then send again.');
  }
  if (sensitive && !canWriteSensitive(model)) {
    return error('Choose an NSFW-friendly writer to generate a sensitive scene.');
  }
  const field = $('#instruction');
  const changedDirection = composerEdit?.canRegenerate && field.value !== composerEdit.original;
  const inputProblem = promptForDraft().problem;
  if (inputProblem) {
    error(inputProblem);
    return field.focus();
  }
  const originalDirection = composerEdit?.canRegenerate && project.messages.find(turn=>turn.turnNumber === composerEdit.turnNumber);
  if (originalDirection && (originalDirection.excludeFromContext ||
    (!sensitive && !composerEdit.verified && !isAvailableToMcp(originalDirection)))) {
    return error('This direction is withheld from the selected model. Verify the edited text as non-explicit if it is eligible.');
  }
  let editedTurn;
  if (composerEdit) {
    editedTurn = saveComposerEdit(true);
    if (!editedTurn) return;
  }
  const input = $('#instruction');
  const direction = editedTurn ? '' : input.value.trim();
  // An empty composer answers a writer turn that has no reply yet, such as
  // after a failed request or a turn an agent handed back.
  const lastTurn = project.messages.at(-1);
  const authorTurn = editedTurn ?? (!direction && lastTurn?.role === 'user' && !lastTurn.excludeFromContext ? lastTurn : undefined);
  const answering = Boolean(authorTurn);
  const directionIndex = answering ? project.messages.indexOf(authorTurn) : project.messages.length;
  const replacement = editedTurn ? pairedReply(project,directionIndex) : undefined;
  if (!direction && !answering) return input.focus();
  error();
  if (authorTurn?.excludeFromContext || (!sensitive && authorTurn
    && (authorTurn.contentSensitivity === 'explicit' || (!changedDirection && !isAvailableToMcp(authorTurn))))) {
    error('This direction is outside the selected model’s context. Check its label in ⋯ → Time and context.');
    return;
  }
  if (!model) {
    sceneModelPicker.focus();
    error('Choose a writer model, then send again.');
    return;
  }

  delete project.agentNotice;
  delete project.agentRequest;
  if (!answering) {
    appendTurn(project,{role:'user',content:direction,contentSensitivity:sensitive ? 'explicit' : 'unclassified'});
    input.value = '';
    showLatestStoryTurn();
    setSession(draftKey(project.id),'');
    markDirty();
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
    const snapshot = openRouterSnapshot(contextProject,history,replacement?.storyTime ?? authorTurn?.storyTime);
    const response = await api('/api/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        project:snapshot, instruction:authorTurn?.content ?? direction, provider:modelProvider(model),model,
        agentProvider:modelProvider(agentModel),agentModel,sensitive,
        flow:refreshDirections,
        mode:replacement ? 'replace' : 'send'
      })
    });
    const {text} = response;
    await mergeServerLibrary({ifChanged:true});
    if (!text?.trim()) throw Error('The co-writer returned an empty response.');
    const target = state.projects.find(item => item.id === project.id);
    if (!target || JSON.stringify(target.messages) !== originalHistory) {
      throw Error('The story changed while writing. Try again from the updated scene.');
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
    const contextChanged = JSON.stringify(openRouterSnapshot(target,history,snapshot.replyTime)) !== JSON.stringify(snapshot);
    if (!replacement) appendTurn(target, {role:'assistant', content:prose, ...speakerMetadata(narrator),
      contentSensitivity:validSensitivity(response.reply) ? response.reply : 'unclassified',
      storyTime:recordStoryTime(target,response.storyTime)});
    if (!replacement) dateWriterTurn(target);
    if (!replacement) applyTurnGraphUpdates(target,target.messages.at(-1),suggestions,{
      allowAutomatic:!contextChanged && isAvailableToMcp(savedDirection) && response.input === 'safe' && response.reply === 'safe'
        && !(target.id === current().id && settingsDraftChanged())
    });
    flowNotice.delete(target.id);
    if (validStoryFlowOptions(response.flowOptions)) {
      target.storyFlow = {source:modelProvider(agentModel),afterTurn:storyFlowTurn(target),options:response.flowOptions};
    } else if (response.flowUnavailable) {
      flowNotice.set(target.id,'The scene was saved. Use Suggest directions to try again.');
    }
    const classifiedExplicit = response.reply === 'explicit' || (!sensitive && response.input === 'explicit');
    if (classifiedExplicit) setSession(sensitiveKey(target.id),'true');
    markDirty(target);
    if (current().id !== project.id) return;
    if (response.truncated) {
      const unverified = response.input === 'unclassified' || response.reply === 'unclassified';
      error('This reply reached Story Studio’s output limit and may end mid-scene.' +
        (unverified ? ' Any unverified text stays outside general AI context until you check its label in ⋯ → Time and context.' : ''));
    } else if (response.metadataFailed) {
      error('Your draft is in the story. The selected continuity agent could not verify its labels or suggest map updates. Check the labels in ⋯ → Time and context before using this turn with a general model.');
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
  const castList = $('#graphCastList');
  castList.replaceChildren();
  for (const editor of editors) {
    const button = el('button','graph-turn',editorName(editor));
    button.type = 'button';
    button.onclick = () => selectCastEditor(editor.dataset.id,true);
    castList.append(button);
  }
  if (!editors.length) castList.append(el('p','form-note','No cast members yet.'));
  const empty = $('#emptyCast');
  empty.hidden = editors.length !== 0;
  graph.hidden = editors.length === 0;
  $('.graph-key').hidden = editors.length === 0;
  $('#connectCharacters').disabled = editors.length < 2;
  updateGraphSelection();
}
narrowGraph.onchange = shortGraph.onchange = () => {
  if (storyView === 'graph') refreshCastGraph();
};

const timeLabel = time => time ? time.replace('T',' ') : 'Undated';
const timelineDate = new Intl.DateTimeFormat('en', {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
const matchesTurn = (turn,{turn:primaryTurn,replyTurn}) => turn === primaryTurn || (replyTurn !== undefined && turn === replyTurn);
const matchesTimeline = (edge,selection) => selection.kind === 'moment'
  ? edge.turn && edge.storyTime === selection.time : matchesTurn(edge.turn || 0,selection);
const countEvents = count => `${count} relationship ${count === 1 ? 'event' : 'events'}`;
const timelineTime = (message,reply) => reply?.storyTime || message?.storyTime || '';

function renderGraphTurns() {
  const entries = [{time:draftStartAt, label:'Story setup', selection:{kind:'turn',turn:0}}];
  const moments = new Map();
  for (const edge of draftRelationships) {
    if (!edge.turn) continue;
    if (!moments.has(edge.storyTime)) moments.set(edge.storyTime,[]);
    moments.get(edge.storyTime).push(edge);
  }
  for (const [time,edges] of moments) {
    const [first] = edges;
    const pairs = [...new Set(edges.map(edge=>`${nameOf(edge.from)} → ${nameOf(edge.to)}`))];
    entries.push({time, label:pairs.length === 1 ? pairs[0] : '',
      detail:pairs.length === 1 ? turnPreview(first.label) : pairs.join(' · '),
      accessibleLabel:countEvents(edges.length), selection:{kind:'moment',time}});
  }
  for (const [index,event] of draftPlotEvents.entries()) {
    entries.push({time:event.storyTime,detail:turnPreview(event.note),accessibleLabel:'Plot event',
      selection:{kind:'plot',index}});
  }
  for (const entry of storyTurns(current())) {
    if (entry.authorOnly && !showGraphDirections) continue;
    const onlyProse = !showGraphDirections && Boolean(entry.selection.replyTurn);
    entries.push({...entry,accessibleLabel:eventTime(onlyProse ? entry.selection.replyTurn : entry.selection.turn),
      ...(onlyProse ? {detail:turnPreview(entry.replyPreview),reason:entry.replyReason} : {})});
  }
  entries.sort((a,b) => Number(!a.time) - Number(!b.time) || a.time.localeCompare(b.time)
    || (a.selection.turn ?? Infinity) - (b.selection.turn ?? Infinity));
  const rail = $('#graphTurns');
  rail.replaceChildren();
  let day, list, lastTime, timeGroup;
  for (const {time,label,accessibleLabel,detail,reason,selection} of entries) {
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
    if (accessibleLabel) button.append(el('span','sr-only',accessibleLabel + ' '));
    if (label) button.append(el('strong','',label));
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
$('#toggleTimeline').onclick = event => {
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'false';
  if (expanded) selectGraphRail(false);
  showTimeline(expanded);
};
function selectGraphRail(cast) {
  $('#showGraphTurns').setAttribute('aria-pressed',String(!cast));
  $('#showGraphCast').setAttribute('aria-pressed',String(cast));
  $('#graphTurns').hidden = cast;
  $('#graphCastList').hidden = !cast;
}
$('#showGraphTurns').onclick = () => selectGraphRail(false);
$('#showGraphCast').onclick = () => selectGraphRail(true);

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
      : note.kind === 'world' ? 'World setting' : note.kind === 'writing' ? 'Writing notes' : 'Plot event';
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
  } else if (selection.kind === 'plot') {
    const event = draftPlotEvents[selection.index];
    if (!event) return;
    type.textContent = 'Plot event';
    title.textContent = timeLabel(event.storyTime);
    preview.replaceChildren(el('p','inspector-copy',event.note));
    preview.hidden = false;
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
      if (reply) {
        if (showGraphDirections) preview.append(timelineText(message,'Direction',message,time));
        preview.append(timelineText(reply,attributedSpeaker(reply) || 'Prose',message,time));
      }
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
  const time = current().messages.length ? edge?.storyTime || lastStoryTime(current()) || draftStartAt : draftStartAt;
  editingRelationship = {from,to,edge,pair,time};
  $('#relationshipLabel').textContent = `What happened between ${nameOf(from)} and ${nameOf(to)}?`;
  $('#relationshipText').value = edge?.label || '';
  $('#relationshipText').setCustomValidity('');
  $('#relationshipTime').value = time;
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
function storeRelationship() {
  if (!editingRelationship) return false;
  const {from,to,edge,pair} = editingRelationship;
  const input = $('#relationshipText');
  const label = input.value.trim();
  const clock = $('#relationshipTime');
  const storyTime = clock.value;
  if (!label) {
    input.setCustomValidity('Describe the relationship event.');
    input.reportValidity();
    return false;
  }
  if (!isStoryTime(storyTime)) {
    clock.setCustomValidity('Enter an in-story date and time.');
    clock.reportValidity();
    return false;
  }
  const project = current();
  const turn = edge ? edge.turn : project.messages.length ? project.messages.at(-1).turnNumber || project.messages.length : 0;
  if (!turn && storyTime !== draftStartAt) setDraftStart(storyTime);
  if (edge) {
    Object.assign(edge,{label,storyTime});
    estimatedEdgeDates.delete(edge);
  }
  else {
    draftRelationships.push({from,to,label,turn,storyTime});
  }
  clearConnection();
  refreshCastGraph();
  renderGraphTurns();
  pinGraph(pair);
  $('#closeInspector').focus();
  return true;
}
$('#storeRelationship').onclick = storeRelationship;
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
    if (!draftRelationships.some(edge => edge.from === from && edge.to === to && edge.label === suggestion.label && edge.turn === item.turnNumber)) {
      const storyTime = suggestion.storyTime || relationshipTime(current(),{turn:item.turnNumber},draftStartAt);
      draftRelationships.push({from,to,label:suggestion.label,turn:item.turnNumber,storyTime});
    }
  } else if (suggestion.kind === 'plot') {
    applied = applyGraphUpdate({...current(),plotEvents:draftPlotEvents},suggestion,item.turnNumber);
  } else {
    const input = $('#settingsForm').elements.notes;
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
    const text = suggestion.kind === 'writing' ? 'Writing notes: ' + suggestion.note : suggestion.kind === 'plot' ? 'Plot event: ' + suggestion.note : suggestion.kind === 'world' ? 'World: ' + suggestion.note
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

let settingsStoryId, settingsBaseline;
let confirmingGraphNavigation = false;
let savingGraphChanges = false;
function settingsSnapshot() {
  const form = $('#settingsForm');
  return JSON.stringify([
    settingsFields.map(key=>form.elements[key].value),
    readCast(), draftRelationships, draftPlotEvents, $('#storyStartAt').value,
    $('#graphUpdates').checked, pendingGraphReview.map(({status})=>status)
  ]);
}
function settingsDraftChanged() {
  return Boolean(settingsBaseline && settingsStoryId === current()?.id &&
    (relationshipDraftChanged() || settingsSnapshot() !== settingsBaseline));
}
function relationshipDraftChanged() {
  return editingRelationship && ($('#relationshipText').value.trim() !== (editingRelationship.edge?.label || '') ||
    $('#relationshipTime').value !== editingRelationship.time);
}
async function confirmGraphNavigation() {
  if (confirmingGraphNavigation) return false;
  if (!settingsDraftChanged()) return true;
  const dialog = $('#unsavedGraph');
  confirmingGraphNavigation = true;
  try {
    const result = await new Promise(resolve => {
      dialog.returnValue = 'stay';
      dialog.addEventListener('close',() => resolve(dialog.returnValue),{once:true});
      dialog.showModal();
    });
    if (result === 'discard') {
      loadSettings(undefined,false);
      error();
      return true;
    }
    if (result !== 'save') return false;
    return await persistGraphChanges();
  } finally {
    confirmingGraphNavigation = false;
  }
}
function openSettings(initialTab = $('#castTab')) {
  if (!state) return;
  showStoryView('graph');
  selectSettingsTab(initialTab,true);
}
function loadSettings(initialTab = $('#settingsForm [role="tab"][aria-selected="true"]'), restore = true) {
  const project = current();
  const previousSelection = restore && settingsStoryId === project.id ? pinnedGraph : null;
  settingsStoryId = project.id;
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
  draftPlotEvents = (project.plotEvents || []).map(event=>({...event}));
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
  if (previousSelection) {
    if (previousSelection.kind === 'character' && castEditors().some(editor=>editor.dataset.id === previousSelection.id)) {
      selectCastEditor(previousSelection.id);
    } else if (previousSelection.kind !== 'character') pinGraph(previousSelection);
  }
  settingsBaseline = settingsSnapshot();
}
function addCastEditor(character) {
  const card = el('fieldset', 'cast-card');
  card.dataset.id = character.id;
  card.hidden = true;
  character = simpleCharacter(character);
  for (const [field, labelText] of Object.entries(castLabels)) {
    const label = el('label', '', labelText);
    const input = el(field === 'name' || field === 'nickname' ? 'input' : 'textarea');
    input.value = character[field] || '';
    input.dataset.field = field;
    if (field === 'name' || field === 'nickname') {
      input.oninput = () => { input.setCustomValidity(''); refreshEditorName(card); };
    } else {
      input.rows = 4;
    }
    label.append(input);
    card.append(label);
  }
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
function normalize(data){if(!data||!Array.isArray(data.projects)||!data.projects.length||data.projects.length>maxLibraryStories+1||data.projects.filter(p=>p?.id!==starterStoryId).length>maxLibraryStories)throw Error('This file does not contain a story library.');const projects=data.projects.map(p=>{if(!p||typeof p!=='object'||!Array.isArray(p.messages))throw Error('A story in this file is missing its turns.');if(p.relationships!==undefined&&!validRelationships(p.relationships))throw Error('A story has invalid relationships.');if(p.cast!==undefined&&!validCast(p.cast))throw Error('A story has an invalid cast.');if(p.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('The library has invalid or too many story turns.');p = migrateStoryFields(migrateLegacyCast(structuredClone(p)));if(p.plotEvents!==undefined&&!validPlotEvents(p.plotEvents))throw Error('A story has invalid plot events.');if(p.cast!==undefined&&!validCast(p.cast))throw Error('A story has an invalid cast.');return {id:typeof p.id==='string'?p.id:id(),title:String(p.title||'Untitled story'),lore:String(p.lore||''),notes:String(p.notes||''),...(p.plotEvents ? {plotEvents:p.plotEvents} : {}),...(p.relationships ? {relationships:p.relationships.map(edge=>({...edge,turn:edge.turn||0}))} : {}),...(p.revisionNotes ? {revisionNotes:normalizeRevisionNotes(p.revisionNotes)} : {}),...(isStoryTime(p.storyStartAt)?{storyStartAt:p.storyStartAt,storyStartSource:p.storyStartSource||'estimate'}:{}),...(p.graphHistory?{graphHistory:normalizeGraphHistory(p.graphHistory)}:{}),...(p.agentHistory?{agentHistory:normalizeAgentHistory(p.agentHistory)}:{}),...(normalizeSetupHistory(p.setupHistory)?{setupHistory:normalizeSetupHistory(p.setupHistory)}:{}),...(normalizeStoryFlow(p.storyFlow)?{storyFlow:normalizeStoryFlow(p.storyFlow)}:{}),...(p.agentEditRequest && typeof p.agentEditRequest.id==='string' && typeof p.agentEditRequest.instruction==='string' && p.agentEditRequest.instruction.trim() ? {agentEditRequest:{id:p.agentEditRequest.id,instruction:p.agentEditRequest.instruction}} : {}),...(p.agentRequest&&['send','alternate','replace'].includes(p.agentRequest.mode)&&typeof p.agentRequest.speakerId==='string'&&Number.isSafeInteger(p.agentRequest.turnNumber)&&(p.agentRequest.mode!=='replace'||Number.isSafeInteger(p.agentRequest.replyTurnNumber))?{agentRequest:p.agentRequest}:{}),...(p.agentNotice&&typeof p.agentNotice.message==='string'&&p.agentNotice.message.trim()&&Number.isSafeInteger(p.agentNotice.turnNumber)?{agentNotice:{turnNumber:p.agentNotice.turnNumber,message:p.agentNotice.message.trim().slice(0,300),...(p.agentNotice.mode==='replace'?{mode:'replace',replyTurnNumber:p.agentNotice.replyTurnNumber}:{})}}:{}),...(Number.isSafeInteger(p.nextTurn)&&p.nextTurn>0?{nextTurn:p.nextTurn}:{}),...(typeof p.graphUpdates==='boolean'?{graphUpdates:p.graphUpdates}:{}),...(p.cast ? {cast:p.cast.map(member=>({id:member.id,...Object.fromEntries(castFields.map(field=>[field,member[field]||'']))}))} : {}),...(typeof p.speakerId==='string' ? {speakerId:p.speakerId} : {}),...Object.fromEntries(storyTextFields.map(key=>[key,typeof p[key]==='string'?p[key]:''])),messages:p.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m,index)=>{const result={role:m.role,content:m.content,turnNumber:Number.isSafeInteger(m.turnNumber)&&m.turnNumber>0?m.turnNumber:index+1};if(isStoryTime(m.storyTime))result.storyTime=m.storyTime;if(m.continuityPending===true)result.continuityPending=true;if(m.excludeFromContext===true)result.excludeFromContext=true;if(validSensitivity(m.contentSensitivity))result.contentSensitivity=m.contentSensitivity;const proposals=graphSuggestions(m.graphSuggestions);if(proposals.length)result.graphSuggestions=proposals;const applied=graphSuggestions(m.appliedGraphUpdates);if(applied.length)result.appliedGraphUpdates=applied;const firstTake=graphSuggestions(m.firstTakeSuggestions);if(firstTake.length)result.firstTakeSuggestions=firstTake;
if(m.role==='assistant'&&m.standalone===true)result.standalone=true;if(m.role==='assistant'&&m.startsChapter===true)result.startsChapter=true;if(m.role==='assistant'&&typeof m.sourcePrefix==='string')result.sourcePrefix=m.sourcePrefix;if(m.role==='assistant'&&typeof m.speakerName==='string'&&typeof m.speakerId==='string')Object.assign(result,{speakerName:m.speakerName,speakerId:m.speakerId});if(m.role==='assistant' && Array.isArray(m.alternatives) && m.alternatives.length && m.alternatives.every(x=>typeof x==='string')){result.alternatives=m.alternatives.slice();result.selectedAlternative=Number.isInteger(m.selectedAlternative)&&m.selectedAlternative>=0&&m.selectedAlternative<result.alternatives.length?m.selectedAlternative:0;if(result.alternatives[result.selectedAlternative]!==m.content){result.alternatives.push(m.content);result.selectedAlternative=result.alternatives.length-1}if(Array.isArray(m.alternativeSensitivities)){result.alternativeSensitivities=result.alternatives.map((_,i)=>i===result.selectedAlternative ? result.contentSensitivity || null : m.alternativeSensitivities[i]===null ? null : validSensitivity(m.alternativeSensitivities[i]) ? m.alternativeSensitivities[i] : 'unclassified')}}return result})};});if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error('Two stories have the same ID.');return {projects,activeId:projects.some(p=>p.id===data.activeId)?data.activeId:projects[0].id}}

const sceneModelChoice = $('#sceneModel');
const continuityModelChoice = $('#continuityModel');
const modePicker = enhanceSelect($('#authorMode'));
const sceneModelPicker = enhanceSelect(sceneModelChoice);
const continuityModelPicker = enhanceSelect(continuityModelChoice);
let continuityOptionsKey = '';
function syncContinuityModel(project) {
  const sensitive = sensitiveContinuity(project);
  const key = JSON.stringify([sensitive,enabledProviders()]);
  if (key !== continuityOptionsKey) {
    continuityOptionsKey = key;
    continuityModelChoice.replaceChildren(...providerOptions(models.filter(model=>isContinuityModel(model.id,sensitive))
      .map(model=>presetOption(model,'agent'))));
  }
  continuityModelChoice.value = selectedContinuityModel(project);
  continuityModelPicker.sync();
}
continuityModelChoice.onchange = () => {
  const project = current();
  const sensitive = sensitiveContinuity(project);
  if (isContinuityModel(continuityModelChoice.value,sensitive)) {
    setSession(continuityKey(project.id,sensitive),continuityModelChoice.value);
  }
  syncRoute();
  if (!sensitive && project.id !== starterStoryId && revisionModel(project)) void syncBackgroundReview({model:revisionModel(project)});
};
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
function presetOption(model,mode,priced = false) {
  const name = modelLabel(model,{agent:mode === 'agent'});
  const cost = priced && mode === 'story' ? chapterCost(model) : undefined;
  const detail = cost === undefined ? '' : `~$${cost.toFixed(5)} / chapter`;
  const option = new Option([name,detail].filter(Boolean).join(' · '),model.id);
  option.dataset.name = model.name;
  const tag = modelTag(model,{agent:mode === 'agent'});
  if (tag) option.dataset.tag = tag;
  if (detail) option.dataset.detail = detail;
  return option;
}

function providerOptions(options) {
  const placeholder = new Option('Pick a model','');
  placeholder.disabled = true;
  const groups = providerOrder.flatMap(provider=>{
    if (!configuredProviders.has(provider)) return [];
    const group = document.createElement('optgroup');
    group.label = providerNames[provider];
    group.append(...options.filter(option=>modelProvider(option.value) === provider));
    return group.children.length ? [group] : [];
  });
  return [placeholder,...groups];
}

function modelOptions(mode, {priced = false, addModel = false} = {}) {
  const list = models.filter(model => mode === 'agent' ? isAgentModel(model.id) : isWriterModel(model.id))
    .map(model=>presetOption(model,mode,priced));
  if (mode !== 'agent') {
    for (const id of userModels) {
      const option = new Option(id + ' · User-added',id);
      option.dataset.name = id;
      option.dataset.tag = 'User-added';
      list.push(option);
    }
  }
  const options = providerOptions(list);
  if (addModel && mode === 'story' && configuredProviders.has('openrouter')) {
    options.push(new Option('Manage custom models…','custom'));
  }
  return options;
}
function syncSceneModel(model,mode) {
  const optionsKey = JSON.stringify([mode,userModels,enabledProviders()]);
  if (sceneModelOptionsKey !== optionsKey) {
    sceneModelChoice.replaceChildren(...modelOptions(mode,{priced:true,addModel:true}));
    sceneModelOptionsKey = optionsKey;
  }
  sceneModelChoice.value = model;
  sceneModelPicker.sync();
}
sceneModelChoice.onchange = () => {
  if (busy || !state) return;
  const project = current();
  const mode = authorMode(project);
  const model = sceneModelChoice.value;
  if (model === 'custom' && mode === 'story') {
    syncRoute();
    return openCustomModels();
  }
  if (mode === 'agent' ? !isAgentModel(model) : !isWriterModel(model)) return;
  const previous = writingModel(project,mode);
  setSession(modelKey(project.id,mode),model);
  if (mode === 'story' && canWriteSensitive(previous) !== canWriteSensitive(model)) {
    setSession(sensitiveKey(project.id),'');
  }
  syncRoute();
  if (mode === 'agent' && project.id !== starterStoryId && revisionModel(project)) void syncBackgroundReview({model:revisionModel(project)});
};
const providerKeyFields = {openrouter:$('#keyInput'),anthropic:$('#claudeKeyInput'),openai:$('#openAiKeyInput')};
const providerRemovals = {openrouter:$('#removeOpenRouterKey'),anthropic:$('#removeClaudeKey'),openai:$('#removeOpenAiKey')};
const providerDialog = $('#providerDialog');
const saveProviderSettings = $('#saveProviderSettings');
function setConfiguredProviders({enabled}) {
  configuredProviders.clear();
  for (const provider of enabled) configuredProviders.add(provider);
}
function providerError(message = '') {
  const notice = $('#providerError');
  notice.textContent = message;
  notice.hidden = !message;
}
function updateProviderFields(reset = false) {
  for (const [provider,field] of Object.entries(providerKeyFields)) {
    const saved = configuredProviders.has(provider);
    const remove = providerRemovals[provider];
    if (reset || !saved) remove.checked = false;
    remove.parentElement.hidden = !saved;
    field.disabled = remove.checked;
    field.placeholder = saved ? 'Key saved' : '';
  }
}
async function openAppSettings() {
  if (!state || busy || providerDialog.open) return;
  updateProviderFields(true);
  providerError();
  $('#toggleDirections').checked = showGraphDirections;
  providerDialog.showModal();
  try {
    setConfiguredProviders(await api('/api/provider-keys'));
    if (providerDialog.open && !saveProviderSettings.disabled) updateProviderFields();
  } catch (failure) {
    if (providerDialog.open) providerError(failure.message);
  }
}
$('#providerButton').onclick = () => {
  $('#sidebar').close();
  openAppSettings();
};
$('#openComposerSettings').onclick = openAppSettings;
$('#closeProvider').onclick = $('#cancelProvider').onclick = () => providerDialog.close();
providerDialog.addEventListener('close', () => {
  for (const field of Object.values(providerKeyFields)) field.value = '';
});
for (const [provider,remove] of Object.entries(providerRemovals)) {
  remove.onchange = () => { providerKeyFields[provider].disabled = remove.checked; };
}
$('#providerForm').onsubmit = async event => {
  event.preventDefault();
  if (saveProviderSettings.disabled) return;
  providerError();
  const changes = {};
  for (const [provider,field] of Object.entries(providerKeyFields)) {
    const key = field.value.trim();
    if (providerRemovals[provider].checked) changes[provider] = null;
    else if (key) changes[provider] = key;
  }
  saveProviderSettings.disabled = true;
  try {
    if (Object.keys(changes).length) {
      setConfiguredProviders(await api('/api/provider-keys',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)
      }));
    }
  } catch (failure) {
    providerError(failure.message);
    return;
  } finally {
    saveProviderSettings.disabled = false;
  }
  if (setupDialog.open) populateSetupModels();
  showGraphDirections = $('#toggleDirections').checked;
  setSession('studio-show-directions',showGraphDirections ? 'true' : '');
  syncRoute();
  if (storyView === 'graph') renderGraphTurns();
  renderMessages();
  providerDialog.close();
  error();
};

const customModelDialog = $('#customModelDialog');
function renderCustomModels() {
  const list = $('#customModelList');
  list.hidden = !userModels.length;
  list.replaceChildren(...userModels.map(model => {
    const item = el('li');
    const remove = el('button','text-button danger','Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label','Remove ' + model);
    remove.onclick = () => {
      saveUserModels(userModels.filter(id=>id !== model));
      clearRemovedModelSelections();
      syncRoute();
      renderCustomModels();
      $('#modelInput').focus();
    };
    item.append(el('span','',model),remove);
    return item;
  }));
}
function openCustomModels() {
  $('#customModelForm').reset();
  $('#modelError').textContent = '';
  renderCustomModels();
  customModelDialog.showModal();
}
$('#closeCustomModel').onclick = () => customModelDialog.close();
$('#modelInput').oninput = () => { $('#modelError').textContent = ''; };
$('#customModelForm').onsubmit = event => {
  event.preventDefault();
  const model = $('#modelInput').value.trim().toLowerCase();
  if (!isWriterModel(model)) {
    $('#modelError').textContent = 'Enter an OpenRouter writer model ID in author/model format.';
    return;
  }
  if (!isPreset(model) && !userModels.includes(model)) saveUserModels([...userModels,model]);
  setSession(modelKey(current().id),model);
  syncRoute();
  customModelDialog.close();
};

const manualProseDrafts = new Map();
function syncManualProse() {
  const draft = manualProseDrafts.get(current().id);
  $('#pasteForm').hidden = !draft;
  $('#pasteReply').hidden = Boolean(draft);
  $('#pasteReply').setAttribute('aria-expanded',String(Boolean(draft)));
  $('#pasteText').value = draft?.text || '';
  $('#pasteSensitivity').value = draft?.sensitivity || 'unclassified';
}
$('#pasteReply').onclick = () => {
  manualProseDrafts.set(current().id,{text:'',sensitivity:'unclassified'});
  syncManualProse();
  $('#pasteText').focus();
};
$('#pasteForm').oninput = () => {
  $('#pasteText').setCustomValidity('');
  manualProseDrafts.set(current().id,{text:$('#pasteText').value,sensitivity:$('#pasteSensitivity').value});
};
$('#cancelPaste').onclick = () => {
  manualProseDrafts.delete(current().id);
  syncManualProse();
  $('#pasteReply').focus();
};
$('#pasteForm').onsubmit=event=>{
  event.preventDefault();
  if (busy || composerEdit) return;
  const field = $('#pasteText');
  const text = field.value.trim();
  if (!text) {
    field.setCustomValidity('Enter a passage to save.');
    field.reportValidity();
    return;
  }
  const project = current();
  delete project.agentRequest;
  delete project.agentNotice;
  appendTurn(project,{role:'assistant',content:text,...speakerMetadata(narrator),
    standalone:true,contentSensitivity:$('#pasteSensitivity').value});
  markDirty();
  manualProseDrafts.delete(project.id);
  syncManualProse();
  render();
  showLatestStoryTurn();
  $('#pasteReply').focus({preventScroll:true});
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
    if (!editor || storyView !== 'graph') return;
    const imported = simpleCharacter(Object.fromEntries(Object.entries(fields).map(([field,key])=>[field,data[key]])));
    for (const field of castFields) {
      const input = editor.querySelector(`[data-field="${field}"]`);
      input.value = typeof imported[field] === 'string' ? imported[field].trim() : '';
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

$('#cancelSettings').onclick = () => loadSettings(undefined,false);
$('#settingsForm').noValidate = true;
$('#settingsForm').addEventListener('input', event => {
  if (event.target.matches('textarea')) event.target.setCustomValidity('');
});
$('#settingsForm').onsubmit = event => {
  event.preventDefault();
  void persistGraphChanges();
};
async function persistGraphChanges() {
  if (savingGraphChanges) return false;
  savingGraphChanges = true;
  try {
    await pendingSave;
    const project = current();
    const keys = [...settingsFields,'cast','storyStartAt','storyStartSource','relationships','graphUpdates','graphHistory'];
    const reviewKeys = ['graphSuggestions','appliedGraphUpdates'];
    const targets = [{keys,find:()=>project}, ...project.messages.filter(turn=>turn.graphSuggestions).map(turn=>({
      keys:reviewKeys,find:()=>project.messages.find(item=>item.turnNumber === turn.turnNumber)
    }))];
    const read = ({keys,find}) => keys.map(key=>structuredClone(find()?.[key]));
    const before = targets.map(read);
    if (!saveGraphSettings()) return false;
    const applied = targets.map(read);
    const submitted = settingsSnapshot();
    await save();
    if (dirty) {
      targets.forEach(({keys,find},index) => {
        const target = find();
        if (!target) return;
        keys.forEach((key,position) => {
          if (JSON.stringify(target[key]) !== JSON.stringify(applied[index][position])) return;
          const original = before[index][position];
          if (original === undefined) delete target[key];
          else target[key] = original;
        });
      });
      return false;
    }
    settingsBaseline = submitted;
    const hasNewDraft = settingsDraftChanged();
    render();
    return !hasNewDraft;
  } finally {
    savingGraphChanges = false;
  }
}
function saveGraphSettings() {
  const form = $('#settingsForm');
  const project = current();
  if (!form.elements.title.value.trim()) {
    selectSettingsTab($('#writingTab'));
    form.elements.title.setCustomValidity('Enter a story title.');
    form.elements.title.reportValidity();
    return false;
  }
  form.elements.title.setCustomValidity('');
  if (!isStoryTime($('#storyStartAt').value)) {
    selectSettingsTab($('#worldTab'));
    $('#storyStartAt').setCustomValidity('Enter an in-story starting date and time.');
    $('#storyStartAt').reportValidity();
    return false;
  }
  setDraftStart($('#storyStartAt').value);
  const cast = readCast();
  if (!validCast(cast)) {
    const missingName = [...$('#castEditors').querySelectorAll('[data-field=name]')].find(input => !input.value.trim());
    if (missingName) {
      selectSettingsTab($('#castTab'));
      selectCastEditor(missingName.closest('fieldset').dataset.id);
      missingName.setCustomValidity('Enter a name for this character.');
      missingName.reportValidity();
    }
    return false;
  }
  if (relationshipDraftChanged() && !storeRelationship()) return false;
  ensureGraphBaseline(project);
  for (const key of settingsFields) project[key] = form.elements[key].value.trim();
  project.cast = cast;
  project.storyStartAt = draftStartAt;
  project.storyStartSource = draftStartSource;
  project.relationships = draftRelationships;
  project.plotEvents = draftPlotEvents;
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
  error();
  return true;
}
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
const setupModel = $('#setupModel');
const setupModelPicker = enhanceSelect(setupModel);
function populateSetupModels() {
  const previous = setupModel.value;
  setupModel.replaceChildren(...modelOptions('setup'));
  setupModel.value = Array.from(setupModel.options).some(option=>option.value === previous) ? previous : '';
  syncSetupChat();
}
$('#openSetupSettings').onclick = openAppSettings;
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
let setupMessages = [], setupReviewedMessages, setupRequest, setupReviewBack = 'choice', setupImportBack = 'choice';
let setupImportFromMessage = false;
let setupManuscript, setupSuggestedChapters = [];

function setupStep(step) {
  $('#setupChoice').hidden = step !== 'choice';
  setupChat.hidden = step !== 'chat';
  setupReview.hidden = step !== 'review';
  setupImport.hidden = step !== 'import';
  setupDialog.dataset.step = step;
  $('#setupProgress').hidden = step === 'choice' || (step === 'review' && setupReviewBack === 'choice');
  for (const item of $('#setupProgress').children) {
    item.hidden = item.dataset.stage === 'import' && step !== 'import' && !setupManuscript;
    if (item.dataset.stage === step) item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  }
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
  setupAddRelationship.disabled = named.length < 2;
}

function addSetupRelationship({from='',to='',label=''} = {}) {
  const entry = el('fieldset','setup-character');
  const fromField = el('select','setup-relationship-from');
  const toField = el('select','setup-relationship-to');
  fromField.required = toField.required = true;
  const note = el('input','setup-relationship-note');
  note.value = label;
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

let setupPlotEvents = [];
function fillSetupReview({title='',scenario='',lore='',notes='',cast=[],plotEvents=[],chapterStarts=[],relationships=[],storyStartAt=''} = {}) {
  $('#setupTitle').value = title;
  $('#setupScenario').value = scenario;
  $('#setupLore').value = lore;
  $('#setupNotes').value = notes;
  setupPlotEvents = plotEvents;
  $('#setupPlotEvents').value = plotEvents.map(event=>event.note).join('\n');
  for (const field of setupReview.querySelectorAll('textarea')) field.setCustomValidity('');
  $('#setupStartAt').value = storyStartAt;
  setupSuggestedChapters = chapterStarts.length || !setupManuscript ? chapterStarts : defaultChapterStarts(setupManuscript);
  $('#setupUseSuggestions').checked = true;
  $('#setupReviewedAll').checked = false;
  $('#setupReferencesReviewed').checked = false;
  $('#setupReferencesReview').hidden = !setupMessages.length && !setupContext.value.trim() && !setupMessage.value.trim();
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
  $('#setupSuggestionField').hidden = !setupSuggestedChapters.length;
  if (!setupManuscript) return;
  const turns = manuscriptTurns(setupManuscript,$('#setupUseSuggestions').checked ? setupSuggestedChapters : []);
  const chapters = turns.filter(turn => turn.startsChapter).length + 1;
  $('#setupReviewSummary').textContent = `${turns.length} ${turns.length === 1 ? 'turn' : 'turns'} · ${chapters} ${chapters === 1 ? 'chapter' : 'chapters'}. All imported prose is kept. AI context requires review.`;
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
  const draftModel = setupDraftModel(setupModel.value);
  const draftName = models.find(({id})=>id === draftModel).name;
  const manuscriptAction = setupManuscript ? 'Replace manuscript' : 'Use as manuscript';
  $('#openSetupSettings').hidden = hasApiKey();
  const usage = updateSetupContextUsage(content,context,draftModel);
  const canTransferDraft = (usage.chatFull || usage.draftFull) && Boolean(content);
  $('#setupProviderNote').textContent = setupModel.value
    ? providerNames[modelProvider(setupModel.value)] + ' receives the setup chat, additional context, and any attached manuscript. ' + draftName + ' prepares the draft.'
    : '';
  setupModel.disabled = pending;
  setupModelPicker.sync();
  setupMessage.readOnly = pending;
  setupContext.readOnly = pending;
  $('#setupSend').disabled = pending || usage.chatFull || !content;
  $('#setupDraft').disabled = pending || (!setupMessages.length && !content && !context && !setupManuscript);
  setupAttach.disabled = pending;
  setupAttach.hidden = Boolean(setupManuscript) && !canTransferDraft;
  setupAttach.textContent = canTransferDraft ? manuscriptAction : 'Import a manuscript';
  $('#setupReviewLocally').disabled = pending;
  $('#backSetupChat').disabled = pending;
  if (!pending) setupFeedback.textContent = (usage.chatFull || usage.draftFull)
    ? 'Prepare setup draft to have the agent review large sources in sections.' : '';
}

async function requestSetup(mode) {
  if (setupRequest) return;
  const content = setupMessage.value.trim();
  const context = setupContext.value.trim();
  const usage = updateSetupContextUsage(content,context,setupDraftModel(setupModel.value));
  if (mode === 'chat' && usage.chatFull) return;
  setupChatError.textContent = '';
  if (!setupModel.value || !hasModelProvider(setupModel.value)) {
    setupChatError.textContent = hasApiKey() ? 'Choose a setup model.' : 'Add an API key in Settings.';
    if (hasApiKey()) setupModelPicker.focus();
    else $('#openSetupSettings').focus();
    return;
  }
  if (mode === 'chat' && !content) return;
  const messages = content ? [...setupMessages,{role:'user',content}] : setupMessages;
  const request = new AbortController();
  const manuscript = setupManuscript?.reference;
  setupRequest = request;
  if (mode === 'chat') renderSetupChat(messages);
  try {
    syncSetupChat();
    setupFeedback.textContent = mode === 'chat' ? 'Thinking…'
      : usage.draftFull ? 'Reviewing the source in sections…' : 'Preparing your setup draft…';
    const payload = {mode,messages,manuscript,context};
    const result = await api('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},signal:request.signal,
      body:JSON.stringify({...payload,provider:modelProvider(setupModel.value),model:setupModel.value})});
    if (setupRequest !== request || !setupDialog.open) return;
    if (mode === 'draft') {
      setupReviewedMessages = messages;
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

$('#newProject').onclick = async () => {
  if (!state) return;
  if (settingsDraftChanged()) {
    $('#sidebar').close();
    showStoryView('graph');
    if (!await confirmGraphNavigation()) return;
  }
  if (state.projects.length - 1 >= maxLibraryStories) {
    alert('Your library has reached its story limit.');
    return;
  }
  setupMessages = [];
  setupReviewedMessages = undefined;
  setupChat.reset();
  populateSetupModels();
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
  setupMessage.value = '';
  setupContext.value = '';
  setupMessages = [];
  setupReviewedMessages = undefined;
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
  const usage = updateSetupContextUsage(setupMessage.value,setupContext.value,setupDraftModel(setupModel.value));
  setupImportFromMessage = Boolean(setupMessage.value.trim()) && (usage.chatFull || usage.draftFull);
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
    if (file?.size > manuscriptByteLimit) throw Error('The manuscript exceeds the 16 MB library transfer limit.');
    const text = file ? await file.text() : pasted;
    if (!setupDialog.open || setupImport.hidden) return;
    const manuscript = parseManuscript(text);
    setupManuscript = {...manuscript,passages:manuscriptPassages(manuscript.turns),reference:manuscriptReference(manuscript),
      title:manuscript.title || file?.name.replace(/\.[^.]+$/u,'') || ''};
    setupManuscript.tokens = estimateContextTokens(JSON.stringify(setupManuscript.reference));
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
  const context = setupContext.value.trim();
  const pendingNote = setupMessage.value.trim();
  const planning = setupReviewedMessages || setupMessages;
  const setupHistory = normalizeSetupHistory({context,reviewed:$('#setupReferencesReviewed').checked,
    messages:pendingNote && planning.at(-1)?.content !== pendingNote
      ? [...planning,{role:'user',content:pendingNote}] : planning});
  const projectId = id();
  const newStory = {
    id:projectId,title,
    lore:$('#setupLore').value.trim(),premise:$('#setupScenario').value.trim(),notes:$('#setupNotes').value.trim(),
    storyStartAt,storyStartSource:setupStart ? 'author' : 'estimate',messages,relationships,
    ...(setupHistory && (setupHistory.context || setupHistory.messages.length) ? {setupHistory} : {}),
    plotEvents:$('#setupPlotEvents').value.split('\n').map(note=>note.trim()).filter(Boolean).map(note=>{
      const suggested = setupPlotEvents.find(event=>event.note === note);
      const turn = suggested?.sourceTurn <= messages.length ? suggested.sourceTurn : 0;
      return {note,turn,storyTime:suggested?.storyTime || storyStartAt};
    }),
    ...(setupManuscript ? {nextTurn:messages.length + 1} : {}),
    cast:cast.map(member => ({...Object.fromEntries(castFields.map(field => [field,''])),...member}))
  };
  if (!validPlotEvents(newStory.plotEvents)) {
    $('#setupReviewError').textContent = 'Keep each plot event within 300 characters.';
    $('#setupPlotEvents').focus();
    return;
  }
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
  setSession(sensitiveKey(current().id),String(event.target.checked));
  syncRoute();
};
$('#saveComposerOnly').onclick = () => saveComposerEdit();
$('#cancelComposerEdit').onclick = closeComposerEdit;
$('#verifyComposerEdit').onchange = event => {
  if (composerEdit) composerEdit.verified = event.target.checked;
};
function clearComposerConnectionWarning() {
  $('#connectionWarning').hidden = true;
  $('#instruction').removeAttribute('aria-invalid');
  $('#instruction').removeAttribute('aria-describedby');
}
function showComposerConnectionWarning() {
  const transcript = $('#messages');
  const following = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
  $('#connectionWarning').hidden = false;
  $('#instruction').setAttribute('aria-invalid','true');
  $('#instruction').setAttribute('aria-describedby','connectionWarning');
  if (following) transcript.scrollTop = transcript.scrollHeight;
}
$('#instruction').addEventListener('focus',() => {
  if (!hasApiKey() && !composerEdit) showComposerConnectionWarning();
});
$('#writingComposer').addEventListener('focusout',event => {
  if (!event.currentTarget.contains(event.relatedTarget)) clearComposerConnectionWarning();
});
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
function draftInputs() {
  const direction = $('#instruction').value.trim();
  const project = current();
  const model = writingModel(project);
  const options = {model,includeSensitive:canWriteSensitive(model) && sensitiveDraft(project),openRouter:true};
  if (composerEdit?.canRegenerate) {
    const index = project.messages.findIndex(turn=>turn.turnNumber === composerEdit.turnNumber);
    if (index >= 0) {
      const reply = pairedReply(project,index);
      const history = project.messages.slice(0,index);
      const source = reply ? storyAtTurn(project,index) : project;
      const replyTime = reply?.storyTime || project.messages[index].storyTime;
      return {project:openRouterSnapshot(source,history,replyTime),direction,mode:reply ? 'replace' : 'send',options};
    }
  }
  const input = direction ? {project,direction,mode:'send'} : replyInput(project,'send',options);
  return {...input,project:openRouterSnapshot(input.project,input.project.messages,input.project.replyTime),options};
}

function promptForDraft() {
  const {project,direction,mode,options} = draftInputs();
  return buildWritingContext(project,direction,mode,options);
}

const contextNumber = new Intl.NumberFormat();
const modelName = model => models.find(item=>item.id === model)?.name || model || 'No model selected';
const contextEstimate = tokens => `≈${contextNumber.format(tokens)} input tokens`;
function windowLabel(model) {
  if (!model) return 'model unselected';
  const limit = modelContextWindow(model);
  return limit ? `${contextNumber.format(limit)} window` : 'model window unknown';
}

const contextColors = {
  'Names and aliases':'#e6a9be', 'Character profiles':'#bc99e0', 'World and premise':'#95b2ed',
  'Writing notes':'#e7a774', 'Story graph':'#8ecbb3', 'Story history':'#7e9ed2', 'Recent story':'#7e9ed2',
  'Agent history':'#d998a6', 'Setup history':'#d2b68a', 'Current direction':'#e4d092', 'Current request':'#e4d092',
  'Setup chat':'#bc99e0', 'Additional context':'#e7a774', 'Manuscript':'#8ecbb3',
  'Output reserve':'#86b9c0'
};

function renderContextMeter(bar, breakdown, parts, window) {
  const colorOf = label => contextColors[label] || '#a9a1b6';
  const taken = parts.reduce((sum,part)=>sum + part.tokens,0);
  const segments = parts.filter(part=>part.tokens > 0);
  if (window > taken) segments.push({label:'Available headroom',tokens:window - taken});
  bar.replaceChildren(...segments.map(({label,tokens})=>{
    const segment = el('span',label === 'Available headroom' ? 'available' : '');
    segment.style.flexGrow = tokens;
    segment.style.setProperty('--context-color',colorOf(label));
    return segment;
  }));
  breakdown.replaceChildren(...parts.map(({label,tokens})=>{
    const name = el('dt','',label);
    name.style.setProperty('--context-color',colorOf(label));
    return [name,el('dd','',contextNumber.format(tokens) + ' tokens')];
  }).flat());
}

function updateSetupContextUsage(content,context,draftModel) {
  const chatTokens = setupMessages.reduce((sum,{content})=>sum + estimateContextTokens(content),estimateContextTokens(content));
  const parts = [{label:'Setup chat',tokens:chatTokens},
    {label:'Additional context',tokens:estimateContextTokens(JSON.stringify(context))},
    {label:'Manuscript',tokens:setupManuscript?.tokens || 0}];
  const used = parts.reduce((sum,part)=>sum + part.tokens,0);
  const selectedModel = setupModel.value;
  const chat = agentBudget(selectedModel || draftModel,setupChatOutputLimit);
  const draft = agentBudget(draftModel,setupDraftOutputLimit);
  $('#setupContextUsage').textContent = `Context · ${contextEstimate(used)} · ${modelName(selectedModel || draftModel)} · ${windowLabel(selectedModel || draftModel)}`;
  renderContextMeter($('#setupContextBar'),$('#setupContextBreakdown'),[...parts,
    {label:'Output reserve',tokens:chat.outputLimit}],chat.window);
  $('#setupContextLimits').textContent = `The setup draft has ${contextNumber.format(draft.inputLimit)} input tokens and reserves ${contextNumber.format(draft.outputLimit)} for output. Estimates include the full manuscript when attached. Requests also include instructions and tool definitions.`;
  return {chatFull:used > chat.inputLimit,draftFull:used > draft.inputLimit};
}

let contextEstimateTimer;
function updateContextIndicator() {
  if (!state) return;
  clearTimeout(contextEstimateTimer);
  const details = composerContext();
  const indicator = $('#contextIndicator');
  const usage = details.usage;
  const label = usage === undefined ? details.summary
    : (usage > 0 && usage < 1 ? 'Less than 1%' : Math.round(usage) + '%') + ' of the context window used';
  indicator.title = label + '. Open to inspect what the model receives.';
  indicator.setAttribute('aria-description',label);
  $('#contextProgress').setAttribute('stroke-dasharray',`${Math.min(100,usage ?? 0)} 100`);
  if ($('#promptDialog').open) renderContextPanel();
  return details;
}

function composerContext(stage = 'writer') {
  const project = current();
  const mode = authorMode(project);
  const writer = writingModel(project,mode);
  const useContinuity = mode === 'story' && stage === 'continuity';
  const model = useContinuity ? selectedContinuityModel(project) : writer;
  if (composerEdit && (!composerEdit.canRegenerate || !model || !hasModelProvider(model))) {
    return {heading:'Context',summary:'Context · no model call',parts:[],
      limits:'This action saves the text locally. No model sees it.'};
  }
  if (mode === 'story' && sensitiveDraft(project) && !canWriteSensitive(writer)) {
    return {heading:'Context',summary:'Context · sensitive route required',parts:[],modelName:modelName(model),
      limits:'Choose an NSFW-friendly writer before sending this marked scene.'};
  }
  const edited = composerEdit && project.messages.find(turn=>turn.turnNumber === composerEdit.turnNumber);
  if (edited && (edited.excludeFromContext || (!sensitiveDraft(project) && !composerEdit.verified && !isAvailableToMcp(edited)))) {
    return {heading:'Context',summary:'Context · direction withheld',parts:[],
      limits:'This direction stays local until you choose an eligible route or review its context label.'};
  }
  const modelWindow = modelContextWindow(model);
  const windowNote = modelWindow ? `The lowest published provider window is ${contextNumber.format(modelWindow)} tokens, including output.`
      : 'Studio does not have a verified window for this model.';
  let details, limits;
  if (!model) return {heading:'Context',modelName:modelName(model),summary:'Context · select a model',
    parts:[],limits:'Choose a model to see its context budget.'};
  if (mode === 'agent' || useContinuity) {
    if (useContinuity) {
      const input = draftInputs();
      details = continuityContext(input.project,input.direction,'',{model,mode:input.mode,
        sensitive:sensitiveDraft(project),suggest:input.mode === 'send' && project.graphUpdates !== false});
    } else details = editorContext(project,$('#instruction').value,model);
    limits = windowNote + ' Studio budgets ' + contextNumber.format(details.inputLimit) + ' input tokens and keeps the current story state when it drops older exchanges.'
      + (details.omitted ? ' ' + details.omitted + ' older exchanges omitted.' : '')
      + (useContinuity ? ' This preview includes the current direction. The generated prose and any tool results are added during the call.' : '');
  } else {
    details = promptForDraft();
    limits = windowNote + ' The current story state and direction share an input budget of ' + contextNumber.format(details.inputLimit)
      + ' tokens, including up to ' + contextNumber.format(writingHistoryLimit(model)) + ' for recent story.';
  }
  const tokens = details.parts.reduce((sum,part)=>sum + part.tokens,0);
  return {heading:mode === 'agent' ? 'Editor agent context' : useContinuity ? 'Continuity agent context' : 'Writer context',
    modelName:modelName(model),canSelectPass:mode === 'story',
    summary:`Context · ${contextEstimate(tokens)} · ${windowLabel(model)}`,
    parts:[...details.parts,{label:'Output reserve',tokens:details.outputLimit}],
    messages:mode === 'story' && !useContinuity && !details.problem ? details.messages : undefined,
    window:modelWindow ?? (details.inputLimit + details.outputLimit),
    usage:modelWindow ? tokens / modelWindow * 100 : undefined,
    limits:details.problem ? limits + ' ' + details.problem : limits};
}

function renderContextPanel() {
  const {heading,modelName,canSelectPass,summary,parts,messages,limits,window} = composerContext($('#contextStage').value);
  $('#promptHeading').textContent = heading;
  $('#contextStageField').hidden = !canSelectPass;
  $('#contextModel').textContent = modelName || '';
  $('#contextModel').hidden = !modelName;
  $('#contextTotal').textContent = summary;
  renderContextMeter($('#contextBar'),$('#contextParts'),parts,window || 0);
  $('#contextLimits').textContent = limits;
  $('#promptTextDetails').hidden = !messages;
  $('#promptContents').textContent = messages ? formatMessages(messages) : '';
}

const spendColors = ['#c7a6b9','#83b5bc','#c8ad7d','#a6a1d0','#91b593','#c39183'];
const spendDate = new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
const spendMoney = new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
const formatSpend = value => value > 0 && value < 0.0001 ? '<$0.0001' : spendMoney.format(value);
const spendLabel = date => spendDate.format(new Date(date + 'T12:00:00Z'));
const modelSpendKey = ({provider,model}) => provider + '/' + model;

function renderSpendDays(days, selected) {
  const chart = $('#spendChart'), breakdown = $('#spendBreakdown');
  const totals = days.map(day=>day.models.reduce((sum,row)=>sum+row.usd,0));
  const ceiling = Math.max(...totals,0);
  const modelsInRange = [...new Set(days.flatMap(day=>day.models.map(modelSpendKey)))].sort();
  const color = row => spendColors[modelsInRange.indexOf(modelSpendKey(row)) % spendColors.length];
  chart.replaceChildren(...days.map(({date,models},index)=>{
    const button = el('button','spend-day');
    button.type = 'button';
    button.setAttribute('aria-pressed',String(index === selected));
    button.setAttribute('aria-label',spendLabel(date) + ', ' + formatSpend(totals[index]));
    const plot = el('span','spend-plot');
    plot.setAttribute('aria-hidden','true');
    for (const row of models) {
      if (!row.usd || !ceiling) continue;
      const segment = el('span','spend-segment');
      segment.style.height = (row.usd / ceiling * 100) + '%';
      segment.style.backgroundColor = color(row);
      plot.append(segment);
    }
    button.append(plot,el('span','spend-day-label',spendLabel(date)));
    button.onclick = () => {
      renderSpendDays(days,index);
      chart.children[index].focus({preventScroll:true});
    };
    return button;
  }));
  breakdown.replaceChildren(el('dt','spend-total',spendLabel(days[selected].date)),el('dd','spend-total',formatSpend(totals[selected])));
  for (const row of days[selected].models) {
    const label = el('dt','spend-label');
    const swatch = el('span','spend-swatch');
    swatch.setAttribute('aria-hidden','true');
    swatch.style.backgroundColor = color(row);
    label.append(swatch,el('span','',modelName(row.model) + ' · ' + providerNames[row.provider]));
    const price = row.unpriced === row.calls ? 'Unavailable' : (row.estimated ? '≈' : '') + formatSpend(row.usd);
    const amount = el('dd','',price);
    if (row.unpriced) amount.append(el('small','','Cost missing for ' + row.unpriced + (row.unpriced === 1 ? ' call' : ' calls')));
    breakdown.append(label,amount);
  }
}

async function refreshSpend() {
  const status = $('#spendStatus');
  $('#spendChart').replaceChildren();
  $('#spendBreakdown').replaceChildren();
  $('#spendNote').hidden = true;
  status.textContent = 'Loading spend…';
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const {days} = await api('/api/spend?timeZone=' + encodeURIComponent(timeZone));
    const latest = days.findLastIndex(day=>day.models.length);
    if (latest < 0) {
      status.textContent = 'No API spend recorded in the past seven days.';
      return;
    }
    status.textContent = '';
    $('#spendNote').hidden = false;
    renderSpendDays(days,latest);
  } catch {
    status.textContent = 'Couldn’t load API spend. Reopen this panel to retry.';
  }
}

$('#contextStage').onchange = renderContextPanel;
$('#contextIndicator').onclick = () => {
  if (!state) return;
  $('#contextStage').value = 'writer';
  renderContextPanel();
  $('#promptDialog').showModal();
  void refreshSpend();
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
    if (file.size > libraryByteLimit) throw Error('The library exceeds the 16 MB import limit.');
    const incoming = normalize(JSON.parse(await file.text()));
    if (incoming.projects.length > maxLibraryStories) throw Error('The library exceeds the story limit.');
    const reserved = incoming.projects.find(project => project.id === starterStoryId);
    if (reserved) {
      reserved.id = id();
      if (incoming.activeId === starterStoryId) incoming.activeId = reserved.id;
    }
    if (!await confirmDanger('Replace your library?',
      'Import replaces your saved stories with the contents of this file. Cancel and export your current library first if you want a backup.', 'Replace library')) return;
    if (!await confirmGraphNavigation()) return;
    const demo = state.projects.find(project => project.id === starterStoryId);
    const replacement = incoming.projects.find(project => project.id === incoming.activeId);
    for (const project of [...state.projects,...incoming.projects]) {
      pendingComposerEdits.delete(project.id);
      setSession(draftKey(project.id),'');
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
installExpandedEditors();
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
    const keyFailure = await api('/api/provider-keys').then(setConfiguredProviders, failure=>failure.message);
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
    const requested = new URLSearchParams(location.search);
    if (state.projects.some(project=>project.id === requested.get('story'))) state.activeId = requested.get('story');
    render();
    const view = requested.get('view');
    if (storyViews.some(([name])=>name === view)) showStoryView(view);
    else if (view === 'revision') workspaceTools.open('pacing',{focus:false});
    status('Saved locally');
    if (keyFailure) error(keyFailure);
    if (requested.has('settings')) openAppSettings();
  } catch (e) {
    status('Could not load');
    error(`Couldn't open your stories: ${e.message}`);
  }
})();

// Other Studio tabs and connected tools can save while this view is open.
let checkingUpdates = false;
setInterval(()=>{ if (!document.hidden) void syncBackgroundReview(); },5000);
setInterval(async () => {
  if (!state || document.hidden || checkingUpdates || dirty || pendingWrites || busy ||
    composerEdit || settingsDraftChanged() || document.querySelector('dialog[open]')) return;
  checkingUpdates = true;
  const polledRevision = revision;
  try {
    const response = await fetch('/api/state', {headers:{'If-None-Match':polledRevision}});
    if (response.status !== 200) return;
    const updated = normalize(await response.json());
    if (revision !== polledRevision || dirty || pendingWrites || busy || composerEdit || settingsDraftChanged() || document.querySelector('dialog[open]')) return;
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
    checkingUpdates = false;
  }
}, 2500);
