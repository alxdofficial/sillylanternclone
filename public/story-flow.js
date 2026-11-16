export const storyFlowTitleLimit = 80;
export const storyFlowDirectionLimit = 400;

export function validStoryFlowOptions(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4) return false;
  const titles = new Set(), directions = new Set();
  const normalize = text=>text.trim().replace(/\s+/gu,' ').toLocaleLowerCase();
  for (const option of value) {
    if (typeof option?.title !== 'string' || !option.title.trim() || option.title.length > storyFlowTitleLimit
      || typeof option.direction !== 'string' || !option.direction.trim() || option.direction.length > storyFlowDirectionLimit) return false;
    titles.add(normalize(option.title));
    directions.add(normalize(option.direction));
  }
  return titles.size === value.length && directions.size === value.length;
}

export function storyFlowTurn(project) {
  return project.messages.at(-1)?.turnNumber || project.messages.length;
}

export function normalizeStoryFlow(flow) {
  if (!flow || !['mcp','openrouter'].includes(flow.source)
      || !Number.isSafeInteger(flow.afterTurn) || flow.afterTurn < 0 || !validStoryFlowOptions(flow.options)
      || (flow.selected !== undefined && (!Number.isInteger(flow.selected) || !flow.options[flow.selected]))) return undefined;
  return {source:flow.source,afterTurn:flow.afterTurn,
    options:flow.options.map(({title,direction})=>({title:title.trim(),direction:direction.trim()})),
    ...(flow.selected === undefined ? {} : {selected:flow.selected})};
}

export function activeStoryFlow(project) {
  const flow = normalizeStoryFlow(project.storyFlow);
  return flow?.afterTurn === storyFlowTurn(project) ? flow : undefined;
}
