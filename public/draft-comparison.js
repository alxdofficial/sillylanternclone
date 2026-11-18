import { syncTakeSuggestions, validSensitivity } from './prompt.js';
import { manuscriptChapters } from './scene-board.js';

const checkpointLimit = 200;
const checkpointTextLimit = 2_000_000;
const checkpointNameLimit = 100;
const diffWorkLimit = 1_000_000;

function isCheckpoint(item) {
  return Boolean(item && typeof item.id === 'string' && /^[\w-]{1,100}$/u.test(item.id) &&
    typeof item.name === 'string' && item.name.trim() && item.name.length <= checkpointNameLimit &&
    Number.isSafeInteger(item.turn) && item.turn > 0 &&
    typeof item.content === 'string' && item.content.length <= checkpointTextLimit && item.content.trim() &&
    typeof item.savedAt === 'string' && item.savedAt.length <= 32 && Number.isFinite(Date.parse(item.savedAt)) &&
    (item.contentSensitivity === undefined || validSensitivity(item.contentSensitivity)) &&
    (item.excludeFromContext === undefined || item.excludeFromContext === true));
}

export function validDraftCheckpoints(value) {
  if (!Array.isArray(value) || value.length > checkpointLimit) return false;
  const ids = new Set();
  let total = 0;
  for (const item of value) {
    if (!isCheckpoint(item) || ids.has(item.id)) return false;
    total += item.content.length;
    if (total > checkpointTextLimit) return false;
    ids.add(item.id);
  }
  return true;
}

function proseScene({messages}, turn) {
  return messages.find((message,index)=>message.role === 'assistant' && (message.turnNumber || index + 1) === turn);
}

export function normalizeDraftCheckpoints(value) {
  if (!Array.isArray(value)) return [];
  const checkpoints = [], ids = new Set();
  let remaining = checkpointTextLimit;
  for (const item of value) {
    if (!isCheckpoint(item) || ids.has(item.id) || item.content.length > remaining) continue;
    const {id,name,turn,content,savedAt,contentSensitivity,excludeFromContext} = item;
    checkpoints.push({id,name:name.trim(),turn,content,savedAt,
      ...(contentSensitivity ? {contentSensitivity} : {}),
      ...(excludeFromContext ? {excludeFromContext} : {})});
    ids.add(id);
    remaining -= content.length;
    if (checkpoints.length === checkpointLimit) break;
  }
  return checkpoints;
}

export function checkpointScene(project, turn, name, {id = globalThis.crypto.randomUUID(),savedAt = new Date().toISOString()} = {}) {
  const scene = proseScene(project,turn);
  if (!scene?.content.trim()) throw new Error('Choose a scene with prose to save.');
  const label = name.trim();
  if (!label || label.length > checkpointNameLimit) throw new Error('Enter a name for the checkpoint.');
  const checkpoint = {id,name:label,turn,content:scene.content,savedAt,
    ...(scene.contentSensitivity ? {contentSensitivity:scene.contentSensitivity} : {}),
    ...(scene.excludeFromContext ? {excludeFromContext:true} : {})};
  const checkpoints = [...(project.draftCheckpoints || []),checkpoint];
  if (!validDraftCheckpoints(checkpoints)) throw new Error('This story has reached its checkpoint storage limit. Remove an older checkpoint first.');
  project.draftCheckpoints = checkpoints;
  return checkpoint;
}

function paragraphs(text) {
  const parts = [];
  let start = 0;
  const add = end=>{
    const raw = text.slice(start,end);
    const content = raw.trim();
    if (content) {
      const from = start + raw.indexOf(content);
      parts.push({blockStart:start,start:from,end:from + content.length,text:content});
    }
  };
  for (const separator of text.matchAll(/\r?\n(?:[\t ]*\r?\n)+/gu)) {
    add(separator.index);
    start = separator.index + separator[0].length;
  }
  add(text.length);
  return parts;
}

function matches(left,right) {
  const width = right.length + 1;
  const pairs = [];
  if (width * (left.length + 1) <= diffWorkLimit) {
    const scores = new Uint32Array(width * (left.length + 1));
    for (let l = left.length - 1; l >= 0; l--) for (let r = right.length - 1; r >= 0; r--) {
      const at = l * width + r;
      scores[at] = left[l].text === right[r].text ? 1 + scores[at + width + 1]
        : Math.max(scores[at + 1],scores[at + width]);
    }
    for (let l = 0,r = 0; l < left.length && r < right.length;) {
      const at = l * width + r;
      if (left[l].text === right[r].text) pairs.push([l++,r++]);
      else if (scores[at + 1] > scores[at + width]) r++;
      else l++;
    }
  } else {
    // Bound memory for a large imported scene while keeping exact text anchors.
    const positions = new Map();
    right.forEach(({text},index)=>{
      const indices = positions.get(text);
      if (indices) indices.push(index);
      else positions.set(text,[index]);
    });
    let next = 0;
    left.forEach(({text},index)=>{
      const indices = positions.get(text);
      if (!indices) return;
      let start = 0, end = indices.length;
      while (start < end) {
        const center = (start + end) >>> 1;
        if (indices[center] < next) start = center + 1;
        else end = center;
      }
      if (start < indices.length) {
        pairs.push([index,indices[start]]);
        next = indices[start] + 1;
      }
    });
  }
  return pairs;
}

export function compareDraftParagraphs(current, source) {
  const left = paragraphs(current), right = paragraphs(source), rows = [];
  const separator = current.includes('\r\n') ? '\r\n\r\n' : '\n\n';
  const anchors = matches(left,right);
  let l = 0, r = 0;
  for (const [nextLeft,nextRight] of [...anchors,[left.length,right.length]]) {
    while (l < nextLeft || r < nextRight) {
      const before = l < nextLeft ? left[l++] : undefined;
      const after = r < nextRight ? right[r++] : undefined;
      const insertion = left[l]?.blockStart ?? left.at(-1)?.end ?? 0;
      const change = after ? {
        start:before?.start ?? insertion,
        end:before?.end ?? insertion,
        text:before ? after.text : l < left.length ? after.text + separator
          : (left.length ? separator : '') + after.text
      } : undefined;
      rows.push({before:before?.text,after:after?.text,change});
    }
    if (l < left.length) rows.push({before:left[l++].text,after:right[r++].text,equal:true});
  }
  return rows;
}

export function restoreDraftText(project, turn, original, source, change) {
  const scene = proseScene(project,turn);
  if (!scene || scene.content !== original) throw new Error('The current scene changed. Reopen the comparison before restoring.');
  if (change && (!Number.isSafeInteger(change.start) || !Number.isSafeInteger(change.end) ||
    change.start < 0 || change.end < change.start || change.end > original.length || typeof change.text !== 'string')) {
    throw new Error('This paragraph is no longer available.');
  }
  const content = change ? original.slice(0,change.start) + change.text + original.slice(change.end) : source.content;
  if (!content.trim() || content === original) return false;

  const previous = Array.isArray(scene.alternatives) ? scene.alternatives.slice() : [original];
  const selected = Number.isInteger(scene.selectedAlternative) &&
    scene.alternatives?.[scene.selectedAlternative] === original ? scene.selectedAlternative : 0;
  if (previous[selected] !== original) previous.push(original);
  if (previous.length >= 5000) throw new Error('This scene has reached the take limit.');
  const originalIndex = previous[selected] === original ? selected : previous.length - 1;
  const sensitivities = previous.map((_,index)=>{
    if (index === originalIndex) return scene.contentSensitivity ?? null;
    const saved = scene.alternativeSensitivities?.[index];
    return saved === null || validSensitivity(saved) ? saved : 'unclassified';
  });
  const classification = scene.contentSensitivity === 'explicit' || source.contentSensitivity === 'explicit'
    ? 'explicit' : 'unclassified';

  scene.content = content;
  scene.alternatives = [...previous,content];
  scene.selectedAlternative = previous.length;
  scene.alternativeSensitivities = [...sensitivities,classification];
  scene.contentSensitivity = classification;
  if (source.excludeFromContext) scene.excludeFromContext = true;
  scene.continuityNeedsReview = true;
  delete scene.continuityPending;
  syncTakeSuggestions(scene);
  delete project.storyFlow;
  if (project.agentRequest?.replyTurnNumber === turn) delete project.agentRequest;
  if (project.agentNotice?.turnNumber === turn || project.agentNotice?.replyTurnNumber === turn) delete project.agentNotice;
  return true;
}

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, className = 'button subtle') {
  const node = element('button',label,className);
  node.type = 'button';
  return node;
}

function field(text, control, className = '') {
  const label = element('label','',className);
  label.append(element('span',text),control);
  return label;
}

function sceneChoices(project) {
  return manuscriptChapters(project).flat().map(({turn,number,content})=>{
    const preview = content.trim().replace(/\s+/gu,' ');
    return {turn,label:`Scene ${number} · ${preview.length > 52 ? preview.slice(0,51) + '…' : preview}`};
  });
}

export function createDraftComparison({dialog,getStory,getStories,canWrite = ()=>true,onChange = ()=>{}}) {
  const heading = element('h2','Compare drafts');
  heading.id = 'draftComparisonTitle';
  const close = button('Close','text-button');
  const header = element('header','','dialog-top');
  header.append(heading,close);
  close.onclick = ()=>dialog.close();

  const target = element('select'), leftDraft = element('select'), rightDraft = element('select');
  const leftBranch = element('select'), rightBranch = element('select');
  const leftBranchField = field('Scene in left story',leftBranch);
  const rightBranchField = field('Scene in right story',rightBranch);
  leftBranchField.hidden = rightBranchField.hidden = true;
  const controls = element('div','','draft-compare-controls');
  const drafts = element('div','','draft-compare-sources');
  const leftControls = element('div');
  const rightControls = element('div');
  leftControls.append(field('Left draft',leftDraft),leftBranchField);
  rightControls.append(field('Right draft',rightDraft),rightBranchField);
  drafts.append(leftControls,rightControls);
  controls.append(field('Manuscript scene',target),drafts);

  const checkpointName = element('input');
  checkpointName.type = 'text';
  checkpointName.maxLength = checkpointNameLimit;
  checkpointName.required = true;
  checkpointName.placeholder = 'e.g. Before the reveal';
  const checkpointSave = button('Save checkpoint');
  checkpointSave.type = 'submit';
  const checkpointForm = element('form','','draft-checkpoint');
  checkpointForm.append(field('Checkpoint name',checkpointName),checkpointSave);
  const checkpointPanel = element('details','','draft-checkpoint-panel');
  checkpointPanel.append(element('summary','Save a named checkpoint'),checkpointForm);

  const status = element('p','','draft-compare-status form-note');
  status.setAttribute('role','status');
  const summary = element('p','','draft-compare-count form-note');
  const restore = button('Restore right draft as new take','button primary');
  restore.title = 'Restore the comparison prose to the selected manuscript scene and keep its current prose as another take.';
  const remove = button('Remove checkpoint','text-button');
  const removeConfirm = button('Remove saved checkpoint','button danger');
  const removeCancel = button('Keep checkpoint','text-button');
  const removePrompt = element('div','','draft-checkpoint-remove');
  removePrompt.hidden = true;
  removePrompt.append(element('span','Remove the saved checkpoint?'),removeCancel,removeConfirm);
  const toolbar = element('div','','draft-compare-toolbar');
  toolbar.append(summary,remove,restore);
  const panes = element('div','','draft-compare-panes');
  const paneTitles = element('div','','draft-compare-row draft-compare-titles');
  const leftHeading = element('h3','Current prose'), rightHeading = element('h3','Comparison prose');
  paneTitles.append(leftHeading,rightHeading);
  const rows = element('div','','draft-compare-rows');
  panes.append(paneTitles,rows);
  dialog.append(header,controls,checkpointPanel,toolbar,removePrompt,status,panes);

  let storyId, choices, candidates;
  const itemLabel = saved=>`${saved.name}${saved.turn === Number(target.value) ? '' : ` · Turn ${saved.turn}`}`;
  function copySource(source) {
    const {content,contentSensitivity,excludeFromContext} = source;
    return {content,contentSensitivity,excludeFromContext};
  }

  function currentStory() {
    const project = getStory();
    return project?.id === storyId ? project : undefined;
  }

  function syncTarget(project, turn) {
    choices = sceneChoices(project);
    target.replaceChildren(...choices.map(option=>new Option(option.label,String(option.turn))));
    target.disabled = !choices.length;
    if (choices.length) target.value = String(choices.find(option=>option.turn === turn)?.turn ?? choices.at(-1).turn);
  }

  function syncCandidates(project, preference) {
    candidates = new Map();
    const previousLeft = leftDraft.value;
    rightDraft.replaceChildren(new Option('Choose a draft…',''));
    const addGroup = (name,items)=>{
      if (!items.length) return;
      const group = element('optgroup');
      group.label = name;
      for (const [key,label,entry] of items) {
        candidates.set(key,entry);
        group.append(new Option(label,key));
      }
      rightDraft.append(group);
    };
    const scene = proseScene(project,Number(target.value));
    const takes = (scene?.alternatives || []).flatMap((content,index)=>{
      if (index === (scene.selectedAlternative || 0) || !content.trim()) return [];
      return [[`take:${index}`,`Take ${index + 1}`,{kind:'take',content,
        contentSensitivity:scene.alternativeSensitivities?.[index] ?? undefined,excludeFromContext:scene.excludeFromContext}]];
    });
    addGroup('Other takes',takes);
    const checkpoints = [...(project.draftCheckpoints || [])].reverse()
      .sort((a,b)=>Number(b.turn === Number(target.value)) - Number(a.turn === Number(target.value)));
    addGroup('Named checkpoints',checkpoints.map(saved=>[`checkpoint:${saved.id}`,itemLabel(saved),{kind:'checkpoint',...saved}]));
    addGroup('Other stories and branches',getStories().filter(other=>other.id !== storyId && other.messages.some(message=>
      message.role === 'assistant' && message.content.trim())).map(other=>[`story:${other.id}`,other.title,{kind:'story',id:other.id}]));
    rightDraft.value = candidates.has(preference) ? preference : takes[0]?.[0] ||
      (checkpoints[0]?.turn === Number(target.value) ? `checkpoint:${checkpoints[0].id}` : '');
    rightDraft.disabled = !candidates.size;
    leftDraft.replaceChildren(new Option('Current prose','current'),
      ...[...rightDraft.querySelectorAll('optgroup')].map(group=>group.cloneNode(true)));
    leftDraft.value = candidates.has(previousLeft) ? previousLeft : 'current';
    leftDraft.disabled = !candidates.size;
  }

  function resolveComparison(draft, branch, branchField, choice, resetBranch) {
    const selected = candidates.get(draft.value);
    branchField.hidden = selected?.kind !== 'story';
    if (branchField.hidden) return selected;
    const previous = resetBranch ? undefined : Number(branch.value);
    const other = getStories().find(item=>item.id === selected.id);
    const options = other ? sceneChoices(other) : [];
    branch.replaceChildren(...options.map(option=>new Option(option.label,String(option.turn))));
    const initial = options.find(option=>option.turn === previous) || options.find(option=>option.turn === choice?.turn)
      || options[choices.indexOf(choice)] || options[0];
    if (initial) branch.value = String(initial.turn);
    return initial && proseScene(other,initial.turn);
  }

  function renderComparison({resetLeft = false,resetRight = false,scroll = true} = {}) {
    const project = currentStory();
    if (!project) return;
    const choice = choices.find(option=>option.turn === Number(target.value));
    const scene = choice && proseScene(project,choice.turn);
    const selected = candidates.get(rightDraft.value);
    const comparedLeft = resolveComparison(leftDraft,leftBranch,leftBranchField,choice,resetLeft);
    const comparedRight = resolveComparison(rightDraft,rightBranch,rightBranchField,choice,resetRight);
    const comparesCurrent = leftDraft.value === 'current';
    const baseline = comparesCurrent ? scene : comparedLeft;
    remove.hidden = selected?.kind !== 'checkpoint' || !canWrite();
    removePrompt.hidden = true;
    checkpointPanel.hidden = !scene || !canWrite();
    const writeable = Boolean(scene && canWrite());
    const previousText = scene?.content;
    const source = comparedRight && copySource(comparedRight);
    const changes = scene && source && previousText !== source.content;
    restore.hidden = !changes || !writeable;
    remove.onclick = ()=>{
      removePrompt.hidden = false;
      removeCancel.focus();
    };
    removeCancel.onclick = ()=>{
      removePrompt.hidden = true;
      remove.focus();
    };
    removeConfirm.onclick = ()=>{
      if (!canWrite() || currentStory() !== project) return;
      project.draftCheckpoints = project.draftCheckpoints.filter(item=>item.id !== selected.id);
      if (!project.draftCheckpoints.length) delete project.draftCheckpoints;
      onChange(project,{kind:'checkpoint',turn:choice.turn});
      resetSources('');
      status.textContent = 'Checkpoint removed.';
      rightDraft.focus();
    };

    function apply(change) {
      if (!canWrite() || currentStory() !== project) {
        status.textContent = 'Finish the active edit before restoring prose.';
        return;
      }
      try {
        if (!restoreDraftText(project,choice.turn,previousText,source,change)) return;
      } catch (failure) {
        status.textContent = failure.message;
        return;
      }
      onChange(project,{kind:'restore',turn:choice.turn});
      syncTarget(project,choice.turn);
      resetSources(undefined,false);
      status.textContent = 'Restored as a new take. Check this scene’s continuity before using it again.';
      status.tabIndex = -1;
      status.focus({preventScroll:true});
    }

    restore.onclick = ()=>apply();
    const pairs = baseline && source ? compareDraftParagraphs(baseline.content,source.content) : [];
    const changed = pairs.filter(pair=>!pair.equal).length;
    const difference = !changed ? baseline?.content === source?.content ? 'No differences.' : 'Only spacing differs.'
      : `${changed} changed ${changed === 1 ? 'paragraph' : 'paragraphs'}.`;
    summary.textContent = baseline && source ? difference + (!comparesCurrent && writeable ? ' Choose Current prose on the left to restore individual paragraphs.' : '')
      : scene ? 'Choose a saved checkpoint, take, or scene from another story.' : 'Add a scene to compare drafts.';
    leftHeading.textContent = leftDraft.selectedOptions[0]?.label || 'Current prose';
    rightHeading.textContent = rightDraft.selectedOptions[0]?.label || 'Comparison prose';
    panes.hidden = !pairs.length;
    const rowNodes = pairs.map(pair=>{
      const row = element('div','','draft-compare-row');
      const left = element('div','','draft-compare-cell');
      const right = element('div','','draft-compare-cell');
      if (!pair.equal) row.dataset.changed = '';
      left.append(element('p',pair.before ?? '', 'draft-compare-text'));
      right.append(element('p',pair.after ?? '', 'draft-compare-text'));
      if (pair.change && writeable && comparesCurrent) {
        const action = button(pair.before === undefined ? 'Insert paragraph' : 'Restore paragraph','text-button draft-restore-paragraph');
        action.onclick = ()=>apply(pair.change);
        right.append(action);
      }
      row.append(left,right);
      return row;
    });
    rows.replaceChildren(...rowNodes);
    if (scroll) panes.scrollTop = 0;
  }

  function resetSources(preference, scroll = true) {
    const project = currentStory();
    if (!project) return;
    syncCandidates(project,preference ?? rightDraft.value);
    renderComparison({resetLeft:scroll,resetRight:scroll,scroll});
  }

  target.onchange = ()=>{
    status.textContent = '';
    leftDraft.value = 'current';
    resetSources('');
  };
  leftDraft.onchange = ()=>{
    status.textContent = '';
    renderComparison({resetLeft:true});
  };
  rightDraft.onchange = ()=>{
    status.textContent = '';
    renderComparison({resetRight:true});
  };
  leftBranch.onchange = rightBranch.onchange = ()=>{
    status.textContent = '';
    renderComparison();
  };
  checkpointForm.onsubmit = event=>{
    event.preventDefault();
    const project = currentStory();
    if (!project || !canWrite()) return;
    try {
      const saved = checkpointScene(project,Number(target.value),checkpointName.value);
      onChange(project,{kind:'checkpoint',turn:saved.turn});
      checkpointName.value = '';
      checkpointPanel.open = false;
      resetSources(`checkpoint:${saved.id}`);
      status.textContent = 'Checkpoint saved.';
      rightDraft.focus();
    } catch (failure) {
      status.textContent = failure.message;
    }
  };

  function open(turn) {
    const project = getStory();
    if (!project || dialog.open) return;
    storyId = project.id;
    syncTarget(project,turn);
    checkpointPanel.open = false;
    checkpointName.value = '';
    status.textContent = '';
    leftDraft.value = 'current';
    resetSources('');
    dialog.showModal();
    (target.disabled ? close : target).focus();
  }

  return {open};
}
