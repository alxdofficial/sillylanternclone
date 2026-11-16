import { continuityChecks, motifOccurrences, normalizeRevisionNotes, pacingRows, reference, resolveReference, sceneIndex, selectScenes } from './revision.js';

const $ = id => document.getElementById(id);
function el(tag,text,cls) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text,action) {
  const node = el('button',text,'text-button');
  node.type = 'button';
  node.onclick = action;
  return node;
}
const threadTitle = text => text.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
const sceneLabel = scene => `Chapter ${scene.chapter} · Scene ${scene.number}`;
const empty = text => el('p',text,'form-note');

function options(select, choices) {
  const selected = select.value;
  select.replaceChildren(...choices.map(([value,label])=>new Option(label,value)));
  if (choices.some(([value])=>String(value) === selected)) select.value = selected;
}

function scopeOptions(scenes) {
  return [['book','Whole book'],
    ...[...new Set(scenes.map(scene=>scene.chapter))].map(chapter=>['chapter:' + chapter,'Chapter ' + chapter]),
    ...scenes.map(scene=>['scene:' + scene.turn,sceneLabel(scene)])];
}

export function createRevisionViews({activeStory,stories,writeNotes,openScene,requestReview}) {
  const dialog = $('continuityReview');
  const view = $('revisionView');
  let owner, scenes = [], notes = [], mode = 'pacing', selectedTurn, editing, term = '';
  let themeFindings, threadFindings, continuityFindings, pending;
  const shelfButtons = ['reviewThemes','reviewThreads','reviewContinuity'];
  let comparisonScenes = new Map();

  function refresh() {
    const project = activeStory();
    if (owner !== project.id) {
      owner = project.id;
      selectedTurn = editing = themeFindings = threadFindings = continuityFindings = undefined;
      term = $('themeQuery').value = $('continuityReference').value = '';
      $('revisionScope').value = $('continuityScope').value = $('continuityComparison').value = 'book';
      resetThread();
    }
    scenes = sceneIndex(project);
    notes = normalizeRevisionNotes(project.revisionNotes);
    comparisonScenes = new Map();
    return project;
  }

  function find(ref) {
    if (ref.storyId === owner) return scenes.find(scene=>scene.turn === ref.turn);
    if (!comparisonScenes.has(ref.storyId)) {
      const story = stories().find(project=>project.id === ref.storyId);
      comparisonScenes.set(ref.storyId,story ? sceneIndex(story) : []);
    }
    return comparisonScenes.get(ref.storyId).find(scene=>scene.turn === ref.turn);
  }

  function appendReference(container, ref, label, excerpt) {
    const scene = find(ref);
    const quote = resolveReference(ref,scene);
    if (!quote) {
      container.append(empty('Needs recheck · the source passage changed or was removed.'));
      return;
    }
    const other = ref.storyId === owner ? '' : stories().find(story=>story.id === ref.storyId)?.title + ' · ';
    const entry = el('div','','revision-citation');
    entry.append(el('blockquote',excerpt || quote),button((label ? label + ' · ' : '') + other + sceneLabel(scene),()=>{
      if (dialog.open) dialog.close();
      void openScene(ref.storyId,ref.turn);
    }));
    container.append(entry);
  }

  function saveNote(note, remove = false) {
    writeNotes(notes.filter(item=>item.id !== note.id).concat(remove ? [] : [note]));
    if (dialog.open) renderContinuity();
    else render();
  }

  function renderInspector() {
    const panel = $('revisionInspector');
    const scene = scenes.find(item=>item.turn === selectedTurn);
    panel.hidden = !scene;
    panel.replaceChildren();
    for (const control of $('revisionScenes').querySelectorAll('button')) {
      control.setAttribute('aria-pressed',String(Number(control.dataset.scene) === selectedTurn));
    }
    if (!scene) return;
    const head = el('header');
    head.append(el('h3',sceneLabel(scene)),button('Close',()=>{ selectedTurn = undefined; renderInspector(); }));
    panel.append(head);
    if (scene.time) panel.append(empty(scene.time.replace('T',' · ')));
    panel.append(empty(`${scene.events} recorded graph ${scene.events === 1 ? 'event' : 'events'}`));
    appendReference(panel,reference(scene),'Open scene');
    if (scene.events) {
      panel.append(button('View graph events',()=>void openScene(owner,scene.turn,'graph')));
    }
  }

  function inspect(turn) {
    selectedTurn = turn;
    renderInspector();
    if (matchMedia('(max-width: 620px)').matches) $('revisionInspector').scrollIntoView({block:'nearest'});
  }

  function renderPacing(project, selected) {
    const rows = pacingRows(project,selected);
    const {total,max} = rows.reduce((values,row)=>({
      total:values.total + row.length,max:Math.max(values.max,row.length)
    }),{total:0,max:1});
    $('pacingSummary').textContent = rows.length ?
      `${rows.length.toLocaleString()} ${rows.length === 1 ? 'scene' : 'scenes'} · ${total.toLocaleString()} words` : '';
    $('pacingRows').replaceChildren(...(rows.length ? rows.map(({scene,length,dialogue,mentions})=>{
      const row = el('div','','revision-pacing-row');
      const head = el('div','','revision-metric-heading');
      head.append(button(sceneLabel(scene),()=>inspect(scene.turn)),
        el('span',`${length.toLocaleString()} words · ~${dialogue}% dialogue`));
      const track = el('div','','revision-pace-track');
      track.setAttribute('aria-hidden','true');
      const bar = el('div','','revision-pace-bar');
      bar.style.width = (100 * length / max) + '%';
      const spoken = el('span');
      spoken.style.width = dialogue + '%';
      bar.append(spoken);
      track.append(bar);
      row.append(head,track,empty([mentions.join(', '),scene.events ? `${scene.events} graph ${scene.events === 1 ? 'event' : 'events'}` : ''].filter(Boolean).join(' · ')));
      return row;
    }) : [empty('Write or import a scene to review pacing.')]));
  }

  function renderThemes(selected) {
    updateThemeAction();
    const hits = term ? motifOccurrences(selected,term) : [];
    const results = $('themeResults');
    results.replaceChildren();
    if (term) results.append(empty(`${hits.length.toLocaleString()} exact ${hits.length === 1 ? 'mention' : 'mentions'}${hits.length > 50 ? ' · showing the first 50' : ''}`));
    for (const {ref,excerpt} of hits.slice(0,50)) {
      const card = el('article','','revision-finding');
      appendReference(card,ref,'',excerpt);
      const existing = notes.find(note=>note.kind === 'theme' && note.title === term &&
        JSON.stringify(note.refs[0]) === JSON.stringify(ref));
      card.append(button(existing ? 'Unpin passage' : 'Pin passage',()=>saveNote(existing ||
        {id:crypto.randomUUID(),kind:'theme',title:term,refs:[ref]},Boolean(existing))));
      results.append(card);
    }
    const aiResults = $('themeAIResults');
    aiResults.replaceChildren();
    $('themeAISection').hidden = !themeFindings?.length;
    $('themeAIHeading').textContent = $('themeQuery').value.trim() ? 'Related passages' : 'Suggested themes';
    for (const finding of themeFindings || []) {
      const card = findingCard(finding);
      const pin = notes.find(note=>note.id === finding.id);
      card.append(button(pin ? 'Unpin passage' : 'Pin passage',()=>saveNote(pin ||
        {id:finding.id,kind:'theme',title:finding.title,refs:[finding.refs[0]]},Boolean(pin))));
      aiResults.append(card);
    }
    const pins = notes.filter(note=>note.kind === 'theme');
    $('themePinsSection').hidden = pins.length === 0;
    $('themePins').replaceChildren(...pins.map(note=>{
      const card = el('article','','revision-finding');
      card.append(el('h4',note.title));
      appendReference(card,note.refs[0]);
      card.append(button('Unpin passage',()=>saveNote(note,true)));
      return card;
    }));
  }

  function resetThread() {
    editing = undefined;
    $('threadForm').reset();
    $('saveThread').textContent = 'Add thread';
    $('cancelThread').hidden = true;
  }

  function renderThreads() {
    options($('threadSetup'),[['','Choose a scene'],...scenes.map(scene=>[scene.turn,sceneLabel(scene)])]);
    options($('threadPayoff'),[['','Still open'],...scenes.map(scene=>[scene.turn,sceneLabel(scene)])]);
    const threads = notes.filter(note=>note.kind === 'thread');
    $('trackedThreadsSection').hidden = threads.length === 0;
    $('threadList').replaceChildren(...threads.map(note=>{
      const card = el('article','','revision-finding');
      card.dataset.threadId = note.id;
      card.tabIndex = -1;
      card.append(el('h4',note.title),empty(note.refs.length === 2 ? 'Payoff tracked' : 'Open thread'));
      note.refs.forEach((ref,index)=>appendReference(card,ref,index ? 'Payoff' : 'Setup'));
      const actions = el('div','','revision-actions');
      actions.append(button('Edit thread',()=>{
        editing = note.id;
        $('threadTitle').value = note.title;
        $('threadSetup').value = note.refs[0].turn;
        $('threadPayoff').value = note.refs[1]?.turn || '';
        $('saveThread').textContent = 'Save thread';
        $('cancelThread').hidden = false;
        $('threadTitle').focus();
      }),button('Remove thread',()=>{ if (editing === note.id) resetThread(); saveNote(note,true); }));
      card.append(actions);
      return card;
    }));
    const suggestions = (threadFindings || []).filter(({id,title,refs:[setup]})=>!threads.some(note=>
      note.id === id || (threadTitle(note.title) === threadTitle(title) &&
        note.refs[0].storyId === setup.storyId && note.refs[0].turn === setup.turn)));
    $('threadSuggestionsSection').hidden = suggestions.length === 0;
    $('threadSuggestions').replaceChildren(...suggestions.map(finding=>{
      const card = findingCard(finding,['Setup','Payoff']);
      const track = button('Track this thread',()=>{
        saveNote({id:finding.id,kind:'thread',title:finding.title,refs:finding.refs});
        $('threadList').querySelector(`[data-thread-id="${finding.id}"]`)?.focus();
      });
      track.title = 'Move this suggestion to your tracked threads.';
      card.append(track);
      return card;
    }));
  }

  function findingCard({title,detail,refs}, labels = []) {
    const card = el('article','','revision-finding');
    card.append(el('h4',title),empty(detail));
    refs.forEach((ref,index)=>appendReference(card,ref,labels[index]));
    return card;
  }

  function render() {
    if (view.hidden) return;
    const project = refresh();
    options($('revisionScope'),scopeOptions(scenes));
    const selected = selectScenes(scenes,$('revisionScope').value);
    $('revisionScenes').replaceChildren(...selected.map(scene=>{
      const control = button(sceneLabel(scene),()=>inspect(scene.turn));
      control.dataset.scene = scene.turn;
      return control;
    }));
    if (mode === 'pacing') renderPacing(project,selected);
    if (mode === 'themes') renderThemes(selected);
    if (mode === 'threads') renderThreads();
    renderInspector();
  }

  function renderContinuity() {
    const project = refresh();
    options($('continuityScope'),scopeOptions(scenes));
    options($('continuityComparison'),[['','This story only'],...stories().filter(item=>item.id !== project.id).map(item=>[item.id,item.title])]);
    const findings = [
      ...continuityChecks(project,scenes,$('continuityScope').value,notes),
      ...(continuityFindings || [])
    ];
    const container = $('continuityFindings');
    const reviewed = el('details','','revision-reviewed');
    reviewed.open = container.querySelector('.revision-reviewed')?.open || false;
    container.replaceChildren();
    let resolved = 0;
    const evaluated = new Set(findings.map(finding=>finding.id));
    const chapterTurns = new Set(selectScenes(scenes,$('continuityScope').value).map(scene=>scene.turn));
    for (const note of notes) {
      if (note.kind === 'continuity' && !evaluated.has(note.id) &&
          ($('continuityScope').value === 'book' || note.refs.some(ref=>ref.storyId === owner && chapterTurns.has(ref.turn)))) {
        findings.push({...note,detail:'Previously reviewed'});
      }
    }
    for (const finding of findings) {
      const card = findingCard(finding);
      const recorded = notes.find(note=>note.kind === 'continuity' && note.id === finding.id);
      if (recorded) {
        card.append(empty(recorded.status === 'intentional' ? 'Marked intentional' : 'Dismissed'));
        card.append(button('Undo',()=>saveNote(recorded,true)));
        reviewed.append(card);
        resolved++;
      } else {
        const remember = status => saveNote({id:finding.id,kind:'continuity',title:finding.title,refs:finding.refs,status});
        card.append(button('Mark intentional',()=>remember('intentional')),button('Dismiss',()=>remember('dismissed')));
        container.append(card);
      }
    }
    if (!container.childElementCount) container.append(empty(resolved ? 'No open findings in this scope.' :
      continuityFindings ? 'No issues found in the reviewed passages.' : 'No graph or setup-date issues found in this scope.'));
    if (resolved) {
      reviewed.prepend(el('summary',`Reviewed (${resolved})`));
      container.append(reviewed);
    }
  }

  function announce(id,message) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }

  async function review(kind) {
    if (pending) return;
    const project = refresh();
    const continuity = kind === 'continuity';
    const scope = $(continuity ? 'continuityScope' : 'revisionScope').value;
    const query = (continuity ? $('continuityReference').value : kind === 'themes' ? $('themeQuery').value : '').trim();
    const comparisonId = continuity ? $('continuityComparison').value : undefined;
    const status = continuity ? 'continuityStatus' : 'revisionStatus';
    const controller = new AbortController();
    pending = controller;
    for (const id of shelfButtons) $(id).disabled = true;
    announce(status,'Reviewing eligible passages…');
    try {
      const {findings,sceneCount,cached} = await requestReview({
        storyId:project.id,kind,scope,query,comparisonId:comparisonId || undefined
      },controller.signal);
      const sameScope = scope === $(continuity ? 'continuityScope' : 'revisionScope').value;
      const sameQuery = query === (continuity ? $('continuityReference').value.trim() : kind === 'themes' ? $('themeQuery').value.trim() : '');
      if (controller.signal.aborted || activeStory().id !== project.id || !sameScope || !sameQuery ||
          continuity && (!dialog.open || comparisonId !== $('continuityComparison').value) ||
          !continuity && (view.hidden || kind !== mode)) {
        announce(status,'');
        return;
      }
      if (continuity) {
        continuityFindings = findings;
        renderContinuity();
      } else {
        if (kind === 'themes') themeFindings = findings;
        else threadFindings = findings;
        render();
      }
      announce(status,`${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} · ${sceneCount} eligible ${sceneCount === 1 ? 'scene' : 'scenes'} reviewed${cached ? ' · reused result' : ''}`);
    } catch (failure) {
      if (!controller.signal.aborted) announce(status,failure.message);
    } finally {
      pending = undefined;
      for (const id of shelfButtons) $(id).disabled = false;
    }
  }

  function setMode(next) {
    mode = next;
    for (const control of view.querySelectorAll('[data-revision-mode]')) control.setAttribute('aria-pressed',String(control.dataset.revisionMode === mode));
    for (const tip of view.querySelectorAll('[data-revision-help]')) tip.hidden = tip.dataset.revisionHelp !== mode;
    for (const [kind,id] of [['pacing','revisionPacing'],['themes','revisionThemes'],['threads','revisionThreads']]) $(id).hidden = kind !== mode;
    announce('revisionStatus','');
    render();
  }

  for (const control of view.querySelectorAll('[data-revision-mode]')) control.onclick = ()=>setMode(control.dataset.revisionMode);
  $('revisionScope').onchange = ()=>{
    selectedTurn = themeFindings = threadFindings = undefined;
    announce('revisionStatus','');
    render();
  };
  $('themeSearch').onsubmit = event=>{
    event.preventDefault();
    term = $('themeQuery').value.trim();
    themeFindings = undefined;
    announce('revisionStatus','');
    render();
  };
  function updateThemeAction() {
    const hasTheme = Boolean($('themeQuery').value.trim());
    const action = $('reviewThemes');
    action.textContent = hasTheme ? 'Find related with AI' : 'Suggest themes with AI';
    action.title = hasTheme ? 'Ask AI for passages that develop or echo the theme you entered.'
      : 'Ask AI to identify possible themes and motifs in the selected scope.';
  }
  $('themeQuery').oninput = ()=>{
    updateThemeAction();
    if (themeFindings) { themeFindings = undefined; render(); }
  };
  $('threadForm').onsubmit = event=>{
    event.preventDefault();
    const title = $('threadTitle').value.trim();
    const setup = scenes.find(scene=>scene.turn === Number($('threadSetup').value));
    const payoff = scenes.find(scene=>scene.turn === Number($('threadPayoff').value));
    if (!title || !setup) return;
    if (setup === payoff) { announce('revisionStatus','Choose a different scene for the payoff.'); return; }
    const existing = notes.find(note=>note.id === editing);
    const preserve = (scene,index)=>resolveReference(existing?.refs[index] || {},scene) ? existing.refs[index] : reference(scene);
    const note = {id:editing || crypto.randomUUID(),kind:'thread',title,refs:[preserve(setup,0),...(payoff ? [preserve(payoff,1)] : [])]};
    resetThread();
    announce('revisionStatus','Thread saved.');
    saveNote(note);
  };
  $('cancelThread').onclick = resetThread;
  $('reviewThemes').onclick = ()=>void review('themes');
  $('reviewThreads').onclick = ()=>void review('threads');
  $('reviewContinuity').onclick = ()=>void review('continuity');
  $('checkContinuity').onclick = ()=>{
    renderContinuity();
    dialog.showModal();
  };
  $('closeContinuity').onclick = ()=>dialog.close();
  dialog.addEventListener('close',()=>{ pending?.abort(); announce('continuityStatus',''); });
  for (const id of ['continuityScope','continuityComparison','continuityReference']) $(id).onchange = ()=>{
    continuityFindings = undefined;
    announce('continuityStatus','');
    renderContinuity();
  };
  return {render};
}
