import { applyTurnGraphUpdates, captureGraphVersion, graphChangesByTurn, normalizeGraphHistory, storyAtTurn } from './graph-history.js';
import { maxLibraryStories, starterStoryId, withoutStarter } from './library.js';
import { mergeLibrary } from './sync.js';
import { buildMessages, formatMessages, extraFields, getCast, narrator, resolveCastName, migratePersona, primarySpeaker, castFields, maxAdditionalCharacters, validCast, validRelationships, graphSuggestions, nextTurnNumber, appendTurn, maxGraphEvents, recentTurns, recentTokenCap, validSensitivity, isAvailableToMcp, precedingDirection, isStoryTime, localStoryTime, lastStoryTime, relationshipTime, recordStoryTime } from './prompt.js';

import { models, chapterCost, isModelId } from './models.js';
import { dateWriterTurn, mcpOmissionReason, queuedTurn, replyInput, stripSpeakerName, syncTakeSuggestions } from './prompt.js';

const settingsFields = ['title', 'character', 'lore', 'notes', ...extraFields.filter(key => key !== 'personaName')];
const castLabels = {name:'Name', nickname:'Aliases', description:'Description', personality:'Personality', scenario:'Scenario', examples:'Example dialogue'};
const $ = s => document.querySelector(s);
let state, revision, pendingWrites = 0, timer, pendingSave = Promise.resolve(), dirty = false, busy = false, editingIndex = null;
let libraryDirty = false, pendingLibraryWrites = 0;
// The library as last loaded from or saved to the server, the base for merging agent writes.
let baseLibrary = null, demoGeneration;
let connection = {model:'',key:''};
let editingCharacter = primarySpeaker;
let draftRelationships = [], connectingFrom = '', editingRelationship = null;
let draftStartAt = '', draftStartSource = '';
let estimatedEdgeDates = new WeakSet();
let connecting = false, pinnedGraph = null, hoverGraph = null, deletedEvent = null, shownEvents = 12;
let pendingGraphReview = [];
// Live activity: local MCP agents (from /api/agent) and an OpenRouter request in progress.
let agentActivity = [], generatingFor = null;
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
const routeKey = id => 'story-route:' + id;
const draftKey = id => 'story-draft:' + id;
const id = () => globalThis.crypto?.randomUUID?.() || `story-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const current = () => state.projects.find(p => p.id === state.activeId);
function status(text) {
  $('#saveStatus').textContent = text === 'Saved locally' && current().id === starterStoryId
    ? 'Demo · resets on reload' : text;
}
function error(text=''){const box=$('#error');box.hidden=!text;box.textContent=text}
const graphRejectionLabels = {
  CAST_NAME_UNRESOLVED:'unknown or ambiguous cast name',
  DUPLICATE_CHARACTER:'character already exists',
  SELF_RELATIONSHIP:'relationship refers to the same character twice',
  INVALID_FIELDS:'missing or invalid fields',
  TOO_MANY_UPDATES:'more than five proposals',
  EXPECTED_UPDATES_ARRAY:'invalid proposal list'
};
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
function render() {
  const project = current();
  if (!project) return;
  $('#instruction').value = getSession(draftKey(project.id)) || '';
  syncRoute();
  $('#storyTitle').textContent = project.title;
  $('#deleteProject').hidden = project.id === starterStoryId;
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
  $('#rewindTurn').disabled = index === current().messages.length - 1;
  turnMenu.hidden = false;
  positionTurnMenu();
  $('#branchTurn').focus({preventScroll:true});
}

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
  setSession(routeKey(branch.id),$('#sceneProvider').value);
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

function appendTurnContextBadge(container, badgeGroup, reason) {
  if (!reason) return;
  const status = reason === 'directionWithheld' ? 'unverified' : reason;
  const labels = {
    explicit:'Explicit · outside MCP',
    unverified:'Unverified · outside MCP',
    allRoutes:'Outside AI context'
  };
  container.dataset.contextStatus = status;
  badgeGroup.append(el('span','context-badge',labels[status]));
}

function renderMessages() {
  closeTurnMenu();
  const project = current(), box = $('#messages');
  box.replaceChildren();
  if (!project.messages.length) {
    const empty = el('div','empty');
    empty.append(el('div','empty-mark','✳'),el('strong','','Every story starts somewhere.'),
      el('p','','Set the scene below, or ask your co-writer to begin.'));
    box.append(empty);
    return;
  }
  const graphChanges = graphChangesByTurn(project);
  let previousDirection;
  project.messages.forEach((message,index) => {
    const fromAuthor = message.role === 'user';
    if (fromAuthor) previousDirection = message;
    const omittedFromMcp = mcpOmissionReason(message,previousDirection);
    const turn = message.turnNumber || index + 1;
    const row = el('article','message ' + (fromAuthor ? 'user' : 'assistant'));
    row.setAttribute('aria-label',`${fromAuthor ? 'Your input' : 'Story'} · Turn ${turn}`);
    const name = fromAuthor ? 'You' : attributedSpeaker(message);
    const body = el('div','message-body'), head = el('div',name ? 'message-header' : 'message-footer');
    if (name) head.append(el('strong',fromAuthor ? 'author-label' : '',name));
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
    edit.onclick = () => openEdit(index);
    const remove = el('button','danger','Delete');
    remove.setAttribute('aria-label',`Delete turn ${turn}`);
    remove.onclick = async () => {
      if (!await confirmDanger(`Delete turn ${turn}?`,
        'This permanently removes the text and its alternate takes from the story.', 'Delete turn')) return;
      project.messages.splice(index,1);
      markDirty(project);
      renderMessages();
    };
    const more = el('button','turn-more','…');
    more.type = 'button';
    more.setAttribute('aria-label',`More actions for turn ${turn}`);
    more.setAttribute('aria-controls','turnMenu');
    more.setAttribute('aria-expanded','false');
    more.disabled = busy;
    more.onclick = () => openTurnMenu(more,index);
    actions.append(edit,remove,more);
    head.append(actions);
    const text = el('div','message-text',message.content);
    body.append(...(name ? [head,text] : [text,head]));
    if (message.role === 'assistant' && message.alternatives?.length > 1) {
      const nav = el('div','alternatives');
      const prev = el('button','','← Previous'), next = el('button','','Next →');
      prev.disabled = busy || message.selectedAlternative === 0;
      next.disabled = busy || message.selectedAlternative === message.alternatives.length - 1;
      prev.onclick = () => selectAlternative(message,message.selectedAlternative - 1);
      next.onclick = () => selectAlternative(message,message.selectedAlternative + 1);
      nav.append(prev,el('span','',`${message.selectedAlternative + 1} of ${message.alternatives.length} takes`),next);
      body.append(nav);
    }
    row.append(body);
    box.append(row);
  });
  renderPending();
  box.scrollTop = box.scrollHeight;
}
function setSensitivity(message, value) {
  if (validSensitivity(value)) message.contentSensitivity = value;
  else delete message.contentSensitivity;
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
function ago(since) {
  const minutes = Math.floor((Date.now() - since) / 60_000);
  return minutes < 1 ? 'just now' : minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
}
// What the writer should know about MCP for this story: a status line, and
// a placeholder turn while a queued turn waits for or is being written by an agent.
function mcpStatus(project) {
  const queue = queuedTurn(project).request;
  const watcher = agentActivity.find(agent => agent.state === 'watching');
  if (queue) {
    const writer = agentActivity.find(agent => agent.state === 'writing' && agent.storyId === project.id && agent.turnNumber === queue.turnNumber);
    if (writer) return {
      line:`${writer.client} picked up your turn ${ago(writer.since)} and is writing the continuation.`,
      pending:{state:'Writing', active:true}
    };
    if (watcher) return {
      line:`Turn queued. ${watcher.client} is watching and will pick it up in a moment.`,
      pending:{state:'Queued', active:true}
    };
    return {
      line:'Turn queued, but no agent is watching. Open Start Claude Writer, or ask your agent to write the queued turn.',
      pending:{state:'Waiting for an agent', active:false}
    };
  }
  if (project.agentRequest) return {line:'The queued turn no longer matches the story, so no agent will write it. Queue a new turn when you are ready.'};
  if (project.agentNotice) return {line:'Your agent did not write the last turn: ' + project.agentNotice.message
    + (project.messages.at(-1)?.role === 'user' && !isAvailableToMcp(project.messages.at(-1))
      ? ' To write it, switch to OpenRouter and click Send & write with an empty box.'
      : ' To try again, click Queue turn with an empty box.')};
  return {line:watcher ? `${watcher.client} is watching. Queue a turn and it writes the reply.`
    : 'No agent is watching. Open Start Claude Writer, or ask your agent to watch Story Studio.'};
}
function renderPending() {
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
function syncRoute() {
  const project = current();
  const savedRoute = getSession(routeKey(project.id));
  const route = ['mcp','openrouter','manual'].includes(savedRoute) ? savedRoute : 'mcp';
  $('#sceneProvider').value = route;
  const usesOpenRouter = route === 'openrouter';
  $('#sceneModelControl').hidden = !usesOpenRouter;
  sceneModelChoice.disabled = busy;
  syncSceneModel();
  $('#routeSummary').textContent = usesOpenRouter
    ? connection.key ? '' : 'Add an API key in Connection'
    : route === 'manual' ? 'No model calls' : mcpStatus(project).line;
  $('#sceneProvider').disabled = busy;
  $('#sendButton').disabled = busy;
  $('#sendButton').textContent = busy ? 'Writing…' : route === 'manual' ? 'Save turn' : route === 'mcp' ? 'Queue turn' : 'Send & write ↗';
}
function speakerMetadata(speaker) {
  return {speakerId:speaker.id, speakerName:speaker.name};
}

function setBusy(value) {
  busy = value;
  syncRoute();
  renderMessages();
}

async function generate() {
  if (busy || !state) return;
  const project = current();
  const provider = $('#sceneProvider').value;
  const input = $('#instruction');
  const direction = input.value.trim();
  // An empty composer answers a writer turn that has no reply yet, such as
  // after a failed request or a turn an agent handed back.
  const lastTurn = project.messages.at(-1);
  const answering = !direction && provider !== 'manual' && lastTurn?.role === 'user' && !lastTurn.excludeFromContext;
  if (!direction && !answering) return input.focus();
  error();
  if (answering && provider === 'mcp' && !isAvailableToMcp(lastTurn)) {
    error('Your last turn is outside MCP context. Write this scene with OpenRouter, or change its label with Edit.');
    return;
  }
  if (provider === 'openrouter' && (!connection.model || !connection.key)) {
    openConnection('openrouter');
    error('Enter your OpenRouter key and choose a model, then send again.');
    return;
  }

  const replacedQueue = Boolean(project.agentRequest);
  const history = answering ? project.messages.slice(0, -1) : project.messages.slice();
  // Any new request replaces an earlier queue and notice; MCP sets a new queue below.
  delete project.agentNotice;
  delete project.agentRequest;
  if (answering && provider === 'mcp') {
    project.agentRequest = {mode:'send',speakerId:narrator.id,turnNumber:lastTurn.turnNumber || project.messages.length};
    markDirty();
    return render();
  }
  if (!answering) {
    const turnNumber = appendTurn(project, {role:'user', content:direction, ...(provider === 'openrouter' ? {contentSensitivity:'unclassified'} : {})});
    input.value = '';
    setSession(draftKey(project.id), '');
    if (provider === 'mcp') project.agentRequest = {mode:'send',speakerId:narrator.id,turnNumber};
    markDirty();
    if (provider !== 'openrouter') return render();
  }

  const snapshot = {
    id:project.id,
    ...Object.fromEntries(settingsFields.map(key => [key,project[key] || ''])),
    persona:project.persona, personaName:project.personaName, storyWriterId:project.storyWriterId,
    storyStartAt:project.storyStartAt, storyStartSource:project.storyStartSource, graphUpdates:project.graphUpdates,
    cast:project.cast, relationships:project.relationships,
    replyTime:answering ? lastTurn.storyTime : undefined,
    messages:recentTurns(history,recentTokenCap,{includeSensitive:true})
  };
  const originalHistory = JSON.stringify(project.messages);
  generatingFor = {projectId:project.id, model:connection.model};
  setBusy(true);
  try {
    if (replacedQueue) {
      markDirty(project);
      await save();
      if (dirty || JSON.stringify(project.messages) !== originalHistory) {
        throw Error('The queued turn changed before OpenRouter could start. Check the transcript and try again.');
      }
    }
    const response = await api('/api/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        project:snapshot, instruction:answering ? lastTurn.content : direction, provider,
        ...connection
      })
    });
    const {text} = response;
    if (!text?.trim()) throw Error('The co-writer returned an empty response.');
    const target = state.projects.find(item => item.id === project.id);
    if (!target || JSON.stringify(target.messages) !== originalHistory) {
      throw Error('The scene changed while writing. Try again from the updated scene.');
    }
    setSensitivity(target.messages.at(-1),validSensitivity(response.input) ? response.input : 'unclassified');
    const suggestions = target.graphUpdates === false ? [] : graphSuggestions(response.suggestions);
    appendTurn(target, {role:'assistant', content:stripSpeakerName(text, narrator.name), ...speakerMetadata(narrator),
      contentSensitivity:validSensitivity(response.reply) ? response.reply : 'unclassified',
      storyTime:recordStoryTime(target,response.storyTime)});
    dateWriterTurn(target);
    const {applied,pending} = applyTurnGraphUpdates(target,target.messages.at(-1),suggestions,{
      allowAutomatic:response.input === 'safe' && response.reply === 'safe'
        && !(target.id === current().id && $('#settingsDialog').open)
    });
    const hasGraphChanges = applied > 0 || pending > 0;
    markDirty(target);
    if (response.truncated) {
      const unverified = response.input === 'unclassified' || response.reply === 'unclassified';
      error('This reply reached Story Studio’s output limit and may end mid-scene.' +
        (unverified ? ' Any unverified text stays outside MCP until you check its label with Edit.' : ''));
    } else if (response.metadataFailed) {
      error('Your draft is in the story. DeepSeek could not verify its labels or suggest map updates. Check the labels with Edit before using this turn in MCP.');
    } else if (response.updateProblems) {
      const reasons = [...new Set(response.updateRejections?.map(({code}) => graphRejectionLabels[code]).filter(Boolean))];
      const reason = reasons.length ? ` (${reasons.join(', ')})` : '';
      error(`Story Studio skipped graph proposals${reason}. The prose was saved.` +
        (hasGraphChanges ? ' See View graph changes for the valid proposals.' : ''));
    }
  } catch (e) {
    error(`Couldn't write the next turn: ${e.message} Your turn is saved. To try again, click Send & write with an empty box.`);
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
  return [$('#primaryEditor'), ...$('#castEditors').children];
}
function editorName(editor) {
  return editor.querySelector('[data-field="name"]').value.trim()
    || (editor.dataset.id === primarySpeaker ? 'Main character' : 'New character');
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
const nameOf = id => editorName(castEditors().find(editor => editor.dataset.id === id) || $('#primaryEditor'));
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
  $('#addCharacter').disabled = editors.length - 1 >= maxAdditionalCharacters;
  $('#connectCharacters').disabled = editors.length < 2;
  updateGraphSelection();
}
narrowGraph.onchange = shortGraph.onchange = () => {
  if ($('#settingsDialog').open) refreshCastGraph();
};

const timeLabel = time => time ? time.replace('T',' ') : 'Undated';
const timelineDate = new Intl.DateTimeFormat('en', {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
const matchesTimeline = (edge,selection) => selection.kind === 'moment'
  ? edge.turn && edge.storyTime === selection.time : (edge.turn || 0) === selection.turn;
const countEvents = count => `${count} relationship ${count === 1 ? 'event' : 'events'}`;

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
      detail:edges.length === 1 ? first.label : countEvents(edges.length), selection:{kind:'moment',time}});
  }
  let previousDirection;
  current().messages.forEach((message,index) => {
    if (message.role === 'user') previousDirection = message;
    const turn = message.turnNumber || index + 1;
    const kind = message.role === 'user' ? 'Direction' : attributedSpeaker(message) || 'Prose';
    entries.push({time:message.storyTime || '', label:`${eventTime(turn)} · ${kind}`,
      reason:mcpOmissionReason(message,previousDirection), selection:{kind:'turn',turn}});
  });
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
    const message = current().messages.find((item,index) => (item.turnNumber || index + 1) === selection.turn);
    const time = selection.kind === 'moment' ? selection.time : selection.turn ? message?.storyTime : draftStartAt;
    type.textContent = selection.kind === 'turn' ? eventTime(selection.turn) : 'Timeline';
    title.textContent = timeLabel(time);
    if (message) {
      preview.replaceChildren(el('p','inspector-copy',message.content));
      preview.hidden = false;
    }
    renderRelationships(draftRelationships.filter(edge => matchesTimeline(edge,selection)),true);
  } else if (selection.kind === 'turn-changes') {
    type.textContent = eventTime(selection.turn);
    title.textContent = 'Graph changes';
    const notes = graphChangesByTurn(current()).get(selection.turn)?.notes || [];
    const edges = draftRelationships.filter(edge => matchesTimeline(edge,selection));
    const pending = pendingGraphReview.filter(item => item.turnNumber === selection.turn && !item.status);
    preview.replaceChildren();
    preview.append(el('h4','','Saved changes'));
    for (const note of notes) {
      const label = note.kind === 'character' ? 'Character added · ' + note.name
        : note.kind === 'profile' ? 'Profile updated · ' + note.name
        : note.kind === 'world' ? 'World setting' : 'Story memory';
      const row = el('div','relationship-row');
      row.append(el('strong','',label),el('p','relationship-copy',note.note));
      preview.append(row);
    }
    if (!notes.length && !edges.length) preview.append(el('p','form-note','No graph changes have been saved for this turn.'));
    if (pending.length) {
      const review = el('button','button subtle',`Review ${pending.length} pending ${pending.length === 1 ? 'proposal' : 'proposals'}`);
      review.type = 'button';
      review.onclick = () => {
        pinGraph({kind:'review',turn:selection.turn});
        $('#closeInspector').focus();
      };
      preview.append(review);
    }
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
  const selected = editors.find(editor => editor.dataset.id === id) || editors[0];
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
    const primary = $('#primaryEditor');
    if (castEditors().length === 1 && [...primary.querySelectorAll('[data-field]')].every(input => !input.value.trim())) {
      primary.querySelector('[data-field="name"]').value = suggestion.name;
      primary.querySelector('[data-field="description"]').value = suggestion.note;
    } else {
      if (castEditors().length > maxAdditionalCharacters) return 'The cast is full.';
      addCastEditor({id:id(),name:suggestion.name,description:suggestion.note});
    }
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
  const pending = turn ? allPending.filter(item => item.turnNumber === turn) : allPending;
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
$('#primaryEditor').querySelector('[data-field="name"]').oninput = () => refreshEditorName($('#primaryEditor'));

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
  editingCharacter = primarySpeaker;
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
    refreshCastGraph();
    renderGraphTurns();
    selectCastEditor(primarySpeaker, true);
  };
  card.append(remove);
  $('#castEditors').append(card);
  return card;
}
$('#addCharacter').onclick = () => {
  if ($('#castEditors').children.length >= maxAdditionalCharacters) return;
  const primary = $('#primaryEditor');
  if ($('#castEditors').children.length === 0 && [...primary.querySelectorAll('[data-field]')].every(input => !input.value.trim())) {
    selectCastEditor(primarySpeaker,true);
    return;
  }
  const card = addCastEditor({id:id()});
  refreshCastGraph();
  selectCastEditor(card.dataset.id).querySelector('input').focus();
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
  status.textContent = heldForReview ? 'This reply follows a direction outside MCP. Review the text before including it.'
    : value === 'unclassified' ? 'This text has not been verified.' : '';
}

function openEdit(index) {
  editingIndex = index;
  const {messages} = current();
  const message = messages[index];
  $('#editText').value = message.content;
  $('#editStoryTime').value = message.storyTime || '';
  $('#editStoryTime').setCustomValidity('');
  $('#excludeTurn').checked = Boolean(message.excludeFromContext);
  const sensitivity = message.contentSensitivity;
  const heldForReview = (!sensitivity || sensitivity === 'safe')
    && !isAvailableToMcp({...message,excludeFromContext:false},precedingDirection(messages,index));
  showEditSensitivity(sensitivity,heldForReview);
  $('#editDialog').showModal();
}
function normalize(data){if(!data||!Array.isArray(data.projects)||!data.projects.length||data.projects.length>maxLibraryStories+1||data.projects.filter(p=>p?.id!==starterStoryId).length>maxLibraryStories)throw Error('This file does not contain a story library.');const projects=data.projects.map(p=>{if(!p||typeof p!=='object'||!Array.isArray(p.messages))throw Error('A story in this file is missing its turns.');if(p.relationships!==undefined&&!validRelationships(p.relationships))throw Error('A story has invalid relationships.');if(p.cast!==undefined&&!validCast(p.cast))throw Error('A story has an invalid cast.');if(p.messages.length>3000||p.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('The library has invalid or too many story turns.');return migratePersona({id:typeof p.id==='string'?p.id:id(),title:String(p.title||'Untitled story'),character:String(p.character||''),persona:String(p.persona||''),lore:String(p.lore||''),notes:String(p.notes||''),...(p.relationships ? {relationships:p.relationships.map(edge=>({...edge,turn:edge.turn||0}))} : {}),...(isStoryTime(p.storyStartAt)?{storyStartAt:p.storyStartAt,storyStartSource:p.storyStartSource||'estimate'}:{}),...(typeof p.storyWriterId==='string'?{storyWriterId:p.storyWriterId}:{}),...(p.graphHistory?{graphHistory:normalizeGraphHistory(p.graphHistory)}:{}),...(p.agentRequest&&['send','alternate'].includes(p.agentRequest.mode)&&typeof p.agentRequest.speakerId==='string'&&Number.isSafeInteger(p.agentRequest.turnNumber)?{agentRequest:p.agentRequest}:{}),...(p.agentNotice&&typeof p.agentNotice.message==='string'&&p.agentNotice.message.trim()&&Number.isSafeInteger(p.agentNotice.turnNumber)?{agentNotice:{turnNumber:p.agentNotice.turnNumber,message:p.agentNotice.message.trim().slice(0,300)}}:{}),...(Number.isSafeInteger(p.nextTurn)&&p.nextTurn>0?{nextTurn:p.nextTurn}:{}),...(typeof p.graphUpdates==='boolean'?{graphUpdates:p.graphUpdates}:{}),...(p.cast ? {cast:p.cast.map(member=>({id:member.id,...Object.fromEntries(castFields.map(field=>[field,member[field]||'']))}))} : {}),...(typeof p.speakerId==='string' ? {speakerId:p.speakerId} : {}),...Object.fromEntries(extraFields.map(key=>[key,typeof p[key]==='string'?p[key]:''])),messages:p.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m,index)=>{const result={role:m.role,content:m.content,turnNumber:Number.isSafeInteger(m.turnNumber)&&m.turnNumber>0?m.turnNumber:index+1};if(isStoryTime(m.storyTime))result.storyTime=m.storyTime;if(m.excludeFromContext===true)result.excludeFromContext=true;if(validSensitivity(m.contentSensitivity))result.contentSensitivity=m.contentSensitivity;const proposals=graphSuggestions(m.graphSuggestions);if(proposals.length)result.graphSuggestions=proposals;const applied=graphSuggestions(m.appliedGraphUpdates);if(applied.length)result.appliedGraphUpdates=applied;const firstTake=graphSuggestions(m.firstTakeSuggestions);if(firstTake.length)result.firstTakeSuggestions=firstTake;
if(m.role==='assistant'&&typeof m.speakerName==='string'&&typeof m.speakerId==='string')Object.assign(result,{speakerName:m.speakerName,speakerId:m.speakerId});if(m.role==='assistant' && Array.isArray(m.alternatives) && m.alternatives.length && m.alternatives.every(x=>typeof x==='string')){result.alternatives=m.alternatives.slice();result.selectedAlternative=Number.isInteger(m.selectedAlternative)&&m.selectedAlternative>=0&&m.selectedAlternative<result.alternatives.length?m.selectedAlternative:0;if(result.alternatives[result.selectedAlternative]!==m.content){result.alternatives.push(m.content);result.selectedAlternative=result.alternatives.length-1}if(Array.isArray(m.alternativeSensitivities)){result.alternativeSensitivities=result.alternatives.map((_,i)=>i===result.selectedAlternative ? result.contentSensitivity || null : m.alternativeSensitivities[i]===null ? null : validSensitivity(m.alternativeSensitivities[i]) ? m.alternativeSensitivities[i] : 'unclassified')}}return result})});});if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error('Two stories have the same ID.');return {projects,activeId:projects.some(p=>p.id===data.activeId)?data.activeId:projects[0].id}}

const modelChoice = $('#modelPreset');
const sceneModelChoice = $('#sceneModel');
for (const model of models) {
  const cost = chapterCost(model).toFixed(5);
  modelChoice.add(new Option(`${model.name} · ~$${cost} / chapter`, model.id));
  sceneModelChoice.add(new Option(model.name, model.id));
}
const sceneCustomOption = new Option();
let customModelId = '';
function syncSceneModel() {
  if (customModelId && sceneCustomOption.value !== customModelId) {
    sceneCustomOption.value = customModelId;
    sceneCustomOption.textContent = customModelId;
    sceneModelChoice.add(sceneCustomOption);
  }
  sceneModelChoice.value = connection.model;
}
sceneModelChoice.onchange = () => {
  if (busy || !state || !isModelId(sceneModelChoice.value)) return;
  connection.model = sceneModelChoice.value;
  syncRoute();
};
const customOption = el('option', '', 'Enter another model ID…');
customOption.value = 'custom';
modelChoice.append(customOption);
const providerDialog = $('#providerDialog');

function showModelPrice() {
  const model = models.find(item => item.id === modelChoice.value);
  $('#customModel').hidden = modelChoice.value !== 'custom';
  $('#modelPrice').hidden = !model;
  if (!model) return;
  $('#modelEstimate').textContent = `~$${chapterCost(model).toFixed(5)} per chapter`;
  $('#modelRates').textContent = `$${model.input.toFixed(2)} input / $${model.output.toFixed(2)} output per million tokens`;
  $('#modelSource').href = 'https://openrouter.ai/' + model.id;
}
modelChoice.onchange = () => { $('#modelError').textContent = ''; showModelPrice(); };
$('#modelInput').oninput = () => { $('#modelError').textContent = ''; };

function openConnection() {
  modelChoice.value = models.some(item => item.id === connection.model)
    ? connection.model : connection.model ? 'custom' : '';
  $('#modelInput').value = modelChoice.value === 'custom' ? connection.model : customModelId;
  showModelPrice();
  $('#modelError').textContent = '';
  $('#keyInput').value = connection.key;
  providerDialog.showModal();
}
$('#providerButton').onclick = openConnection;
$('#closeProvider').onclick = $('#cancelProvider').onclick = () => $('#providerDialog').close();
providerDialog.addEventListener('close', () => {
  $('#keyInput').value = '';
});
$('#providerForm').onsubmit = event => {
  event.preventDefault();
  const custom = modelChoice.value === 'custom';
  const modelInput = $('#modelInput');
  const model = custom ? modelInput.value.trim() : modelChoice.value;
  if (!isModelId(model)) {
    $('#modelError').textContent = custom
      ? 'Enter a specific model ID in author/model format.'
      : 'Choose an OpenRouter model.';
    (custom ? modelInput : modelChoice).focus();
    return;
  }
  if (custom && !models.some(item => item.id === model)) customModelId = model;
  connection = {model, key:$('#keyInput').value.trim()};
  setSession(routeKey(current().id), 'openrouter');
  syncRoute();
  renderMessages();
  $('#providerDialog').close();
  error();
};
$('#sceneProvider').onchange = event => {
  setSession(routeKey(current().id), event.target.value);
  syncRoute();
  if (event.target.value === 'openrouter' && !connection.key) openConnection('openrouter');
  renderMessages();
};
$('#pasteReply').onclick=()=>{$('#pasteText').value='';$('#pasteDialog').showModal()};$('#closePaste').onclick=$('#cancelPaste').onclick=()=>$('#pasteDialog').close();$('#pasteForm').onsubmit=e=>{e.preventDefault();const text=$('#pasteText').value.trim();if(!text)return;const project=current();delete project.agentRequest;delete project.agentNotice;appendTurn(project,{role:'assistant',content:text,...speakerMetadata(narrator)});markDirty();$('#pasteDialog').close();renderMessages()};
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
  if (!isStoryTime($('#storyStartAt').value)) {
    selectSettingsTab($('#worldTab'));
    $('#storyStartAt').setCustomValidity('Enter an in-story starting date and time.');
    $('#storyStartAt').reportValidity();
    return;
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
    return;
  }
  if (!project.graphHistory?.length) captureGraphVersion(project, 0);
  if (cast.length) {
    for (const turn of project.messages) {
      if (turn.role === 'assistant' && !turn.speakerId) Object.assign(turn, speakerMetadata(getCast(project)[0]));
    }
  }
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
$('#editText').oninput = () => {
  if (['safe','reviewed-safe'].includes(editingSensitivity)) showEditSensitivity('unclassified');
};
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
  message.content = $('#editText').value;
  setSensitivity(message,editingSensitivity);
  if ($('#excludeTurn').checked) message.excludeFromContext = true;
  else delete message.excludeFromContext;
  if (message.alternatives) {
    message.alternatives[message.selectedAlternative] = message.content;
    if (message.alternativeSensitivities) message.alternativeSensitivities[message.selectedAlternative] = message.contentSensitivity || null;
    else if (message.contentSensitivity) message.alternativeSensitivities = message.alternatives.map((_,index)=>
      index===message.selectedAlternative ? message.contentSensitivity : 'unclassified');
  }
  markDirty();
  $('#editDialog').close();
  renderMessages();
};
$('#newProject').onclick = () => {
  if (!state) return;
  if (state.projects.length - 1 >= maxLibraryStories) {
    alert('Your library has reached its story limit.');
    return;
  }
  const project = {id:id(),title:'Untitled story',character:'',persona:'',lore:'',notes:'',
    storyStartAt:localStoryTime(),storyStartSource:'estimate',messages:[]};
  state.projects.unshift(project);
  state.activeId = project.id;
  markDirty();
  render();
  $('#sidebar').close();
  openSettings();
};
$('#deleteProject').onclick = async () => {
  if (!state) return;
  const project = current();
  if (project.id === starterStoryId || !await confirmDanger(`Delete “${project.title}”?`,
    'This permanently removes the story, its turns, and its character and relationship history from the library.', 'Delete story')) return;
  state.projects = state.projects.filter(item => item.id !== project.id);
  state.activeId = state.projects[0].id;
  markDirty(project);
  render();
};
$('#sendButton').onclick=()=>generate();$('#instruction').oninput=()=>{if(state)setSession(draftKey(current().id),$('#instruction').value)};$('#instruction').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();generate()}};
function promptForDraft() {
  const direction = $('#instruction').value.trim();
  const project = current();
  const provider = $('#sceneProvider').value;
  const options = {
    maintainGraph: provider === 'mcp' && project.graphUpdates !== false,
    model: provider === 'openrouter' ? connection.model : '',
    includeSensitive:provider === 'openrouter',openRouter:provider === 'openrouter'
  };
  if (direction) return buildMessages(project, direction, 'send', options);
  // Without a new direction, show what a queued turn or a reply to the last
  // writer turn sends, laid out exactly as the MCP server lays it out.
  const queued = provider === 'mcp' ? queuedTurn(project).request : null;
  const input = replyInput(project, queued?.mode === 'alternate' ? 'alternate' : 'send', options);
  return buildMessages(input.project, input.direction, input.mode, options);
}
$('#promptPreview').onclick = () => {
  if (!state) return;
  $('#promptContents').textContent = formatMessages(promptForDraft());
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
      setSession(draftKey(project.id),'');
      setSession(routeKey(project.id),'');
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
    setSession(draftKey(starterStoryId),'');
    setSession(routeKey(starterStoryId),'');
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
  const project = current();
  if (!project) return;
  const status = mcpStatus(project);
  const key = JSON.stringify([project.id, status.line, status.pending]);
  if (key === activityKey) return;
  activityKey = key;
  syncRoute();
  renderPending();
}, 2000);

setInterval(async () => {
  if (!state || !state.projects.some(p => p.agentRequest) || checkingAgent || dirty || pendingWrites || busy || document.querySelector('dialog[open]')) return;
  checkingAgent = true;
  try {
    const response = await fetch('/api/state', {headers:{'If-None-Match':revision}});
    if (response.status !== 200) return;
    const updated = normalize(await response.json());
    if (dirty || pendingWrites || busy || document.querySelector('dialog[open]')) return;
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
