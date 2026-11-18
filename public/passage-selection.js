import { reference, resolveReference, sceneIndex } from './revision.js';

function mapOffset(offset,replacements,toDisplay,isEnd) {
  let shift = 0;
  for (const {original,display,originalLength,displayLength} of replacements) {
    const start = toDisplay ? original : display;
    const length = toDisplay ? originalLength : displayLength;
    const targetLength = toDisplay ? displayLength : originalLength;
    if (offset <= start) break;
    if (offset < start + length) return start + shift + (isEnd ? targetLength : 0);
    shift += targetLength - length;
  }
  return offset + shift;
}

export function createPassageSelection({transcript,getStory,getActions}) {
  const prose = new WeakMap();
  const marks = {finding:[],passages:[]};
  const priorities = {'density-medium':0,'density-high':0,repeated:1,'active-density':2,'active-repeat':2,passages:3,finding:4};
  const supportsHeatmap = Boolean(globalThis.CSS?.highlights && globalThis.Highlight);
  let layers = {};
  let renderEpoch = 0, lastPaint;
  const toolbar = document.createElement('div');
  toolbar.className = 'passage-actions';
  toolbar.setAttribute('role','group');
  toolbar.setAttribute('aria-label','Selected passage actions');
  toolbar.hidden = true;
  document.body.append(toolbar);
  let refreshScheduled = false, selectedKey;

  function register(element,content,match) {
    const replacements = [];
    let shift = 0;
    element.textContent = match ? match(content,(original,originalLength,displayLength)=>{
      replacements.push({original,originalLength,displayLength,display:original + shift});
      shift += displayLength - originalLength;
    }) : content;
    prose.set(element,replacements);
    renderEpoch++;
  }

  function sceneRange(ref,scene,element) {
    if (resolveReference(ref,scene) === undefined) return;
    const replacements = prose.get(element);
    if (!replacements || !element.firstChild) return;
    const range = document.createRange();
    range.setStart(element.firstChild,mapOffset(ref.start,replacements,true,false));
    range.setEnd(element.firstChild,mapOffset(ref.end,replacements,true,true));
    return {element,range};
  }

  function render() {
    const project = getStory();
    const all = {...marks,...layers};
    if (lastPaint && lastPaint.project === project && lastPaint.epoch === renderEpoch && Object.keys(priorities).every(kind=>
      all[kind] === lastPaint.all[kind] || !all[kind]?.length && !lastPaint.all[kind]?.length)) return;
    lastPaint = {project,epoch:renderEpoch,all};
    const active = project && Object.values(all).some(refs=>refs.length);
    const scenes = active ? new Map(sceneIndex(project).map(scene=>[scene.turn,scene])) : new Map();
    const elements = active ? new Map([...transcript.querySelectorAll('.assistant[data-story-turn]')]
      .map(article=>[Number(article.dataset.storyTurn),article.querySelector('.message-text')])) : new Map();
    if (!supportsHeatmap) {
      for (const element of transcript.querySelectorAll('[data-passage-mark]')) delete element.dataset.passageMark;
    }
    for (const kind of Object.keys(priorities)) {
      const matches = active ? (all[kind] || []).map(ref=>sceneRange(ref,scenes.get(ref.turn),elements.get(ref.turn))).filter(Boolean) : [];
      if (supportsHeatmap) {
        CSS.highlights.delete(`studio-${kind}`);
        if (matches.length) {
          const layer = new Highlight();
          layer.priority = priorities[kind];
          for (const {range} of matches) layer.add(range);
          CSS.highlights.set(`studio-${kind}`,layer);
        }
      } else if (kind in marks) {
        for (const {element} of matches) element.dataset.passageMark = kind;
      }
    }
  }

  function heatmap(next = {}) {
    layers = next;
    render();
  }

  function highlight(refs = []) {
    marks.passages = refs;
    if (!refs.length) marks.finding = [];
    render();
  }

  function focus(ref,element,mark = true,{onlyIfHidden = false,focus = true} = {}) {
    marks.finding = ref && mark ? [ref] : [];
    render();
    const match = ref && sceneRange(ref,sceneIndex(getStory()).find(scene=>scene.turn === ref.turn),element.querySelector('.message-text'));
    const anchor = match?.range.getClientRects()[0] || element.getBoundingClientRect();
    const area = transcript.getBoundingClientRect();
    if (!onlyIfHidden || anchor.top < area.top + 8 || anchor.top > area.bottom - 48) {
      transcript.scrollTop += anchor.top - area.top - 18;
    }
    if (focus) element.focus({preventScroll:true});
  }

  function readSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = (node.parentElement || node).closest?.('.message-text');
    const replacements = prose.get(element);
    if (!replacements || range.startContainer !== element.firstChild || range.endContainer !== element.firstChild) return;
    const article = element.closest('[data-story-turn]');
    const scene = sceneIndex(getStory()).find(scene=>scene.turn === Number(article.dataset.storyTurn));
    if (!scene) return;
    let start = mapOffset(range.startOffset,replacements,false,false);
    let end = mapOffset(range.endOffset,replacements,false,true);
    while (start < end && /\s/u.test(scene.text[start])) start++;
    while (end > start && /\s/u.test(scene.text[end - 1])) end--;
    if (end > start) return {selection,range,ref:reference(scene,start,end)};
  }

  function refresh() {
    refreshScheduled = false;
    if (!getStory() || !transcript.getClientRects().length) {
      toolbar.hidden = true;
      return;
    }
    const selected = readSelection();
    if (!selected) {
      if (!toolbar.contains(document.activeElement)) toolbar.hidden = true;
      selectedKey = undefined;
      return;
    }
    const actions = getActions(selected.ref);
    const anchor = selected.range.getBoundingClientRect();
    const limit = transcript.getBoundingClientRect();
    if (!actions?.length || anchor.bottom < limit.top || anchor.top > limit.bottom) {
      toolbar.hidden = true;
      return;
    }
    const key = JSON.stringify([selected.ref,actions.map(action=>action.label)]);
    if (selectedKey !== key) {
      toolbar.replaceChildren(...actions.map(({label,run})=>{
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = label;
        button.addEventListener('pointerdown',event=>{ if (event.pointerType === 'mouse') event.preventDefault(); });
        button.onclick = () => {
          selected.selection.removeAllRanges();
          toolbar.hidden = true;
          run();
        };
        return button;
      }));
      selectedKey = key;
    }
    toolbar.hidden = false;
    const {width,height} = toolbar.getBoundingClientRect();
    const left = Math.max(8,Math.min(anchor.left,innerWidth - width - 8));
    const top = Math.min(anchor.bottom + 8,limit.bottom - height - 5);
    toolbar.style.transform = `translate(${left}px,${Math.max(limit.top + 5,top)}px)`;
  }

  function scheduleRefresh() {
    if (!refreshScheduled) {
      refreshScheduled = true;
      requestAnimationFrame(refresh);
    }
  }

  document.addEventListener('selectionchange',scheduleRefresh);
  document.addEventListener('focusin',scheduleRefresh);
  transcript.addEventListener('scroll',scheduleRefresh,{passive:true});
  window.addEventListener('resize',scheduleRefresh,{passive:true});
  return {register,render,focus,highlight,heatmap,supportsHeatmap};
}
