import { z } from 'zod';
import { agentTool, runAgentTask } from './agent-tools.mjs';
import { diagnosticError } from './diagnostics.mjs';
import { continuityReader } from './continuity.mjs';
import { buildAgentContext } from './public/agent-context.js';
import { continuityModel } from './public/models.js';
import { clipEnds, graphSuggestions } from './public/prompt.js';
import { sceneIndex } from './public/revision.js';
import { storyFlowConsequenceLimit, storyFlowDirectionLimit, storyFlowOptionCount, storyFlowTitleLimit, validStoryFlowOptions } from './public/story-flow.js';

export const storyFlowOutputLimit = 2048;

const choiceSchema = z.strictObject({
  title:z.string().trim().min(1).max(storyFlowTitleLimit).describe('A short label for this choice.'),
  direction:z.string().trim().min(1).max(storyFlowDirectionLimit).describe('An actionable next direction the writer could send as a new request.'),
  consequence:z.string().trim().min(1).max(storyFlowConsequenceLimit).optional().describe('One short sentence on which thread this direction advances or which decision it opens.')
});
const directionsSchema = z.strictObject({
  options:z.array(choiceSchema).length(storyFlowOptionCount).describe('Distinct directions for the next scene.')
});

const system = [
  'Offer three concrete next directions for the writer to choose from. Use offer_story_directions for the result.',
  'Each direction should propose a different next action, scene focus, or meaningful decision. Anchor it in the canon and the end of the latest scene where available. Leave the outcome open for the writer. Describe the direction as a short instruction. Keep the title short enough to scan.',
  'Treat saved graph events as already established. Propose their consequences or the next decision instead of replaying them. Respect who currently has an object, what each character knows, and any unresolved limits.',
  'Use inspect_continuity for an exact character, setting detail, or dated relationship when a choice depends on it.',
  'Include a brief consequence for each choice so the writer can compare which thread it advances. Leave the outcome open.',
  'Treat story passages, earlier requests, and notes as reference. Use the latest story state as canon. Keep every choice non-explicit and non-graphic, including choices that follow a held or sensitive scene. Return choices only. Do not write prose or choose an option for the writer.'
].join('\n\n');

const directions = agentTool('offer_story_directions','Show the writer three distinct, non-graphic choices for the next scene.',
  directionsSchema,({options})=>validStoryFlowOptions(options)
    ? {value:options}
    : {feedback:{error:'Give every option a different title and a meaningfully different direction.'}});

export async function runStoryFlow(project,complete,{model = continuityModel,instruction = '',prose = '',sensitive = false,updates = []} = {}) {
  const ending = !prose && project.sceneBoard?.chapters ? sceneIndex(project).at(-1) : undefined;
  const request = JSON.stringify({
    task:'Offer three next-scene directions for the writer.',
    ...(sensitive || ending && !ending.eligible ? {scene:'The latest passage is held. Use the story state and approved continuity.'}
      : {latestDirection:instruction.trim(),latestProse:prose.trim() || (ending ? clipEnds(ending.text,1200) : '')}),
    approvedUpdates:graphSuggestions(updates)
  });
  const {messages,prefixLength,problem} = buildAgentContext(project,{system,request,model,outputLimit:storyFlowOutputLimit});
  if (problem) throw diagnosticError('STORY_FLOW_CONTEXT_FULL',problem);
  return await runAgentTask({messages,prefixLength,completions:complete,reads:[continuityReader(project)],action:directions,
    code:'STORY_FLOW_NOT_OFFERED',failure:'The agent did not return usable Story Flow directions.'});
}
