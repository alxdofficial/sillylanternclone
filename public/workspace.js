const defaults = { outline: 216, tools: 264, split: 50, composer: 100, flow: 78 };
const preferenceKey = 'studio-workspace-layout';
const labels = {
  scene: 'In this scene',
  pacing: 'Pacing',
  themes: 'Themes',
  threads: 'Setups & payoffs',
  continuity: 'Continuity'
};
const revisionTools = new Set(['pacing', 'themes', 'threads']);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function createWorkspace({ onToolChange, onComposerChange, onResize }) {
  const get = id => document.getElementById(id);
  const workspace = get('writeView');
  const panel = workspace.querySelector('.story-panel');
  const outline = get('storyTurnSidebar');
  const tools = get('workspaceTools');
  const toolHeading = get('workspaceToolHeading');
  const flowBody = get('storyFlowBody');
  const flowOptions = get('storyFlowOptions');
  const composer = get('writingComposer');
  const composerDock = get('composerDock');
  const routeModels = get('routeModels');
  const outlineToggle = get('toggleStoryTurns');
  const toolsToggle = get('toggleWritingTools');
  const flowToggle = get('toggleStoryFlow');
  const composerToggle = get('toggleComposer');
  const modelToggle = get('toggleComposerModels');
  const catalogue = get('workspaceToolList');
  const controls = get('workspaceLayoutMenu');
  const returnButton = get('returnToTool');
  const backdrop = get('workspaceBackdrop');
  const toolButtons = [...catalogue.querySelectorAll('[data-workspace-tool]')];
  const dividers = [...workspace.querySelectorAll('[data-workspace-divider]')];
  const presets = [...controls.querySelectorAll('[data-workspace-size]')];
  const summaries = Object.fromEntries(toolButtons.map(button => [
    button.dataset.workspaceTool, button.querySelector('small').textContent
  ]));

  let preferences = { ...defaults, showOutline: true, showTools: true, showFlow: true, showComposer: true };
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey));
    if (saved) {
      for (const name of Object.keys(preferences)) {
        if (typeof saved[name] === typeof preferences[name]) preferences[name] = saved[name];
      }
    } else if (sessionStorage.getItem('studio-hide-composer') === 'true') {
      preferences.showComposer = false;
    }
  } catch {
    // The workspace still works when storage is unavailable.
  }
  const save = () => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch {}
  };

  let width = 0;
  let height = 0;
  let writing = true;
  let overlay;
  let active;
  let returnTool;
  let flowOverride;
  let composerEditing = false;
  let modelsOpen = false;
  let drag;
  const split = () => Boolean(active) && width >= 940;
  const compactOutline = () => width < 760;
  const compactCatalogue = () => width < 1130;
  const short = () => height > 0 && height < 540;
  const compactComposer = () => short() || width > 0 && width <= 520;

  function range(name) {
    switch (name) {
      case 'outline': {
        const available = compactOutline() || split() ? Math.floor(width * .88)
          : width - (compactCatalogue() || !preferences.showTools ? 460 : 770);
        return [162, clamp(available, 162, 350)];
      }
      case 'tools': {
        const available = compactCatalogue() ? Math.floor(width * .88) : width - (preferences.showOutline ? 750 : 510);
        return [215, clamp(available, 215, 380)];
      }
      case 'split': return [Math.ceil(41000 / width), Math.floor(100 - 41000 / width)];
      case 'composer': return [52, Math.max(52, Math.min(420, Math.floor(height * (short() ? 0.24 : 0.38))))];
      case 'flow': return [58, Math.max(58, Math.min(195, Math.floor(height * (short() ? .15 : .24))))];
    }
  }

  function size(name) {
    const [minimum, maximum] = range(name);
    return clamp(preferences[name], minimum, maximum);
  }

  function setPreferences(values) {
    const isNearLatest = onResize?.();
    Object.assign(preferences, values);
    save();
    update();
    isNearLatest?.();
  }

  function syncCarousel() {
    const overflow = flowOptions.scrollWidth > flowOptions.clientWidth + 1;
    get('storyFlowPages').hidden = flowBody.hidden || !overflow;
    get('previousFlowOption').disabled = flowOptions.scrollLeft < 2;
    get('nextFlowOption').disabled = !overflow || flowOptions.scrollLeft + flowOptions.clientWidth > flowOptions.scrollWidth - 3;
  }

  function update() {
    const hasSplit = split();
    const mainVisible = !active || hasSplit;
    const outlineOverlay = overlay === 'outline';
    const outlineVisible = outlineOverlay || !active && !compactOutline() && preferences.showOutline;
    const toolsVisible = Boolean(active) || (compactCatalogue() ? overlay === 'tools' : preferences.showTools);
    const flowOpen = short() ? Boolean(flowOverride) : preferences.showFlow;
    const showComposer = preferences.showComposer || composerEditing;
    const shortMode = short();
    const compactControls = compactComposer();
    const previous = workspace.dataset.layout;
    workspace.dataset.layout = active ? hasSplit ? 'split' : 'tool'
      : [outlineVisible && !outlineOverlay ? 'outline' : '', toolsVisible && !compactCatalogue() ? 'tools' : ''].filter(Boolean).join('-') || 'manuscript';
    workspace.toggleAttribute('data-short', shortMode);
    workspace.toggleAttribute('data-compact-composer', compactControls);
    workspace.toggleAttribute('data-models-open', compactControls && modelsOpen);
    workspace.toggleAttribute('data-flow-open', flowOpen);
    workspace.toggleAttribute('data-flow-expanded', size('flow') >= 110);
    workspace.toggleAttribute('data-outline-overlay', outlineOverlay);
    workspace.toggleAttribute('data-tools-overlay', !active && toolsVisible && compactCatalogue());
    workspace.toggleAttribute('data-very-short', shortMode && height < 335);
    panel.hidden = !mainVisible;
    panel.inert = Boolean(overlay);
    outline.hidden = !outlineVisible;
    outline.inert = overlay === 'tools';
    outline.toggleAttribute('data-open', outlineVisible);
    tools.hidden = !toolsVisible;
    tools.inert = outlineOverlay;
    backdrop.hidden = !workspace.hasAttribute('data-outline-overlay') && !workspace.hasAttribute('data-tools-overlay');
    flowBody.hidden = !flowOpen || !flowOptions.childElementCount;
    flowToggle.setAttribute('aria-expanded', String(flowOpen));
    const count = flowOptions.childElementCount;
    get('storyFlowHeading').textContent = !flowOpen && count ? `Story Flow · ${count} ideas` : 'Story Flow';
    composer.hidden = !showComposer;
    composerToggle.setAttribute('aria-expanded', String(showComposer));
    composerToggle.title = showComposer ? 'Hide composer' : 'Show composer';
    composerToggle.setAttribute('aria-label', composerToggle.title);
    composerToggle.disabled = composerEditing;
    modelToggle.hidden = !showComposer || !compactControls || routeModels.hidden;
    modelToggle.setAttribute('aria-expanded', String(!modelToggle.hidden && modelsOpen));
    outlineToggle.hidden = !writing;
    toolsToggle.hidden = !writing;
    controls.hidden = !writing;
    outlineToggle.setAttribute('aria-expanded', String(outlineVisible));
    toolsToggle.setAttribute('aria-expanded', String(toolsVisible));
    returnButton.hidden = !returnTool || Boolean(active);
    if (returnTool) returnButton.textContent = `Back to ${labels[returnTool]}`;

    workspace.style.setProperty('--outline-width', `${size('outline')}px`);
    workspace.style.setProperty('--tools-width', `${size('tools')}px`);
    workspace.style.setProperty('--tools-share', `${size('split')}%`);
    workspace.style.setProperty('--composer-height', `${size('composer')}px`);
    workspace.style.setProperty('--flow-height', `${size('flow')}px`);
    if (!modelToggle.hidden && modelsOpen) {
      const available = composerDock.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
      composerDock.style.setProperty('--available-model-height', `${Math.max(44, Math.floor(available))}px`);
    }
    for (const divider of dividers) {
      const id = divider.dataset.workspaceDivider;
      const name = id === 'tools' && hasSplit ? 'split' : id;
      const [minimum, maximum] = range(name);
      divider.hidden = !({
        outline: outlineVisible && !outlineOverlay,
        tools: hasSplit || !active && toolsVisible && !compactCatalogue(),
        composer: showComposer && mainVisible && height > 0,
        flow: !flowBody.hidden && mainVisible
      })[id];
      if (divider.hidden && document.activeElement === divider) {
        ({ outline: outlineToggle, tools: toolsToggle, composer: composerToggle, flow: flowToggle })[id].focus();
      }
      const current = size(name);
      divider.setAttribute('aria-valuemin', String(minimum));
      divider.setAttribute('aria-valuemax', String(maximum));
      divider.setAttribute('aria-valuenow', String(current));
      divider.setAttribute('aria-valuetext', name === 'split' ? `${current}% for tools` : `${current} pixels`);
    }
    for (const select of presets) {
      const saved = String(preferences[select.dataset.workspaceSize]);
      const custom = select.querySelector('[data-custom-size]');
      if (![...select.options].some(option => option !== custom && option.value === saved)) {
        const option = custom || select.appendChild(new Option());
        option.dataset.customSize = '';
        option.value = saved;
        option.textContent = `Custom (${saved}${select.dataset.workspaceSize === 'split' ? '%' : ' px'})`;
        option.disabled = true;
      } else custom?.remove();
      select.value = saved;
    }
    if (previous !== workspace.dataset.layout && hasSplit) controls.open = false;
    syncCarousel();
  }

  function open(tool, { focus = true } = {}) {
    if (!Object.hasOwn(labels, tool)) return;
    const keepScroll = active === tool || returnTool === tool;
    active = tool;
    overlay = undefined;
    returnTool = undefined;
    catalogue.hidden = true;
    get('backToTools').hidden = false;
    get('workspaceScene').hidden = tool !== 'scene';
    get('revisionView').hidden = !revisionTools.has(tool);
    get('continuityReview').hidden = tool !== 'continuity';
    toolHeading.textContent = labels[tool];
    update();
    onToolChange(tool);
    if (!keepScroll) get('workspaceToolContent').scrollTop = 0;
    if (focus) toolHeading.focus({ preventScroll: true });
  }

  function showCatalogue({ focus = true } = {}) {
    const previous = active || returnTool;
    active = undefined;
    returnTool = undefined;
    get('backToTools').hidden = true;
    get('workspaceScene').hidden = true;
    get('revisionView').hidden = true;
    get('continuityReview').hidden = true;
    catalogue.hidden = false;
    toolHeading.textContent = 'Writing tools';
    update();
    if (previous) onToolChange(undefined);
    if (focus) (toolButtons.find(button => button.dataset.workspaceTool === previous) || toolHeading).focus({ preventScroll: true });
  }

  function dismissOutline() {
    if (overlay !== 'outline') return;
    overlay = undefined;
    update();
  }

  function closeTools() {
    overlay = undefined;
    setPreferences(compactCatalogue() ? {} : { showTools: false });
    showCatalogue({ focus: false });
    toolsToggle.focus();
  }

  function backToManuscript({ focus = false } = {}) {
    if (!active || split()) return;
    returnTool = active;
    active = undefined;
    overlay = undefined;
    update();
    if (focus) returnButton.focus();
  }

  function toggleOverlay(name, trigger, target) {
    const close = overlay === name;
    overlay = close ? undefined : name;
    update();
    if (close) trigger.focus();
    else target.focus({ preventScroll: true });
  }

  outlineToggle.addEventListener('click', () => {
    if (active && split()) {
      toggleOverlay('outline', outlineToggle, outline.querySelector('h2'));
    } else if (active) {
      backToManuscript();
      if (compactOutline()) toggleOverlay('outline', outlineToggle, outline.querySelector('h2'));
      else if (!preferences.showOutline) setPreferences({ showOutline: true });
    } else if (compactOutline()) {
      toggleOverlay('outline', outlineToggle, outline.querySelector('h2'));
    } else {
      setPreferences({ showOutline: !preferences.showOutline });
    }
  });
  toolsToggle.addEventListener('click', () => {
    if (active || !tools.hidden) closeTools();
    else if (compactCatalogue()) {
      showCatalogue({ focus: false });
      toggleOverlay('tools', toolsToggle, toolHeading);
    } else {
      showCatalogue({ focus: false });
      setPreferences({ showTools: true });
    }
  });
  get('closeWritingTools').addEventListener('click', closeTools);
  get('backToTools').addEventListener('click', () => {
    if (compactCatalogue()) overlay = 'tools';
    else setPreferences({ showTools: true });
    showCatalogue();
  });
  returnButton.addEventListener('click', () => open(returnTool));
  for (const button of toolButtons) button.addEventListener('click', () => open(button.dataset.workspaceTool));

  function dismissOverlay() {
    if (!overlay) return;
    const trigger = overlay === 'outline' ? outlineToggle : toolsToggle;
    overlay = undefined;
    update();
    trigger.focus();
  }
  backdrop.addEventListener('click', dismissOverlay);
  workspace.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (overlay) {
      event.preventDefault();
      dismissOverlay();
    } else if (modelsOpen && compactComposer() && event.target.closest('#composerDock')) {
      event.preventDefault();
      modelsOpen = false;
      update();
      modelToggle.focus();
    }
  });
  controls.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !controls.open) return;
    controls.open = false;
    controls.querySelector('summary').focus();
  });
  document.addEventListener('pointerdown', event => {
    if (controls.open && !controls.contains(event.target)) controls.open = false;
    if (compactComposer() && modelsOpen && !routeModels.contains(event.target) &&
        !modelToggle.contains(event.target) && !event.target.closest?.('.picker-list')) {
      modelsOpen = false;
      update();
    }
  });

  flowToggle.addEventListener('click', () => {
    const open = flowToggle.getAttribute('aria-expanded') === 'true';
    if (short()) {
      flowOverride = !open;
      update();
    } else setPreferences({ showFlow: !open });
  });
  composerToggle.addEventListener('click', () => {
    if (composerEditing) return;
    if (preferences.showComposer) modelsOpen = false;
    setPreferences({ showComposer: !preferences.showComposer });
    onComposerChange();
  });
  modelToggle.addEventListener('click', () => {
    modelsOpen = !modelsOpen;
    update();
  });
  function moveFlow(direction) {
    const step = flowOptions.firstElementChild?.getBoundingClientRect().width || flowOptions.clientWidth;
    const gap = parseFloat(getComputedStyle(flowOptions).columnGap) || 0;
    flowOptions.scrollBy({ left: (step + gap) * direction, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  get('previousFlowOption').addEventListener('click', () => moveFlow(-1));
  get('nextFlowOption').addEventListener('click', () => moveFlow(1));
  flowOptions.addEventListener('scroll', syncCarousel, { passive: true });
  new ResizeObserver(syncCarousel).observe(flowOptions);

  for (const select of presets) select.addEventListener('change', () => {
    const name = select.dataset.workspaceSize;
    if (name === 'flow' && short()) flowOverride = true;
    setPreferences({ [name]: Number(select.value) });
  });
  get('resetWorkspaceLayout').addEventListener('click', () => {
    overlay = undefined;
    flowOverride = undefined;
    modelsOpen = false;
    setPreferences({ ...defaults, showOutline: true, showTools: true, showFlow: true, showComposer: true });
    controls.open = false;
    controls.querySelector('summary').focus();
    onComposerChange();
  });

  function side(name) { return name === 'outline' || name === 'tools'; }
  function resize(name, value) {
    const [minimum, maximum] = range(name);
    setPreferences({ [name]: clamp(Math.round(value), minimum, maximum) });
  }
  for (const divider of dividers) {
    const id = divider.dataset.workspaceDivider;
    const name = () => id === 'tools' && split() ? 'split' : id;
    const axis = event => side(id) ? event.clientX : event.clientY;
    const direction = id === 'outline' ? 1 : -1;
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      const kind = name();
      drag = { kind, origin: axis(event), value: size(kind) };
      workspace.setAttribute('data-resizing', '');
      divider.setPointerCapture(event.pointerId);
    });
    divider.addEventListener('pointermove', event => {
      if (!drag || !divider.hasPointerCapture(event.pointerId)) return;
      const movement = (axis(event) - drag.origin) * direction;
      resize(drag.kind, drag.value + (drag.kind === 'split' ? movement * 100 / width : movement));
    });
    divider.addEventListener('lostpointercapture', () => {
      drag = undefined;
      workspace.removeAttribute('data-resizing');
    });
    divider.addEventListener('keydown', event => {
      const kind = name();
      const increment = kind === 'split' ? 2 : 16;
      const [minimum, maximum] = range(kind);
      let next;
      if (event.key === 'Home') next = minimum;
      else if (event.key === 'End') next = maximum;
      else if (event.key === (side(id) ? 'ArrowLeft' : 'ArrowUp')) next = size(kind) - increment * direction;
      else if (event.key === (side(id) ? 'ArrowRight' : 'ArrowDown')) next = size(kind) + increment * direction;
      else return;
      event.preventDefault();
      resize(kind, next);
    });
  }

  new ResizeObserver(([entry]) => {
    const bounds = entry.contentRect;
    if (!bounds.width || !bounds.height) return;
    const wasShort = short();
    const wasCompact = compactComposer();
    width = bounds.width;
    height = bounds.height;
    if (compactComposer() !== wasCompact) modelsOpen = false;
    if (short() !== wasShort) flowOverride = undefined;
    if (overlay === 'outline' && !active && !compactOutline()
      || overlay === 'tools' && !compactCatalogue()) overlay = undefined;
    update();
  }).observe(workspace);
  update();

  return {
    open,
    backToManuscript,
    dismissOutline,
    get activeTool() { return active; },
    get composerOpen() { return preferences.showComposer || composerEditing; },
    setComposerEditing(editing) { composerEditing = editing; update(); },
    setComposerOpen(showComposer) { setPreferences({ showComposer }); },
    showComposerModels() {
      modelsOpen = true;
      setPreferences({ showComposer: true });
    },
    setWritingView(isWriting) { writing = isWriting; overlay = undefined; update(); },
    syncFlow() { update(); },
    renderCatalogue(previews) {
      for (const button of toolButtons) {
        const tool = button.dataset.workspaceTool;
        button.querySelector('small').textContent = previews[tool] || summaries[tool];
      }
    }
  };
}
