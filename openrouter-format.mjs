import { z } from 'zod';
import { updateSchema } from './map-updates.mjs';
import { diagnosticError } from './diagnostics.mjs';
import { isModelId } from './public/models.js';
import { isStoryTime } from './public/prompt.js';

const label = z.enum(['safe','explicit']);
const replySchema = z.strictObject({
  text:z.string().min(1).describe('Narrative prose only.'),
  input:label.describe('Classification of the writer direction.'),
  reply:label.describe('Classification of the narrative prose.'),
  storyTime:z.string().describe('In-story date and time to the minute, YYYY-MM-DDTHH:mm.'),
  updates:z.array(z.union(updateSchema.options.map(option => option.required()))).max(5)
    .describe('New non-explicit continuity facts, or an empty array when disabled or unnecessary.')
});
const {$schema, ...schema} = z.toJSONSchema(replySchema,{target:'draft-7'});
export const storyResponseFormat = {
  type:'json_schema', json_schema:{name:'story_studio_reply',strict:true,schema}
};

const capabilities = new Map();

export async function supportsStorySchema(model) {
  if (typeof model !== 'string' || !isModelId(model)) return false;
  const cached = capabilities.get(model);
  if (cached && cached.until > Date.now()) return cached.supported;
  try {
    const id = model.split('/').map(encodeURIComponent).join('/');
    const response = await fetch('https://openrouter.ai/api/v1/models/' + id + '/endpoints',{
      redirect:'error',signal:AbortSignal.timeout(2500)
    });
    if (!response.ok) return false;
    const {data} = await response.json();
    if (!Array.isArray(data?.endpoints)) return false;
    const supported = data.endpoints.some(endpoint => endpoint.supported_parameters?.includes('structured_outputs'));
    if (capabilities.size >= 100) capabilities.delete(capabilities.keys().next().value);
    capabilities.set(model,{supported,until:Date.now()+300_000});
    return supported;
  } catch {
    return false;
  }
}

export function readStructuredStory(output, checkUpdates) {
  let value;
  try { value = JSON.parse(output.text); } catch {
    throw diagnosticError('OPENROUTER_INVALID_STRUCTURED_REPLY', output.truncated
      ? 'OpenRouter cut off the structured reply. Ask for a shorter continuation.'
      : 'OpenRouter returned an unreadable structured reply.');
  }
  if (typeof value?.text !== 'string' || !value.text.trim()) {
    throw diagnosticError('OPENROUTER_EMPTY_REPLY','OpenRouter returned no prose for this request.');
  }

  // Keep successfully returned prose even if a provider violates the schema.
  // Labels are evaluated independently, and only checked map entries are kept.
  const checked = checkUpdates(value.updates);
  return {
    text:value.text.trim(),
    input:label.safeParse(value.input).data || 'unclassified',
    reply:label.safeParse(value.reply).data || 'unclassified',
    storyTime:isStoryTime(value.storyTime) ? value.storyTime : '',
    suggestions:checked.updates,
    ...(checked.problems.length ? {updateProblems:checked.problems.length} : {})
  };
}
