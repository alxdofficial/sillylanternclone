import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentTool } from './agent-tools.mjs';
import { diagnosticError } from './diagnostics.mjs';
import { metadataPreviewDetail, reviewedProposalPreviews } from './public/agent-context.js';
import { restoreDraftText } from './public/draft-comparison.js';
import { ensureGraphBaseline, captureGraphVersion } from './public/graph-history.js';
import { nextTurnNumber } from './public/prompt.js';
import { sceneIndex } from './public/revision.js';
import { lastProseTurn, manuscriptChapters, normalizeSceneBoard, readingChapterBreak, toggleReadingChapter } from './public/scene-board.js';
import { applyStoryEdits, storyEditChangesSchema } from './story-edits.mjs';

const turn = z.int().positive().describe('Stable prose turn from inspect_manuscript.');
const prose = z.string().max(12_000);
const make = (kind,fields) => z.strictObject({kind:z.literal(kind),...fields});
const limit = 10;

export const manuscriptChangesSchema = z.array(z.discriminatedUnion('kind',[
  make('revise_scene',{turn,text:prose,anchor:z.string().min(1).max(6000).optional().describe('Exact unique passage to replace. Omit only for an explicitly requested full-scene rewrite.')}),
  make('insert_scene',{text:prose.min(1).refine(value=>Boolean(value.trim()),'Supply scene prose.'),beforeTurn:turn.optional(),newChapter:z.boolean().optional().describe('Insert a chapter break immediately before the new scene.')}),
  make('delete_scene',{turn}),
  make('move_scene',{turn,beforeTurn:turn.optional().describe('Target scene. Omit only to move to the end of the book.')}),
  make('chapter_break',{turn,enabled:z.boolean()}),
  make('move_chapter',{turn:turn.describe('First turn of the chapter to move.'),beforeTurn:turn.optional()
    .describe('First turn of the destination chapter. Omit to move to the end.')}),
  make('delete_chapter',{turn:turn.describe('First turn of the chapter to remove.')}),
  make('scene_details',{turn,pov:z.string().trim().max(160).optional(),summary:z.string().trim().max(180).optional(),
    status:z.enum(['draft','revising','ready']).optional(),heading:z.string().trim().max(180).optional()})
])).max(limit);

const inspectSchema = z.strictObject({turn:turn.optional(),offset:z.int().nonnegative().optional()});
const failure = text => diagnosticError('MANUSCRIPT_EDIT_INVALID',text);
const projected = (text,limit) => text.slice(0,limit).replace(/[\uD800-\uDBFF]$/u,'');

export function manuscriptReader(project,reads) {
  let scenes;
  return agentTool('inspect_manuscript',
    'List up to 20 scenes in reading order with stable turns; follow nextOffset. To read one eligible scene, supply its turn and optional character offset. Read the exact target before revising it. Withheld text is unavailable.',
    inspectSchema,({turn,offset = 0})=>{
      reads.used = true;
      scenes ??= sceneIndex(project);
      if (turn) {
        const scene = scenes.find(item=>item.turn === turn);
        if (!scene?.eligible) return {error:'This scene is unavailable to the agent. Ask the writer for clarification when needed.'};
        const text = projected(scene.text.slice(offset),6000);
        const nextOffset = offset + text.length;
        if (text.length) {
          const read = reads.scenes.get(turn) || {length:scene.text.length,pages:new Map()};
          read.pages.set(offset,text);
          reads.scenes.set(turn,read);
        }
        return {turn,chapter:scene.chapter,scene:scene.number,text,...(nextOffset < scene.text.length ? {nextOffset} : {})};
      }
      return {
        scenes:scenes.slice(offset,offset+20).map(scene=>({turn:scene.turn,chapter:scene.chapter,scene:scene.number,
          available:scene.eligible,...(scene.eligible ? {opening:projected(scene.text,240)} : {})})),
        ...(offset+20 < scenes.length ? {nextOffset:offset+20} : {})
      };
    });
}

function contiguousPages(pages) {
  const runs = [];
  for (const [start,text] of [...pages].sort(([a],[b])=>a-b)) {
    const previous = runs.at(-1);
    const end = previous && previous.start + previous.text.length;
    if (previous && start <= end) previous.text += text.slice(end-start);
    else runs.push({start,text});
  }
  return runs;
}

export function requireManuscriptReads(operations,reads) {
  for (const edit of operations) {
    if (edit.kind !== 'revise_scene') continue;
    const read = reads.scenes.get(edit.turn);
    if (!read?.pages.size) throw failure('Read the target scene with inspect_manuscript before revising it.');
    const runs = contiguousPages(read.pages);
    if (edit.anchor && !runs.some(({text})=>text.includes(edit.anchor))) {
      throw failure('Use an exact anchor from the text read with inspect_manuscript.');
    }
    if (!edit.anchor && (runs[0].start !== 0 || runs[0].text.length < read.length)) {
      throw failure('Read the remaining scene pages before a full rewrite, or use an exact passage anchor.');
    }
  }
}

function setBoard(project,value) {
  const board = normalizeSceneBoard(project,value);
  if (board) project.sceneBoard = board;
  else delete project.sceneBoard;
}

function chapterOrder(project) {
  return manuscriptChapters(project).map(chapter=>chapter.map(scene=>scene.turn));
}

function changeOrder(project,chapters,number,beforeTurn,newChapter,nextChapterAfter = project.sceneBoard?.nextChapterAfter) {
  const target = beforeTurn === undefined ? chapters.length-1 : chapters.findIndex(scenes=>scenes.includes(beforeTurn));
  if (beforeTurn !== undefined && target < 0) throw failure('Use an existing destination scene turn from inspect_manuscript.');
  if (!chapters.length) chapters.push([number]);
  else {
    const chapter = chapters[target];
    const position = beforeTurn === undefined ? chapter.length : chapter.indexOf(beforeTurn);
    if (!newChapter) chapter.splice(position,0,number);
    else if (!position) chapters.splice(target,0,[number]);
    else chapters.splice(target+1,0,[number,...chapter.splice(position)]);
  }
  setBoard(project,{...project.sceneBoard,chapters,nextChapterAfter});
}

function removeScenes(project,numbers) {
  const adjustGraph = [...(project.plotEvents || []),...(project.relationships || [])].some(event=>numbers.has(event.turn));
  if (adjustGraph) ensureGraphBaseline(project);
  const chapters = chapterOrder(project).map(chapter=>chapter.filter(turn=>!numbers.has(turn)));
  const keepUpcoming = Boolean(project.sceneBoard?.nextChapterAfter);
  const next = nextTurnNumber(project);
  // Give older messages stable numbers before removing an entry that could shift their position.
  project.messages = project.messages.map((message,index)=>({...message,turnNumber:message.turnNumber || index+1}))
    .filter(message=>!numbers.has(message.turnNumber));
  project.nextTurn = next;
  for (const field of ['plotEvents','relationships','draftCheckpoints']) {
    if (project[field]) project[field] = project[field].filter(item=>!numbers.has(item.turn));
  }
  if (numbers.has(project.agentRequest?.replyTurnNumber)) delete project.agentRequest;
  if ([project.agentNotice?.turnNumber,project.agentNotice?.replyTurnNumber].some(turn=>numbers.has(turn))) delete project.agentNotice;
  setBoard(project,{...project.sceneBoard,chapters,nextChapterAfter:keepUpcoming ? lastProseTurn(project) : undefined});
  if (adjustGraph) captureGraphVersion(project,Math.max(next-1,project.graphHistory.at(-1)?.turn || 0));
}

function applyOperation(project,operation) {
  const ordered = manuscriptChapters(project).flat();
  const {kind,turn:target,beforeTurn} = operation;
  const current = ordered.find(item=>item.turn === target);
  const label = current ? `Chapter ${current.chapter} · Scene ${current.number}` : '';
  const destination = ordered.find(item=>item.turn === beforeTurn);
  if (beforeTurn !== undefined && !destination) throw failure('The destination scene is unavailable. Use a current turn from inspect_manuscript.');
  const destinationLabel = destination ? `before scene ${destination.number}` : 'at the end';
  if (kind !== 'insert_scene' && !current) throw failure('Use an existing scene turn from inspect_manuscript.');
  if (kind === 'insert_scene') {
    const chapters = chapterOrder(project);
    const number = nextTurnNumber(project);
    project.messages.push({role:'assistant',standalone:true,content:operation.text,turnNumber:number,
      contentSensitivity:'unclassified',continuityNeedsReview:true});
    project.nextTurn = number + 1;
    const upcoming = Boolean(project.sceneBoard?.nextChapterAfter);
    const extending = beforeTurn === undefined;
    const newChapter = operation.newChapter || extending && upcoming;
    changeOrder(project,chapters,number,beforeTurn,newChapter,upcoming && !extending ? number : null);
    return {title:`Insert prose ${destinationLabel}${newChapter ? ' with a chapter break' : ''}`,after:operation.text};
  }
  if (kind === 'revise_scene') {
    if (!sceneIndex(project).find(item=>item.turn === target)?.eligible) {
      throw failure('That scene is withheld from AI context. Choose an eligible scene.');
    }
    const original = current.content;
    let content = operation.text;
    if (operation.anchor !== undefined) {
      const start = original.indexOf(operation.anchor);
      if (start < 0 || start !== original.lastIndexOf(operation.anchor)) throw failure('Quote one exact, unique passage from the current scene.');
      content = original.slice(0,start) + operation.text + original.slice(start + operation.anchor.length);
    } else if (original.length > 12_000) {
      throw failure('Revise this long scene using exact passage anchors in smaller batches.');
    }
    if (!content.trim()) throw failure('Use delete_scene to remove the entire scene.');
    if (content === original) return null;
    try { restoreDraftText(project,target,original,{content}); }
    catch (error) { throw failure(error.message); }
    return {title:`${label} · New take`,before:operation.anchor || original,after:operation.text};
  }
  if (kind === 'delete_scene') {
    // Keep the author direction in Write. Remove the scene and the records anchored to it.
    removeScenes(project,new Set([target]));
    const excerpt = projected(current.content,1500);
    return {title:`Delete ${label}`,detail:'Removes the scene, its takes and checkpoints, and graph events sourced to it.',
      before:excerpt + (excerpt.length < current.content.length ? '…' : '')};
  }
  if (kind === 'chapter_break') {
    const hasBreak = readingChapterBreak(project,target);
    if (hasBreak === null) throw failure('The first scene already opens Chapter 1. Choose another scene.');
    if (hasBreak === operation.enabled) return null;
    setBoard(project,toggleReadingChapter(project,target));
    return {title:`${operation.enabled ? 'Add' : 'Remove'} chapter break before scene ${current.number}`};
  }
  if (kind === 'move_chapter' || kind === 'delete_chapter') {
    const chapters = chapterOrder(project);
    const sourceIndex = chapters.findIndex(scenes=>scenes[0] === target);
    if (sourceIndex < 0) throw failure('Use the opening turn of the chapter.');
    if (kind === 'delete_chapter') {
      const removed = chapters[sourceIndex];
      removeScenes(project,new Set(removed));
      return {title:`Delete Chapter ${sourceIndex+1}`,detail:`Removes ${removed.length} prose ${removed.length === 1 ? 'scene' : 'scenes'} and their takes, checkpoints, and sourced graph events.`};
    }
    if (beforeTurn === target) return null;
    const [source] = chapters.splice(sourceIndex,1);
    const index = beforeTurn === undefined ? chapters.length : chapters.findIndex(scenes=>scenes[0] === beforeTurn);
    if (index < 0) throw failure('Use the opening turn of the destination chapter.');
    if (sourceIndex === index) return null;
    chapters.splice(index,0,source);
    setBoard(project,{...project.sceneBoard,chapters});
    return {title:`Move Chapter ${sourceIndex+1} ${destination ? 'before Chapter ' + destination.chapter : 'to the end'}`};
  }
  if (kind === 'move_scene') {
    if (beforeTurn === target) throw failure('A scene cannot move before itself.');
    const chapters = chapterOrder(project);
    const original = JSON.stringify(chapters);
    const source = chapters.find(scenes=>scenes.includes(target));
    source.splice(source.indexOf(target),1);
    const requested = chapters.filter(scenes=>scenes.length);
    changeOrder(project,requested,target,beforeTurn,false);
    if (JSON.stringify(chapterOrder(project)) === original) return null;
    return {title:`Move ${label} ${destinationLabel}`};
  }
  const scene = project.messages.find((message,index)=>(message.turnNumber || index+1) === target);
  const {pov,summary,status,heading} = operation;
  const originalBoard = JSON.stringify(project.sceneBoard);
  const previousHeading = scene.sourcePrefix;
  const oldScene = project.sceneBoard?.scenes?.[target];
  const fields = Object.fromEntries(Object.entries({pov,summary,status}).filter(([,value])=>value !== undefined));
  setBoard(project,{...project.sceneBoard,scenes:{...project.sceneBoard?.scenes,[target]:{...oldScene,...fields}}});
  if (heading !== undefined) scene.sourcePrefix = heading;
  if (JSON.stringify(project.sceneBoard) === originalBoard && scene.sourcePrefix === previousHeading) return null;
  return {title:`Update scene details for ${label}`,detail:Object.entries({...fields,...(heading !== undefined ? {heading} : {})})
    .map(([key,value])=>key + ' · ' + (value || 'Clear field')).join('\n')};
}

function stableKeys(_key,value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]]));
}

function manuscriptRevision(project) {
  const {agentHistory,agentEditRequest,agentNotice,...book} = project;
  return createHash('sha256').update(JSON.stringify(book,stableKeys)).digest('hex');
}

const indexedGraphEdits = {
  edit_plot:'plotEvents',remove_plot:'plotEvents',edit_relationship:'relationships',remove_relationship:'relationships'
};

function remapGraphIndices(project,draft,metadata) {
  if (project.messages.length === draft.messages.length &&
      (project.plotEvents?.length ?? 0) === (draft.plotEvents?.length ?? 0) &&
      (project.relationships?.length ?? 0) === (draft.relationships?.length ?? 0)) return metadata;
  const surviving = new Set(draft.messages.map((message,index)=>message.turnNumber || index+1));
  const removed = new Set(project.messages.map((message,index)=>message.turnNumber || index+1)
    .filter(turn=>!surviving.has(turn)));
  if (!removed.size) return metadata;
  return metadata.map(change=>{
    const field = indexedGraphEdits[change.kind];
    if (!field) return change;
    const original = project[field] || [];
    if (!original[change.eventIndex] || removed.has(original[change.eventIndex].turn)) {
      throw failure('A graph edit targets an event removed by this manuscript change. Omit that graph edit or choose another event.');
    }
    const eventIndex = original.slice(0,change.eventIndex).filter(event=>!removed.has(event.turn)).length;
    return {...change,eventIndex};
  });
}

function plan(project,operations,metadata) {
  const draft = structuredClone(project);
  const previews = [];
  const revised = new Set();
  for (const operation of operations) {
    if (operation.kind === 'revise_scene') {
      if (revised.has(operation.turn)) throw failure('Combine revisions to each scene into one exact replacement or separate requests.');
      revised.add(operation.turn);
    }
    const preview = applyOperation(draft,operation);
    if (preview) previews.push(preview);
  }
  const count = metadata.length ? applyStoryEdits(draft,remapGraphIndices(project,draft,metadata)) : 0;
  if (previews.length) delete draft.storyFlow;
  return {draft,previews,count};
}

function describeMetadata(previews,count,metadata) {
  if (count) previews.push({title:`${count} story-state ${count === 1 ? 'change' : 'changes'}`,
    detail:metadataPreviewDetail(metadata)});
}

export function proposeManuscriptEdit(project,operations,metadata) {
  const {previews,count} = plan(project,operations,metadata);
  if (!previews.length && !count) return null;
  describeMetadata(previews,count,metadata);
  return {id:randomUUID(),base:manuscriptRevision(project),operations,metadata,previews};
}

export function applyManuscriptProposal(project,id) {
  const entry = project.agentHistory?.find(item=>item.proposal?.id === id && !item.resolution);
  if (!entry) throw failure('This proposal is no longer pending.');
  const {base,operations,metadata} = entry.proposal;
  if (base !== manuscriptRevision(project)) throw failure('The story changed after this proposal. Ask the agent for a fresh revision.');
  const parsed = manuscriptChangesSchema.safeParse(operations);
  const state = storyEditChangesSchema.safeParse(metadata);
  if (!parsed.success || !state.success || !parsed.data.length) throw failure('This proposal is no longer valid. Ask for a new one.');
  const {draft,previews,count} = plan(project,parsed.data,state.data);
  if (!previews.length && !count) throw failure('There are no remaining changes to apply.');
  const applied = previews.length+count;
  describeMetadata(previews,count,state.data);
  if (JSON.stringify(previews,stableKeys) !== JSON.stringify(reviewedProposalPreviews(entry.proposal),stableKeys)) {
    throw failure('The reviewed preview no longer matches the proposed edits. Ask for a fresh proposal.');
  }
  const accepted = draft.agentHistory.find(item=>item.proposal?.id === id);
  accepted.resolution = 'applied';
  accepted.count = applied;
  accepted.proposalId = id;
  delete accepted.proposal;
  return {project:draft,count:applied};
}
