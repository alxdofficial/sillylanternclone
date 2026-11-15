import { captureGraphVersion, normalizeGraphHistory } from './graph-history.js';
import { buildMessages, formatMessages, extraFields, getCast, getSpeaker, primarySpeaker, castFields, maxAdditionalCharacters, validCast, validRelationships, graphSuggestions, nextTurnNumber, appendTurn, maxGraphEvents, recentTurns } from './prompt.js';

import { models, chapterCost, isModelId } from './models.js';

const settingsFields = ['title', 'character', 'persona', 'lore', 'notes', ...extraFields];
const castLabels = {name:'Name', nickname:'Aliases', description:'Description', personality:'Personality', scenario:'Scenario', examples:'Example dialogue'};
const $ = s => document.querySelector(s);
let state, revision, pendingWrites = 0, timer, pendingSave = Promise.resolve(), dirty = false, busy = false, editingIndex = null;
let connection = {model:'',key:''};
let editingCharacter = primarySpeaker;
let draftRelationships = [], connectingFrom = '', editingRelationship = null, showOlderEvents = false;
let pendingGraphReview = [];
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
function status(text){$('#saveStatus').textContent=text}
function error(text=''){const box=$('#error');box.hidden=!text;box.textContent=text}
async function api(url, options={}) {const response=await fetch(url,options);let result;try{result=await response.json()}catch{throw Error(`Unexpected server response (${response.status}).`)}if(!response.ok)throw Error(result.error || `Request failed (${response.status}).`);return result}
function markDirty(){dirty=true;status('Saving…');clearTimeout(timer);timer=setTimeout(save,450)}
function save() {
  clearTimeout(timer);
  if (!dirty) return pendingSave;
  dirty = false;
  const body = JSON.stringify(state);
  pendingWrites++;
  pendingSave = pendingSave.then(async () => {
    try {
      const result = await api('/api/state', {method:'PUT', headers:{
        'Content-Type':'application/json', 'If-Match':revision
      }, body});
      revision = result.revision;
      if (!dirty && pendingWrites === 1) status('Saved locally');
    } catch (e) {
      dirty = true;
      status('Not saved');
      error(`Couldn't save your changes. ${e.message}`);
    } finally {
      pendingWrites--;
    }
  });
  return pendingSave;
}
window.addEventListener('beforeunload', event => {
  if (dirty || pendingWrites) event.preventDefault();
});
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function render() {
  const project = current();
  if (!project) return;
  syncSpeaker();
  $('#instruction').value = getSession(draftKey(project.id)) || '';
  syncRoute();
  $('#storyTitle').textContent = project.title;
  $('#crumb').textContent = project.title;
  document.title = project.title + ' · Story Studio';
  const list = $('#projectList');
  list.replaceChildren();
  for (const story of state.projects) {
    const button = el('button','project-item' + (story.id === project.id ? ' active' : ''),story.title);
    button.onclick = () => {
      state.activeId = story.id;
      markDirty();
      error();
      render();
      $('#sidebar').classList.remove('open');
    };
    list.append(button);
  }
  renderMessages();
}
function renderMessages(){const p=current(), box=$('#messages');box.replaceChildren();if(!p.messages.length){const empty=el('div','empty');empty.append(el('div','empty-mark','\u2733'),el('strong','','Every story starts somewhere.'),el('p','','Set the scene below, or ask your co-writer to begin.'));box.append(empty);return}p.messages.forEach((m,index)=>{const row=el('article','message '+(m.role==='user'?'user':'assistant'));const avatar=el('div','avatar',m.role==='user'?'Y':'\u2733');avatar.setAttribute('aria-hidden','true');const body=el('div','message-body'), head=el('div','message-header');head.append(el('strong','',m.role==='user'?(p.personaName||'You'):(m.speakerName||p.characterName||'Co-writer')));if(m.excludeFromContext)head.append(el('span','context-badge','Outside AI context'));else if(m.graphSuggestions?.length){const review=el('button','text-button','Review map updates');review.onclick=()=>{openSettings();$('#graphSuggestions').scrollIntoView({block:'nearest'});};head.append(review)}const actions=el('div','message-actions');const edit=el('button','','Edit');edit.onclick=()=>openEdit(index);const del=el('button','','Delete');del.onclick=()=>{if(!confirm('Delete this turn?'))return;p.messages.splice(index,1);markDirty();renderMessages()};actions.append(edit,del);if(m.role==='assistant'&&!m.excludeFromContext&&index===p.messages.length-1&&$('#sceneProvider').value!=='manual'){const retry=el('button','','Another take');retry.disabled=busy;retry.onclick=()=>generate('retry');actions.prepend(retry)}head.append(actions);body.append(head,el('div','message-text',m.content));if(m.role==='assistant' && m.alternatives?.length>1){const nav=el('div','alternatives');const prev=el('button','','← Previous');const count=el('span','',`${m.selectedAlternative+1} of ${m.alternatives.length} takes`);const next=el('button','','Next →');prev.disabled=busy||m.selectedAlternative===0;next.disabled=busy||m.selectedAlternative===m.alternatives.length-1;prev.onclick=()=>selectAlternative(m,m.selectedAlternative-1);next.onclick=()=>selectAlternative(m,m.selectedAlternative+1);nav.append(prev,count,next);body.append(nav)}row.append(avatar,body);box.append(row)});box.scrollTop=box.scrollHeight}
function selectAlternative(message,index){if(!message.alternatives || index<0 || index>=message.alternatives.length)return;message.selectedAlternative=index;message.content=message.alternatives[index];markDirty();renderMessages()}
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
    : route === 'manual' ? 'No model calls' : project.agentRequest
      ? 'Turn queued. Ask your connected agent to continue.' : 'Use the Story Studio tool in Codex or Claude Code';
  $('#sceneProvider').disabled = busy;
  $('#sendButton').disabled = busy;
  $('#sendButton').textContent = busy ? 'Writing…' : route === 'manual' ? 'Save turn' : route === 'mcp' ? 'Queue turn' : 'Send & write ↗';
}
function syncSpeaker() {
  const project = current();
  const cast = getCast(project);
  const select = $('#speakerSelect');
  $('#speakerControl').hidden = cast.length <= 1;
  select.replaceChildren(...cast.map(character => new Option(character.name, character.id)));
  select.value = getSpeaker(project).id;
  select.disabled = busy;
}
$('#speakerSelect').onchange = event => {
  if (busy || !state) return;
  current().speakerId = event.target.value;
  markDirty();
};
function speakerMetadata(speaker) {
  return {speakerId:speaker.id, speakerName:speaker.name};
}

function setBusy(value) {
  busy = value;
  syncSpeaker();
  syncRoute();
  renderMessages();
}

async function generate(mode) {
  if (busy || !state) return;
  const project = current();
  const provider = $('#sceneProvider').value;
  const input = $('#instruction');
  const direction = mode === 'send' ? input.value.trim() : '';
  if (mode === 'send' && !direction) return input.focus();
  error();
  if (provider === 'manual' && mode !== 'send') {
    error('Use Copy prompt and Add reply for an external writing session.');
    return;
  }
  if (provider === 'openrouter' && (!connection.model || !connection.key)) {
    openConnection('openrouter');
    error('Enter your OpenRouter key and choose a model, then send again.');
    return;
  }

  let speaker = getSpeaker(project);
  if (mode === 'retry') {
    const previous = project.messages.at(-1);
    if (previous?.role !== 'assistant' || previous.excludeFromContext) return;
    const originalId = previous.speakerId || primarySpeaker;
    speaker = getCast(project).find(member => member.id === originalId);
    if (!speaker) {
      error('This turn’s speaker is no longer in the cast. Choose a current speaker and use Continue.');
      return;
    }
  }

  const history = mode === 'retry' ? project.messages.slice(0, -1) : project.messages.slice();
  if (mode === 'send') {
    const turnNumber = appendTurn(project, {role:'user', content:direction});
    input.value = '';
    setSession(draftKey(project.id), '');
    if (provider === 'mcp') project.agentRequest = {mode:'send',speakerId:speaker.id,turnNumber};
    markDirty();
    if (provider !== 'openrouter') return render();
  } else if (provider === 'mcp') {
    const previous = project.messages.at(-1);
    project.agentRequest = {mode:'alternate',speakerId:speaker.id,turnNumber:previous.turnNumber || project.messages.length};
    markDirty();
    return render();
  }

  const snapshot = {
    id:project.id,
    ...Object.fromEntries(settingsFields.map(key => [key,project[key] || ''])),
    cast:project.cast, relationships:project.relationships, speakerId:speaker.id,
    messages:recentTurns(history)
  };
  const originalHistory = JSON.stringify(project.messages);
  setBusy(true);
  try {
    const response = await api('/api/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        project:snapshot, instruction:direction, provider,
        mode: mode === 'retry' ? 'alternate' : mode,
        ...(provider === 'openrouter' ? connection : {})
      })
    });
    const {text} = response;
    if (!text?.trim()) throw Error('The co-writer returned an empty response.');
    const target = state.projects.find(item => item.id === project.id);
    if (!target || JSON.stringify(target.messages) !== originalHistory) {
      throw Error('The scene changed while writing. Try again from the updated scene.');
    }
    if (mode === 'retry') {
      const message = target.messages.at(-1);
      message.alternatives ||= [message.content];
      message.alternatives.push(text.trim());
      message.selectedAlternative = message.alternatives.length - 1;
      message.content = message.alternatives[message.selectedAlternative];
    } else {
      appendTurn(target, {role:'assistant', content:text.trim(), ...speakerMetadata(speaker)});
    }
    markDirty();
  } catch (e) {
    error(`Couldn't write the next turn: ${e.message}`);
  } finally {
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
function nodePositions(editors) {
  return new Map(editors.map((editor, i) => {
    const angle = Math.PI * 2 * i / editors.length - Math.PI / 2;
    const position = editors.length === 1 ? [180,126]
      : editors.length === 2 ? [100 + i * 160,126]
      : [180 + 123 * Math.cos(angle),126 + 91 * Math.sin(angle)];
    return [editor.dataset.id, position];
  }));
}
function refreshCastGraph() {
  const graph = $('#castGraph');
  const editors = castEditors();
  const coordinates = nodePositions(editors);
  graph.replaceChildren();
  const drawn = new Set();
  for (const edge of draftRelationships) {
    const pair = JSON.stringify([edge.from,edge.to].sort());
    if (drawn.has(pair)) continue;
    drawn.add(pair);
    const from = coordinates.get(edge.from), to = coordinates.get(edge.to);
    if (!from || !to) continue;
    const line = svg('line', {x1:from[0],y1:from[1],x2:to[0],y2:to[1],class:'graph-edge'});
    graph.append(line);
  }
  for (const editor of editors) {
    const id = editor.dataset.id, name = editorName(editor);
    const [x,y] = coordinates.get(id);
    const node = svg('g', {
      class:'graph-node', role:'button', tabindex:'0', transform:`translate(${x} ${y})`,
      'aria-label':name, 'aria-pressed':String(id === editingCharacter)
    });
    node.append(svg('circle', {r:20}), svg('text', {class:'graph-initial',x:0,y:5,'text-anchor':'middle'}, Array.from(name)[0] || '?'));
    node.append(svg('text', {x:0,y:38,'text-anchor':'middle'}, name.length > 13 ? name.slice(0, 12) + '…' : name));
    node.onclick = () => {
      if (connectingFrom && connectingFrom !== id) openRelationship(connectingFrom, id);
      else selectCastEditor(id, true);
    };
    node.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        node.onclick();
      }
    };
    node.dataset.id = id;
    graph.append(node);
  }
  $('#addCharacter').disabled = editors.length - 1 >= maxAdditionalCharacters;
  $('#connectCharacters').disabled = editors.length < 2;
  renderRelationships();
}
function selectCastEditor(id, focusNode = false) {
  const editors = castEditors();
  const selected = editors.find(editor => editor.dataset.id === id) || editors[0];
  editingCharacter = selected.dataset.id;
  for (const editor of editors) editor.hidden = editor !== selected;
  $('#profileHeading').textContent = editorName(selected);
  $('#cardHint').textContent = '';
  refreshCastGraph();
  if (focusNode && matchMedia('(max-width: 560px)').matches) {
    $('#profileHeading').scrollIntoView({block:'start'});
    selected.querySelector('input').focus({preventScroll:true});
  } else if (focusNode) [...$('#castGraph').querySelectorAll('g')].find(node => node.dataset.id === editingCharacter)?.focus();
  return selected;
}
function refreshEditorName(editor) {
  if (editor.dataset.id === editingCharacter) $('#profileHeading').textContent = editorName(editor);
  refreshCastGraph();
}
$('#backToGraph').onclick = () => {
  $('#settingsBody').scrollTop = 0;
  [...$('#castGraph').querySelectorAll('g')].find(node => node.dataset.id === editingCharacter)?.focus({preventScroll:true});
};
const nameOf = id => editorName(castEditors().find(editor => editor.dataset.id === id) || $('#primaryEditor'));
function renderRelationships() {
  const list = $('#relationshipList');
  list.replaceChildren();
  const ordered = [...draftRelationships].sort((a,b) => (b.turn || 0) - (a.turn || 0));
  if (ordered.length > 10) {
    const toggle = el('button','text-button',showOlderEvents ? 'Show recent events' : `Show ${ordered.length - 10} earlier events`);
    toggle.type = 'button';
    toggle.onclick = () => { showOlderEvents = !showOlderEvents; renderRelationships(); list.firstElementChild.focus(); };
    list.append(toggle);
  }
  for (const edge of showOlderEvents ? ordered : ordered.slice(0,10)) {
    const row = el('div','relationship-row', `${edge.turn ? 'Turn ' + edge.turn : 'Setup'} · ${nameOf(edge.from)} → ${nameOf(edge.to)}: ${edge.label}`);
    const edit = el('button','text-button','Edit link');
    edit.type = 'button';
    edit.onclick = () => openRelationship(edge.from, edge.to, edge);
    const remove = el('button','text-button','Remove link');
    remove.type = 'button';
    remove.onclick = () => {
      draftRelationships = draftRelationships.filter(item => item !== edge);
      clearConnection();
      refreshCastGraph();
      $('#connectCharacters').focus();
    };
    row.append(el('br'), edit, remove);
    list.append(row);
  }
}
function clearConnection() {
  connectingFrom = '';
  editingRelationship = null;
  $('#relationshipEditor').hidden = true;
  $('#graphStatus').textContent = '';
}
function openRelationship(from, to, edge) {
  connectingFrom = '';
  editingRelationship = {from:edge?.from || from, to:edge?.to || to, edge};
  $('#relationshipLabel').textContent = `${nameOf(editingRelationship.from)} → ${nameOf(editingRelationship.to)}`;
  $('#relationshipText').value = edge?.label || '';
  $('#relationshipText').setCustomValidity('');
  $('#storeRelationship').textContent = edge ? 'Save link' : 'Add relationship';
  $('#relationshipEditor').hidden = false;
  $('#graphStatus').textContent = '';
  $('#relationshipText').focus();
}
$('#connectCharacters').onclick = () => {
  clearConnection();
  connectingFrom = editingCharacter;
  $('#graphStatus').textContent = `Choose another character to connect to ${nameOf(connectingFrom)}.`;
};
$('#cancelRelationship').onclick = () => { clearConnection(); $('#connectCharacters').focus(); };
$('#storeRelationship').onclick = () => {
  if (!editingRelationship) return;
  const label = $('#relationshipText').value.trim();
  if (!label) {
    $('#relationshipText').setCustomValidity('Describe the relationship.');
    $('#relationshipText').reportValidity();
    return;
  }
  if (editingRelationship.edge) editingRelationship.edge.label = label;
  else if (draftRelationships.length < maxGraphEvents) {
    const project = current();
    const turn = project.messages.length ? project.messages.at(-1).turnNumber || project.messages.length : 0;
    draftRelationships.push({from:editingRelationship.from,to:editingRelationship.to,label,turn});
  } else {
    $('#graphStatus').textContent = 'This map has reached its event limit.';
    return;
  }
  clearConnection();
  refreshCastGraph();
  $('#connectCharacters').focus();
};
$('#relationshipText').oninput = event => event.target.setCustomValidity('');
$('#relationshipText').onkeydown = event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  $('#storeRelationship').click();
};
function resolveName(name) {
  const wanted = name.trim().toLowerCase();
  const matches = castEditors().filter(editor => {
    const aliases = editor.querySelector('[data-field="nickname"]').value.split(',');
    return [editorName(editor), ...aliases].some(item => item.trim().toLowerCase() === wanted);
  });
  return matches.length === 1 ? matches[0].dataset.id : null;
}
function addDatedFact(previous, note, turn) {
  const line = `Turn ${turn}: ${note}`;
  return previous.split('\n').includes(line) ? previous : [previous.trim(),line].filter(Boolean).join('\n');
}
function reviewSuggestion(item) {
  const suggestion = item.suggestion;
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
    description.value = addDatedFact(description.value,suggestion.note,item.turnNumber);
  } else if (suggestion.kind === 'world') {
    const input = $('#settingsForm').elements.lore;
    input.value = addDatedFact(input.value,suggestion.note,item.turnNumber);
  } else if (suggestion.kind === 'relationship') {
    const from = resolveName(suggestion.from), to = resolveName(suggestion.to);
    if (!from || !to || from === to) return 'Add both characters with distinct names first.';
    if (draftRelationships.length >= maxGraphEvents) return 'The map has reached its event limit.';
    if (!draftRelationships.some(edge => edge.from === from && edge.to === to && edge.label === suggestion.label && edge.turn === item.turnNumber)) {
      draftRelationships.push({from,to,label:suggestion.label,turn:item.turnNumber});
    }
  } else {
    const input = $('#settingsForm').elements.continuity;
    const fact = `Turn ${item.turnNumber}: ${suggestion.note}`;
    if (!input.value.split('\n').includes(fact)) input.value = [input.value.trim(),fact].filter(Boolean).join('\n');
  }
  item.status = 'accepted';
  refreshCastGraph();
  $('#profileHeading').textContent = nameOf(editingCharacter);
  renderGraphReview();
  return '';
}
function renderGraphReview() {
  const container = $('#graphSuggestions');
  const pending = pendingGraphReview.filter(item => !item.status);
  container.hidden = !pending.length;
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
  draftRelationships = structuredClone(project.relationships || []);
  showOlderEvents = false;
  pendingGraphReview = project.messages.flatMap((message, turn) => message.excludeFromContext ? [] :
    (message.graphSuggestions || []).map((suggestion, index) => ({turn,index,suggestion, turnNumber:message.turnNumber || turn + 1, status:''})));
  pendingGraphReview = pendingGraphReview.slice(-30);
  $('#graphUpdates').checked = project.graphUpdates !== false;
  clearConnection();
  selectCastEditor(getSpeaker(project).id);
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
  const remove = el('button', 'button subtle', 'Remove from cast');
  remove.type = 'button';
  remove.onclick = () => {
    draftRelationships = draftRelationships.filter(edge => edge.from !== card.dataset.id && edge.to !== card.dataset.id);
    card.remove();
    clearConnection();
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
    selectCastEditor(primarySpeaker).querySelector('input').focus();
    return;
  }
  const card = addCastEditor({id:id()});
  selectCastEditor(card.dataset.id).querySelector('input').focus();
};

function readCast() {
  return [...$('#castEditors').children].map(card => ({
    id:card.dataset.id,
    ...Object.fromEntries([...card.querySelectorAll('[data-field]')].map(input =>
      [input.dataset.field, input.value.trim()]))
  }));
}

function openEdit(index) {
  editingIndex = index;
  const message = current().messages[index];
  $('#editText').value = message.content;
  $('#excludeTurn').checked = Boolean(message.excludeFromContext);
  $('#editDialog').showModal();
}
function normalize(data){if(!data||!Array.isArray(data.projects)||!data.projects.length||data.projects.length>100)throw Error('This file does not contain a story library.');const projects=data.projects.map(p=>{if(!p||typeof p!=='object'||!Array.isArray(p.messages))throw Error('A story in this file is missing its turns.');if(p.relationships!==undefined&&!validRelationships(p.relationships))throw Error('A story has invalid relationships.');if(p.cast!==undefined&&!validCast(p.cast))throw Error('A story has an invalid cast.');if(p.messages.length>3000||p.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('The library has invalid or too many story turns.');return {id:typeof p.id==='string'?p.id:id(),title:String(p.title||'Untitled story'),character:String(p.character||''),persona:String(p.persona||''),lore:String(p.lore||''),notes:String(p.notes||''),...(p.relationships ? {relationships:p.relationships.map(({from,to,label,turn})=>({from,to,label,turn:turn||0}))} : {}),...(p.graphHistory?{graphHistory:normalizeGraphHistory(p.graphHistory)}:{}),...(p.agentRequest&&['send','alternate'].includes(p.agentRequest.mode)&&typeof p.agentRequest.speakerId==='string'&&Number.isSafeInteger(p.agentRequest.turnNumber)?{agentRequest:p.agentRequest}:{}),...(Number.isSafeInteger(p.nextTurn)&&p.nextTurn>0?{nextTurn:p.nextTurn}:{}),...(typeof p.graphUpdates==='boolean'?{graphUpdates:p.graphUpdates}:{}),...(p.cast ? {cast:p.cast.map(member=>({id:member.id,...Object.fromEntries(castFields.map(field=>[field,member[field]||'']))}))} : {}),...(typeof p.speakerId==='string' ? {speakerId:p.speakerId} : {}),...Object.fromEntries(extraFields.map(key=>[key,typeof p[key]==='string'?p[key]:''])),messages:p.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m,index)=>{const result={role:m.role,content:m.content,turnNumber:Number.isSafeInteger(m.turnNumber)&&m.turnNumber>0?m.turnNumber:index+1};if(m.excludeFromContext===true)result.excludeFromContext=true;const proposals=graphSuggestions(m.graphSuggestions);if(proposals.length)result.graphSuggestions=proposals;
if(m.role==='assistant'&&typeof m.speakerName==='string'&&typeof m.speakerId==='string')Object.assign(result,{speakerName:m.speakerName,speakerId:m.speakerId});if(m.role==='assistant' && Array.isArray(m.alternatives) && m.alternatives.length && m.alternatives.every(x=>typeof x==='string')){result.alternatives=m.alternatives.slice();result.selectedAlternative=Number.isInteger(m.selectedAlternative)&&m.selectedAlternative>=0&&m.selectedAlternative<result.alternatives.length?m.selectedAlternative:0;if(result.alternatives[result.selectedAlternative]!==m.content){result.alternatives.push(m.content);result.selectedAlternative=result.alternatives.length-1}}return result})}});if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error('Two stories have the same ID.');return {projects,activeId:projects.some(p=>p.id===data.activeId)?data.activeId:projects[0].id}}

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
  $('#providerDialog').showModal();
}
$('#providerButton').onclick = openConnection;
$('#closeProvider').onclick = $('#cancelProvider').onclick = () => $('#providerDialog').close();
$('#providerDialog').addEventListener('close', () => { $('#keyInput').value = ''; });
$('#providerForm').onsubmit = event => {
  event.preventDefault();
  {
    const model = modelChoice.value === 'custom' ? $('#modelInput').value.trim() : modelChoice.value;
    if (!isModelId(model)) {
      $('#modelError').textContent = modelChoice.value === 'custom'
        ? 'Enter a specific model ID in author/model format.'
        : 'Choose an OpenRouter model.';
      (modelChoice.value === 'custom' ? $('#modelInput') : modelChoice).focus();
      return;
    }
    if (!models.some(item => item.id === model)) customModelId = model;
    connection = {model, key:$('#keyInput').value.trim()};
  }
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
$('#pasteReply').onclick=()=>{$('#pasteText').value='';$('#pasteDialog').showModal()};$('#closePaste').onclick=$('#cancelPaste').onclick=()=>$('#pasteDialog').close();$('#pasteForm').onsubmit=e=>{e.preventDefault();const text=$('#pasteText').value.trim();if(!text)return;const project=current();appendTurn(project,{role:'assistant',content:text,...speakerMetadata(getSpeaker(project))});markDirty();$('#pasteDialog').close();renderMessages()};
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
      if (turn.role === 'assistant' && !turn.speakerId) Object.assign(turn, speakerMetadata(getSpeaker(project, primarySpeaker)));
    }
  }
  for (const key of settingsFields) project[key] = form.elements[key].value.trim();
  project.cast = cast;
  project.relationships = draftRelationships;
  project.graphUpdates = $('#graphUpdates').checked;
  for (const [index, turn] of project.messages.entries()) {
    if (!turn.graphSuggestions) continue;
    turn.graphSuggestions = turn.graphSuggestions.filter((_, proposal) => !pendingGraphReview.some(item => item.turn === index && item.index === proposal && item.status));
    if (!turn.graphSuggestions.length) delete turn.graphSuggestions;
  }
  project.speakerId = getSpeaker(project).id;
  captureGraphVersion(project, Math.max(nextTurnNumber(project)-1, project.graphHistory.at(-1)?.turn || 0));
  markDirty();
  $('#settingsDialog').close();
  render();
};
$('#settingsForm').elements.title.oninput = event => event.target.setCustomValidity('');
$('#closeEdit').onclick = $('#cancelEdit').onclick = () => $('#editDialog').close();
$('#editForm').onsubmit = event => {
  event.preventDefault();
  const message = current().messages[editingIndex];
  message.content = $('#editText').value;
  if ($('#excludeTurn').checked) message.excludeFromContext = true;
  else delete message.excludeFromContext;
  if (message.alternatives) message.alternatives[message.selectedAlternative] = message.content;
  markDirty();
  $('#editDialog').close();
  renderMessages();
};
$('#newProject').onclick=()=>{const p={id:id(),title:'Untitled story',character:'',persona:'',lore:'',notes:'',messages:[]};state.projects.unshift(p);state.activeId=p.id;markDirty();render();$('#sidebar').classList.remove('open');openSettings()};$('#deleteProject').onclick=()=>{if(state.projects.length===1){alert('Keep at least one story in your library.');return}if(!confirm(`Delete “${current().title}” and all its turns? This cannot be undone.`))return;state.projects=state.projects.filter(p=>p.id!==state.activeId);state.activeId=state.projects[0].id;markDirty();render()};$('#sendButton').onclick=()=>generate('send');$('#instruction').oninput=()=>{if(state)setSession(draftKey(current().id),$('#instruction').value)};$('#instruction').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();generate('send')}};
function promptForDraft() {
  const direction = $('#instruction').value.trim();
  const project = current();
  const provider = $('#sceneProvider').value;
  const queued = provider === 'mcp' && !direction ? project.agentRequest : null;
  const snapshot = queued ? {...project, speakerId:queued.speakerId,
    messages:queued.mode === 'alternate' ? project.messages.slice(0,-1) : project.messages} : project;
  return buildMessages(snapshot, direction, queued?.mode === 'alternate' ? 'alternate' : direction ? 'send' : 'continue', {
    maintainGraph: provider === 'mcp' && project.graphUpdates !== false, model: provider === 'openrouter' ? connection.model : ''
  });
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
  const body = JSON.stringify(state);
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
$('#importButton').onclick=()=>$('#importFile').click();$('#importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>16_000_000)throw Error('The library exceeds the 16 MB import limit.');const incoming=normalize(JSON.parse(await file.text()));if(!confirm('Replace your current library with this file? Export first if you want a backup.'))return;for(const project of [...state.projects,...incoming.projects]){setSession(draftKey(project.id),'');setSession(routeKey(project.id),'')}state=incoming;markDirty();render();error()}catch(err){alert(`Could not import: ${err.message}`)}finally{e.target.value=''}};$('#openMenu').onclick=()=>$('#sidebar').classList.add('open');$('#closeMenu').onclick=()=>$('#sidebar').classList.remove('open');
(async () => {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    revision = response.headers.get('etag');
    state = normalize(await response.json());
    render();
    status('Saved locally');
  } catch (e) {
    status('Could not load');
    error(`Couldn't open your stories: ${e.message}`);
  }
})();

// While a turn is queued, pick up agent writes without replacing unsaved work.
let checkingAgent = false;
setInterval(async () => {
  if (!state || !current().agentRequest || checkingAgent || dirty || pendingWrites || busy || document.querySelector('dialog[open]')) return;
  checkingAgent = true;
  try {
    const response = await fetch('/api/state', {headers:{'If-None-Match':revision}});
    if (response.status !== 200) return;
    const updated = normalize(await response.json());
    if (dirty || pendingWrites || busy || document.querySelector('dialog[open]')) return;
    revision = response.headers.get('etag');
    state = updated;
    render();
    status('Saved locally');
  } catch {
    // Keep the local state if the server is unavailable.
  } finally {
    checkingAgent = false;
  }
}, 2500);
