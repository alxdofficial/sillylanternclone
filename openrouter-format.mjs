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

export function isWritingRefusal(text) {
  // Some hosts report a conversational refusal as an ordinary completion.
  // Match explicit assistant phrasing at the start so dialogue can use it.
  const sceneRefusal = /^this (?:isn['’]t|is not) appropriate for our collaborative storytelling environment\b/i;
  const decline = /^(?:i['’]m sorry[, .]+(?:but\s+)?)?i (?:can['’]t|cannot|won['’]t) (?:help (?:with|write|create|generate)|write|create|generate|provide|continue)\s+(?:(?:that|this) request|(?:sexually |graphic(?:ally)? )?explicit (?:content|material|scenes?))\b/i;
  return sceneRefusal.test(text) || decline.test(text);
}

export function stripWritingPreamble(prose) {
  const breakAt = prose.search(/\r?\n[ \t]*\r?\n/);
  const end = breakAt < 0 ? prose.length : breakAt;
  const opening = prose.slice(0,end);
  const aside = /(^|[.!?][ \t]+)I(?:['’]ve| have) been (?:instructed|asked) to write (?:(?:approximately|about|around) )?\d[\d,]* words\b[^.!?\r\n]*(?:[.!?](?=[ \t]|$)|$)/i.exec(opening);
  if (!aside) return prose;
  const before = opening.slice(0,aside.index + aside[1].length);
  if ((before.match(/"/g) || []).length % 2 || before.lastIndexOf('“') > before.lastIndexOf('”')) return prose;
  const after = opening.slice(aside.index + aside[0].length);
  const cleanOpening = [before.trim(),after.trim()].filter(Boolean).join(' ');
  return (cleanOpening + prose.slice(end)).trim();
}

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

  const input = label.safeParse(value.input).data;
  const reply = label.safeParse(value.reply).data;
  const storyTime = isStoryTime(value.storyTime) ? value.storyTime : '';
  const invalidFields = [
    ...(!input ? ['input'] : []),
    ...(!reply ? ['reply'] : []),
    ...(!storyTime ? ['storyTime'] : []),
    ...(!Array.isArray(value.updates) ? ['updates'] : [])
  ];
  const checked = checkUpdates(value.updates);
  return {
    input:input || 'unclassified',
    reply:reply || 'unclassified',
    storyTime,
    suggestions:checked.updates,
    invalidFields,
    ...(checked.rejections.length ? {updateProblems:checked.rejections.length,updateRejections:checked.rejections} : {})
  };
}
