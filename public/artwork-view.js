import { starterStoryId } from './library.js';
import { sameValue } from './sync.js';

export const ARTWORK_DRAG_TYPE = 'application/x-studio-artwork';
export const ARTWORK_MAX_WORDS = 1200;
export const ARTWORK_MAX_CHARACTERS = 6000;
const maxRevisionNote = 300;

export function artworkPassageSize(text) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/u).length : 0;
  const characters = trimmed.length;
  return {words,characters,fits:words > 0 && words <= ARTWORK_MAX_WORDS && characters <= ARTWORK_MAX_CHARACTERS};
}

const subjectKinds = {character:'Character',location:'Location',object:'Object'};
const sceneKinds = {illustration:'Illustration',comic:'Comic'};
const sceneLabel = scene=>`Chapter ${scene.chapter} · Scene ${scene.number}`;
const suppliedModel = model=>typeof model === 'string' ? {id:model,label:model} : model;
const nameKey = value=>value.trim().toLocaleLowerCase().normalize('NFKC');

function element(tag,className,text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text,handler,className = 'text-button') {
  const control = element('button',className,text);
  control.type = 'button';
  control.onclick = handler;
  return control;
}

function labeled(name,control,field) {
  const block = element('div',field);
  const label = element('label','',name);
  label.htmlFor = control.id;
  block.append(label,control);
  return block;
}

function select(id,choices) {
  const control = element('select');
  control.id = id;
  setOptions(control,choices);
  return control;
}

function setOptions(control,choices) {
  if (control.options.length === choices.length &&
    choices.every(([key,label],index)=>control.options[index].value === key && control.options[index].text === label)) return;
  control.replaceChildren(...choices.map(([key,label])=>new Option(label,key)));
}

function textRef(scene,selection) {
  if (!scene) return undefined;
  if (selection) {
    const {turn,fingerprint,start,end} = selection;
    if (turn !== scene.turn || fingerprint !== scene.fingerprint || !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) || start < 0 || end <= start || end > scene.text.length) return undefined;
    return {turn,fingerprint,start,end};
  }
  return {turn:scene.turn,fingerprint:scene.fingerprint,start:0,end:scene.text.length};
}

function localImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value,document.baseURI);
    return url.origin === window.location.origin ? url.href : '';
  } catch {
    return '';
  }
}

export function createArtworkView({root,getStory,getScenes,getCurrentTurn,getModel,generate,update,onChooseModel}) {
  const stories = new Map();
  root.classList.add('artwork-view');
  const views = element('div','artwork-view-buttons');
  views.setAttribute('role','group');
  views.setAttribute('aria-label','Artwork views');
  const moodTab = button('Mood board',()=>switchView('mood'));
  moodTab.setAttribute('aria-controls','artworkGallery');
  const sceneTab = button('Scene art',()=>switchView('scene'));
  sceneTab.setAttribute('aria-controls','artworkGallery');
  views.append(moodTab,sceneTab);

  const subjectKind = select('artworkSubjectKind',Object.entries(subjectKinds));
  const subjectName = element('input');
  subjectName.id = 'artworkSubjectName';
  subjectName.required = true;
  subjectName.maxLength = 160;
  const subjectSuggestions = element('datalist');
  subjectSuggestions.id = 'artworkCastSuggestions';
  const generateReference = element('button','button primary','Generate reference');
  generateReference.type = 'submit';
  const mood = element('form','artwork-form');
  mood.id = 'artworkMoodForm';
  const moodFields = element('div','artwork-fields artwork-subject-fields');
  moodFields.append(labeled('Subject',subjectKind),labeled('Name',subjectName),subjectSuggestions);
  const subjectNote = element('p','artwork-source-note');
  subjectNote.setAttribute('role','status');
  mood.append(moodFields,subjectNote,generateReference);

  const targetScene = select('artworkScene',[]);
  const output = select('artworkSceneOutput',Object.entries(sceneKinds));
  const sceneFields = element('div','artwork-fields artwork-scene-fields');
  sceneFields.append(labeled('Scene',targetScene),labeled('Output',output));
  const sourceToggle = element('div','artwork-source-toggle');
  sourceToggle.setAttribute('role','group');
  sourceToggle.setAttribute('aria-label','Image source');
  const fullScene = button('Full scene',()=>switchSource('scene'));
  const selectedPassage = button('Selected passage',()=>switchSource('passage'));
  sourceToggle.append(fullScene,selectedPassage);
  const sourceNote = element('p','artwork-source-note');
  sourceNote.id = 'artworkSourceNote';
  sourceNote.setAttribute('role','status');
  sourceToggle.setAttribute('aria-describedby',sourceNote.id);
  const generateScene = element('button','button primary','Generate illustration');
  generateScene.type = 'submit';
  const sceneForm = element('form','artwork-form');
  sceneForm.id = 'artworkSceneForm';
  sceneForm.append(sceneFields,sourceToggle,sourceNote,generateScene);

  const modelNote = element('p','artwork-model-note');
  const progress = element('progress','artwork-progress');
  progress.setAttribute('aria-label','Generating artwork');
  progress.hidden = true;
  const status = element('p','artwork-status');
  status.setAttribute('role','status');
  const error = element('p','artwork-error');
  error.setAttribute('role','alert');
  const gallery = element('div','artwork-gallery');
  gallery.id = 'artworkGallery';
  root.replaceChildren(views,mood,sceneForm,modelNote,progress,status,error,gallery);

  function current() {
    const id = getStory()?.id;
    if (!id) return undefined;
    if (!stories.has(id)) stories.set(id,{
      id,view:'mood',subject:'character',name:'',kind:'illustration',source:'scene',entries:[]
    });
    return stories.get(id);
  }

  function activeScene(state,scenes) {
    if (state.turn !== undefined) {
      const chosen = scenes.find(scene=>scene.turn === state.turn);
      if (chosen) return chosen;
    }
    return scenes.find(scene=>scene.turn === getCurrentTurn()) || scenes.at(-1);
  }

  function sourceFor(state,scene) {
    if (!scene) return {note:'Write a scene to make an illustration or comic.'};
    if (scene.eligible === false) return {note:'This scene is excluded from model context.'};
    if (state.source === 'passage' && !state.selection) {
      return {note:'Select a passage in the manuscript and choose Create scene art.'};
    }
    const ref = textRef(scene,state.source === 'passage' ? state.selection : undefined);
    if (!ref) return {note:'This selection changed. Select the passage again in the manuscript.'};
    const text = scene.text.slice(ref.start,ref.end);
    const {words,characters,fits} = artworkPassageSize(text);
    if (!fits) return {note:words ? 'Image requests support up to 1,200 words and 6,000 characters. Select a shorter passage.'
      : 'Select a passage that contains prose.'};
    return {ref,note:`${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${characters.toLocaleString()} characters`};
  }

  function switchView(view) {
    const state = current();
    state.view = view;
    sync(state);
  }

  function switchSource(source) {
    const state = current();
    state.source = source;
    sync(state);
  }

  subjectKind.onchange = ()=>{
    const state = current();
    state.subject = subjectKind.value;
    sync(state);
  };
  subjectName.oninput = ()=>{
    const state = current();
    state.name = subjectName.value;
    syncForm(state,getScenes());
  };
  targetScene.onchange = ()=>{
    const state = current();
    state.turn = Number(targetScene.value) || undefined;
    if (state.selection?.turn !== state.turn) state.source = 'scene';
    sync(state);
  };
  output.onchange = ()=>{
    const state = current();
    state.kind = output.value;
    syncForm(state,getScenes());
  };

  function syncForm(state,scenes) {
    const model = suppliedModel(getModel());
    const scene = activeScene(state,scenes);
    const source = sourceFor(state,scene);
    const demo = state.id === starterStoryId;
    moodTab.setAttribute('aria-pressed',String(state.view === 'mood'));
    sceneTab.setAttribute('aria-pressed',String(state.view === 'scene'));
    mood.hidden = demo || state.view !== 'mood';
    sceneForm.hidden = demo || state.view !== 'scene';
    subjectKind.value = state.subject;
    if (subjectName.value !== state.name) subjectName.value = state.name;
    subjectName.placeholder = state.subject === 'character' ? 'Choose a cast member'
      : state.subject === 'location' ? 'Name a location' : 'Name an object';
    let subjectValid = Boolean(state.name.trim());
    let subjectHint = '';
    if (state.subject === 'character') {
      const names = [...new Set((getStory()?.cast || []).map(member=>member.name).filter(Boolean))];
      subjectValid = names.some(name=>nameKey(name) === nameKey(state.name));
      if (!names.length) subjectHint = 'Add a character to the cast or choose another subject.';
      else if (state.name.trim() && !subjectValid) subjectHint = 'Choose a character from this story’s cast.';
      if (names.join('\n') !== subjectSuggestions.dataset.names) {
        subjectSuggestions.replaceChildren(...names.map(name=>new Option(name)));
        subjectSuggestions.dataset.names = names.join('\n');
      }
      subjectName.setAttribute('list',subjectSuggestions.id);
    } else {
      subjectName.removeAttribute('list');
    }
    subjectNote.hidden = !subjectHint;
    if (subjectNote.textContent !== subjectHint) subjectNote.textContent = subjectHint;
    setOptions(targetScene,scenes.length ? scenes.map(item=>[String(item.turn),sceneLabel(item)]) : [['','No scenes yet']]);
    targetScene.value = scene ? String(scene.turn) : '';
    targetScene.disabled = !scenes.length;
    output.value = state.kind;
    fullScene.setAttribute('aria-pressed',String(state.source === 'scene'));
    selectedPassage.setAttribute('aria-pressed',String(state.source === 'passage'));
    if (sourceNote.textContent !== source.note) sourceNote.textContent = source.note;
    generateReference.disabled = demo || state.busy || !model?.id || !subjectValid;
    generateScene.disabled = demo || state.busy || !model?.id || !source.ref;
    generateScene.textContent = state.kind === 'comic' ? 'Generate comic' : 'Generate illustration';
    if (!demo && !model?.id && onChooseModel) {
      if (!modelNote.querySelector('button')) {
        modelNote.replaceChildren('Set up a planning model and an OpenRouter key in ',button('Settings',onChooseModel),'.');
      }
    } else {
      const note = demo ? 'Branch the demo to generate and arrange artwork for your own story.' : model?.id ? `Plans with ${model.label || model.id}`
        : 'Set up a planning model and an OpenRouter key in Settings.';
      if (modelNote.textContent !== note) modelNote.textContent = note;
    }
    progress.hidden = !state.generating;
    status.hidden = !state.status;
    status.toggleAttribute('data-activity',state.busy);
    if (status.textContent !== (state.status || '')) status.textContent = state.status || '';
    error.hidden = !state.error;
    if (error.textContent !== (state.error || '')) error.textContent = state.error || '';
  }

  async function perform(state,operation,working,done) {
    if (state.busy) return;
    state.busy = true;
    state.status = working;
    state.error = '';
    sync(state);
    try {
      const entries = await operation();
      if (Array.isArray(entries)) state.entries = entries;
      state.status = done;
      return true;
    } catch (failure) {
      state.status = '';
      state.error = failure?.message || 'Artwork could not be saved. Try again.';
      return false;
    } finally {
      state.busy = false;
      state.generating = false;
      if (current() === state) sync(state);
    }
  }

  function startGeneration(payload,working = 'Generating artwork…',done = 'Artwork is ready for review.') {
    const state = current();
    if (state.busy) return;
    state.generating = true;
    return perform(state,()=>generate(payload),working,done);
  }

  mood.onsubmit = event=>{
    event.preventDefault();
    const model = suppliedModel(getModel());
    if (generateReference.disabled || !model?.id) return;
    const state = current();
    void startGeneration({kind:'reference',subject:{kind:state.subject,name:state.name.trim()},model:model.id});
  };
  sceneForm.onsubmit = event=>{
    event.preventDefault();
    const model = suppliedModel(getModel());
    if (generateScene.disabled || !model?.id) return;
    const state = current();
    const {ref} = sourceFor(state,activeScene(state,getScenes()));
    if (ref) void startGeneration({kind:state.kind,ref,model:model.id});
  };

  function focusCard(id,selector) {
    const card = [...gallery.querySelectorAll('[data-artwork-id]')].find(item=>item.dataset.artworkId === id);
    (card?.querySelector(selector) || card || (current()?.view === 'mood' ? moodTab : sceneTab)).focus();
  }

  async function updateEntry(entry,action,turn,done) {
    const state = current();
    state.confirm = undefined;
    const successful = await perform(state,()=>update(entry.id,action,turn),'Saving artwork…',done);
    if (current() !== state) return;
    if (successful) state.inserting = undefined;
    sync(state);
    if (document.activeElement === document.body) focusCard(entry.id,state.inserting ? 'select' : 'button');
  }

  function picture(entry,state) {
    const frame = element('div','artwork-image-frame');
    const unavailable = element('p','artwork-unavailable','Image unavailable');
    const source = localImageUrl(entry.url);
    frame.append(unavailable);
    if (!source) return frame;
    unavailable.hidden = true;
    const link = element('a','artwork-image-link');
    link.href = source;
    link.target = '_blank';
    link.rel = 'noopener';
    link.draggable = false;
    link.setAttribute('aria-label',`Open ${entry.label || 'artwork'} in a new tab`);
    const image = element('img','artwork-thumbnail');
    image.src = source;
    image.alt = entry.label || 'Generated artwork';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = state.id !== starterStoryId && (entry.status === 'approved' || entry.status === 'pending');
    if (image.draggable) image.title = entry.status === 'pending' ? 'Drag into a scene to approve and insert' : 'Drag into a scene to place this image';
    image.ondragstart = event=>{
      if (!image.draggable || !event.dataTransfer) return;
      event.dataTransfer.clearData();
      event.dataTransfer.setData(ARTWORK_DRAG_TYPE,entry.id);
      event.dataTransfer.effectAllowed = 'move';
    };
    image.onerror = ()=>{
      link.hidden = true;
      unavailable.hidden = false;
    };
    link.append(image);
    frame.append(link);
    return frame;
  }

  function insertForm(entry,state,scenes) {
    const form = element('form','artwork-insert-form');
    const target = select(`artworkPlace-${entry.id}`,scenes.map(scene=>[String(scene.turn),sceneLabel(scene)]));
    target.value = String(state.placeTurn ?? entry.placedTurn ?? entry.sceneTurn ?? activeScene(state,scenes)?.turn);
    if (!target.value && scenes.length) target.value = String(scenes[0].turn);
    target.disabled = state.busy;
    target.onchange = ()=>{ state.placeTurn = Number(target.value); };
    const confirm = element('button','button primary',entry.status === 'pending' ? 'Approve and insert' : 'Insert');
    confirm.type = 'submit';
    confirm.disabled = state.busy || !scenes.length;
    const cancel = button('Cancel',()=>{
      state.inserting = undefined;
      sync(state);
      focusCard(entry.id,'[data-artwork-insert]');
    });
    form.append(labeled('Insert into',target),confirm,cancel);
    form.onsubmit = event=>{
      event.preventDefault();
      if (!confirm.disabled) void updateEntry(entry,'place',Number(target.value),'Artwork inserted into the scene.');
    };
    return form;
  }

  function revisionSource(entry,scenes) {
    if (entry.kind === 'reference') {
      const subject = entry.subject;
      if (!subject?.name || !Object.hasOwn(subjectKinds,subject.kind)) return {note:'This reference has no saved subject.'};
      if (subject.kind === 'character' && !getStory()?.cast?.some(member=>nameKey(member.name || '') === nameKey(subject.name))) {
        return {note:'This character is no longer in the cast.'};
      }
      return {payload:{kind:entry.kind,subject},note:`Uses the current story details for ${subject.name}.`};
    }
    const scene = scenes.find(item=>item.turn === entry.sceneTurn);
    if (!scene) return {note:'The source scene is no longer available.'};
    const exact = entry.passageRef && textRef(scene,entry.passageRef);
    const {ref,note} = sourceFor({source:exact ? 'passage' : 'scene',selection:exact},scene);
    if (!ref) return {note};
    return {payload:{kind:entry.kind,ref},note:`Uses ${exact ? 'the original passage from' : 'the current full text of'} ${sceneLabel(scene)}.`};
  }

  function revisionForm(entry,state,source,model) {
    const form = element('form','artwork-revision-form');
    const note = element('textarea');
    note.id = `artworkRevision-${entry.id}`;
    note.rows = 3;
    note.required = true;
    note.maxLength = maxRevisionNote;
    note.value = state.revisionNote;
    note.disabled = state.busy;
    note.placeholder = 'Make the dock darker and keep the logbook in view.';
    const sourceNote = element('p','artwork-source-note',source.note);
    sourceNote.id = `${note.id}-source`;
    note.setAttribute('aria-describedby',sourceNote.id);
    const submit = element('button','button primary','Generate new draft');
    submit.type = 'submit';
    function syncSubmit() {
      submit.disabled = state.busy || !model?.id || !source.payload || !note.value.trim();
    }
    syncSubmit();
    note.oninput = ()=>{
      state.revisionNote = note.value;
      syncSubmit();
    };
    const cancel = button('Cancel',()=>{
      state.revising = undefined;
      sync(state);
      focusCard(entry.id,'[data-artwork-revise]');
    });
    cancel.disabled = state.busy;
    form.append(labeled('What should change?',note),sourceNote,
      element('p','artwork-source-note','The new draft needs its own approval.'),submit,cancel);
    form.onsubmit = async event=>{
      event.preventDefault();
      if (submit.disabled || state.busy) return;
      const latest = state.entries.find(item=>item.id === entry.id);
      const latestSource = latest && revisionSource(latest,getScenes());
      const latestModel = suppliedModel(getModel());
      if (!sameValue(latestSource,source) || latestModel?.id !== model.id) {
        state.error = 'The source or model changed. Review it before trying again.';
        return sync(state);
      }
      const previous = new Set(state.entries.map(item=>item.id));
      const success = await startGeneration({...source.payload,model:model.id,style:note.value.trim()},
        'Generating a new draft…','New draft ready for review.');
      if (success) state.revising = undefined;
      if (current() !== state) return;
      sync(state);
      const draft = success && state.entries.findLast(item=>item.kind === entry.kind && !previous.has(item.id));
      if (document.activeElement === document.body) focusCard(draft?.id || entry.id,success ? 'button' : 'textarea');
    };
    return form;
  }

  function entryCard(entry,state,scenes,revision,model) {
    const card = element('li','artwork-card');
    card.dataset.artworkId = entry.id;
    card.tabIndex = -1;
    card.append(picture(entry,state));
    const details = element('div','artwork-card-details');
    details.append(element('h4','',entry.label || (entry.kind === 'reference' ? 'Reference' : sceneKinds[entry.kind] || 'Artwork')));
    const origin = scenes.find(scene=>scene.turn === entry.sceneTurn);
    const placed = scenes.find(scene=>scene.turn === entry.placedTurn);
    const metadata = [entry.subject?.kind ? subjectKinds[entry.subject.kind] : sceneKinds[entry.kind],
      origin ? sceneLabel(origin) : '',placed ? `In scene ${placed.number}` : ''].filter(Boolean);
    if (metadata.length) details.append(element('p','artwork-card-meta',metadata.join(' · ')));
    const badges = element('div','artwork-badges');
    const approved = entry.status === 'approved';
    const demo = state.id === starterStoryId;
    const badge = approved ? 'Approved' : demo ? 'Sample draft' : 'Needs approval';
    badges.append(element('span',approved ? 'artwork-badge artwork-approved' : 'artwork-badge',badge));
    if (entry.stale) badges.append(element('span','artwork-badge artwork-stale','Changed source'));
    details.append(badges);
    if (demo) {
      if (!approved) details.append(element('p','artwork-source-note','This sample is read-only. In your own story you can approve a draft or request changes.'));
      card.append(details);
      return card;
    }
    if (state.confirm === entry.id) {
      const group = element('div','artwork-card-actions');
      group.append(element('p','','Discard this image?'));
      const discard = button('Discard image',()=>void updateEntry(entry,'discard',undefined,'Artwork discarded.'),'button danger');
      const cancel = button('Cancel',()=>{
        state.confirm = undefined;
        sync(state);
        focusCard(entry.id,'[data-artwork-discard]');
      });
      group.append(discard,cancel);
      details.append(group);
    } else if (state.inserting === entry.id) {
      details.append(insertForm(entry,state,scenes));
    } else if (state.revising === entry.id) {
      details.append(revisionForm(entry,state,revision,model));
    } else {
      const actions = element('div','artwork-card-actions');
      if (!approved) {
        const approve = button('Approve',()=>void updateEntry(entry,'approve',undefined,'Artwork approved.'),'button subtle');
        approve.disabled = state.busy;
        actions.append(approve);
      }
      if (scenes.length) {
        const insert = button(!approved ? 'Approve and insert…' : placed ? 'Move to scene' : 'Insert in scene',()=>{
          state.revising = undefined;
          state.inserting = entry.id;
          state.placeTurn = undefined;
          sync(state);
          focusCard(entry.id,'select');
        });
        insert.dataset.artworkInsert = '';
        insert.disabled = state.busy;
        actions.append(insert);
        if (placed) {
          const remove = button('Remove from scene',()=>void updateEntry(entry,'unplace',undefined,'Artwork removed from the scene.'));
          remove.disabled = state.busy;
          actions.append(remove);
        }
      }
      const revise = button('Request changes',()=>{
        state.confirm = undefined;
        state.inserting = undefined;
        state.revising = entry.id;
        state.revisionNote = '';
        sync(state);
        focusCard(entry.id,'textarea');
      });
      revise.dataset.artworkRevise = '';
      revise.disabled = state.busy;
      actions.append(revise);
      const discard = button('Discard',()=>{
        state.revising = undefined;
        state.confirm = entry.id;
        sync(state);
        focusCard(entry.id,'.danger');
      });
      discard.dataset.artworkDiscard = '';
      discard.disabled = state.busy;
      actions.append(discard);
      details.append(actions);
    }
    card.append(details);
    return card;
  }

  let renderedGallery;
  function sync(state) {
    const scenes = getScenes();
    syncForm(state,scenes);
    const entries = state.entries.filter(item=>(item.kind === 'reference') === (state.view === 'mood')).reverse();
    const revising = entries.find(entry=>entry.id === state.revising);
    const revision = revising && revisionSource(revising,scenes);
    const model = revising && suppliedModel(getModel());
    const key = JSON.stringify([state.id,state.view,state.busy,state.confirm,state.inserting,state.revising,revision,model?.id,
      state.inserting ? activeScene(state,scenes)?.turn : undefined,entries,scenes.map(scene=>[scene.turn,scene.number,scene.chapter])]);
    if (renderedGallery === key) return;
    renderedGallery = key;
    const heading = element('h3','',state.view === 'mood' ? 'References' : 'Generated artwork');
    if (!entries.length) {
      const empty = state.id === starterStoryId ? 'No bundled artwork in this view.' : state.view === 'mood'
        ? 'Generate a visual reference to start the mood board.' : 'Generated illustrations and comics appear here for review.';
      gallery.replaceChildren(heading,element('p','artwork-empty',empty));
      return;
    }
    const list = element('ul','artwork-cards');
    for (const entry of entries) list.append(entryCard(entry,state,scenes,revision,model));
    gallery.replaceChildren(heading,list);
  }

  return {
    render(entries) {
      const state = current();
      if (!state) return;
      if (Array.isArray(entries)) state.entries = entries;
      sync(state);
    },
    setSelection(ref) {
      const state = current();
      if (!state) return;
      state.view = 'scene';
      state.source = 'passage';
      state.selection = ref;
      state.turn = ref?.turn;
      sync(state);
    }
  };
}
