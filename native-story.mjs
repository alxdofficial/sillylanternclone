import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { captureGraphVersion, storyAtTurn } from './public/graph-history.js';
import { maxLibraryStories, starterStoryId } from './public/library.js';
import {
  castFields, getCast, isAvailableToMcp, localStoryTime, nextTurnNumber,
  mcpOmissionReason, precedingDirection
} from './public/prompt.js';
import { sceneTimeSchema } from './map-updates.mjs';
import { applyStoryEdits, graphEditKinds, graphEditShapes } from './story-edits.mjs';
import { setupResultShape, validateSetupDraft } from './setup-chat.mjs';

export const nativeSetupSchema = setupResultShape(false).partial().required({title:true});
const title = nativeSetupSchema.shape.title;
const turnNumber = z.int().positive().max(Number.MAX_SAFE_INTEGER);
const op = (kind, fields) => z.strictObject({kind:z.literal(kind),...fields});

export const nativeStoryChange = z.discriminatedUnion('kind',[
  ...graphEditShapes,
  op('edit_turn',{
    turnNumber, content:z.string().trim().min(1).optional().describe('Full revised text for this existing eligible turn. Omit for date or chapter edits.'),
    storyTime:sceneTimeSchema.nullable().optional(),startsChapter:z.boolean().optional()
  }),
  op('hold_turn',{turnNumber,reason:z.enum(['explicit','unverified','all_ai'])}),
  op('delete_turn',{turnNumber}),
  op('branch',{turnNumber,title}),
  op('rewind',{turnNumber}),
  op('delete_story',{})
]);

function appendNativeStory(library, project) {
  if (library.projects.filter(item=>item.id !== starterStoryId).length >= maxLibraryStories) throw Error('The library has reached its story limit.');
  library.projects.unshift(project);
  library.activeId = project.id;
  return project;
}

export function createNativeStory(library, value) {
  const draft = validateSetupDraft({lore:'',scenario:'',notes:'',cast:[],...value},null);
  const time = draft.storyStartAt || localStoryTime();
  const cast = draft.cast.map(({name, description}) => ({
    ...Object.fromEntries(castFields.map(field=>[field,''])),id:randomUUID(),name,description
  }));
  const ids = new Map(cast.map(member=>[member.name, member.id]));
  const project = {
    id:randomUUID(),title:draft.title,premise:draft.scenario,lore:draft.lore,notes:draft.notes,
    storyStartAt:time,storyStartSource:draft.storyStartAt ? 'author' : 'estimate',cast,messages:[],
    relationships:(draft.relationships || []).map(({from,to,label})=>({
      from:ids.get(from),to:ids.get(to),label,storyTime:time,turn:0
    }))
  };
  captureGraphVersion(project,0);
  return appendNativeStory(library,project);
}

function selectedTurn(project, number) {
  const index = project.messages.findIndex((turn,index)=>(turn.turnNumber || index + 1) === number);
  if (index < 0) throw Error('Turn not found. Use read_story_turns for current turn numbers.');
  return index;
}

export function readNativeTurns(project,{afterTurn = 0,turnNumber,offset = 0,limit = 12,recent = false}) {
  const entries = project.messages.map((turn,index)=>({turn,index,number:turn.turnNumber || index + 1}));
  const format = ({turn,index,number},detailed) => {
    const reason = mcpOmissionReason(turn,precedingDirection(project.messages,index));
    const metadata = {turnNumber:number,role:turn.role,storyTime:turn.storyTime,startsChapter:Boolean(turn.startsChapter),context:reason || 'eligible'};
    if (reason) return metadata;
    if (!detailed) return {...metadata,preview:turn.content.slice(0,260)};
    let end = Math.min(turn.content.length,offset + 10000);
    if (end < turn.content.length && /[\ud800-\udbff]/u.test(turn.content[end-1])) end--;
    return {...metadata,content:turn.content.slice(offset,end),...(end < turn.content.length ? {nextOffset:end} : {})};
  };
  if (turnNumber !== undefined) return {turn:format(entries[selectedTurn(project,turnNumber)],true)};
  if (recent) return {turns:entries.slice(-limit).map(entry=>format(entry,false))};
  const matching = entries.filter(entry=>entry.number > afterTurn);
  const page = matching.slice(0,limit);
  return {turns:page.map(entry=>format(entry,false)),...(matching.length > limit ? {nextAfterTurn:page.at(-1).number} : {})};
}

function amendTurn(turn,change) {
  if (change.startsChapter !== undefined && turn.role !== 'assistant') throw Error('Chapter breaks start at a prose turn.');
  if (change.content !== undefined) {
    const changed = change.content !== turn.content;
    turn.content = change.content;
    if (changed) delete turn.continuityPending;
    if (changed) turn.contentSensitivity = 'safe';
    if (turn.alternatives?.length) {
      const selected = turn.selectedAlternative || 0;
      turn.alternatives[selected] = turn.content;
      turn.alternativeSensitivities ||= turn.alternatives.map(()=> 'unclassified');
      turn.alternativeSensitivities[selected] = turn.contentSensitivity || null;
    }
  }
  if (change.storyTime) turn.storyTime = change.storyTime;
  else if (change.storyTime === null) delete turn.storyTime;
  if (change.startsChapter === true) turn.startsChapter = true;
  else if (change.startsChapter === false) delete turn.startsChapter;
}

export function applyNativeStoryChange(library,project,change) {
  const kind = change.kind;
  if (kind === 'delete_story') {
    if (project.id === starterStoryId) throw Error('The temporary demo cannot be deleted.');
    library.projects = library.projects.filter(item=>item.id !== project.id);
    if (library.activeId === project.id) library.activeId = library.projects[0].id;
    return {deleted:true};
  }
  if (graphEditKinds.has(kind)) {
    applyStoryEdits(project,[change]);
  } else {
    const index = selectedTurn(project,change.turnNumber);
    const turn = project.messages[index];
    if (kind === 'edit_turn') {
      if (change.content !== undefined && !isAvailableToMcp(turn,precedingDirection(project.messages,index))) {
        throw Error('Use the browser to edit the text of this withheld turn. Its date and chapter break are editable here.');
      }
      amendTurn(turn,change);
      if (change.content !== undefined) delete project.storyFlow;
      if (project.agentRequest?.turnNumber === change.turnNumber || project.agentRequest?.replyTurnNumber === change.turnNumber) delete project.agentRequest;
    } else if (kind === 'hold_turn') {
      if (change.reason === 'all_ai') turn.excludeFromContext = true;
      else turn.contentSensitivity = change.reason === 'explicit' ? 'explicit' : 'unclassified';
      if (turn.alternativeSensitivities?.length) turn.alternativeSensitivities[turn.selectedAlternative || 0] = turn.contentSensitivity || null;
    } else if (kind === 'delete_turn') {
      const next = project.messages[index+1];
      const paired = turn.role === 'user' && next?.role === 'assistant' && !next.standalone;
      project.messages.splice(index,paired ? 2 : 1);
      delete project.agentRequest;
      delete project.agentNotice;
      return {deletedTurns:paired ? 2 : 1};
    } else {
      const updated = storyAtTurn(project,index);
      if (kind === 'rewind') library.projects[library.projects.indexOf(project)] = updated;
      else {
        const branch = appendNativeStory(library,{...updated,id:randomUUID(),title:change.title});
        return {branchId:branch.id};
      }
    }
  }
  return {changed:kind};
}
