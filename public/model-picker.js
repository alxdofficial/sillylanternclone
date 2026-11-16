// Keep the select as the value source and as a fallback for older browsers.
export function enhanceSelect(select) {
  const list = document.createElement('div');
  if (typeof list.showPopover !== 'function') return {sync() {}, focus:()=>select.focus()};

  const button = document.createElement('button');
  const value = document.createElement('span');
  const chevron = document.createElement('span');
  const label = select.labels[0];
  const description = select.getAttribute('aria-describedby');
  const labelId = select.id + '-label';
  button.id = select.id + '-picker';
  button.className = 'picker-trigger';
  button.type = 'button';
  button.setAttribute('role','combobox');
  button.setAttribute('aria-expanded','false');
  button.setAttribute('aria-haspopup','listbox');
  button.setAttribute('aria-controls',select.id + '-options');
  if (label) {
    label.id ||= labelId;
    label.htmlFor = button.id;
    button.setAttribute('aria-labelledby',label.id);
  }
  value.id = button.id + '-value';
  value.className = 'picker-selection';
  button.setAttribute('aria-describedby',[value.id,description].filter(Boolean).join(' '));
  chevron.className = 'picker-chevron';
  chevron.setAttribute('aria-hidden','true');
  button.append(value,chevron);

  list.id = select.id + '-options';
  list.className = 'picker-list';
  list.setAttribute('popover','auto');
  list.setAttribute('role','listbox');
  if (label) list.setAttribute('aria-labelledby',label.id);
  select.hidden = true;
  select.after(button,list);

  let choices = [];
  let active = -1;
  let search = '';
  let lastKeyAt = 0;

  function optionContents(option, showDetail = false) {
    const name = document.createElement('span');
    name.className = 'picker-name';
    name.textContent = option?.dataset.name || option?.textContent || 'Pick a model';
    const result = [name];
    if (option?.dataset.tag) {
      const tag = document.createElement('span');
      tag.className = 'picker-tag';
      tag.dataset.kind = option.dataset.tag;
      tag.textContent = option.dataset.tag;
      result.push(tag);
    }
    if (showDetail && option?.dataset.detail) {
      const detail = document.createElement('span');
      detail.className = 'picker-detail';
      detail.textContent = option.dataset.detail;
      result.push(detail);
    }
    return result;
  }

  function isOpen() {
    return list.matches(':popover-open');
  }

  function place() {
    const trigger = button.getBoundingClientRect();
    const gutter = 8;
    const width = Math.min(document.documentElement.clientWidth - 2 * gutter,Math.max(260,trigger.width));
    const below = window.innerHeight - trigger.bottom - 2 * gutter;
    const above = trigger.top - 2 * gutter;
    const opensAbove = below < Math.min(320,list.scrollHeight) && above > below;
    list.style.width = width + 'px';
    list.style.maxHeight = Math.max(0,Math.min(320,opensAbove ? above : below)) + 'px';
    list.style.left = Math.max(gutter,Math.min(trigger.left,document.documentElement.clientWidth - width - gutter)) + 'px';
    list.style.top = (opensAbove ? trigger.top - list.offsetHeight - 5 : trigger.bottom + 5) + 'px';
  }

  function highlight(index, scroll = true) {
    if (!choices.length) return;
    choices[active]?.row.removeAttribute('data-active');
    active = (index + choices.length) % choices.length;
    const {row} = choices[active];
    row.dataset.active = '';
    button.setAttribute('aria-activedescendant',row.id);
    if (scroll) row.scrollIntoView({block:'nearest'});
  }

  function close() {
    if (isOpen()) list.hidePopover();
    button.setAttribute('aria-expanded','false');
    button.removeAttribute('aria-activedescendant');
    search = '';
  }

  function choose(index) {
    const option = choices[index]?.option;
    if (!option) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close();
    sync();
    if (changed) select.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function open() {
    if (button.disabled || isOpen()) return;
    choices = Array.from(select.options).filter(option=>!option.disabled).map((option,index)=>{
      const row = document.createElement('div');
      row.id = list.id + '-' + index;
      row.className = 'picker-option';
      row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(option.selected));
      row.append(...optionContents(option,true));
      row.addEventListener('mousemove',()=>{ if (active !== index) highlight(index,false); });
      row.addEventListener('mousedown',event=>event.preventDefault());
      row.addEventListener('click',()=>choose(index));
      return {row,option};
    });
    if (!choices.length) return;
    list.replaceChildren(...choices.map(({row})=>row));
    list.showPopover();
    button.setAttribute('aria-expanded','true');
    place();
    highlight(Math.max(0,choices.findIndex(({option})=>option.selected)));
  }

  function sync() {
    button.disabled = select.disabled;
    if (button.disabled || (isOpen() && choices.some(({option}) => option.parentElement !== select))) close();
    const option = select.selectedOptions[0] || select.options[0];
    value.replaceChildren(...optionContents(option));
    value.title = option?.dataset.name || option?.textContent || '';
    button.classList.toggle('picker-placeholder',!select.value);
  }

  button.addEventListener('click',()=>isOpen() ? close() : open());
  button.addEventListener('keydown',event=>{
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') return close();
    if (['Enter',' ','ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      if (!isOpen()) return open();
      if (event.key === 'Enter' || event.key === ' ') return choose(active);
      if (event.key === 'Home') return highlight(0);
      if (event.key === 'End') return highlight(choices.length - 1);
      return highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    }
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!isOpen()) open();
    const now = Date.now();
    search = (now - lastKeyAt < 600 ? search : '') + event.key.toLowerCase();
    lastKeyAt = now;
    const index = choices.findIndex(({option})=>(option.dataset.name || option.textContent).toLowerCase().startsWith(search));
    if (index >= 0) highlight(index);
  });
  list.addEventListener('toggle',()=>{
    if (!isOpen()) close();
  });
  window.addEventListener('resize',()=>{ if (isOpen()) place(); });
  window.addEventListener('scroll',event=>{
    if (isOpen() && !(event.target instanceof Node && list.contains(event.target))) place();
  },true);

  sync();
  return {sync, close, focus:()=>button.focus()};
}
