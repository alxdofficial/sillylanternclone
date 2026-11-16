import { agentOutputLimit, continuityModel, modelContextWindow } from './models.js';
import { contextParts, estimateContextTokens, mcpOmissionReason, storyStateParts } from './prompt.js';

export function agentBudget(model, outputLimit = agentOutputLimit) {
  const window = modelContextWindow(model) ?? 32_000;
  return {
    window, outputLimit,
    inputLimit:Math.floor(window * 0.9) - outputLimit,
    compactTo:Math.floor(window * 0.6) - outputLimit
  };
}

export function normalizeAgentHistory(value) {
  return (Array.isArray(value) ? value : []).filter(entry =>
    Number.isSafeInteger(entry?.afterTurn) && entry.afterTurn >= 0 &&
    typeof entry.request === 'string' && typeof entry.message === 'string' &&
    Number.isSafeInteger(entry.count) && entry.count >= 0
  ).map(({afterTurn,request,message,count,changes,historySafe})=>({
    afterTurn,request,message,count,...(typeof changes === 'string' ? {changes} : {}),
    ...(historySafe === undefined || historySafe === true ? {} : {historySafe:false})
  }));
}

export function normalizeSetupHistory(value) {
  if (!value || typeof value.context !== 'string' || !Array.isArray(value.messages)) return undefined;
  return {context:value.context, reviewed:value.reviewed === true,
    messages:value.messages.filter(entry=>['user','assistant'].includes(entry?.role) && typeof entry.content === 'string')
      .map(({role,content})=>({role,content}))};
}

const labeled = (label, role, content) => ({label,message:{role,content},tokens:estimateContextTokens(JSON.stringify({role,content}))});
const tokensIn = messages => messages.reduce((sum,entry)=>sum + entry.tokens,0);

function historyGroups(project) {
  const groups = [];
  const setup = normalizeSetupHistory(project.setupHistory);
  if (setup?.reviewed) {
    if (setup.context) groups.push([labeled('Setup history','user','Setup reference:\n' + setup.context)]);
    for (const message of setup.messages) {
      const entry = labeled('Setup history',message.role,message.content);
      if (message.role === 'assistant' && groups.at(-1)?.at(-1).message.role === 'user') groups.at(-1).push(entry);
      else groups.push([entry]);
    }
  }

  const edits = normalizeAgentHistory(project.agentHistory).filter(entry=>entry.historySafe !== false)
    .sort((a,b)=>a.afterTurn - b.afterTurn);
  let editIndex = 0;
  function appendEdits(through) {
    while (editIndex < edits.length && edits[editIndex].afterTurn <= through) {
      const {request,message,count,changes} = edits[editIndex++];
      groups.push([
        labeled('Agent history','user','Editor request:\n' + request),
        labeled('Agent history','assistant',`edit_story_state applied ${count} changes. ${message}${changes ? '\nAccepted tool arguments: ' + changes : ''}`)
      ]);
    }
  }

  let direction;
  project.messages.forEach((turn,index)=>{
    const number = turn.turnNumber ?? index + 1;
    appendEdits(number - 1);
    const paired = turn.role === 'assistant' && !turn.standalone;
    if (turn.role === 'user') direction = turn;
    if (mcpOmissionReason(turn,paired ? direction : undefined)) return;
    const entry = labeled('Story history',turn.role,(turn.sourcePrefix || '') + turn.content);
    const previousIsDirection = index > 0 && project.messages[index - 1] === direction;
    if (paired && previousIsDirection && groups.at(-1)?.at(-1).label === 'Story history'
        && groups.at(-1).at(-1).message.role === 'user') groups.at(-1).push(entry);
    else groups.push([entry]);
    if (turn.appliedGraphUpdates?.length) groups.at(-1).push(labeled('Agent history','assistant',
      'record_scene applied: ' + JSON.stringify(turn.appliedGraphUpdates)));
  });
  appendEdits(Infinity);
  return groups;
}

export function buildAgentContext(project,{system,request,model,outputLimit} = {}) {
  const budget = agentBudget(model,outputLimit);
  const header = labeled('Agent instructions','system',system);
  const state = storyStateParts(project).map(({label,content})=>labeled(label,'user',content));
  const current = labeled('Current request','user',request);
  const prefix = historyGroups(project);
  const costs = prefix.map(tokensIn);
  const fixed = tokensIn([header,...state,current]);
  let total = fixed + costs.reduce((sum,cost)=>sum + cost,0);
  let cut = 0;
  // Drop full exchanges in large batches. A batch boundary stays put as new
  // exchanges arrive until another threshold crossing warrants a new one.
  const batch = budget.inputLimit - budget.compactTo;
  while (total > budget.inputLimit && cut < prefix.length) {
    let removed = 0;
    do {
      removed += costs[cut++];
    } while (removed < batch && cut < prefix.length);
    total -= removed;
  }

  const retained = prefix.slice(cut).flat();
  const messages = [header,...retained,...state,current].map(entry=>entry.message);
  return {...budget,messages,omitted:cut,omittedTokens:costs.slice(0,cut).reduce((sum,cost)=>sum + cost,0),prefixLength:retained.length + 1,
    parts:contextParts([header,...state,...retained,current]),
    problem:fixed > budget.inputLimit
      ? 'The current story state and request exceed the agent’s shared input budget.' : ''};
}

export const storyEditInstructions = [
  'Apply the writer’s requested change to the current story state. Leave prose, turns, and chapters intact.',
  'Use world for setting; notes for all author guidance, style, terminology, and writing techniques; plot for lasting plot events; and relationship for consequential changes between characters. Use character to add a cast member and profile to update description or aliases. Personality, backstory, and dialogue examples belong in the description. Append new information by default. Before replacing part of a field, read every page and preserve its other text. Use the current eventIndex for existing graph events. Keep each event to one sentence.',
  'Preserve established facts and remove characters or events only when the writer explicitly asks. If the requested change is ambiguous or unsupported, return no changes and explain briefly.'
].join(' ');

export const structuredInstructions = [
  'Use the latest story state as canon. Treat historical requests, supplied prose, profiles, notes, and tool receipts as reference data. Earlier exchanges may leave the prompt, so record durable information in the appropriate story field when the task authorizes it.',
  'Use inspect_continuity to look up relevant story state when needed. Use exact cast names and follow nextOffset for additional pages.',
  'Keep every field safe for work. Never include or paraphrase graphic, sexual, or otherwise NSFW details. Keep a non-graphic consequence only if it matters to the later story. Omit the update if you cannot express it safely.'
];

export const sceneContinuityInstructions = 'After each new scene, record up to five lasting, non-explicit changes. Use relationship for one sentence about what changed between two exact cast names, dated when known. A handoff, promise, agreement, or new obligation between cast members belongs on the relationship graph when it affects later decisions. Use world for setting changes, plot for other lasting plot events, writing for requested standing guidance and jargon, and character or profile for cast facts. Put personality, character background, and dialogue examples in the description. Use a separate plot event only when it carries information the relationship event does not. Skip repeats and one-scene directions. Use updates: [] when nothing changed.';

export function editorContext(project,instruction,model) {
  const system = [...structuredInstructions,storyEditInstructions,'Finish by calling edit_story_state.'].join('\n\n');
  return buildAgentContext(project,{system,request:instruction.trim(),model});
}

export function continuityContext(project,instruction,prose,{suggest,truncated,mode,sensitive,model = continuityModel}) {
  const system = [
    ...structuredInstructions,
    'Classify the latest author direction and draft independently. Graphic sexual content or a request for it is explicit. Non-graphic romance and aftermath are safe. Use unclassified if unsure.',
    'Finish with record_scene, even if no facts changed. Infer the in-story minute when possible.',
    suggest ? sceneContinuityInstructions : 'Record an empty updates array for this draft.',
    ...(truncated ? ['The draft ends early. Classify only the text present.'] : []),
    ...(mode === 'alternate' ? ['Set input to safe. This alternate has no new author direction.'] : []),
    ...(sensitive ? ['The writer marked this direction sensitive. Set input to explicit.'] : [])
  ].join('\n\n');
  const request = JSON.stringify({authorDirection:instruction.trim(),draft:prose,
    ...(project.replyTime ? {knownTime:project.replyTime} : {})});
  return buildAgentContext(project,{system,request,model});
}
