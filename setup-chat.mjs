import { z } from 'zod';
import { diagnosticError } from './diagnostics.mjs';

const castMember = z.strictObject({
  name:z.string().trim().min(1).max(100),
  description:z.string().trim().max(1200)
});
const draftSchema = z.strictObject({
  title:z.string().trim().min(1).max(160),
  lore:z.string().trim().max(4000),
  scenario:z.string().trim().max(1700),
  notes:z.string().trim().max(1500),
  cast:z.array(castMember).max(8)
});
const {$schema, ...schema} = z.toJSONSchema(draftSchema,{target:'draft-7'});
export const setupDraftFormat = {
  type:'json_schema', json_schema:{name:'story_studio_setup',strict:true,schema}
};

const brainstorm = 'You are a fiction brainstorming partner in Story Studio. Discuss the story the writer wants to tell. Offer a few distinct ideas and ask one or two useful questions at a time. Build on what the writer chooses, including later revisions. Discuss the title, setting, characters, opening situation, and writing style when useful. Keep replies brief and conversational. Plan the story without drafting scenes or producing a setup object.';
const prepare = 'Prepare an editable Story Studio setup from this planning conversation. Return only the requested structured fields. The writer’s latest choices take priority over earlier choices and tentative suggestions. Use title for the story name, lore for the world and setting, scenario for the premise and opening situation, and notes for the writer’s point of view, tone, style, and constraints. For cast, use the named characters agreed on and give each a unique name and a short description, with the main character first. Keep each field concise. Propose a working title if none was chosen. Use an empty string or empty array for the remaining undecided fields. Do not write story prose, relationship events, or further questions.';

export function setupMessages(messages, mode) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 42) return null;
  if (mode === 'chat' && messages.length % 2 === 0) return null;
  let length = 0;
  for (const [index, turn] of messages.entries()) {
    if (turn?.role !== (index % 2 ? 'assistant' : 'user') || typeof turn.content !== 'string'
      || !turn.content.trim() || turn.content.length > 6000) return null;
    length += turn.content.length;
  }
  if (length > (mode === 'draft' ? 42_000 : 36_000)) return null;
  const history = messages.map(({role,content}) => ({role,content:content.trim()}));
  if (mode === 'draft') {
    const request = 'Prepare the story setup from our planning conversation now.';
    if (history.at(-1).role === 'user') history.at(-1).content += '\n\n' + request;
    else history.push({role:'user',content:request});
  }
  return [{role:'system',content:mode === 'draft' ? prepare : brainstorm},...history];
}

export function readSetupDraft({text,truncated}) {
  if (truncated) throw diagnosticError('SETUP_DRAFT_TRUNCATED','OpenRouter cut off the setup draft. Try preparing it again.');
  let draft;
  try { draft = draftSchema.parse(JSON.parse(text)); }
  catch { throw diagnosticError('SETUP_DRAFT_INVALID','OpenRouter returned an invalid setup draft. Try preparing it again.'); }
  const names = new Set(draft.cast.map(member => member.name.toLowerCase()));
  if (names.size !== draft.cast.length) {
    throw diagnosticError('SETUP_DRAFT_DUPLICATE_CAST','The setup draft repeats a character name. Ask the model to clarify the cast, then try again.');
  }
  return draft;
}
