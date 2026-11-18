import { continuityChecks, motifOccurrences, normalizeRevisionNotes, pacingRows, reference, resolveReferenceRange, sceneIndex, selectScenes } from './revision.js';
import { extraHighlightKinds, findRecurringDetails, manuscriptHeatmap, passageSignals, proseHighlights } from './revision-signals.js';
import { models } from './models.js';

const $ = id => document.getElementById(id);
const toolSections = {pacing:'revisionPacing',themes:'revisionThemes',threads:'revisionThreads'};
const reviewButtons = {themes:'reviewThemes',threads:'reviewThreads',continuity:'reviewContinuity'};
const nameKey = text => text.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
const sceneLabel = scene => `Chapter ${scene.chapter} · Scene ${scene.number}`;
const countLabel = (number,singular,plural = `${singular}s`) => `${number.toLocaleString()} ${number === 1 ? singular : plural}`;
const statusId = kind => kind === 'continuity' ? 'continuityStatus' : 'revisionStatus';
const excerptTitle = quote => quote.trim().replace(/\s+/gu,' ').slice(0,120);
const reviewLimit = 24;

function readReviewCache(key) {
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && saved.length < 500000) {
      const entries = JSON.parse(saved);
      if (Array.isArray(entries)) return new Map(entries.slice(-reviewLimit));
    }
  } catch {}
  return new Map();
}

async function hashReviewKey(key) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function el(tag,text,cls) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function button(text,action,cls = 'text-button') {
  const node = el('button',text,cls);
  node.type = 'button';
  node.onclick = action;
  return node;
}

function options(select, choices, selected = select.value) {
  if (select.options.length !== choices.length || choices.some(([value,label],index)=>
    select.options[index].value !== String(value) || select.options[index].text !== label)) {
    select.replaceChildren(...choices.map(([value,label])=>new Option(label,value)));
  }
  if (choices.some(([value])=>String(value) === selected)) select.value = selected;
}

function scopeOptions(scenes) {
  return [['book','Whole book'],
    ...[...new Set(scenes.map(scene=>scene.chapter))].map(chapter=>['chapter:' + chapter,'Chapter ' + chapter]),
    ...scenes.map(scene=>['scene:' + scene.turn,sceneLabel(scene)])];
}

function addSection(parent,title,id) {
  const section = el('section','','revision-list-section');
  const content = el('div');
  section.append(el('h3',title),content);
  if (id) section.id = id;
  parent.append(section);
  return content;
}

export function createRevisionViews({activeStory,stories,writeNotes,openScene,requestReview,
  openTool = ()=>{}, readManuscript = ()=>{}, highlight = ()=>{}, reviewModel = ()=>'',
  backgroundReview = ()=>undefined, setBackgroundReview = ()=>{}, paintHeatmap = ()=>{}, canPaintHeatmap = ()=>true,
  revealHeatmap = ()=>{}, cacheKey = 'studio-revision-findings-v1'}) {
  const view = $('revisionView');
  const continuityView = $('continuityReview');
  const states = new Map();
  const findingsCache = new Map();
  const storedReviews = readReviewCache(cacheKey);
  const visualizations = new Map();
  const heatmapControls = [];
  let owner, state, scenes, notes, scope, mode, pending;
  let comparisonScenes = new Map(), byTurn = new Map();
  let derivedIndex, rendered, storageLookup, heatmapNavigation;

  const empty = text => el('p',text,'form-note');
  const newState = () => ({scopes:new Map(),themeQuery:'',themeSearch:'',comparisonId:'',canon:'',notice:new Map(),expanded:new Set(),highlighting:false,
    pacingView:'overview',heatmap:{density:true,repetition:false,more:false},extraHeatmap:new Set()});
  const sceneAt = (list,turn) => list.find(scene=>scene.turn === turn) || list.at(-1);
  const sourceKey = list => JSON.stringify(list.map(({turn,chapter,fingerprint,time,eligible})=>[turn,chapter,fingerprint,time,eligible]));
  const refKey = ({storyId,turn,fingerprint,start,end}) => `${storyId}:${turn}:${fingerprint}:${start}:${end}`;
  const selectedModel = () => {
    const selected = reviewModel();
    return typeof selected === 'string' ? {id:selected,label:selected} : selected || {};
  };

  function buildIndex(project) {
    const list = sceneIndex(project);
    const signature = JSON.stringify([project.id,sourceKey(list),project.plotEvents,project.relationships,project.cast]);
    if (derivedIndex?.signature === signature) return derivedIndex;
    const rows = pacingRows(project,list);
    derivedIndex = {signature,list,rows,recurring:new Map(),signals:new Map(),heatmaps:new Map()};
    return derivedIndex;
  }

  function refresh() {
    const project = activeStory();
    if (owner !== project.id) {
      owner = project.id;
      if (!states.has(owner)) states.set(owner,newState());
      state = states.get(owner);
      $('themeQuery').value = state.themeQuery;
      $('continuityReference').value = state.canon;
      resetThread();
      comparisonScenes = new Map();
    }
    const list = buildIndex(project).list;
    if (list !== scenes) {
      scenes = list;
      byTurn = new Map(scenes.map(scene=>[scene.turn,scene]));
    }
    notes = normalizeRevisionNotes(project.revisionNotes);
    return project;
  }

  function detailsFor(project,selected) {
    const index = buildIndex(project);
    const key = sourceKey(selected);
    if (!index.recurring.has(key)) index.recurring.set(key,findRecurringDetails(selected));
    return index.recurring.get(key);
  }

  function signalsFor(project,selected) {
    const index = buildIndex(project);
    const key = sourceKey(selected);
    if (!index.signals.has(key)) {
      const included = new Set(selected.map(scene=>scene.turn));
      const latest = index.list.findLastIndex(scene=>included.has(scene.turn));
      const throughSelection = index.list.slice(0,latest + 1);
      index.signals.set(key,passageSignals(throughSelection).filter(signal=>included.has(signal.ref.turn)));
    }
    return index.signals.get(key);
  }

  function find(ref) {
    if (ref.storyId === owner) return byTurn.get(ref.turn);
    const story = stories().find(project=>project.id === ref.storyId);
    if (!story) return undefined;
    const cached = comparisonScenes.get(story.id);
    if (cached?.messages === story.messages) return cached.scenes.find(scene=>scene.turn === ref.turn);
    const indexed = sceneIndex(story);
    comparisonScenes.set(story.id,{messages:story.messages,scenes:indexed});
    return indexed.find(scene=>scene.turn === ref.turn);
  }

  function liveRef(ref) {
    const scene = find(ref);
    const range = resolveReferenceRange(ref,scene);
    return range && reference(scene,range.start,range.end);
  }

  function anchor(ref) {
    const live = liveRef(ref);
    if (!live || live.end - live.start > 1000) return ref;
    return {...live,quote:find(live).text.slice(live.start,live.end)};
  }

  function sameExcerpt(first,second) {
    if (!first || !second) return false;
    return refKey(liveRef(first) || first) === refKey(liveRef(second) || second);
  }

  function appendReference(container, ref, label, excerpt) {
    const live = liveRef(ref);
    const scene = live && find(live);
    const quote = live && (excerpt || scene.text.slice(live.start,live.end));
    const entry = el('div','','revision-citation');
    if (!quote) {
      entry.append(empty('Passage changed'));
      if (label) entry.prepend(el('span',label,'revision-citation-label'));
      container.append(entry);
      return;
    }
    const other = ref.storyId === owner ? '' : `${stories().find(story=>story.id === ref.storyId).title} · `;
    entry.append(el('blockquote',quote),button(`${label ? `${label} · ` : ''}${other}${sceneLabel(scene)}`,()=>{
      void openScene(live.storyId,live.turn,'write',live);
    }));
    container.append(entry);
  }

  function saveNotes(next) {
    writeNotes(next);
    render();
  }

  function saveNote(note, remove = false) {
    saveNotes(notes.filter(item=>item.id !== note.id).concat(remove ? [] : [{...note,refs:note.refs.map(anchor)}]));
  }

  function pinTheme(title,refs) {
    const existing = notes.filter(note=>note.kind === 'theme' && nameKey(note.title) === nameKey(title));
    const merged = existing.flatMap(note=>note.refs);
    merged.push(...refs.filter(ref=>!merged.some(item=>sameExcerpt(item,ref))));
    const ids = new Set(existing.map(note=>note.id));
    const pinned = [];
    for (let index = 0; index < merged.length; index += 50) {
      pinned.push({id:existing[index / 50]?.id || crypto.randomUUID(),kind:'theme',title:existing[0]?.title || title,
        refs:merged.slice(index,index + 50).map(anchor)});
    }
    saveNotes(notes.filter(note=>!ids.has(note.id)).concat(pinned));
  }

  function findingCard({title,detail,refs}, labels = []) {
    const card = el('article','','revision-finding');
    card.append(el('h4',title));
    if (detail) card.append(empty(detail));
    refs.forEach((ref,index)=>appendReference(card,ref,labels[index]));
    return card;
  }

  function renderPacing(project, selected, findings) {
    const {rows} = buildIndex(project);
    const included = new Set(selected.map(scene=>scene.turn));
    const scoped = rows.filter(({scene})=>included.has(scene.turn));
    $('pacingSummary').textContent = scoped.length ? `${countLabel(scoped.length,'scene')} · ${countLabel(scoped.reduce((sum,row)=>sum + row.length,0),'word')}` : '';
    const max = scoped.reduce((longest,row)=>Math.max(longest,row.length),1);
    $('pacingChartKey').hidden = !scoped.length;
    $('pacingRows').replaceChildren(...scoped.map(({scene,length,dialogue})=>{
      const row = el('div','','revision-pacing-row');
      const head = el('div','','revision-metric-heading');
      const ref = reference(scene);
      head.append(button(sceneLabel(scene),()=>void openScene(owner,scene.turn,'write',ref)),
        el('span',`${countLabel(length,'word')} · ~${dialogue}% quoted dialogue`));
      const track = el('div','','revision-pace-track');
      track.setAttribute('aria-hidden','true');
      const bar = el('div','','revision-pace-bar');
      bar.style.width = `${100 * length / max}%`;
      const spoken = el('span');
      spoken.style.width = `${dialogue}%`;
      bar.append(spoken);
      track.append(bar);
      row.append(head,track);
      return row;
    }));
    if (!scoped.length) $('pacingRows').append(empty('Write or import a scene to see its pacing.'));
    $('pacingAISection').hidden = !findings.length;
    $('pacingAIResults').replaceChildren(...findings.map(finding=>findingCard(finding)));
    const signals = signalsFor(project,selected);
    const comparisonGroup = $('pacingSignalsGroup');
    comparisonGroup.hidden = !signals.length;
    keepDetails(comparisonGroup,'pacing-signals');
    $('pacingSignals').replaceChildren(...signals.map(({label,ref,comparison})=>findingCard({title:label,refs:[ref,comparison]},
      ['Later passage','Earlier passage'])));
  }

  function renderPacingView(project,selected) {
    const showHighlights = state.pacingView === 'highlights';
    $('showPacingOverview').setAttribute('aria-pressed',String(!showHighlights));
    $('showPacingHighlights').setAttribute('aria-pressed',String(showHighlights));
    $('pacingOverview').hidden = showHighlights;
    $('pacingHeatmap').hidden = !showHighlights;
    return applyHeatmap(project,selected);
  }

  function applyHeatmap(project,selected) {
    const available = canPaintHeatmap() && selected.length > 0;
    const {density,repetition,more} = state.heatmap;
    const extra = extraHighlightKinds.filter(({key})=>state.extraHeatmap.has(key));
    const enabled = available && state.pacingView === 'highlights' && (density || repetition || extra.length);
    $('heatmapDensity').disabled = $('heatmapRepetition').disabled = $('heatmapSensitivity').disabled = !available;
    $('heatmapDensity').checked = density;
    $('heatmapRepetition').checked = repetition;
    $('heatmapSensitivity').checked = more;
    $('heatmapSensitivityLabel').hidden = !enabled;
    for (const {id,key} of extraHighlightKinds) {
      $(id).disabled = !available;
      $(id).checked = state.extraHeatmap.has(key);
    }
    const layers = {};
    if (enabled) {
      const index = derivedIndex;
      const key = sourceKey(selected);
      if (!index.heatmaps.has(key)) {
        if (index.heatmaps.size >= 4) index.heatmaps.delete(index.heatmaps.keys().next().value);
        index.heatmaps.set(key,{});
      }
      const results = index.heatmaps.get(key);
      const needDensity = density && !results.density;
      const needRepetition = repetition && !results.repetition;
      if (needDensity || needRepetition) {
        Object.assign(results,manuscriptHeatmap(project,index.list,selected,{density:needDensity,repetition:needRepetition}));
      }
      if (density) {
        if (more) layers['density-medium'] = results.density.medium;
        layers['density-high'] = results.density.high;
      }
      if (repetition) {
        results.repetition.all ||= [...results.repetition.strong,...results.repetition.subtle];
        layers.repeated = more ? results.repetition.all : results.repetition.strong;
      }
      if (extra.length) {
        results.extra ||= proseHighlights(selected);
        for (const {key} of extra) {
          const group = results.extra[key];
          group.all ||= [...group.strong,...group.subtle];
          layers[key] = more ? group.all : group.strong;
        }
      }
    }
    const shaded = Object.entries(layers).filter(([key])=>key.startsWith('density-')).reduce((sum,[,refs])=>sum+refs.length,0);
    const repeated = layers.repeated?.length || 0;
    const summary = $('heatmapSummary');
    const count = Object.values(layers).reduce((sum,items)=>sum+items.length,0);
    const matches = [density && countLabel(shaded,'dense paragraph'),repetition && countLabel(repeated,'repeated phrase'),
      ...extra.map(({key,singular})=>countLabel(layers[key]?.length || 0,singular))].filter(Boolean);
    summary.hidden = available && !enabled;
    summary.textContent = !canPaintHeatmap() ? 'This browser does not support in-text highlights.'
      : !selected.length ? 'Write or import a scene to see highlights.'
        : count ? matches.join(' · ') : more ? 'No matches in this scope.' : 'No strong matches here. Try subtler matches or a wider scope.';
    $('heatmapLegend').hidden = !count;
    $('densityLegend').hidden = !shaded;
    $('repetitionLegend').hidden = !repeated;
    $('extraHeatmapLegend').replaceChildren(...extra.filter(({key})=>layers[key]?.length).map(({key,label})=>{
      const text = el('span');
      text.append(el('span','',`heatmap-swatch ${key}-swatch`),document.createTextNode(label));
      return text;
    }));
    const ordered = new Map(selected.map((scene,index)=>[scene.turn,index]));
    const entries = Object.entries(layers).flatMap(([layer,refs])=>refs.map(ref=>({
      ref, key:layer + ':' + refKey(ref), activeLayer:layer.startsWith('density-') ? 'active-density'
        : layer === 'repeated' ? 'active-repeat' : 'active-' + layer
    })));
    entries.sort((a,b)=>ordered.get(a.ref.turn)-ordered.get(b.ref.turn) || a.ref.start-b.ref.start);
    heatmapNavigation = {entries,layers,index:0};
    return selectHeatmapMatch(Math.max(0,entries.findIndex(entry=>entry.key === state.heatmapMatch)));
  }

  function selectHeatmapMatch(index) {
    const {entries,layers} = heatmapNavigation;
    const match = entries[index];
    heatmapNavigation.index = index;
    if (match) state.heatmapMatch = match.key;
    $('viewHeatmap').hidden = !match;
    for (const {root,previous,next,position} of heatmapControls) {
      root.hidden = !match;
      previous.disabled = next.disabled = entries.length < 2;
      const label = match ? `${index + 1} of ${entries.length}` : '';
      if (position.textContent !== label) position.textContent = label;
    }
    paintHeatmap(match ? {...layers,[match.activeLayer]:[match.ref]} : layers);
    return match?.ref;
  }

  function jumpToHeatmapMatch(step,{focus = false} = {}) {
    if (!heatmapNavigation?.entries.length) return;
    const {entries,index} = heatmapNavigation;
    const ref = selectHeatmapMatch((index + step + entries.length) % entries.length);
    void openScene(ref.storyId,ref.turn,'write',ref,{mark:false,focus});
  }

  function hideHeatmap() {
    heatmapNavigation = undefined;
    $('heatmapLegend').hidden = true;
    $('viewHeatmap').hidden = true;
    for (const {root} of heatmapControls) root.hidden = true;
    paintHeatmap({});
  }

  function themePins() {
    const groups = new Map();
    for (const note of notes.filter(item=>item.kind === 'theme')) {
      const key = nameKey(note.title);
      if (!groups.has(key)) groups.set(key,{title:note.title,notes:[],refs:[]});
      const group = groups.get(key);
      group.notes.push(note);
      group.refs.push(...note.refs.filter(ref=>!group.refs.some(item=>sameExcerpt(item,ref))));
    }
    return groups;
  }

  function keepDetails(detail,key) {
    detail.open = state.expanded.has(key);
    detail.ontoggle = ()=>{
      if (!detail.isConnected) return;
      if (detail.open) state.expanded.add(key);
      else state.expanded.delete(key);
    };
  }

  function renderThemes(project,selected,findings) {
    const pins = themePins();
    $('themePinsSection').hidden = pins.size === 0;
    $('themePins').replaceChildren(...[...pins.values()].map(({title,notes:groupNotes,refs})=>{
      const card = findingCard({title,refs});
      card.append(button('Unpin theme',()=>{
        const ids = new Set(groupNotes.map(note=>note.id));
        saveNotes(notes.filter(note=>!ids.has(note.id)));
      }));
      return card;
    }));
    const recurring = detailsFor(project,selected);
    $('recurringDetails').replaceChildren(...recurring.map(({term,count,refs})=>{
      const detail = el('details','','revision-recurring');
      keepDetails(detail,`recurring:${scope}:${nameKey(term)}`);
      const summary = el('summary');
      summary.append(el('span',term),el('span',countLabel(count,'scene'),'revision-count'));
      detail.append(summary);
      refs.forEach(ref=>{
        const scene = find(ref);
        const excerpt = scene.text.slice(Math.max(0,ref.start - 42),Math.min(scene.text.length,ref.end + 42));
        appendReference(detail,ref,'',excerpt);
      });
      const pinned = refs.every(ref=>pins.get(nameKey(term))?.refs.some(item=>sameExcerpt(item,ref)));
      const pin = button(pinned ? 'Pinned' : 'Pin these passages',()=>pinTheme(term,refs));
      pin.disabled = pinned;
      detail.append(pin);
      return detail;
    }));
    if (!recurring.length) $('recurringDetails').append(empty(selected.length < 2
      ? 'Choose a chapter or the whole book to compare phrases across scenes.' : 'No distinctive phrases repeat in the selected scenes.'));

    const term = state.themeSearch;
    const hits = term ? motifOccurrences(selected,term) : [];
    const results = $('themeResults');
    results.replaceChildren();
    if (term) results.append(el('h3',`${countLabel(hits.length,'exact mention')}${hits.length > 50 ? ' · first 50 shown' : ''}`));
    for (const {ref,excerpt} of hits.slice(0,50)) {
      const card = el('article','','revision-finding');
      appendReference(card,ref,'',excerpt);
      const pinned = pins.get(nameKey(term))?.refs.some(item=>sameExcerpt(item,ref));
      const action = button(pinned ? 'Pinned' : 'Pin passage',()=>pinTheme(term,[ref]));
      action.disabled = pinned;
      card.append(action);
      results.append(card);
    }
    $('themeAISection').hidden = !findings.length;
    $('themeAIHeading').textContent = state.themeQuery.trim() ? 'Related passages' : 'Suggested themes';
    $('themeAIResults').replaceChildren(...findings.map(finding=>{
      const card = findingCard(finding);
      const pinned = finding.refs.every(ref=>pins.get(nameKey(finding.title))?.refs.some(item=>sameExcerpt(item,ref)));
      const action = button(pinned ? 'Pinned' : 'Pin theme',()=>pinTheme(finding.title,finding.refs));
      action.disabled = pinned;
      card.append(action);
      return card;
    }));
    return [...[...pins.values()].flatMap(group=>group.refs),...recurring.flatMap(detail=>detail.refs),
      ...hits.slice(0,50).map(item=>item.ref),...findings.flatMap(finding=>finding.refs)];
  }

  function resetThread() {
    state.editing = undefined;
    $('threadForm').reset();
    $('saveThread').textContent = 'Add thread';
    $('cancelThread').hidden = true;
  }

  function editThread(note) {
    state.editing = note.id;
    $('threadFormGroup').open = true;
    $('threadTitle').value = note.title;
    $('threadSetup').value = note.refs[0].turn;
    $('threadPayoff').value = note.refs[1]?.turn || '';
    $('saveThread').textContent = 'Save thread';
    $('cancelThread').hidden = false;
    $('threadTitle').focus();
  }

  function renderThreads(findings) {
    options($('threadSetup'),[['','Choose a scene'],...scenes.map(scene=>[scene.turn,sceneLabel(scene)])]);
    options($('threadPayoff'),[['','Still open'],...scenes.map(scene=>[scene.turn,sceneLabel(scene)])]);
    const threads = notes.filter(note=>note.kind === 'thread');
    const groups = [['Open',[]],['Paid off',[]],['Set aside',[]]];
    for (const note of threads) groups[note.status === 'shelved' ? 2 : note.refs.length === 2 ? 1 : 0][1].push(note);
    $('threadList').replaceChildren();
    for (const [group,entries] of groups) {
      if (!entries.length) continue;
      const section = addSection($('threadList'),`${group} (${entries.length})`);
      for (const note of entries) {
        const card = findingCard(note,['Setup','Payoff']);
        card.dataset.threadId = note.id;
        card.tabIndex = -1;
        const actions = el('div','','revision-actions');
        if (note.status !== 'shelved') {
          const linking = state.payoff === note.id;
          actions.append(button(linking ? 'Cancel link' : note.refs.length === 2 ? 'Change payoff' : 'Link payoff',()=>{
            state.payoff = linking ? undefined : note.id;
            render();
            if (!linking) {
              $('threadLinkNotice').querySelector('button')?.focus();
              readManuscript();
            }
          }));
        }
        actions.append(button('Edit thread',()=>editThread(note)));
        if (note.status === 'shelved') actions.append(button('Restore thread',()=>saveNote({...note,status:undefined})));
        else actions.append(button('Set aside',()=>{
          if (state.payoff === note.id) state.payoff = undefined;
          saveNote({...note,status:'shelved'});
        }));
        actions.append(button('Remove',()=>{
          if (state.editing === note.id) resetThread();
          if (state.payoff === note.id) state.payoff = undefined;
          saveNote(note,true);
        }));
        card.append(actions);
        section.append(card);
      }
    }
    if (!threads.length) $('threadList').append(empty('Select a passage in the manuscript to track a setup.'));
    const linking = threads.find(note=>note.id === state.payoff && note.status !== 'shelved');
    $('threadLinkNotice').hidden = !linking;
    $('threadLinkNotice').replaceChildren();
    if (linking) $('threadLinkNotice').append(empty(`Select the payoff passage for “${linking.title}” in the manuscript.`),
      button('Cancel',()=>{ state.payoff = undefined; render(); }));

    const suggestions = findings.filter(({id,title,refs:[setup]})=>!threads.some(note=>
      note.id === id || (nameKey(note.title) === nameKey(title) && note.refs[0].turn === setup.turn && note.refs[0].storyId === setup.storyId)));
    $('threadSuggestionsSection').hidden = suggestions.length === 0;
    $('threadSuggestions').replaceChildren(...suggestions.map(finding=>{
      const card = findingCard(finding,['Setup','Payoff']);
      card.append(button('Track this thread',()=>{
        saveNote({id:finding.id,kind:'thread',title:finding.title,refs:finding.refs});
        $('threadList').querySelector(`[data-thread-id="${finding.id}"]`)?.focus();
      }));
      return card;
    }));
    return [...threads.filter(note=>note.status !== 'shelved').flatMap(note=>note.refs),...suggestions.flatMap(finding=>finding.refs)];
  }

  function renderContinuity(project,findings,analysis,selected,other,manualReviewDone) {
    options($('continuityComparison'),[['','This story only'],...stories().filter(item=>item.id !== project.id).map(item=>[item.id,item.title])],state.comparisonId);
    const local = continuityChecks(project,scenes,scope,notes);
    const container = $('continuityFindings');
    const reviewed = el('details','','revision-reviewed');
    keepDetails(reviewed,'continuity-reviewed');
    container.replaceChildren();
    const combined = [...local,...findings];
    const evaluated = new Set(combined.map(finding=>finding.id));
    const included = new Set(selected.map(scene=>scene.turn));
    const eligible = selected.filter(scene=>scene.eligible).length;
    const comparisonEligible = other ? sceneIndex(other).filter(scene=>scene.eligible).length : 0;
    $('reviewContinuity').disabled ||= !eligible || eligible + comparisonEligible < 2;
    $('reviewContinuity').title = !eligible || eligible + comparisonEligible < 2
      ? 'Choose a scope with two eligible scenes, or add a comparison story.'
      : 'Ask AI to compare claims in the selected passages.';
    $('continuityCoverage').textContent = included.size
      ? `${countLabel(included.size,'scene')} in scope. ${scope === 'book' ? 'Local checks look at graph links and the dates on tracked payoffs.' : 'Local checks compare setup and payoff dates for tracked threads in this scope.'}`
      : 'Add a scene to begin checking continuity.';
    for (const note of notes) {
      if (note.kind === 'continuity' && !evaluated.has(note.id) &&
          (scope === 'book' || note.refs.some(ref=>ref.storyId === owner && included.has(ref.turn)))) {
        combined.push({...note,detail:'Previously reviewed'});
      }
    }
    const highlights = [];
    for (const finding of combined) {
      const card = findingCard(finding);
      const recorded = notes.find(note=>note.kind === 'continuity' && note.id === finding.id);
      if (recorded) {
        card.append(empty(recorded.status === 'intentional' ? 'Marked intentional' : 'Dismissed'));
        card.append(button('Undo',()=>saveNote(recorded,true)));
        reviewed.append(card);
      } else {
        const remember = status => saveNote({id:finding.id,kind:'continuity',title:finding.title,refs:finding.refs,status});
        card.append(button('Mark intentional',()=>remember('intentional')),button('Dismiss',()=>remember('dismissed')));
        container.append(card);
        highlights.push(...finding.refs);
      }
    }
    if (!container.childElementCount && included.size) {
      container.append(empty(analysis?.continuityChecked || manualReviewDone
        ? 'No open conflicts flagged in this scope.' : 'No open graph or date findings in this scope.'));
    }
    if (reviewed.childElementCount) {
      reviewed.prepend(el('summary',`Reviewed (${reviewed.childElementCount})`));
      container.append(reviewed);
    }
    const proseStatus = $('continuityProseStatus');
    const checked = analysis?.continuityChecked || 0;
    const waiting = (analysis?.continuityPairs || 0) - checked;
    let text;
    if (analysis?.state === 'demo') text = 'The demo shows a checked example below.';
    else if (analysis?.reviewed) {
      text = `Across the manuscript, background review read ${analysis.reviewed} of ${analysis.total} eligible scenes. `;
      if (checked) text += `${countLabel(checked,'pair of claims','pairs of claims')} compared.`;
      else text += analysis.state === 'ready' ? 'No comparable claims found.' : 'No claims compared yet.';
      if (waiting) text += ` ${countLabel(waiting,'pair')} waiting for comparison.`;
    } else if (analysis?.state === 'waiting-model') text = 'Prose review awaits a configured model.';
    else if (analysis?.state === 'paused') text = 'Background prose review is paused.';
    else text = 'No prose reviewed in the background yet.';
    if (eligible && eligible + comparisonEligible < 2) text += ' Manual comparison needs two eligible scenes.';
    proseStatus.textContent = text;
    const example = $('continuityExample');
    const sample = analysis?.continuityExample;
    example.hidden = !sample || !sample.refs.some(ref=>included.has(ref.turn)) || !sample.refs.every(ref=>byTurn.get(ref.turn)?.eligible && liveRef(ref));
    example.replaceChildren();
    if (!example.hidden) example.append(el('h3','Checked example'),findingCard(sample,['Earlier reading','Later reading']));
    return highlights;
  }

  function reviewKey(project,kind) {
    const query = kind === 'continuity' ? state.canon.trim() : kind === 'themes' ? state.themeQuery.trim() : '';
    const other = kind === 'continuity' ? stories().find(story=>story.id === state.comparisonId) : undefined;
    const included = selectScenes(scenes,scope);
    const canon = story=>[story.title,story.premise,story.lore,story.notes,story.cast,story.plotEvents,story.relationships];
    return {query,other,key:JSON.stringify([owner,kind,scope,query,selectedModel().id,sourceKey(included),canon(project),
      other ? [other.id,sourceKey(sceneIndex(other)),canon(other)] : []])};
  }

  function addReviewToMemory(key,cache) {
    findingsCache.delete(key);
    findingsCache.set(key,cache);
    if (findingsCache.size > reviewLimit) findingsCache.delete(findingsCache.keys().next().value);
  }

  async function storeReview(key,cache) {
    try {
      const hash = await hashReviewKey(key);
      storedReviews.delete(hash);
      storedReviews.set(hash,cache);
      if (storedReviews.size > reviewLimit) storedReviews.delete(storedReviews.keys().next().value);
      sessionStorage.setItem(cacheKey,JSON.stringify([...storedReviews]));
    } catch {}
  }

  async function restoreReview(key,kind,selected,other) {
    if (storageLookup === key || !storedReviews.size || !key) return;
    storageLookup = key;
    let saved;
    try { saved = storedReviews.get(await hashReviewKey(key)); } catch { return; }
    if (!saved || findingsCache.has(key) || pending?.key === key ||
      !Array.isArray(saved.findings) || saved.findings.length > 10 || typeof saved.status !== 'string') return;
    const eligible = [...selected,...(other ? sceneIndex(other) : [])].filter(scene=>scene.eligible);
    const validEvidence = ref => ref && Number.isSafeInteger(ref.start) && ref.start >= 0 &&
      Number.isSafeInteger(ref.end) && ref.end > ref.start && eligible.some(scene=>scene.storyId === ref.storyId &&
        scene.turn === ref.turn && scene.fingerprint === ref.fingerprint && ref.end <= scene.text.length);
    const primaryId = selected[0]?.storyId;
    const validText = (value,limit) => typeof value === 'string' && value.trim() && value.length <= limit;
    const findings = saved.findings.filter(finding=>finding && typeof finding.id === 'string' && /^[a-z0-9-]{1,100}$/i.test(finding.id) &&
      validText(finding.title,140) && validText(finding.detail,600) && Array.isArray(finding.refs) &&
      finding.refs.length >= (kind === 'continuity' ? 2 : 1) && finding.refs.length <= 2 && finding.refs.every(validEvidence) &&
      finding.refs.some(ref=>ref.storyId === primaryId));
    if (findings.length !== saved.findings.length) return;
    addReviewToMemory(key,{findings,status:saved.status});
    render();
  }

  function updateReview(key,cache) {
    if (!(mode in reviewButtons)) {
      $('revisionStatus').hidden = true;
      return;
    }
    const status = $(statusId(mode));
    const control = $(reviewButtons[mode]);
    for (const id of Object.values(reviewButtons)) $(id).disabled = Boolean(pending);
    if (mode === 'themes') {
      const hasTheme = Boolean(state.themeQuery.trim());
      control.textContent = hasTheme ? 'Find related with AI' : 'Suggest themes with AI';
      control.title = hasTheme ? 'Find passages that develop or echo the theme you entered.' : 'Find possible themes and motifs in this scope.';
    }
    const message = state.notice.get(mode) || (pending?.key === key ? 'Reviewing eligible passages…' : '') || cache?.status || '';
    const model = selectedModel().label;
    const meta = $(`${mode}ReviewModel`);
    meta.textContent = model || '';
    meta.hidden = !model;
    status.textContent = message;
    status.hidden = !message;
    status.toggleAttribute('data-activity',pending?.key === key);
  }

  function setVisualization(refs) {
    const controls = visualizations.get(mode);
    if (!controls) return;
    const current = [];
    for (const ref of refs.filter(item=>item.storyId === owner)) {
      const live = liveRef(ref);
      if (live && !current.some(item=>sameExcerpt(item,live))) current.push(live);
    }
    current.sort((a,b)=>a.turn - b.turn || a.start - b.start);
    controls.refs = current;
    controls.root.hidden = !current.length;
    controls.toggle.setAttribute('aria-pressed',String(state.highlighting));
    controls.steps.hidden = !state.highlighting;
    controls.steps.setAttribute('aria-label',countLabel(current.length,'highlight'));
    if (state.highlighting && !controls.root.hidden) highlight(current);
    else highlight([]);
  }

  function renderBackground(result) {
    const panel = $('backgroundReview');
    const bar = $('backgroundReviewProgress');
    panel.hidden = !result;
    bar.hidden = true;
    if (!result) return;
    const {state,reviewed,total,held,enabled,model,estimatedUsd,dailyBudget,progress} = result;
    const updating = state === 'running' || state === 'queued';
    const updateLabel = progress?.phase === 'reading' ? 'Reading prose' : 'Checking links';
    const waiting = progress?.etaSeconds === undefined ? 'Estimating time…' : progress.etaSeconds < 60
      ? 'About a minute or less for this stage' : `About ${Math.ceil(progress.etaSeconds / 60)} min for this stage`;
    if (updating && progress?.total) {
      bar.max = progress.total;
      bar.value = progress.completed;
      bar.setAttribute('aria-valuetext',`${updateLabel}. ${progress.completed} of ${progress.total} done.`);
      bar.hidden = false;
    }
    const summary = state === 'demo' ? 'Example review' : state === 'waiting-model' ? 'Background review · Choose a model' :
      state === 'paused' ? 'Background review · Paused' : state === 'failed' ? 'Background review · Needs attention' :
      state === 'budget' ? 'Background review · Daily budget reached' : state === 'retrying' ? 'Background review · Retrying shortly' :
      state === 'empty' ? 'Background review · No eligible scenes' :
      state === 'ready' ? `Review up to date · ${countLabel(total,'scene')}` :
      `${updateLabel} · ${progress?.completed || 0}/${progress?.total || 0} · ${waiting}`;
    const heading = $('backgroundReviewSummary');
    if (heading.textContent !== summary) heading.textContent = summary;
    heading.toggleAttribute('data-activity',updating);
    const label = models.find(item=>item.id === model)?.name;
    const details = state === 'demo' ? 'Sample findings from this demo manuscript.' : [label,
      'Reviews eligible prose using your API key. Results are saved locally for each story.',
      total ? `${reviewed} of ${total} eligible scenes read.` : '',
      held ? `${countLabel(held,'scene')} held out of AI context.` : '',
      dailyBudget ? `$${estimatedUsd.toFixed(2)} estimated toward the $${dailyBudget} daily review budget.` : '',
      state === 'failed' ? 'Check your provider settings before retrying.' : ''
    ].filter(Boolean).join(' ');
    $('backgroundReviewDetails').textContent = details;
    const toggle = $('toggleBackgroundReview');
    toggle.hidden = state === 'demo';
    toggle.textContent = enabled ? state === 'failed' ? 'Retry review' : 'Pause background review' : 'Resume background review';
    toggle.onclick = ()=>void setBackgroundReview(state === 'failed' ? {retry:true} : {enabled:!enabled});
  }

  function render({reveal = false} = {}) {
    const project = refresh();
    const analysis = backgroundReview(project);
    renderBackground(analysis);
    if (!mode || mode === 'scene') return;
    const selector = $(mode === 'continuity' ? 'continuityScope' : 'revisionScope');
    const choices = scopeOptions(scenes);
    const chosen = state.scopes.get(mode);
    if (!chosen || !choices.some(([value])=>value === chosen)) state.scopes.set(mode,'book');
    scope = state.scopes.get(mode);
    const {key,other} = mode in reviewButtons ? reviewKey(project,mode) : {key:''};
    const cache = findingsCache.get(key);
    const selected = selectScenes(scenes,scope);
    const included = new Set(selected.map(scene=>scene.turn));
    const localFindings = (analysis?.findings?.[mode] || []).filter(finding=>finding.refs.some(ref=>included.has(ref.turn)) &&
      finding.refs.every(ref=>ref.storyId === owner && byTurn.get(ref.turn)?.eligible && liveRef(ref))).slice(0,12);
    const customQuery = mode === 'themes' && state.themeQuery.trim() || mode === 'continuity' && (state.comparisonId || state.canon.trim());
    const findings = [...new Map([...(customQuery ? [] : localFindings),...(cache?.findings || [])].map(item=>[item.id,item])).values()];
    const coverage = mode === 'continuity' && [analysis?.state,analysis?.reviewed,analysis?.total,analysis?.continuityChecked,analysis?.continuityPairs,analysis?.continuityExample];
    const presentation = JSON.stringify([owner,mode,scope,derivedIndex.signature,notes,pending?.key,key,cache?.status,localFindings,coverage,
      state.notice.get(mode),state.themeSearch,state.payoff,mode === 'continuity' && stories().map(({id,title})=>[id,title])]);
    if (rendered?.presentation === presentation && rendered.cache === cache) return;
    rendered = {presentation,cache};
    if (mode !== 'continuity') $('revisionScopeLabel').textContent = mode === 'threads' ? 'AI review scope' : 'Scope';
    options(selector,choices,scope);
    if (!cache) void restoreReview(key,mode,selected,other);
    updateReview(key,cache);
    let refs;
    if (mode === 'pacing') {
      renderPacing(project,selected,findings);
      const first = renderPacingView(project,selected);
      if (reveal && first) revealHeatmap(first);
    }
    if (mode === 'themes') refs = renderThemes(project,selected,findings);
    if (mode === 'threads') refs = renderThreads(findings);
    if (mode === 'continuity') refs = renderContinuity(project,findings,analysis,selected,other,Boolean(cache));
    if (refs) setVisualization(refs);
  }

  async function review(kind) {
    if (pending) return;
    const project = refresh();
    const {key,query,other} = reviewKey(project,kind);
    const captured = state;
    state.notice.delete(kind);
    const controller = new AbortController();
    const payload = {storyId:owner,kind,scope,query,comparisonId:other?.id};
    pending = {key,controller};
    render();
    try {
      const {findings,sceneCount,cached} = await requestReview(payload,controller.signal);
      const status = `${countLabel(findings.length,'finding')} · ${countLabel(sceneCount,'eligible scene')} reviewed${cached ? ' · reused result' : ''}`;
      const result = {findings,status};
      addReviewToMemory(key,result);
      void storeReview(key,result);
    } catch (failure) {
      if (!controller.signal.aborted && captured === state && activeStory().id === payload.storyId && mode === kind && reviewKey(activeStory(),kind).key === key) {
        captured.notice.set(kind,failure.message);
      }
    } finally {
      pending = undefined;
      render();
    }
  }

  function open(tool) {
    if (mode !== tool) {
      rendered = undefined;
      if (state) state.highlighting = false;
      if (mode === 'pacing') hideHeatmap();
      highlight([]);
    }
    mode = tool;
    view.hidden = !(tool in toolSections);
    continuityView.hidden = tool !== 'continuity';
    $('pacingViews').hidden = tool !== 'pacing';
    view.classList.toggle('pacing-view',tool === 'pacing');
    for (const [kind,id] of Object.entries(toolSections)) $(id).hidden = kind !== tool;
    render();
  }

  function getPreviews(project,activeTurn) {
    const {list,rows} = buildIndex(project);
    const scene = sceneAt(list,activeTurn);
    if (!scene) return {};
    const row = rows.find(item=>item.scene.turn === scene.turn);
    const chosenNotes = normalizeRevisionNotes(project.revisionNotes);
    const pinned = new Set(chosenNotes.filter(note=>note.kind === 'theme').map(note=>nameKey(note.title))).size;
    const activeThreads = chosenNotes.filter(note=>note.kind === 'thread' && note.status !== 'shelved');
    const paid = activeThreads.filter(note=>note.refs.length === 2).length;
    const local = continuityChecks(project,list,'book',chosenNotes).filter(finding=>!chosenNotes.some(note=>note.id === finding.id));
    return {
      scene:[scene.time && scene.time.slice(11),row.mentions.length && countLabel(row.mentions.length,'cast mention')].filter(Boolean).join(' · ') || sceneLabel(scene),
      pacing:`${countLabel(list.length,'scene')} · ${countLabel(rows.reduce((sum,entry)=>sum + entry.length,0),'word')}`,
      themes:pinned ? countLabel(pinned,'pinned theme') : 'Find and pin recurring details',
      threads:`${activeThreads.length - paid} open · ${paid} paid off`,
      continuity:local.length ? countLabel(local.length,'local finding') : 'Check for conflicting story facts'
    };
  }

  function selectionActions(ref) {
    refresh();
    const scene = find(ref), range = resolveReferenceRange(ref,scene);
    if (!range || ref.storyId !== owner) return [];
    const quote = scene.text.slice(range.start,range.end);
    const title = excerptTitle(quote);
    if (!title) return [];
    const targeted = notes.find(note=>note.id === state.payoff && note.status !== 'shelved');
    if (targeted && mode === 'threads') {
      const setup = liveRef(targeted.refs[0]);
      if (setup && setup.turn === ref.turn && setup.start < range.end && range.start < setup.end) return [];
      return [{label:'Link as payoff',run:()=>{
        state.payoff = undefined;
        saveNote({...targeted,refs:[targeted.refs[0],ref]});
      }}];
    }
    return [{label:'Pin as theme',run:()=>{
      pinTheme(title,[ref]);
      openTool('themes');
    }},{label:'Track as setup',run:()=>{
      if (notes.some(note=>note.kind === 'thread' && sameExcerpt(note.refs[0],ref))) {
        openTool('threads');
        return;
      }
      saveNote({id:crypto.randomUUID(),kind:'thread',title,refs:[ref]});
      openTool('threads');
    }}];
  }

  function installVisualization(parent,kind,before = null) {
    const root = el('div','','revision-visualization');
    const controls = {root,refs:[],index:-1};
    const toggle = button('Highlight in text',()=>{
      state.highlighting = !state.highlighting;
      controls.index = -1;
      setVisualization(controls.refs);
      if (state.highlighting) readManuscript();
    });
    controls.toggle = toggle;
    const steps = el('div','','revision-visualization-steps');
    controls.steps = steps;
    const jump = direction=>{
      const {refs,index} = controls;
      if (!refs.length) return;
      controls.index = (index < 0 && direction < 0 ? refs.length - 1 : (index + direction + refs.length) % refs.length);
      const target = refs[controls.index];
      void openScene(target.storyId,target.turn,'write',target);
    };
    steps.append(button('Previous',()=>jump(-1)),button('Next',()=>jump(1)));
    root.append(toggle,steps);
    root.hidden = true;
    visualizations.set(kind,controls);
    parent.insertBefore(root,before);
  }

  function installMarkup() {
    view.querySelector('.revision-help').remove();
    $('revisionScenes').remove();
    $('revisionInspector').remove();
    view.classList.add('revision-dock');
    continuityView.classList.add('revision-dock');
    const tools = $('revisionThemes');
    const pins = $('themePinsSection');
    pins.querySelector('h3').textContent = 'Pinned themes';
    tools.prepend(pins);
    const recurring = addSection(tools,'Recurring phrases','recurringDetailsSection');
    recurring.id = 'recurringDetails';
    pins.after(recurring.parentElement);
    pins.after($('themeAISection'));
    tools.prepend($('themesIntro'));
    $('themeQuery').required = false;
    const signals = el('details','','pacing-notes');
    signals.id = 'pacingSignalsGroup';
    signals.append(el('summary','Similar wording across scenes'));
    const signalList = el('div');
    signalList.id = 'pacingSignals';
    signals.append(signalList);
    $('pacingOverview').append(signals);
    const threadForm = el('details','','revision-thread-form');
    threadForm.id = 'threadFormGroup';
    threadForm.append(el('summary','Add or edit a thread by scene'));
    $('threadForm').before(threadForm);
    threadForm.append($('threadForm'));
    $('trackedThreadsSection').hidden = false;
    $('trackedThreadsSection').querySelector('h3').remove();
    threadForm.before($('trackedThreadsSection'));
    $('revisionThreads').prepend($('threadsIntro'));
    const linkNotice = el('div','','revision-link-notice');
    linkNotice.id = 'threadLinkNotice';
    linkNotice.hidden = true;
    linkNotice.setAttribute('role','status');
    $('trackedThreadsSection').before(linkNotice);
    threadForm.after($(reviewButtons.threads));
    for (const kind of ['themes','threads','continuity']) {
      const parent = kind === 'continuity' ? $('continuityFindings').parentElement : $(toolSections[kind]);
      const before = kind === 'continuity' ? $('continuityFindings') : parent.firstElementChild;
      installVisualization(parent,kind,before);
      if (kind in reviewButtons) {
        const meta = el('span','','revision-review-model');
        meta.id = `${kind}ReviewModel`;
        meta.hidden = true;
        $(reviewButtons[kind]).after(meta);
      }
    }
  }

  installMarkup();
  for (const id of ['toolHeatmapNavigation','proseHeatmapNavigation']) {
    const root = $(id);
    root.append($('heatmapNavigationTemplate').content.cloneNode(true));
    const previous = root.querySelector('.heatmap-previous');
    const next = root.querySelector('.heatmap-next');
    const jump = root.querySelector('.heatmap-position');
    previous.onclick = ()=>jumpToHeatmapMatch(-1);
    next.onclick = ()=>jumpToHeatmapMatch(1);
    jump.onclick = ()=>jumpToHeatmapMatch(0);
    root.onkeydown = event=>{
      if (!['ArrowLeft','ArrowRight'].includes(event.key) || previous.disabled) return;
      event.preventDefault();
      jumpToHeatmapMatch(event.key === 'ArrowLeft' ? -1 : 1);
    };
    heatmapControls.push({root,previous,next,position:jump.firstElementChild});
  }
  $('viewHeatmap').onclick = ()=>jumpToHeatmapMatch(0,{focus:true});
  const extraHelp = {
    'long-sentences':'Marks sentences of 36 words or more.',
    'repeated-openings':'Marks matching first two words in runs of sentences.',
    'dialogue-runs':'Shades runs of four or more quote-only paragraphs.'
  };
  for (const {id,key,label} of extraHighlightKinds) {
    const input = el('input');
    input.type = 'checkbox';
    input.id = id;
    const description = el('span');
    description.append(el('span',label),el('small',extraHelp[key]));
    const control = el('label');
    control.append(el('span','',`heatmap-swatch ${key}-swatch`),description,input);
    $('extraHeatmapControls').append(control);
    input.onchange = ()=>{
      if (input.checked) state.extraHeatmap.add(key);
      else state.extraHeatmap.delete(key);
      const match = applyHeatmap(activeStory(),selectScenes(scenes,scope));
      if (input.checked && match) revealHeatmap(match);
    };
  }
  $('showPacingOverview').onclick = ()=>{
    state.pacingView = 'overview';
    renderPacingView(activeStory(),selectScenes(scenes,scope));
  };
  $('showPacingHighlights').onclick = ()=>{
    state.pacingView = 'highlights';
    const first = renderPacingView(activeStory(),selectScenes(scenes,scope));
    if (first) revealHeatmap(first);
  };
  for (const id of ['heatmapDensity','heatmapRepetition','heatmapSensitivity']) $(id).onchange = ()=>{
    state.heatmap = {density:$('heatmapDensity').checked,repetition:$('heatmapRepetition').checked,more:$('heatmapSensitivity').checked};
    const first = applyHeatmap(activeStory(),selectScenes(scenes,scope));
    if ($(id).checked && first) revealHeatmap(first);
  };
  $('clearHeatmap').onclick = ()=>{
    Object.assign(state.heatmap,{density:false,repetition:false});
    state.extraHeatmap.clear();
    applyHeatmap(activeStory(),selectScenes(scenes,scope));
    const returnButton = $('returnToTool');
    if (!returnButton.hidden) returnButton.focus({preventScroll:true});
    else if (!$('pacingHeatmap').hidden) $('heatmapDensity').focus({preventScroll:true});
  };
  $('revisionScope').onchange = ()=>{
    state.scopes.set(mode,$('revisionScope').value);
    state.notice.delete(mode);
    render({reveal:true});
  };
  $('continuityScope').onchange = ()=>{
    state.scopes.set('continuity',$('continuityScope').value);
    state.notice.delete('continuity');
    render();
  };
  $('themeSearch').onsubmit = event=>{
    event.preventDefault();
    state.themeSearch = state.themeQuery.trim();
    render();
  };
  $('themeQuery').oninput = ()=>{
    state.themeQuery = $('themeQuery').value;
    if (!state.themeQuery.trim()) state.themeSearch = '';
    state.notice.delete('themes');
    render();
  };
  $('threadForm').onsubmit = event=>{
    event.preventDefault();
    const title = $('threadTitle').value.trim();
    const setup = scenes.find(scene=>scene.turn === Number($('threadSetup').value));
    const payoff = scenes.find(scene=>scene.turn === Number($('threadPayoff').value));
    if (!title || !setup) return;
    const existing = notes.find(note=>note.id === state.editing);
    if (setup === payoff && !(existing?.refs[0].turn === setup.turn && existing.refs[1]?.turn === payoff.turn)) {
      state.notice.set('threads','Choose a different scene for the payoff, or select the payoff passage directly.');
      render();
      return;
    }
    const preserve = (scene,index)=>existing?.refs[index]?.turn === scene.turn ? existing.refs[index] : reference(scene);
    const note = {id:existing?.id || crypto.randomUUID(),kind:'thread',title,
      refs:[preserve(setup,0),...(payoff ? [preserve(payoff,1)] : [])],status:existing?.status};
    resetThread();
    $('threadFormGroup').open = false;
    state.notice.set('threads','Thread saved.');
    saveNote(note);
  };
  $('cancelThread').onclick = ()=>{ resetThread(); $('threadFormGroup').open = false; };
  for (const [kind,id] of Object.entries(reviewButtons)) $(id).onclick = ()=>void review(kind);
  $('continuityComparison').onchange = ()=>{
    state.comparisonId = $('continuityComparison').value;
    state.notice.delete('continuity');
    render();
  };
  $('continuityReference').oninput = ()=>{
    state.canon = $('continuityReference').value;
    state.notice.delete('continuity');
    render();
  };
  return {open,render,getPreviews,selectionActions};
}
