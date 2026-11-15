const get = id => document.getElementById(id);
const firstNames = ['Rowan', 'Mara', 'Avery', 'Jules', 'Leona', 'Nico', 'Lena', 'Adrian', 'Ellis', 'Sasha', 'Robin', 'Ari', 'Mina', 'Tessa', 'Noel', 'Quinn', 'Iris', 'Remy', 'Rory', 'Esme'];
const lastNames = ['Hale', 'Mercer', 'Dalton', 'Flynn', 'Voss', 'Reyes', 'Fenwick', 'Keane', 'Parker', 'Dawson', 'Larkin', 'Reed', 'Valdez', 'Gardner', 'Desai', 'Lin', 'Santos', 'Kwan', 'Patel', 'Bennett'];
const status = message => { get('status').textContent = message; };
const nameKey = name => name.toLowerCase();
const randomChoice = choices => choices[crypto.getRandomValues(new Uint32Array(1))[0] % choices.length];
const mapping = new Map();

get('make').onclick = () => {
  const unique = new Map();
  for (const line of get('names').value.split('\n')) {
    const name = line.trim();
    if (name && !unique.has(nameKey(name))) unique.set(nameKey(name), name);
  }
  if (!unique.size || unique.size > 50) return status('Enter between 1 and 50 source names.');
  const previous = new Map(mapping);
  mapping.clear();
  get('mapping').replaceChildren();
  get('output').value = '';
  const used = new Set([...unique.keys(), ...[...previous.values()].map(input => nameKey(input.value.trim()))]);
  for (const [key, name] of unique) {
    const row = document.createElement('div');
    row.className = 'name-row';
    const label = document.createElement('label');
    label.textContent = name;
    label.htmlFor = 'alias-' + mapping.size;
    const input = document.createElement('input');
    input.id = label.htmlFor;
    input.maxLength = 120;
    let alias = previous.get(key)?.value;
    if (!alias) {
      do { alias = randomChoice(firstNames) + ' ' + randomChoice(lastNames); }
      while (used.has(nameKey(alias)));
    }
    used.add(nameKey(alias));
    input.value = alias;
    input.addEventListener('input', () => { get('output').value = ''; });
    mapping.set(key, input);
    row.append(label, input);
    get('mapping').append(row);
  }
  status('Review or edit the aliases, then replace names in the draft.');
};
get('source').oninput = () => { get('output').value = ''; };
get('apply').onclick = () => {
  if (!mapping.size) return status('Generate a name table first.');
  const aliases = new Map([...mapping].map(([name, input]) => [name, input.value.trim()]));
  const values = [...aliases.values()].map(nameKey);
  if (values.some(name => !name || mapping.has(name)) || new Set(values).size !== values.length) {
    return status('Give each source name a unique alias different from every source name.');
  }
  const escaped = [...mapping.keys()].sort((a,b) => b.length-a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('(?<![\\p{L}\\p{M}\\p{N}_])(?:' + escaped.join('|') + ')(?![\\p{L}\\p{M}\\p{N}_])', 'giu');
  let count = 0;
  get('output').value = get('source').value.replace(pattern, match => {
    const alias = aliases.get(nameKey(match));
    if (!alias) return match;
    count += 1;
    return alias;
  });
  status(count + (count === 1 ? ' name replaced.' : ' names replaced.'));
};
get('copy').onclick = async () => {
  if (!get('output').value) return status('Replace names in a draft first.');
  try { await navigator.clipboard.writeText(get('output').value); status('Draft copied.'); }
  catch { get('output').select(); status('Select and copy the output manually.'); }
};
