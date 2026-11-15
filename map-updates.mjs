import { z } from 'zod';
import { getCast, isStoryTime, resolveCastName } from './public/prompt.js';

const castName = z.string().trim().min(1).max(100);
const note = z.string().trim().min(1).max(300);
export const updateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind:z.literal('relationship'),
    from:castName.describe('Exact cast name of the character who acted.'),
    to:castName.describe('Exact cast name of the other character.'),
    label:z.string().trim().min(1).max(200).describe('One sentence: what happened between them.'),
    storyTime:z.string().refine(isStoryTime).optional().describe('When it happened, YYYY-MM-DDTHH:mm.')
  }),
  z.strictObject({kind:z.literal('profile'), name:castName.describe('Exact cast name.'), note:note.describe('A new fact about this character.')}),
  z.strictObject({kind:z.literal('character'), name:castName.describe('A new character’s name.'), note:note.describe('A brief profile.')}),
  z.strictObject({kind:z.literal('world'), note:note.describe('A new fact about the setting.')}),
  z.strictObject({kind:z.literal('fact'), note:note.describe('A plot fact to remember.')})
]);

export function checkMapUpdates(project, value) {
  if (value === undefined) return {updates:[], problems:[]};
  if (!Array.isArray(value) || value.length > 5) {
    return {updates:[], problems:['Provide an updates array with at most five entries.']};
  }
  const cast = getCast(project);
  const accepted = [], problems = [], added = new Map();
  const parsed = value.map((entry,index) => {
    const result = updateSchema.safeParse(entry);
    if (result.success) return result.data;
    problems.push(`updates[${index}] has invalid fields: ${result.error.issues.map(issue => issue.path.join('.') || 'kind').join(', ')}.`);
    return null;
  });
  for (const [index,update] of parsed.entries()) {
    if (update?.kind !== 'character') continue;
    const key = update.name.toLowerCase();
    if (cast.some(member => [member.name, ...(member.nickname || '').split(',')]
        .some(name => name.trim().toLowerCase() === key)) || added.has(key)) {
      problems.push(`updates[${index}]: ${update.name} is already in the cast. Use a profile update instead.`);
      parsed[index] = null;
    } else {
      added.set(key, `new:${index}`);
    }
  }
  for (const [index,update] of parsed.entries()) {
    if (!update) continue;
    if (update.kind === 'profile' && !resolveCastName(cast,update.name)) {
      problems.push(`updates[${index}]: no single cast member is named ${update.name}.`);
      continue;
    }
    if (update.kind === 'relationship') {
      const resolve = name => resolveCastName(cast,name) || added.get(name.toLowerCase());
      const from = resolve(update.from), to = resolve(update.to);
      for (const name of [update.from,update.to].filter(name => !resolve(name))) {
        problems.push(`updates[${index}]: ${name} is not a cast name. Use an exact name from cast, or add a character update first.`);
      }
      if (!from || !to) continue;
      if (from === to) {
        problems.push(`updates[${index}]: from and to must be different characters.`);
        continue;
      }
    }
    accepted.push(update);
  }
  return {updates:accepted,problems};
}
