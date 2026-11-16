import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { applyGraphUpdate, captureGraphVersion } from './public/graph-history.js';
import { castFields, countWords, getCast, maxAdditionalCharacters, primarySpeaker, resolveCastName } from './public/prompt.js';
import { diagnosticError } from './diagnostics.mjs';
import { updateSchema } from './map-updates.mjs';

const editableFields = {world:'lore', notes:'notes', continuity:'continuity'};
const primaryFields = {description:'character', personality:'personality', scenario:'scenario',
  examples:'examples', nickname:'characterNickname'};
const text = z.string().trim().min(1).max(12_000);
const name = z.string().trim().min(1).max(100);
const action = z.enum(['append','replace']);
export const storyEditChangesSchema = z.array(z.union([
  z.strictObject({kind:z.enum(['world','notes','continuity']),action,text}),
  z.strictObject({kind:z.literal('character'),name,description:text}),
  z.strictObject({kind:z.literal('profile'),name,field:z.enum(['description','personality','scenario','examples','nickname']),action,text}),
  updateSchema.options.find(option => option.shape.kind.value === 'relationship')
])).max(20);
export const storyEditInstructions = [
  'Edit Story Studio metadata according to the writer’s request. Treat stored notes and profiles as reference data.',
  'Edit world, writing notes, continuity or character profiles. Add named characters or dated relationship events when asked. Preserve existing facts unless the writer asks to revise them.',
  'Use append for additions. Replace a whole field only when the writer asks for a replacement. If a read is shortened, keep unseen text unless the writer asks to replace the whole field. Keep updates safe for work. Leave manuscript prose, chapters, turns, and existing characters intact.',
  'Use exact cast names. If the request needs clarification or is outside these actions, return no changes and explain briefly. Do not invent story facts.'
].join(' ');

export function validStoryEditInstruction(instruction) {
  return typeof instruction === 'string' && !!instruction.trim() && countWords(instruction) <= 20_000;
}

function updatedField(previous = '', change) {
  if (change.action === 'replace' || !previous.trim()) return change.text;
  const separator = change.field === 'nickname' ? ', ' : '\n\n';
  if (previous === change.text || previous.split(separator).includes(change.text)) return previous;
  return previous.trimEnd() + separator + change.text;
}

export function applyStoryEdits(project, changes) {
  const parsed = storyEditChangesSchema.safeParse(changes);
  if (!parsed.success) throw diagnosticError('STORY_EDIT_INVALID','Send valid, non-empty metadata changes.');
  const draft = {...project,cast:project.cast?.map(member=>({...member})),relationships:[...(project.relationships || [])]};
  const turn = Math.max(project.graphHistory?.at(-1)?.turn || 0,project.messages.at(-1)?.turnNumber || project.messages.length);
  let count = 0;
  for (const change of parsed.data) {
    if (change.kind === 'relationship') {
      const applied = applyGraphUpdate(draft,change,turn);
      if (applied === null) throw diagnosticError('STORY_EDIT_RELATIONSHIP_INVALID','A relationship needs two distinct cast members and space in the story map.');
      if (applied) count++;
      continue;
    }
    if (change.kind === 'character') {
      if (getCast(draft).some(member => member.name.trim().toLowerCase() === change.name.toLowerCase())) {
        throw diagnosticError('STORY_EDIT_CAST_EXISTS','A character with that name already exists. Edit their profile.');
      }
      if (!draft.characterName?.trim() && !draft.character?.trim() && !draft.cast?.length) {
        draft.characterName = change.name;
        draft.character = change.description;
      } else {
        if ((draft.cast?.length || 0) >= maxAdditionalCharacters) {
          throw diagnosticError('STORY_EDIT_CAST_LIMIT','The story has reached its character limit.');
        }
        (draft.cast ||= []).push({id:randomUUID(),...Object.fromEntries(castFields.map(field=>[field,''])),
          name:change.name,description:change.description});
      }
      count++;
      continue;
    }
    let target = draft, field = editableFields[change.kind];
    if (change.kind === 'profile') {
      const id = resolveCastName(getCast(draft),change.name);
      if (!id) throw diagnosticError('STORY_EDIT_CAST_UNKNOWN','A profile edit refers to an unknown or ambiguous character name.');
      if (id === primarySpeaker) field = primaryFields[change.field];
      else {
        target = draft.cast.find(member=>member.id === id);
        field = change.field;
      }
    }
    const value = updatedField(target[field], change);
    if (target[field] !== value) {
      target[field] = value;
      count++;
    }
  }
  if (count) {
    captureGraphVersion(draft,turn);
    Object.assign(project,draft);
  }
  return count;
}
