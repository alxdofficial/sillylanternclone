export const storyFlowTitleLimit = 80;
export const storyFlowDirectionLimit = 400;
export const storyFlowConsequenceLimit = 160;
export const storyFlowOptionCount = 3;

export function validStoryFlowOptions(value) {
  if (!Array.isArray(value) || value.length !== storyFlowOptionCount) return false;
  const titles = new Set(), directions = new Set();
  const normalize = text=>text.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
  for (const option of value) {
    if (typeof option?.title !== 'string' || !option.title.trim() || option.title.length > storyFlowTitleLimit
      || typeof option.direction !== 'string' || !option.direction.trim() || option.direction.length > storyFlowDirectionLimit
      || option.consequence !== undefined && (typeof option.consequence !== 'string' ||
        !option.consequence.trim() || option.consequence.length > storyFlowConsequenceLimit)) return false;
    titles.add(normalize(option.title));
    directions.add(normalize(option.direction));
  }
  return titles.size === value.length && directions.size === value.length;
}

export function storyFlowTurn(project) {
  return project.messages.at(-1)?.turnNumber || project.messages.length;
}

export function normalizeStoryFlow(flow) {
  if (!flow || !['mcp','openrouter','anthropic','openai'].includes(flow.source)
      || !Number.isSafeInteger(flow.afterTurn) || flow.afterTurn < 0 || !Array.isArray(flow.options)
      || (flow.selected !== undefined && (!Number.isInteger(flow.selected) || !flow.options[flow.selected]))) return undefined;
  let {options,selected} = flow;
  // Preserve a writer's selection if they had picked the fourth legacy option.
  if (options.length === storyFlowOptionCount + 1) {
    options = options.slice(0,storyFlowOptionCount);
    if (selected === storyFlowOptionCount) {
      selected = storyFlowOptionCount - 1;
      options[selected] = flow.options[storyFlowOptionCount];
    }
  }
  if (!validStoryFlowOptions(options)) return undefined;
  return {source:flow.source,afterTurn:flow.afterTurn,
    options:options.map(({title,direction,consequence})=>({title:title.trim(),direction:direction.trim(),
      ...(consequence ? {consequence:consequence.trim()} : {})})),
    ...(selected === undefined ? {} : {selected})};
}

export function activeStoryFlow(project) {
  const flow = normalizeStoryFlow(project.storyFlow);
  return flow?.afterTurn === storyFlowTurn(project) ? flow : undefined;
}
