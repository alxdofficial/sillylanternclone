import { buildMessages, formatMessages, extraFields } from './prompt.js';

import { models, chapterCost, isModelId } from './models.js';

const settingsFields = ['title', 'character', 'persona', 'lore', 'notes', ...extraFields];
const $ = s => document.querySelector(s);
let state, revision, pendingWrites = 0, timer, pendingSave = Promise.resolve(), dirty = false, busy = false, editingIndex = null;
let connection = {model:'',key:''};
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
function render(){const p=current();if(!p)return;$('#instruction').value=getSession(draftKey(p.id))||'';syncRoute();$('#storyTitle').textContent=p.title;$('#crumb').textContent=p.title;document.title=`${p.title} · Story Studio`;const list=$('#projectList');list.replaceChildren();state.projects.forEach(project=>{const b=el('button','project-item'+(project.id===p.id?' active':''),project.title);b.onclick=()=>{state.activeId=project.id;markDirty();error();render();$('#sidebar').classList.remove('open')};list.append(b)});const summary=$('#contextSummary');summary.replaceChildren();for(const [key,label] of [['character','Character'],['persona','Your persona'],['lore','World & lore'],['notes','Writing notes']]){const block=el('div','context-block');block.append(el('h3','',label),el('p','',p[key]?.trim()||'Not added yet.'));summary.append(block)}renderMessages()}
function renderMessages(){const p=current(), box=$('#messages');box.replaceChildren();if(!p.messages.length){const empty=el('div','empty');empty.append(el('div','empty-mark','\u2733'),el('strong','','Every story starts somewhere.'),el('p','','Set the scene below, or ask your co-writer to begin.'));box.append(empty);return}p.messages.forEach((m,index)=>{const row=el('article','message '+(m.role==='user'?'user':'assistant'));const avatar=el('div','avatar',m.role==='user'?'Y':'\u2733');avatar.setAttribute('aria-hidden','true');const body=el('div','message-body'), head=el('div','message-header');head.append(el('strong','',m.role==='user'?(p.personaName||'You'):(p.characterName||'Co-writer')));const actions=el('div','message-actions');const edit=el('button','','Edit');edit.onclick=()=>openEdit(index);const del=el('button','','Delete');del.onclick=()=>{if(!confirm('Delete this turn?'))return;p.messages.splice(index,1);markDirty();renderMessages()};actions.append(edit,del);if(m.role==='assistant'&&index===p.messages.length-1&&$('#sceneProvider').value!=='manual'){const retry=el('button','','Another take');retry.disabled=busy;retry.onclick=()=>generate('retry');actions.prepend(retry)}head.append(actions);body.append(head,el('div','message-text',m.content));if(m.role==='assistant' && m.alternatives?.length>1){const nav=el('div','alternatives');const prev=el('button','','← Previous');const count=el('span','',`${m.selectedAlternative+1} of ${m.alternatives.length} takes`);const next=el('button','','Next →');prev.disabled=busy||m.selectedAlternative===0;next.disabled=busy||m.selectedAlternative===m.alternatives.length-1;prev.onclick=()=>selectAlternative(m,m.selectedAlternative-1);next.onclick=()=>selectAlternative(m,m.selectedAlternative+1);nav.append(prev,count,next);body.append(nav)}row.append(avatar,body);box.append(row)});box.scrollTop=box.scrollHeight}
function selectAlternative(message,index){if(!message.alternatives || index<0 || index>=message.alternatives.length)return;message.selectedAlternative=index;message.content=message.alternatives[index];markDirty();renderMessages()}
function syncRoute() {
  const route = getSession(routeKey(current().id)) || 'codex';
  $('#sceneProvider').value = route;
  const usesOpenRouter = route === 'openrouter';
  $('#sceneModelControl').hidden = !usesOpenRouter;
  sceneModelChoice.disabled = busy;
  syncSceneModel();
  $('#routeSummary').textContent = usesOpenRouter
    ? connection.key ? '' : 'Add an API key in Connection'
    : route === 'manual' ? 'Copy prompt, then add the reply' : 'Uses your ChatGPT sign-in';
  $('#sceneProvider').disabled = busy;
  $('#sendButton').disabled = busy;
  $('#continueButton').disabled = busy || route === 'manual';
  $('#sendButton').textContent = busy ? 'Writing…' : route === 'manual' ? 'Save turn' : 'Send & write ↗';
}
function setBusy(value) {
  busy = value;
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

  const snapshot = {
    ...project,
    // The shared prompt builder looks at at most 60 turns. Retry removes one.
    messages: project.messages.slice(mode === 'retry' ? -61 : -60)
      .map(({role, content}) => ({role, content:content.trim().slice(0, 6000)}))
  };
  if (mode === 'retry') {
    if (snapshot.messages.at(-1)?.role !== 'assistant') return;
    snapshot.messages.pop();
  }
  if (mode === 'send') {
    project.messages.push({role:'user', content:direction});
    input.value = '';
    setSession(draftKey(project.id), '');
    markDirty();
    if (provider === 'manual') return renderMessages();
  }

  const originalHistory = JSON.stringify(project.messages);
  setBusy(true);
  try {
    const {text} = await api('/api/generate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        project:snapshot, instruction:direction, provider,
        mode: mode === 'retry' ? 'alternate' : mode,
        ...(provider === 'openrouter' ? connection : {})
      })
    });
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
      target.messages.push({role:'assistant', content:text.trim()});
    }
    markDirty();
  } catch (e) {
    error(`Couldn't write the next turn: ${e.message}`);
  } finally {
    setBusy(false);
    render();
  }
}
function openSettings() {
  const p = current(), form = $('#settingsForm');
  for (const key of settingsFields) form.elements[key].value = p[key] || '';
  $('#settingsDialog').showModal();
}
function openEdit(index){editingIndex=index;$('#editText').value=current().messages[index].content;$('#editDialog').showModal()}
function normalize(data){if(!data||!Array.isArray(data.projects)||!data.projects.length||data.projects.length>100)throw Error('This file does not contain a story library.');const projects=data.projects.map(p=>{if(!p||typeof p!=='object'||!Array.isArray(p.messages))throw Error('A story in this file is missing its turns.');if(p.messages.length>3000||p.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('The library has invalid or too many story turns.');return {id:typeof p.id==='string'?p.id:id(),title:String(p.title||'Untitled story'),character:String(p.character||''),persona:String(p.persona||''),lore:String(p.lore||''),notes:String(p.notes||''),...Object.fromEntries(extraFields.map(key=>[key,typeof p[key]==='string'?p[key]:''])),messages:p.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>{const result={role:m.role,content:m.content};if(m.role==='assistant' && Array.isArray(m.alternatives) && m.alternatives.length && m.alternatives.every(x=>typeof x==='string')){result.alternatives=m.alternatives.slice();result.selectedAlternative=Number.isInteger(m.selectedAlternative)&&m.selectedAlternative>=0&&m.selectedAlternative<result.alternatives.length?m.selectedAlternative:0;if(result.alternatives[result.selectedAlternative]!==m.content){result.alternatives.push(m.content);result.selectedAlternative=result.alternatives.length-1}}return result})}});if(new Set(projects.map(p=>p.id)).size!==projects.length)throw Error('Two stories have the same ID.');return {projects,activeId:projects.some(p=>p.id===data.activeId)?data.activeId:projects[0].id}}
function showProviderFields(){const isRouter=$('#providerSelect').value==='openrouter';$('#routerFields').hidden=!isRouter;$('#codexNote').hidden=isRouter;}
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

function openConnection(preferred) {
  $('#providerSelect').value = preferred === 'openrouter' ? 'openrouter' : 'codex';
  modelChoice.value = models.some(item => item.id === connection.model)
    ? connection.model : connection.model ? 'custom' : '';
  $('#modelInput').value = modelChoice.value === 'custom' ? connection.model : customModelId;
  showModelPrice();
  $('#modelError').textContent = '';
  $('#keyInput').value = connection.key;
  showProviderFields();
  $('#providerDialog').showModal();
}
$('#providerButton').onclick = () => openConnection($('#sceneProvider').value);
$('#providerSelect').onchange = showProviderFields;
$('#closeProvider').onclick = $('#cancelProvider').onclick = () => $('#providerDialog').close();
$('#providerDialog').addEventListener('close', () => { $('#keyInput').value = ''; });
$('#providerForm').onsubmit = event => {
  event.preventDefault();
  const route = $('#providerSelect').value;
  if (route === 'openrouter') {
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
  setSession(routeKey(current().id), route);
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
$('#pasteReply').onclick=()=>{$('#pasteText').value='';$('#pasteDialog').showModal()};$('#closePaste').onclick=$('#cancelPaste').onclick=()=>$('#pasteDialog').close();$('#pasteForm').onsubmit=e=>{e.preventDefault();const text=$('#pasteText').value.trim();if(!text)return;current().messages.push({role:'assistant',content:text});markDirty();$('#pasteDialog').close();renderMessages()};
// Character-card import fills the settings form only; saving remains an explicit action.
const cardTools=el('div','card-import');const cardButton=el('button','button subtle','Import character card JSON');cardButton.type='button';const cardInput=el('input');cardInput.type='file';cardInput.accept='.json,application/json';cardInput.hidden=true;const cardHint=el('p','form-note','Imports name, description, personality, scenario and example dialogue from V1/V2/V3 JSON cards. Greetings, lorebooks, images, extensions and other fields are not imported. Review before saving.');cardTools.append(cardButton,cardInput,cardHint);$('#settingsForm').insertBefore(cardTools,$('#settingsForm').querySelector('label'));cardButton.onclick=()=>cardInput.click();cardInput.onchange=async()=>{const file=cardInput.files[0];if(!file)return;try{if(file.size>2_000_000)throw Error('The card is too large (maximum 2 MB).');const raw=JSON.parse(await file.text());const data=raw?.data&&typeof raw.data==='object'?raw.data:raw;if(!data||typeof data!=='object'||Array.isArray(data))throw Error('This is not a supported character card.');const name=typeof data.name==='string'?data.name.trim():'';const fields=['description','personality','scenario','mes_example'];if(!name&&!fields.some(k=>typeof data[k]==='string'&&data[k].trim()))throw Error('No supported character fields found.');const form = $('#settingsForm');
for (const [field,key] of [['characterName','name'],['character','description'],['personality','personality'],['scenario','scenario'],['examples','mes_example']]) {
  form.elements[field].value = typeof data[key] === 'string' ? data[key].trim() : '';
}
cardHint.textContent = `Imported ${name || 'character'} into the form. Review and save. Greetings, attached lorebooks, images and extensions were skipped.`}catch(e){cardHint.textContent=`Could not import card: ${e.message}`}finally{cardInput.value=''}};
$('#settingsButton').onclick=$('#editContext').onclick=openSettings;$('#closeSettings').onclick=$('#cancelSettings').onclick=()=>$('#settingsDialog').close();$('#settingsForm').onsubmit=e=>{e.preventDefault();const p=current();if(!e.currentTarget.elements.title.value.trim())return;for(const key of settingsFields)p[key]=e.currentTarget.elements[key].value.trim();markDirty();$('#settingsDialog').close();render()};$('#closeEdit').onclick=$('#cancelEdit').onclick=()=>$('#editDialog').close();$('#editForm').onsubmit=e=>{e.preventDefault();const message=current().messages[editingIndex];message.content=$('#editText').value;if(message.alternatives)message.alternatives[message.selectedAlternative]=message.content;markDirty();$('#editDialog').close();renderMessages()};
$('#newProject').onclick=()=>{const p={id:id(),title:'Untitled story',character:'',persona:'',lore:'',notes:'',messages:[]};state.projects.unshift(p);state.activeId=p.id;markDirty();render();$('#sidebar').classList.remove('open');openSettings()};$('#deleteProject').onclick=()=>{if(state.projects.length===1){alert('Keep at least one story in your library.');return}if(!confirm(`Delete “${current().title}” and all its turns? This cannot be undone.`))return;state.projects=state.projects.filter(p=>p.id!==state.activeId);state.activeId=state.projects[0].id;markDirty();render()};$('#sendButton').onclick=()=>generate('send');$('#continueButton').onclick=()=>generate('continue');$('#instruction').oninput=()=>{if(state)setSession(draftKey(current().id),$('#instruction').value)};$('#instruction').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();generate('send')}};
function promptForDraft() {
  const direction = $('#instruction').value.trim();
  return buildMessages(current(), direction, direction ? 'send' : 'continue');
}
$('#promptPreview').onclick = () => {
  if (!state) return;
  $('#promptContents').textContent = formatMessages(promptForDraft());
  $('#promptDialog').showModal();
};
$('#closePrompt').onclick = () => $('#promptDialog').close();
$('#copyPrompt').onclick = async () => {
  if (!state) return;
  try {
    await navigator.clipboard.writeText(formatMessages(promptForDraft()));
    status('Prompt copied');
  } catch {
    $('#promptPreview').click();
    status('Select and copy the preview');
  }
};
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
