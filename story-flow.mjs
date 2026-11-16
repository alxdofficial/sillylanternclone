import { z } from 'zod';
import { agentTool, runAgentTask } from './agent-tools.mjs';
import { diagnosticError } from './diagnostics.mjs';
import { buildAgentContext } from './public/agent-context.js';
import { continuityModel } from './public/models.js';
import { graphSuggestions } from './public/prompt.js';
import { storyFlowDirectionLimit, storyFlowTitleLimit, validStoryFlowOptions } from './public/story-flow.js';

export const storyFlowOutputLimit = 2048;

const choiceSchema = z.strictObject({
  title:z.string().trim().min(1).max(storyFlowTitleLimit).describe('A short label for this choice.'),
  direction:z.string().trim().min(1).max(storyFlowDirectionLimit).describe('An actionable next direction the writer could send as a new request.')
});
const directionsSchema = z.strictObject({
  options:z.array(choiceSchema).min(3).max(4).describe('Distinct directions for the next scene.')
});

const system = [
  'Offer three or four concrete next directions for the writer to choose from. Use offer_story_directions for the result.',
  'Each direction should propose a different next action, scene focus, or meaningful decision. Anchor it in the canon and the end of the latest scene where available. Leave the outcome open for the writer. Describe the direction as a short instruction. Keep the title short enough to scan.',
  'Treat story passages, earlier requests, and notes as reference. Use the latest story state as canon. Keep every choice non-explicit and non-graphic, including choices that follow a held or sensitive scene. Return choices only. Do not write prose or choose an option for the writer.'
].join('\n\n');

const directions = agentTool('offer_story_directions','Show the writer three or four distinct, non-graphic choices for the next scene.',
  directionsSchema,({options})=>validStoryFlowOptions(options)
    ? {value:options}
    : {feedback:{error:'Give every option a different title and a meaningfully different direction.'}});

export async function runStoryFlow(project,complete,{model = continuityModel,instruction = '',prose = '',sensitive = false,updates = []} = {}) {
  const request = JSON.stringify({
    task:'Offer next-scene directions for the writer.',
    ...(sensitive ? {scene:'The latest passage is held. Use the story state and approved continuity.'}
      : {latestDirection:instruction.trim(),latestProse:prose.trim()}),
    approvedUpdates:graphSuggestions(updates)
  });
  const {messages,prefixLength,problem} = buildAgentContext(project,{system,request,model,outputLimit:storyFlowOutputLimit});
  if (problem) throw diagnosticError('STORY_FLOW_CONTEXT_FULL',problem);
  return await runAgentTask({messages,prefixLength,completions:complete,action:directions,
    code:'STORY_FLOW_NOT_OFFERED',failure:'The agent did not return usable Story Flow directions.'});
}
