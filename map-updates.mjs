import { z } from 'zod';
import { getCast, isStoryTime, resolveCastName } from './public/prompt.js';

export const castName = z.string().trim().min(1).describe('Exact cast name.');
export const sceneTimeSchema = z.string().refine(isStoryTime).describe('In-story date and minute, YYYY-MM-DDTHH:mm.');
const note = z.string().trim().min(1).max(300);
const updateFields = new Set(['kind','from','to','label','storyTime','name','note']);
export const updateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind:z.literal('relationship'),
    from:castName.describe('Exact cast name of the character who acted.'),
    to:castName.describe('Exact cast name of the other character.'),
    label:z.string().trim().min(1).max(200).describe('One safe-for-work sentence about what changed between the characters. Omit NSFW, explicit, and graphic details.'),
    storyTime:sceneTimeSchema.optional()
  }),
  z.strictObject({kind:z.literal('profile'), name:castName.describe('Exact cast name.'), note:note.describe('A new safe-for-work fact about this character.')}),
  z.strictObject({kind:z.literal('character'), name:castName.describe('A new character’s name.'), note:note.describe('A brief safe-for-work profile.')}),
  z.strictObject({kind:z.literal('world'), note:note.describe('A new safe-for-work fact about the setting.')}),
  z.strictObject({kind:z.literal('writing'), note:note.describe('A standing, non-explicit writing preference the author explicitly asked to carry into future scenes.')}),
  z.strictObject({kind:z.literal('fact'), note:note.describe('A safe-for-work plot fact to remember.')})
]);

export function checkMapUpdates(project, value) {
  if (value === undefined) return {updates:[], problems:[], rejections:[]};
  if (!Array.isArray(value) || value.length > 5) {
    return {updates:[],problems:['Provide an updates array with at most five entries.'],
      rejections:[{code:Array.isArray(value) ? 'TOO_MANY_UPDATES' : 'EXPECTED_UPDATES_ARRAY'}]};
  }
  const cast = getCast(project);
  const accepted = [], problems = [], rejections = [], added = new Map();
  const parsed = value.map((entry,index) => {
    const result = updateSchema.safeParse(entry);
    if (result.success) return result.data;
    problems.push(`updates[${index}] has invalid fields: ${result.error.issues.map(issue => issue.path.join('.') || 'kind').join(', ')}.`);
    const fields = result.error.issues.map(issue => ({
      field:updateFields.has(issue.path[0]) ? issue.path[0] : 'entry', issue:issue.code
    }));
    rejections.push({index,code:'INVALID_FIELDS',fields});
    return null;
  });
  for (const [index,update] of parsed.entries()) {
    if (update?.kind !== 'character') continue;
    const key = update.name.toLowerCase();
    if (cast.some(member => [member.name, ...(member.nickname || '').split(',')]
        .some(name => name.trim().toLowerCase() === key)) || added.has(key)) {
      problems.push(`updates[${index}]: ${update.name} is already in the cast. Use a profile update instead.`);
      rejections.push({index,code:'DUPLICATE_CHARACTER'});
      parsed[index] = null;
    } else {
      added.set(key, `new:${index}`);
    }
  }
  for (const [index,update] of parsed.entries()) {
    if (!update) continue;
    if (update.kind === 'profile' && !resolveCastName(cast,update.name)) {
      problems.push(`updates[${index}]: no single cast member is named ${update.name}.`);
      rejections.push({index,code:'CAST_NAME_UNRESOLVED',fields:['name']});
      continue;
    }
    if (update.kind === 'relationship') {
      const resolve = name => resolveCastName(cast,name) || added.get(name.toLowerCase());
      const from = resolve(update.from), to = resolve(update.to);
      if (!from || !to) {
        const fields = [...(!from ? ['from'] : []),...(!to ? ['to'] : [])];
        for (const field of fields) {
          problems.push(`updates[${index}]: ${update[field]} is not a cast name. Use an exact name from cast, or add a character update first.`);
        }
        rejections.push({index,code:'CAST_NAME_UNRESOLVED',fields});
        continue;
      }
      if (from === to) {
        problems.push(`updates[${index}]: from and to must be different characters.`);
        rejections.push({index,code:'SELF_RELATIONSHIP'});
        continue;
      }
    }
    accepted.push(update);
  }
  rejections.sort((a,b) => a.index - b.index);
  return {updates:accepted,problems,rejections};
}
