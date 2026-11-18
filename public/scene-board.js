const statuses = {draft:'Draft',revising:'Revising',ready:'Ready'};
const maxSummary = 180;
const maxPov = 160;
const validTurn = turn => Number.isSafeInteger(turn) && turn > 0;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validStatus = status => typeof status === 'string' && Object.hasOwn(statuses,status);
const oneLine = (value,limit) => typeof value === 'string' ? value.replace(/\s+/gu,' ').trim().slice(0,limit) : '';

function nativeChapters(project) {
  const chapters = [];
  for (const [index,message] of project.messages.entries()) {
    if (message.role !== 'assistant' || !message.content.trim()) continue;
    if (!chapters.length || message.startsChapter) chapters.push([]);
    chapters.at(-1).push({
      turn:validTurn(message.turnNumber) ? message.turnNumber : index + 1,
      content:message.content,
      storyTime:message.storyTime,
      sourcePrefix:message.sourcePrefix,
      startsChapter:message.startsChapter === true
    });
  }
  return chapters;
}

function cleanMetadata(value) {
  if (!record(value)) return {};
  const pov = oneLine(value.pov,maxPov), summary = oneLine(value.summary,maxSummary);
  const status = validStatus(value.status) && value.status !== 'draft' ? value.status : undefined;
  return {...(pov ? {pov} : {}),...(summary ? {summary} : {}),...(status ? {status} : {})};
}

export function validSceneBoard(value) {
  if (!record(value) || Object.keys(value).some(key=>key !== 'chapters' && key !== 'scenes')) return false;
  if (value.chapters !== undefined) {
    if (!Array.isArray(value.chapters)) return false;
    const seen = new Set();
    for (const chapter of value.chapters) {
      if (!Array.isArray(chapter) || !chapter.length) return false;
      for (const turn of chapter) {
        if (!validTurn(turn) || seen.has(turn)) return false;
        seen.add(turn);
      }
    }
  }
  return value.scenes === undefined || record(value.scenes) && Object.entries(value.scenes).every(([id,scene])=>
    validTurn(Number(id)) && String(Number(id)) === id && record(scene) &&
    Object.keys(scene).every(key=>key === 'pov' || key === 'summary' || key === 'status') &&
    (scene.pov === undefined || typeof scene.pov === 'string' && scene.pov.length <= maxPov) &&
    (scene.summary === undefined || typeof scene.summary === 'string' && scene.summary.length <= maxSummary) &&
    (scene.status === undefined || validStatus(scene.status)));
}

export function normalizeSceneBoard(project,value = project.sceneBoard) {
  if (!record(value)) return undefined;
  const native = nativeChapters(project);
  const turns = new Set(native.flatMap(chapter=>chapter.map(scene=>scene.turn)));
  const visited = new Set();
  const chapters = [];
  if (Array.isArray(value.chapters)) {
    for (const chapter of value.chapters) {
      if (!Array.isArray(chapter)) continue;
      const kept = [];
      for (const turn of chapter) {
        if (!turns.has(turn) || visited.has(turn)) continue;
        kept.push(turn);
        visited.add(turn);
      }
      if (kept.length) chapters.push(kept);
    }
  }
  const scenes = {};
  if (record(value.scenes)) {
    for (const [key,metadata] of Object.entries(value.scenes)) {
      if (!turns.has(Number(key)) || String(Number(key)) !== key) continue;
      const cleaned = cleanMetadata(metadata);
      if (Object.keys(cleaned).length) scenes[key] = cleaned;
    }
  }
  const nativeOrder = chapters.length === native.length && chapters.every((chapter,index)=>
    chapter.length === native[index].length && chapter.every((turn,position)=>turn === native[index][position].turn));
  const result = {...(chapters.length && !nativeOrder ? {chapters} : {}),...(Object.keys(scenes).length ? {scenes} : {})};
  return Object.keys(result).length ? result : undefined;
}

function editorialChapters(native,placed) {
  if (!Array.isArray(placed) || !placed.length) return native;
  const scenes = native.flat();
  const remaining = new Map(scenes.map(scene=>[scene.turn,scene]));
  if (remaining.size !== scenes.length) return native;
  const chapters = [];
  for (const chapter of placed) {
    if (!Array.isArray(chapter)) continue;
    const slots = [];
    for (const turn of chapter) {
      if (!remaining.has(turn)) continue;
      slots.push(remaining.get(turn));
      remaining.delete(turn);
    }
    if (slots.length) chapters.push(slots);
  }
  if (!chapters.length) return native;
  // New prose remains discoverable in the manuscript after earlier scenes are reordered.
  for (const scene of remaining.values()) {
    if (scene.startsChapter) chapters.push([]);
    chapters.at(-1).push(scene);
  }
  return chapters;
}

export function manuscriptChapters(project) {
  const chapters = editorialChapters(nativeChapters(project),project.sceneBoard?.chapters);
  let number = 0;
  return chapters.map((chapter,index)=>chapter.map(scene=>({
    ...scene,
    ...cleanMetadata(project.sceneBoard?.scenes?.[scene.turn]),
    number:++number,
    chapter:index + 1
  })));
}

export function readingChapters(project) {
  return manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.content));
}

export function readingChapterBreak(project,turn) {
  const chapters = manuscriptChapters(project);
  if (chapters[0]?.[0]?.turn === turn || !chapters.some(chapter=>chapter.some(scene=>scene.turn === turn))) return null;
  return chapters.some(chapter=>chapter[0].turn === turn);
}

function saveChapterOrder(project,chapters) {
  return normalizeSceneBoard(project,{...project.sceneBoard,chapters});
}

export function toggleReadingChapter(project,turn) {
  const chapters = manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn));
  const chapter = chapters.findIndex(scenes=>scenes.includes(turn));
  if (chapter === -1 || chapters[0]?.[0] === turn) return normalizeSceneBoard(project);
  const position = chapters[chapter].indexOf(turn);
  if (position) chapters.splice(chapter + 1,0,chapters[chapter].splice(position));
  else chapters[chapter - 1].push(...chapters.splice(chapter,1)[0]);
  return saveChapterOrder(project,chapters);
}

export function moveManuscriptScene(project,turn,{chapter,beforeTurn} = {}) {
  const chapters = manuscriptChapters(project).map(scenes=>scenes.map(scene=>scene.turn));
  const source = chapters.find(scenes=>scenes.includes(turn));
  const target = chapters[chapter - 1];
  if (!source || !target || beforeTurn === turn || beforeTurn !== undefined && !target.includes(beforeTurn)) {
    return normalizeSceneBoard(project);
  }
  source.splice(source.indexOf(turn),1);
  target.splice(beforeTurn === undefined ? target.length : target.indexOf(beforeTurn),0,turn);
  return saveChapterOrder(project,chapters);
}

function withMetadata(project,turn,metadata) {
  return normalizeSceneBoard(project,{...project.sceneBoard,scenes:{...project.sceneBoard?.scenes,[turn]:metadata}});
}

function scenePreview(content) {
  const text = oneLine(content,maxSummary + 1);
  if (text.length <= maxSummary) return text;
  const prefix = text.slice(0,maxSummary - 1).replace(/[\uD800-\uDBFF]$/u,'');
  const boundary = prefix.lastIndexOf(' ');
  return (boundary > maxSummary * .55 ? prefix.slice(0,boundary) : prefix).trimEnd() + '…';
}

const allPointsOfView = '';
const missingPointOfView = 'unassigned';

function node(tag,className,text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function action(text,run,className = 'text-button') {
  const button = node('button',className,text);
  button.type = 'button';
  button.onclick = run;
  return button;
}

function glyph(path) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('class','tool-mark');
  svg.setAttribute('aria-hidden','true');
  const drawing = document.createElementNS(namespace,'path');
  drawing.setAttribute('d',path);
  svg.append(drawing);
  return svg;
}

function reorderButton(scene,earlier,run) {
  const label = `Move scene ${scene.number} ${earlier ? 'earlier' : 'later'}`;
  const button = action('',run,'icon scene-board-move');
  button.dataset.sceneBoardFocus = earlier ? 'earlier' : 'later';
  button.setAttribute('aria-label',label);
  button.title = label;
  button.append(glyph(earlier ? 'm6 14 6-6 6 6' : 'm6 10 6 6 6-6'));
  return button;
}

export function createSceneBoard({root,getStory,onSave,onOpenScene}) {
  root.classList.add('scene-board');
  const stories = new Map();
  const heading = node('h2','','Scene board');
  const total = node('p','scene-board-count');
  const title = node('div','scene-board-title');
  title.append(heading,total);
  const header = node('header','scene-board-header');
  const order = node('div','scene-board-order');
  order.setAttribute('role','group');
  order.setAttribute('aria-label','Scene order');
  const reading = action('Reading order',()=>selectOrder('reading'));
  const chronology = action('Story time',()=>selectOrder('chronology'));
  order.append(reading,chronology);
  const filter = node('select');
  filter.id = 'scene-board-pov-filter';
  const filterLabel = node('label','','POV');
  filterLabel.htmlFor = filter.id;
  const filterField = node('div','scene-board-filter');
  filterField.append(filterLabel,filter);
  const controls = node('div','scene-board-controls');
  controls.append(order,filterField);
  const instructions = node('p','scene-board-instructions');
  const announcement = node('span','sr-only');
  announcement.setAttribute('role','status');
  const lanes = node('div','scene-board-lanes');
  header.append(title,controls);
  root.replaceChildren(header,instructions,announcement,lanes);
  filter.onchange = ()=>{
    ui().pov = filter.value;
    render();
  };
  let dragged, dropTarget;

  function ui() {
    const id = getStory().id;
    if (!stories.has(id)) stories.set(id,{order:'reading',pov:allPointsOfView,drafts:new Map()});
    return stories.get(id);
  }

  function selectOrder(next) {
    ui().order = next;
    render();
  }

  function focus(turn,control = 'open') {
    const card = lanes.querySelector(`[data-scene-board-turn="${turn}"]`);
    const desired = card?.querySelector(`[data-scene-board-focus="${control}"]`);
    (desired && !desired.disabled ? desired : card?.querySelector('[data-scene-board-focus="open"]') || filter).focus();
  }

  function commit(board,turn,control,message) {
    onSave(board);
    render();
    focus(turn,control);
    announcement.textContent = message;
  }

  function move(turn,destination,control) {
    const project = getStory();
    const board = moveManuscriptScene(project,turn,destination);
    const changed = manuscriptChapters({...project,sceneBoard:board}).flat().find(scene=>scene.turn === turn);
    if (!changed) return;
    commit(board,turn,control,`Scene moved to chapter ${changed.chapter}, position ${changed.number} in the manuscript.`);
  }

  function metadataForm(scene,chapters) {
    const state = ui();
    const draft = state.drafts.get(scene.turn) || {summary:scene.summary || '',pov:scene.pov || '',status:scene.status || 'draft'};
    state.drafts.set(scene.turn,draft);
    const form = node('form','scene-board-editor');
    const summary = node('input');
    summary.type = 'text';
    summary.maxLength = maxSummary;
    summary.value = draft.summary;
    summary.placeholder = 'What changes in this scene?';
    summary.dataset.sceneBoardFocus = 'summary';
    const pov = node('input');
    pov.type = 'text';
    pov.maxLength = maxPov;
    pov.value = draft.pov;
    pov.placeholder = 'Point-of-view character';
    pov.setAttribute('list','scene-board-pov-options');
    pov.dataset.sceneBoardFocus = 'pov';
    const people = node('datalist');
    people.id = 'scene-board-pov-options';
    people.append(...[...new Set((getStory().cast || []).map(member=>member.name?.trim()).filter(Boolean))]
      .map(name=>new Option(name)));
    const status = node('select');
    status.append(...Object.entries(statuses).map(([value,label])=>new Option(label,value)));
    status.value = draft.status;
    status.dataset.sceneBoardFocus = 'status';
    const fields = node('div','scene-board-fields');
    for (const [label,name,input] of [['One-line summary','summary',summary],['POV','pov',pov],['Status','status',status]]) {
      const field = node('div',`scene-board-field-${name}`);
      input.id = `scene-board-${name}`;
      const caption = node('label','',label);
      caption.htmlFor = input.id;
      field.append(caption,input);
      input.oninput = ()=>{ draft[name] = input.value; };
      fields.append(field);
    }
    const controls = node('div','scene-board-editor-actions');
    const save = node('button','button primary','Save scene details');
    save.type = 'submit';
    controls.append(action('Cancel',()=>{
      state.drafts.delete(scene.turn);
      state.editing = undefined;
      render();
      focus(scene.turn,'edit');
    }),save);
    form.append(fields,people,controls);
    if (state.order === 'reading' && (chapters.length > 1 || scene.number > 1)) {
      const target = node('div','scene-board-chapter-move');
      if (chapters.length > 1) {
        const chapter = node('select');
        chapter.setAttribute('aria-label',`Move scene ${scene.number} to another chapter`);
        chapter.append(...chapters.map((_,index)=>new Option(`Chapter ${index + 1}`,String(index + 1))));
        chapter.value = String(scene.chapter);
        const moveAction = action('Move to chapter',()=>move(scene.turn,{chapter:Number(chapter.value)},'summary'),'button');
        moveAction.disabled = true;
        chapter.onchange = ()=>{ moveAction.disabled = Number(chapter.value) === scene.chapter; };
        target.append(chapter,moveAction);
      }
      if (scene.number > 1) {
        const startsHere = chapters[scene.chapter - 1][0].turn === scene.turn;
        target.append(action(startsHere ? 'Join previous chapter' : 'Start chapter here',()=>{
          commit(toggleReadingChapter(getStory(),scene.turn),scene.turn,'summary',
            startsHere ? 'Joined the previous chapter.' : 'New chapter started.');
        }));
      }
      form.append(target);
    }
    form.onsubmit = event=>{
      event.preventDefault();
      state.drafts.delete(scene.turn);
      state.editing = undefined;
      commit(withMetadata(getStory(),scene.turn,draft),scene.turn,'edit','Scene details saved.');
    };
    return form;
  }

  function moveRelative(scene,step,all,chapters) {
    const adjacent = all[scene.number - 1 + step];
    if (!adjacent) return;
    const destination = chapters[adjacent.chapter - 1];
    const beforeTurn = step < 0 ? adjacent.turn : destination[destination.indexOf(adjacent) + 1]?.turn;
    move(scene.turn,{chapter:adjacent.chapter,beforeTurn},step < 0 ? 'earlier' : 'later');
  }

  function card(scene,all,chapters,last) {
    const state = ui();
    const item = node('li','scene-board-card');
    item.dataset.sceneBoardTurn = String(scene.turn);
    const top = node('div','scene-board-card-heading');
    const open = action(`Scene ${scene.number}`,()=>onOpenScene(scene.turn));
    open.classList.add('scene-board-open');
    open.dataset.sceneBoardFocus = 'open';
    const status = node('span','scene-board-status',statuses[scene.status || 'draft']);
    status.dataset.status = scene.status || 'draft';
    top.append(open,status);
    if (state.order === 'reading' && all.length > 1) {
      const grip = node('span','scene-board-grip');
      grip.draggable = true;
      grip.title = 'Drag to move this scene';
      grip.setAttribute('aria-hidden','true');
      grip.append(glyph('M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01'));
      grip.ondragstart = event=>{
        dragged = {id:getStory().id,turn:scene.turn};
        item.dataset.dragging = '';
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain',String(scene.turn));
        event.dataTransfer.setDragImage?.(item,24,20);
      };
      grip.ondragend = clearDrag;
      top.prepend(grip);
      item.ondragover = event=>{
        if (!dragged || dragged.turn === scene.turn) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(item,dropAfter(event,item) ? 'after' : 'before');
      };
      item.ondrop = event=>{
        if (!dragged || dragged.turn === scene.turn) return;
        event.preventDefault();
        event.stopPropagation();
        const after = dropAfter(event,item);
        const next = chapters[scene.chapter - 1][chapters[scene.chapter - 1].indexOf(scene) + 1]?.turn;
        finishDrop({chapter:scene.chapter,beforeTurn:after ? next : scene.turn});
      };
    }
    const synopsis = node('p',scene.summary ? 'scene-board-summary' : 'scene-board-excerpt',scene.summary || scenePreview(scene.content));
    if (!scene.summary) synopsis.title = 'Opening of the scene';
    const details = node('div','scene-board-card-details');
    if (scene.pov) details.append(node('span','',scene.pov));
    if (scene.storyTime) {
      const time = node('time','',scene.storyTime.replace('T',' · '));
      time.dateTime = scene.storyTime;
      details.append(time);
    }
    const footer = node('div','scene-board-card-footer');
    const edit = action(state.editing === scene.turn ? 'Editing' : 'Edit details',()=>{
      state.editing = scene.turn;
      render();
      focus(scene.turn,'summary');
    });
    edit.dataset.sceneBoardFocus = 'edit';
    edit.setAttribute('aria-label',`Edit details for scene ${scene.number}`);
    edit.disabled = state.editing === scene.turn;
    footer.append(edit);
    if (state.order === 'reading') {
      const group = node('div','scene-board-moves');
      const earlier = reorderButton(scene,true,()=>moveRelative(scene,-1,all,chapters));
      const later = reorderButton(scene,false,()=>moveRelative(scene,1,all,chapters));
      earlier.disabled = scene.number === 1;
      later.disabled = scene.number === last;
      group.append(earlier,later);
      footer.append(group);
    }
    item.append(top,synopsis);
    if (details.childElementCount) item.append(details);
    item.append(footer);
    if (state.editing === scene.turn) item.append(metadataForm(scene,chapters));
    return item;
  }

  function dropAfter(event,item) {
    const {top,height} = item.getBoundingClientRect();
    return event.clientY >= top + height / 2;
  }

  function setDropTarget(element,position) {
    if (dropTarget && dropTarget !== element) delete dropTarget.dataset.dropPosition;
    dropTarget = element;
    element.dataset.dropPosition = position;
  }

  function clearDrag() {
    lanes.querySelector('[data-dragging]')?.removeAttribute('data-dragging');
    if (dropTarget) delete dropTarget.dataset.dropPosition;
    dropTarget = undefined;
    dragged = undefined;
  }

  function finishDrop(destination) {
    const source = dragged;
    clearDrag();
    if (source?.id === getStory().id) move(source.turn,destination,'open');
  }

  function render() {
    const state = ui();
    const chapters = manuscriptChapters(getStory());
    const all = chapters.flat();
    const pointsOfView = [...new Set(all.map(scene=>scene.pov).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const povOptions = [[allPointsOfView,'All viewpoints']];
    if (all.some(scene=>!scene.pov)) povOptions.push([missingPointOfView,'Unassigned']);
    // Prefix values to keep authored text distinct from the built-in Unassigned option.
    povOptions.push(...pointsOfView.map(pov=>[`pov:${pov}`,pov]));
    if (!povOptions.some(([value])=>value === state.pov)) state.pov = allPointsOfView;
    filter.replaceChildren(...povOptions.map(([value,label])=>new Option(label,value)));
    filter.value = state.pov;
    filter.disabled = !all.length;
    reading.setAttribute('aria-pressed',String(state.order === 'reading'));
    chronology.setAttribute('aria-pressed',String(state.order === 'chronology'));
    total.textContent = `${all.length} ${all.length === 1 ? 'scene' : 'scenes'} · ${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}`;
    if (state.order === 'reading') instructions.replaceChildren(
      node('span','scene-board-drag-instructions','Drag scenes or use the arrows to change their reading order.'),
      node('span','scene-board-touch-instructions','Use the arrows to change the reading order.')
    );
    else instructions.textContent = 'Scenes are sorted by story time, with undated scenes last.';
    instructions.hidden = !all.length;
    const visible = scene=>!state.pov || (scene.pov ? `pov:${scene.pov}` : missingPointOfView) === state.pov;
    const chronological = state.order === 'chronology';
    const chronologically = [...all].sort((a,b)=>a.storyTime && b.storyTime ? a.storyTime.localeCompare(b.storyTime)
      : Number(Boolean(b.storyTime)) - Number(Boolean(a.storyTime)));
    const groups = chronological ? [chronologically] : chapters;
    const active = document.activeElement;
    const focusedTurn = Number(active?.closest('[data-scene-board-turn]')?.dataset.sceneBoardTurn);
    const focusedControl = active?.dataset.sceneBoardFocus;
    const selection = active?.tagName === 'INPUT' && focusedControl ? [active.selectionStart,active.selectionEnd] : undefined;
    const horizontal = lanes.scrollLeft;
    lanes.classList.toggle('scene-board-by-time',chronological);
    lanes.replaceChildren(...groups.map((chapter,index)=>{
      const lane = node('section','scene-board-chapter');
      if (!chronological) {
        const label = node('h3','',`Chapter ${index + 1}`);
        lane.append(label);
        lane.ondragover = event=>{
          if (!dragged) return;
          event.preventDefault();
          setDropTarget(lane,'end');
        };
        lane.ondrop = event=>{
          if (!dragged) return;
          event.preventDefault();
          finishDrop({chapter:index + 1});
        };
      }
      const list = node('ol','scene-board-cards');
      list.append(...chapter.filter(visible).map(scene=>card(scene,all,chapters,all.length)));
      if (!list.childElementCount) list.append(node('li','scene-board-empty-lane','No scenes match this POV.'));
      lane.append(list);
      return lane;
    }));
    if (!all.length) lanes.replaceChildren(node('p','scene-board-empty','Write or import a scene to start arranging the manuscript.'));
    lanes.scrollLeft = horizontal;
    if (focusedTurn && focusedControl) {
      focus(focusedTurn,focusedControl);
      if (selection) document.activeElement?.setSelectionRange?.(...selection);
    }
  }

  return {render};
}
