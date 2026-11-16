import { z } from 'zod';
import { checkMapUpdates, sceneTimeSchema, updateSchema } from './map-updates.mjs';
import { clipEnds, getCast, resolveCastName } from './public/prompt.js';
import { continuityContext, editorContext } from './public/agent-context.js';
import { diagnosticError } from './diagnostics.mjs';
import { agentTool, runAgentTask } from './agent-tools.mjs';
import { applyStoryEdits, storyEditChangesSchema } from './story-edits.mjs';

const classification = z.enum(['safe','explicit','unclassified']);
export { sceneTimeSchema };
export const sceneUpdatesSchema = z.array(updateSchema).max(5);
export const inspectShape = {
  section:z.enum(['cast','world','notes','plot','premise','relationships']).describe('Which part of the story to inspect.'),
  character:z.string().trim().min(1).optional().describe('Exact cast name to narrow cast profiles or relationship events.'),
  field:z.enum(['description','nickname']).optional().describe('Read one full profile field in pages. Requires cast and an exact character name.'),
  offset:z.number().int().min(0).optional().describe('Use nextOffset from the previous result to read the next page.')
};
const extraNativeSections = ['loreRules'];
export const nativeInspectShape = {...inspectShape,
  section:z.enum([...inspectShape.section.options,...extraNativeSections]).describe('Which part of the story to inspect.')
};
const inspectSchema = z.strictObject(nativeInspectShape);
const recordSchema = z.strictObject({
  input:classification.describe('Label the latest author direction. Use unclassified when unsure.'),
  reply:classification.describe('Label the new prose. Use unclassified when unsure.'),
  storyTime:sceneTimeSchema.optional().describe('In-story time, if inferable.'),
  updates:sceneUpdatesSchema.describe('New safe-for-work facts to save with the scene. Use an empty array when none qualify.')
});
export const inspectDescription = 'Inspect the cast, world, opening premise, writing notes, dated plot events, or dated relationship events. Select a character and field to page through long profile text.';
export const recordDescription = 'Finish the continuity pass by recording the scene time and any new safe-for-work facts. Leave out speculative, graphic, or already recorded information.';
const editSchema = z.strictObject({changes:storyEditChangesSchema,
  message:z.string().trim().min(1).max(300).describe('A short non-explicit result for the writer. Use no changes if clarification is needed.'),
  historySafe:z.boolean().optional().describe('True only when both the current request and your reply are non-explicit and can be reused in later AI context.')});

const head = (text, limit) => (text || '').length > limit ? text.slice(0,limit) + '…' : text || '';

function readText(field, value = '', offset = 0) {
  let end = Math.min(value.length,offset + 12000);
  if (end < value.length && /[\ud800-\udbff]/u.test(value[end - 1])) end--;
  const page = value.slice(offset,end);
  const nextOffset = offset + page.length;
  return {[field]:page,...(nextOffset < value.length ? {shortened:true,nextOffset} : {})};
}

export function inspectContinuity(project,{section,character,field,offset = 0, includeEventIndex = false,castPageSize}) {
  const cast = getCast(project);
  const characterId = character && resolveCastName(cast,character);
  if (character && !characterId && ['cast','relationships'].includes(section)) return {error:'Use an exact cast name.'};
  if (field) {
    if (section !== 'cast' || !characterId) return {error:'Choose a character to read a profile field.'};
    const member = cast.find(candidate=>candidate.id === characterId);
    return {name:member.name,...readText(field,member[field],offset)};
  }
  if (section === 'cast') {
    const matches = characterId ? cast.filter(member=>member.id === characterId) : cast;
    const page = castPageSize && !characterId ? matches.slice(offset,offset + castPageSize) : matches;
    const profiles = page.map(member=>{
      const profile = {
        name:member.name,nickname:head(member.nickname,300),
        description:clipEnds(member.description,characterId ? 12000 : 500)
      };
      const shortenedFields = Object.keys(profile).filter(field=>profile[field].length < (member[field]?.trim().length || 0));
      return shortenedFields.length ? {...profile,shortenedFields} : profile;
    });
    const nextOffset = offset + profiles.length;
    return {cast:profiles,...(castPageSize && !characterId && nextOffset < matches.length ? {nextOffset} : {})};
  }
  if (section === 'world') return readText('world',project.lore,offset);
  if (section === 'notes') return readText('notes',project.notes,offset);
  if (section === 'premise') return readText('premise',project.premise ?? project.scenario,offset);
  if (section === 'plot') {
    const events = project.plotEvents || [];
    const page = events.slice(offset,offset+24);
    return {events:page.map((event,index)=>({...event,eventIndex:offset+index})),
      ...(offset + page.length < events.length ? {nextOffset:offset+page.length} : {})};
  }
  if (extraNativeSections.includes(section)) return readText(section,project[section],offset);
  const names = new Map(cast.map(({id,name})=>[id,name]));
  const events = (project.relationships || []).map((edge,eventIndex)=>({...edge,eventIndex})).filter(edge =>
    names.has(edge.from) && names.has(edge.to) && (!characterId || [edge.from,edge.to].includes(characterId)));
  const page = events.toSorted((a,b)=>(b.turn || 0)-(a.turn || 0)).slice(offset,offset + 24);
  return {events:page.map(({from,to,label,storyTime,turn,eventIndex})=>({
    from:names.get(from),to:names.get(to),label,storyTime,turn,...(includeEventIndex ? {eventIndex} : {})
  })),
    ...(offset + page.length < events.length ? {nextOffset:offset + page.length} : {})};
}

export function continuityMessages(...args) {
  return continuityContext(...args).messages;
}

export function continuityReader(project) {
  return agentTool('inspect_continuity',inspectDescription + ' Page through the cast and relationships. Use eventIndex when editing an existing relationship.',
    inspectSchema,args=>inspectContinuity(project,{...args,includeEventIndex:true,castPageSize:24}));
}

export async function runContinuity(project,instruction,prose,options,complete,audit) {
  const action = agentTool('record_scene',recordDescription,recordSchema,({input,reply,storyTime,updates}) => {
    const checked = checkMapUpdates(project,options.suggest ? updates : []);
    if (checked.rejections.length) {
      audit(checked.rejections);
      return {feedback:{error:'Fix the rejected entries or omit them. Inspect the cast if needed.',rejections:checked.rejections}};
    }
    return {value:{input:options.sensitive ? 'explicit' : input,reply,
      storyTime:project.replyTime || storyTime || '',suggestions:checked.updates}};
  });
  const {messages,prefixLength,problem} = continuityContext(project,instruction,prose,options);
  if (problem) throw diagnosticError('AGENT_CONTEXT_FULL',problem);
  return await runAgentTask({messages,prefixLength,
    completions:complete,reads:[continuityReader(project)],action,
    code:'CONTINUITY_NOT_RECORDED',failure:'The continuity editor did not record a valid scene.'});
}

export async function runStoryEdit(project,instruction,complete,model) {
  const context = editorContext(project,instruction,model);
  if (context.problem) throw diagnosticError('AGENT_CONTEXT_FULL',context.problem);
  const {messages} = context;
  const action = agentTool('edit_story_state','Apply the writer’s requested story-state changes and finish. Use the current eventIndex for an existing relationship. Leave prose, turns, and chapters intact.',
    editSchema,({changes,message,historySafe}) => {
      try {
        const count = applyStoryEdits(project,changes);
        if (historySafe) (project.agentHistory ||= []).push({
          afterTurn:project.messages.at(-1)?.turnNumber ?? project.messages.length,
          request:instruction.trim(),message,count,...(count ? {changes:JSON.stringify(changes)} : {})
        });
        return {value:{count,message}};
      } catch (failure) {
        if (!failure.diagnosticCode) throw failure;
        return {feedback:{error:failure.message}};
      }
    });
  return await runAgentTask({messages,completions:complete,reads:[continuityReader(project)],action,
    prefixLength:context.prefixLength,
    code:'STORY_EDIT_NOT_RECORDED',failure:'The editor did not complete a valid story edit.'});
}
