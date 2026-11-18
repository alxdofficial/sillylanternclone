const fieldTitles = {
  instruction: 'Story direction',
  pasteText: 'New story prose',
  setupManuscript: 'Manuscript',
  setupContext: 'Additional context',
  setupMessage: 'Brainstorm message',
  setupScenario: 'Opening premise',
  setupLore: 'World & setting',
  setupNotes: 'Writing notes',
  setupPlotEvents: 'Plot events',
  continuityReference: 'Canon reference notes'
};
const namedFields = {lore:'World setting', loreRules:'Keyword lore', premise:'Opening premise', notes:'Writing notes'};
const targets = [
  ...Object.keys(fieldTitles).map(id => `textarea#${id}`),
  ...Object.keys(namedFields).map(name => `#settingsForm textarea[name="${name}"]`),
  '#castEditors textarea[data-field="description"]',
  '.setup-character-description'
].join(',');

const selection = field => [field.selectionStart,field.selectionEnd,field.selectionDirection];

function addEditor(field, number) {
  const title = fieldTitles[field.id] || namedFields[field.name] || 'Character description';
  const dialog = document.createElement('dialog');
  dialog.className = 'expanded-editor';
  dialog.id = `expandedEditor-${number}`;
  dialog.setAttribute('role','presentation');
  dialog.innerHTML = `<header class="expanded-editor-header" hidden>
    <h2 id="${dialog.id}-title"></h2>
    <button type="button" class="button primary" data-expanded-done>Done</button>
  </header>
  <footer class="expanded-editor-footer" hidden>
    <button type="button" class="text-button" data-expanded-discard>Discard expanded edits</button>
  </footer>`;
  const header = dialog.querySelector('header');
  const footer = dialog.querySelector('footer');
  const heading = dialog.querySelector('h2');
  heading.textContent = title;
  const discard = dialog.querySelector('[data-expanded-discard]');
  let draft;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'expanded-editor-trigger icon';
  button.title = 'Expand editor';
  button.setAttribute('aria-label',`Expand editor for ${title.toLowerCase()}`);
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-controls',dialog.id);
  button.innerHTML = '<svg class="tool-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-6 6M10 20H4v-6m0 6 6-6"/></svg>';

  const inlineLabel = field.closest('label');
  if (inlineLabel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'expanded-field';
    const labelHeader = document.createElement('div');
    labelHeader.className = 'expanded-field-header';
    if (!field.id) field.id = `expandableField-${number}`;
    inlineLabel.htmlFor = field.id;
    inlineLabel.before(wrapper);
    wrapper.append(labelHeader,dialog);
    labelHeader.append(inlineLabel,button);
  } else {
    field.before(dialog);
    const composerSlot = field.id === 'instruction' && (document.querySelector('#composerExpandEditor') || document.querySelector('#routeModels'));
    if (composerSlot) composerSlot.append(button);
    else {
      const labelHeader = document.createElement('div');
      labelHeader.className = 'expanded-field-header';
      const label = field.labels[0];
      dialog.before(labelHeader);
      if (label?.parentElement === dialog.parentElement) {
        label.classList.remove('sr-only');
        labelHeader.append(label);
      }
      labelHeader.append(button);
    }
  }
  footer.before(field);

  const viewport = window.visualViewport;
  function fitViewport() {
    dialog.style.setProperty('--editor-viewport-height',`${viewport.height}px`);
    dialog.style.setProperty('--editor-viewport-top',`${viewport.offsetTop}px`);
  }

  function open() {
    if (draft || field.disabled || field.readOnly) return;
    draft = {value:field.value,originalSelection:selection(field),scrollTop:field.scrollTop,
      scrollLeft:field.scrollLeft,labelledBy:field.getAttribute('aria-labelledby')};
    // Keep the textarea in place so the browser retains its native undo history.
    dialog.removeAttribute('role');
    dialog.setAttribute('aria-labelledby',heading.id);
    dialog.classList.add('expanded');
    header.hidden = footer.hidden = false;
    discard.disabled = true;
    field.setAttribute('aria-labelledby',heading.id);
    dialog.showModal();
    if (viewport) {
      fitViewport();
      viewport.addEventListener('resize',fitViewport);
      viewport.addEventListener('scroll',fitViewport);
    }
    field.focus({preventScroll:true});
    field.setSelectionRange(...draft.originalSelection);
    field.scrollTop = draft.scrollTop;
    field.scrollLeft = draft.scrollLeft;
  }

  function finish(keep = true) {
    if (!draft) return;
    const {value,scrollTop,scrollLeft,originalSelection,labelledBy} = draft;
    draft = null;
    const changed = field.value !== value;
    const restoredSelection = keep ? selection(field) : originalSelection;
    if (!keep && changed) field.value = value;
    viewport?.removeEventListener('resize',fitViewport);
    viewport?.removeEventListener('scroll',fitViewport);
    dialog.close();
    dialog.classList.remove('expanded');
    dialog.setAttribute('role','presentation');
    dialog.removeAttribute('aria-labelledby');
    header.hidden = footer.hidden = true;
    if (labelledBy === null) field.removeAttribute('aria-labelledby');
    else field.setAttribute('aria-labelledby',labelledBy);
    field.setSelectionRange(...restoredSelection);
    button.focus({preventScroll:true});
    if (!keep || !changed) {
      field.scrollTop = scrollTop;
      field.scrollLeft = scrollLeft;
    }
    if (keep && changed) field.dispatchEvent(new Event('input',{bubbles:true}));
  }

  button.addEventListener('click',open);
  header.querySelector('[data-expanded-done]').addEventListener('click',() => finish());
  discard.addEventListener('click',() => finish(false));
  dialog.addEventListener('cancel',event => {
    if (!draft) return;
    event.preventDefault();
    finish();
  });
  dialog.addEventListener('keydown',event => {
    if (draft && event.target === field && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
  },true);
  dialog.addEventListener('input',event => {
    if (!draft || event.target !== field) return;
    discard.disabled = field.value === draft.value;
    // Apply the enclosing form's input behavior once the author keeps the draft.
    event.stopPropagation();
  },true);
}

export function installExpandedEditors() {
  const registered = new WeakSet();
  let editorNumber = 0;
  function register(field) {
    if (registered.has(field)) return;
    registered.add(field);
    addEditor(field,++editorNumber);
  }
  document.querySelectorAll(targets).forEach(register);
  new MutationObserver(records => {
    for (const {addedNodes} of records) {
      for (const node of addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || !node.isConnected) continue;
        if (node.matches(targets)) register(node);
        node.querySelectorAll(targets).forEach(register);
      }
    }
  }).observe(document.body,{childList:true,subtree:true});
}
