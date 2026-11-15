import { z } from 'zod';
import { updateSchema } from './map-updates.mjs';
import { diagnosticError } from './diagnostics.mjs';
import { isStoryTime } from './public/prompt.js';

export const metadataModel = 'deepseek/deepseek-v4.1-flash';
const label = z.enum(['safe','explicit']);
const metadataSchema = z.strictObject({
  input:label.describe('Classification of the writer direction.'),
  reply:label.describe('Classification of the narrative prose.'),
  storyTime:z.string().describe('In-story date and time to the minute, YYYY-MM-DDTHH:mm.'),
  updates:z.array(z.union(updateSchema.options.map(option => option.required()))).max(5)
    .describe('New non-explicit continuity facts, or an empty array when disabled or unnecessary.')
});
const {$schema, ...schema} = z.toJSONSchema(metadataSchema,{target:'draft-7'});
export const storyMetadataFormat = {
  type:'json_schema', json_schema:{name:'story_studio_metadata',strict:true,schema}
};

export function readStoryMetadata(output, checkUpdates) {
  if (output.truncated) {
    throw diagnosticError('OPENROUTER_METADATA_TRUNCATED','OpenRouter cut off the metadata response.');
  }
  let value;
  try { value = JSON.parse(output.text); } catch {
    throw diagnosticError('OPENROUTER_INVALID_METADATA','OpenRouter returned unreadable story metadata.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw diagnosticError('OPENROUTER_INVALID_METADATA','OpenRouter returned an invalid story metadata object.');
  }

  const checked = checkUpdates(value.updates);
  return {
    input:label.safeParse(value.input).data || 'unclassified',
    reply:label.safeParse(value.reply).data || 'unclassified',
    storyTime:isStoryTime(value.storyTime) ? value.storyTime : '',
    suggestions:checked.updates,
    ...(checked.problems.length ? {updateProblems:checked.problems.length} : {})
  };
}
