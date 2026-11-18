import { compareDraftParagraphs } from './draft-comparison.js';
import { starterStoryId } from './library.js';
import { manuscriptChapters } from './scene-board.js';
import { sameValue } from './sync.js';

const stamp = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'medium'});
const storyFields = {title:'Title',premise:'Premise',lore:'World',notes:'Writing notes',cast:'Cast',
  relationships:'Relationships',plotEvents:'Plot events',revisionNotes:'Review notes',sceneBoard:'Scene board'};

export function changedScenes(before,after) {
  const scenes = project=>new Map(manuscriptChapters(project).flat().map(scene=>[scene.turn,scene]));
  const left = scenes(before), right = scenes(after);
  return [...new Set([...right.keys(),...left.keys()])].flatMap(turn=>{
    const first = left.get(turn), second = right.get(turn);
    const edited = first?.content !== second?.content;
    const moved = first && second && (first.chapter !== second.chapter || first.number !== second.number);
    if (!edited && !moved) return [];
    const scene = second || first;
    const change = !first ? 'Added' : !second ? 'Removed' : edited ? moved ? 'Edited and moved' : 'Edited' : 'Moved';
    return [{turn,first,second,change,label:`Chapter ${scene.chapter} · Scene ${scene.number} · ${change}`}];
  });
}

const node = (tag,className,text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};
const button = (text,run,className = 'text-button')=>{
  const control = node('button',className,text);
  control.type = 'button';
  control.onclick = run;
  return control;
};
const field = (label,control)=>{
  const wrapper = node('label','',label);
  wrapper.append(control);
  return wrapper;
};

export function appendProseDiff(target,before,after,{foldContext = false} = {}) {
  const rows = compareDraftParagraphs(before,after);
  const renderRow = pair=>{
    const block = node('div','history-diff-row');
    const cell = (text,mark,className)=>{
      const content = node('div',`history-diff-cell ${text && !pair.equal ? className : ''}`);
      const sign = node('span','history-diff-mark',text && !pair.equal ? mark : '');
      sign.setAttribute('aria-hidden','true');
      if (text && !pair.equal) content.append(node('span','sr-only',mark === '+' ? 'Added ' : 'Removed '));
      content.append(sign,node('p','',text));
      return content;
    };
    block.append(cell(pair.before,'−','history-removed'),cell(pair.after,'+','history-added'));
    return block;
  };
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    if (foldContext && rows[start].equal) {
      while (rows[end]?.equal) end++;
    }
    if (end - start < 5) {
      target.append(...rows.slice(start,end).map(renderRow));
    } else {
      const folded = rows.slice(start + 1,end - 1);
      const details = node('details','history-unchanged');
      details.append(node('summary','',`Show ${folded.length} unchanged paragraphs`),...folded.map(renderRow));
      target.append(renderRow(rows[start]),details,renderRow(rows[end - 1]));
    }
    start = end;
  }
}

export function createTimeMachine({root,getStory,readHistory,readVersion,restoreVersion,compareDrafts}) {
  const header = node('header','history-header');
  const versions = node('ol','history-versions');
  const rail = node('aside','history-rail');
  rail.append(node('h3','','Saved versions'),versions);
  const heading = node('h2','','Time Machine');
  heading.tabIndex = -1;
  header.append(heading,button('Compare scene drafts',()=>compareDrafts()));
  const main = node('section','history-work');
  const controlRow = node('div','history-controls');
  const left = node('select'), right = node('select');
  controlRow.append(field('Earlier version',left),field('Compare with',right));
  const status = node('p','form-note history-status');
  status.setAttribute('role','status');
  const compare = node('div','history-compare');
  const restore = button('Restore this version',()=>void restoreEarlier(),'button subtle');
  restore.classList.add('history-restore');
  restore.hidden = true;
  main.append(controlRow,restore,status,compare);
  const body = node('div','history-body');
  body.append(rail,main);
  root.replaceChildren(header,body);

  let projectId, request = 0, history = [], cached = new Map(), selectedTurn;
  const previousLabel = entry=>`${entry.label} · ${stamp.format(new Date(entry.createdAt))}`;
  function showStatus(message,loading = false) {
    status.textContent = message;
    status.hidden = !message;
    status.toggleAttribute('data-activity',loading);
  }

  function updateSelected() {
    for (const item of versions.querySelectorAll('button[data-version]')) {
      if (item.dataset.version === left.value) item.setAttribute('aria-current','true');
      else item.removeAttribute('aria-current');
    }
  }

  function renderOptions(previousHead) {
    const oldLeft = left.value, oldRight = right.value;
    const options = ()=>history.map(entry=>new Option(previousLabel(entry),entry.id));
    left.replaceChildren(...options());
    right.replaceChildren(...options());
    const followLatest = oldRight === previousHead && previousHead !== history[0]?.id;
    const latest = history[0]?.id || '';
    left.value = history.some(entry=>entry.id === oldLeft) && !(followLatest && oldLeft === oldRight)
      ? oldLeft : history[1]?.id || latest;
    right.value = history.some(entry=>entry.id === oldRight) && !followLatest ? oldRight : latest;
    left.disabled = right.disabled = !history.length;
    versions.replaceChildren(...history.map((entry,index)=>{
      const row = node('li');
      const item = button('',()=>{
        left.value = entry.id;
        void renderComparison();
      });
      item.dataset.version = entry.id;
      const label = node('span','',entry.label);
      if (index === 0) label.append(node('small','history-latest','Latest'));
      item.append(label,node('time','',stamp.format(new Date(entry.createdAt))));
      row.append(item);
      return row;
    }));
    updateSelected();
  }

  async function getVersion(id) {
    const copies = cached;
    if (!copies.has(id)) copies.set(id,await readVersion(projectId,id));
    return copies.get(id);
  }

  function renderScene(target,entry) {
    target.replaceChildren();
    if (!entry) return;
    const row = node('div','history-diff-titles');
    row.append(node('h3','','Earlier'),node('h3','','Comparison'));
    target.append(row);
    if (entry.first && entry.second && /moved/iu.test(entry.change)) {
      const place = scene=>`Chapter ${scene.chapter} · Scene ${scene.number}`;
      target.append(node('p','history-move form-note',`Moved from ${place(entry.first)} to ${place(entry.second)}.`));
    }
    if (entry.change !== 'Moved') appendProseDiff(target,entry.first?.content || '',entry.second?.content || '',{foldContext:true});
  }

  function renderDiff(before,after) {
    compare.replaceChildren();
    const scenes = changedScenes(before,after);
    const fields = Object.entries(storyFields).filter(([key])=>!sameValue(before[key],after[key]));
    compare.append(node('p','history-change-summary',scenes.length || fields.length
      ? [scenes.length ? `${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} changed` : '',fields.map(([,label])=>label).join(', ')].filter(Boolean).join(' · ')
      : 'No manuscript or story-state differences between these versions.'));
    if (scenes.length) {
      const scene = node('select');
      scene.append(...scenes.map(entry=>new Option(entry.label,String(entry.turn))));
      if (scenes.some(entry=>entry.turn === selectedTurn)) scene.value = String(selectedTurn);
      const target = node('div','history-diff');
      scene.onchange = ()=>{
        selectedTurn = Number(scene.value);
        renderScene(target,scenes.find(item=>item.turn === selectedTurn));
      };
      compare.append(field('Changed scene',scene),target);
      scene.onchange();
    }
    if (fields.length) {
      const changes = node('details','history-state-changes');
      changes.append(node('summary','','Story state changes'));
      for (const [key,label] of fields) {
        const value = snapshot=>typeof snapshot[key] === 'string' ? snapshot[key] : JSON.stringify(snapshot[key],null,2) || '';
        const row = node('div','history-diff-row');
        for (const [mark,snapshot,kind] of [['−',before,'removed'],['+',after,'added']]) {
          const cell = node('div',`history-diff-cell history-${kind}`);
          const text = value(snapshot);
          cell.append(node('span','history-diff-mark',mark),node('p','',text.length > 12000 ? text.slice(0,11999) + '…' : text || 'Empty'));
          row.append(cell);
        }
        changes.append(node('h4','',label),row);
      }
      compare.append(changes);
    }
    restore.hidden = projectId === starterStoryId || !left.value || left.value === history[0]?.id;
  }

  async function renderComparison() {
    const currentRequest = ++request;
    updateSelected();
    restore.hidden = true;
    compare.replaceChildren();
    const demo = projectId === starterStoryId;
    if (!history.length) {
      showStatus(demo ? 'This demo has no bundled versions.' : '');
      return;
    }
    if (history.length === 1) {
      showStatus(demo ? 'This demo has one read-only version.' : 'This is your first saved version. Future edits will appear here.');
      return;
    }
    showStatus('Loading comparison…',true);
    try {
      const [before,after] = await Promise.all([getVersion(left.value),getVersion(right.value)]);
      if (currentRequest !== request) return;
      showStatus(demo ? 'The demo’s saved versions are read-only.' : '');
      renderDiff(before,after);
    } catch (failure) {
      if (currentRequest === request) showStatus(failure.message);
    }
  }

  async function refresh() {
    const project = getStory();
    if (!project) return;
    if (projectId !== project.id) {
      projectId = project.id;
      cached = new Map();
      history = [];
      selectedTurn = undefined;
      compare.replaceChildren();
      restore.hidden = true;
      renderOptions();
    }
    const pending = ++request;
    showStatus('Loading saved versions…',true);
    try {
      const loaded = await readHistory(projectId);
      if (pending !== request) return;
      const previousHead = history[0]?.id;
      history = loaded;
      renderOptions(previousHead);
      await renderComparison();
    } catch (failure) {
      if (pending === request) showStatus(failure.message);
    }
  }

  async function restoreEarlier() {
    const entry = history.find(version=>version.id === left.value);
    if (projectId === starterStoryId || !entry) return;
    restore.disabled = true;
    try {
      if (await restoreVersion(projectId,entry)) {
        await refresh();
        showStatus('Restored as a new version. Later versions are still available.');
      }
    } catch (failure) {
      showStatus(failure.message);
    } finally {
      restore.disabled = false;
    }
  }

  left.onchange = right.onchange = ()=>void renderComparison();
  return {refresh};
}
