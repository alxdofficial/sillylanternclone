import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { applyGraphUpdate, captureGraphVersion, ensureGraphBaseline } from './public/graph-history.js';
import { castFields, getCast, migrateLegacyCast, resolveCastName } from './public/prompt.js';
import { diagnosticError } from './diagnostics.mjs';
import { castName, sceneTimeSchema, updateSchema } from './map-updates.mjs';

const editableFields = {world:'lore', notes:'notes', continuity:'continuity', premise:'premise'};
const text = z.string().trim().min(1);
const action = z.enum(['append','replace']);
const eventIndex = z.int().nonnegative().describe('Copy eventIndex from inspect_continuity for the current story.');
const op = (kind, fields) => z.strictObject({kind:z.literal(kind),...fields});
const settings = op('settings',{title:text.optional(),storyStartAt:sceneTimeSchema.optional(),graphUpdates:z.boolean().optional()});
const relationship = updateSchema.options.find(option => option.shape.kind.value === 'relationship');

export const graphEditShapes = [
  settings,
  op('field',{field:z.enum(['premise','lore','notes','continuity','authorNote','postHistory','loreRules']),
    text:z.string().trim().describe('Replace this full field. Read every page first when preserving surrounding text.')}),
  op('rename_character',{name:castName,newName:text}),
  op('remove_character',{name:castName}).describe('Remove a character and their relationship events only when asked.'),
  op('edit_relationship',{
    eventIndex, from:castName.optional(), to:castName.optional(),
    label:text.optional().describe('One concise, non-explicit sentence about what changed between the characters.'),
    storyTime:sceneTimeSchema.optional(),sourceTurn:z.int().min(0).optional()
  }),
  op('remove_relationship',{eventIndex}).describe('Remove the specified event only when asked.')
];
export const graphEditKinds = new Set(graphEditShapes.map(shape=>shape.shape.kind.value));

export const storyEditChangesSchema = z.array(z.union([
  z.strictObject({kind:z.enum(['world','notes','continuity','premise']),action,text}),
  op('character',{name:castName,description:text}),
  op('profile',{name:castName,field:z.enum(['description','personality','scenario','examples','nickname']),action,text}),
  relationship,
  ...graphEditShapes
])).max(20);
export { storyEditInstructions } from './public/agent-context.js';

export function validStoryEditInstruction(instruction) {
  return typeof instruction === 'string' && !!instruction.trim();
}

function updatedField(previous = '', change) {
  if (change.action === 'replace' || !previous.trim()) return change.text;
  const separator = change.field === 'nickname' ? ', ' : '\n\n';
  if (previous === change.text || previous.split(separator).includes(change.text)) return previous;
  return previous.trimEnd() + separator + change.text;
}

function requireCastMember(project,name) {
  const cast = getCast(project);
  const id = resolveCastName(cast,name);
  const member = cast.find(item=>item.id === id);
  if (!member) throw diagnosticError('STORY_EDIT_CAST_UNKNOWN','Use an exact, unambiguous cast name from inspect_continuity.');
  return member;
}

function updateFields(target,values) {
  let changed = false;
  for (const [key,value] of Object.entries(values)) {
    if (value === undefined || target[key] === value) continue;
    target[key] = value;
    changed = true;
  }
  return changed;
}

function applyStructuredChange(project,change,originalEvents) {
  const {kind} = change;
  if (kind === 'field') return updateFields(project,{[change.field]:change.text});
  if (kind === 'settings') {
    const {title,storyStartAt,graphUpdates} = change;
    let changed = updateFields(project,{title,storyStartAt,graphUpdates,
      ...(storyStartAt ? {storyStartSource:'author'} : {})});
    if (storyStartAt) {
      for (const edge of project.relationships) {
        if (!edge.turn && updateFields(edge,{storyTime:storyStartAt})) changed = true;
      }
    }
    return changed;
  }
  if (kind === 'rename_character' || kind === 'remove_character') {
    const member = requireCastMember(project,change.name);
    if (kind === 'remove_character') {
      project.cast = project.cast.filter(item=>item !== member);
      project.relationships = project.relationships.filter(edge=>edge.from !== member.id && edge.to !== member.id);
      return true;
    }
    if (project.cast.some(item=>item !== member && item.name.toLowerCase() === change.newName.toLowerCase())) {
      throw diagnosticError('STORY_EDIT_CAST_EXISTS','Another character already uses that name.');
    }
    return updateFields(member,{name:change.newName});
  }
  // All event indices refer to the story as read, even after another operation removes a row.
  const event = originalEvents[change.eventIndex];
  if (!event || !project.relationships.includes(event)) {
    throw diagnosticError('STORY_EDIT_EVENT_UNKNOWN','Use the current eventIndex from inspect_continuity. That event is unavailable.');
  }
  if (kind === 'remove_relationship') {
    project.relationships.splice(project.relationships.indexOf(event),1);
    return true;
  }
  const from = change.from ? requireCastMember(project,change.from).id : event.from;
  const to = change.to ? requireCastMember(project,change.to).id : event.to;
  if (from === to) throw diagnosticError('STORY_EDIT_RELATIONSHIP_INVALID','A relationship requires two distinct characters.');
  if (change.sourceTurn && !project.messages.some((message,index)=>(message.turnNumber || index + 1) === change.sourceTurn)) {
    throw diagnosticError('STORY_EDIT_TURN_UNKNOWN','The proposed source turn is unavailable.');
  }
  const storyTime = change.storyTime ?? (change.sourceTurn === 0 ? project.storyStartAt : undefined);
  return updateFields(event,{from,to,label:change.label,turn:change.sourceTurn,storyTime});
}

export function applyStoryEdits(project, changes) {
  const parsed = storyEditChangesSchema.safeParse(changes);
  if (!parsed.success) throw diagnosticError('STORY_EDIT_INVALID','Send valid metadata changes.');
  const draft = migrateLegacyCast({...project,cast:(project.cast || []).map(member=>({...member})),
    relationships:(project.relationships || []).map(edge=>({...edge}))});
  const originalEvents = draft.relationships.slice();
  const turn = Math.max(project.graphHistory?.at(-1)?.turn || 0,project.messages.at(-1)?.turnNumber || project.messages.length);
  ensureGraphBaseline(draft);
  let count = 0;
  for (const change of parsed.data) {
    if (graphEditKinds.has(change.kind)) {
      if (applyStructuredChange(draft,change,originalEvents)) count++;
    } else if (change.kind === 'relationship') {
      const applied = applyGraphUpdate(draft,change,turn);
      if (applied === null) throw diagnosticError('STORY_EDIT_RELATIONSHIP_INVALID','Use two distinct cast names for a relationship.');
      if (applied) count++;
    } else if (change.kind === 'character') {
      if (getCast(draft).some(member=>member.name.trim().toLowerCase() === change.name.toLowerCase())) {
        throw diagnosticError('STORY_EDIT_CAST_EXISTS','A character with that name already exists. Edit their profile.');
      }
      draft.cast.push({id:randomUUID(),...Object.fromEntries(castFields.map(field=>[field,''])),
        name:change.name,description:change.description});
      count++;
    } else {
      const target = change.kind === 'profile' ? requireCastMember(draft,change.name) : draft;
      const field = change.field || editableFields[change.kind];
      if (updateFields(target,{[field]:updatedField(target[field],change)})) count++;
    }
  }
  if (count) {
    captureGraphVersion(draft,turn);
    migrateLegacyCast(project);
    Object.assign(project,draft);
  }
  return count;
}
