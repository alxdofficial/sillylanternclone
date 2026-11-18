import { normalizeAgentHistory, normalizeSetupHistory } from './agent-context.js';
import { normalizeDraftCheckpoints } from './draft-comparison.js';
import { normalizeGraphHistory } from './graph-history.js';
import { maxLibraryStories, starterStoryId } from './library.js';
import { castFields, graphSuggestions, isStoryTime, migrateLegacyCast, migrateStoryFields, storyTextFields,
  validCast, validPlotEvents, validRelationships, validSensitivity } from './prompt.js';
import { normalizeRevisionNotes } from './revision.js';
import { normalizeSceneBoard } from './scene-board.js';
import { normalizeStoryFlow } from './story-flow.js';

function setOptional(record, key, value) {
  if (value === undefined) delete record[key];
  else record[key] = value;
}

function normalizeTurn(turn, index) {
  const prose = turn.role === 'assistant';
  if (!Number.isSafeInteger(turn.turnNumber) || turn.turnNumber <= 0) turn.turnNumber = index + 1;
  if (!isStoryTime(turn.storyTime)) delete turn.storyTime;
  if (turn.continuityPending !== true) delete turn.continuityPending;
  if (!prose || turn.continuityNeedsReview !== true) delete turn.continuityNeedsReview;
  if (turn.excludeFromContext !== true) delete turn.excludeFromContext;
  if (!validSensitivity(turn.contentSensitivity)) delete turn.contentSensitivity;

  for (const field of ['graphSuggestions','appliedGraphUpdates','firstTakeSuggestions']) {
    const suggestions = graphSuggestions(turn[field]);
    setOptional(turn, field, suggestions.length ? suggestions : undefined);
  }
  if (!prose || turn.standalone !== true) delete turn.standalone;
  if (!prose || turn.startsChapter !== true) delete turn.startsChapter;
  if (!prose || typeof turn.sourcePrefix !== 'string') delete turn.sourcePrefix;
  if (!prose || typeof turn.speakerName !== 'string' || typeof turn.speakerId !== 'string') {
    delete turn.speakerName;
    delete turn.speakerId;
  }

  const alternatives = turn.alternatives;
  if (!prose || !Array.isArray(alternatives) || !alternatives.length ||
      !alternatives.every(text=>typeof text === 'string')) {
    delete turn.alternatives;
    delete turn.selectedAlternative;
    delete turn.alternativeSensitivities;
    return;
  }
  const selected = turn.selectedAlternative;
  turn.selectedAlternative = Number.isInteger(selected) && selected >= 0 && selected < alternatives.length ? selected : 0;
  if (alternatives[turn.selectedAlternative] !== turn.content) {
    alternatives.push(turn.content);
    turn.selectedAlternative = alternatives.length - 1;
  }
  const sensitivities = turn.alternativeSensitivities;
  if (Array.isArray(sensitivities)) {
    turn.alternativeSensitivities = alternatives.map((_,index)=>{
      if (index === turn.selectedAlternative) return turn.contentSensitivity || null;
      const value = sensitivities[index];
      return value === null || validSensitivity(value) ? value : 'unclassified';
    });
  } else delete turn.alternativeSensitivities;
}

function normalizeProject(project, createId) {
  if (!project || typeof project !== 'object' || !Array.isArray(project.messages)) {
    throw Error('A story in this file is missing its turns.');
  }
  if (project.relationships !== undefined && !validRelationships(project.relationships)) throw Error('A story has invalid relationships.');
  if (project.cast !== undefined && !validCast(project.cast)) throw Error('A story has an invalid cast.');
  if (project.messages.some(turn=>!turn || !['user','assistant'].includes(turn.role) || typeof turn.content !== 'string')) {
    throw Error('The library has invalid or too many story turns.');
  }
  migrateStoryFields(migrateLegacyCast(project));
  if (project.plotEvents !== undefined && !validPlotEvents(project.plotEvents)) throw Error('A story has invalid plot events.');
  if (!validCast(project.cast)) throw Error('A story has an invalid cast.');

  if (typeof project.id !== 'string') project.id = createId();
  project.title = String(project.title || 'Untitled story');
  project.lore = String(project.lore || '');
  project.notes = String(project.notes || '');
  for (const key of storyTextFields) if (typeof project[key] !== 'string') project[key] = '';
  for (const relationship of project.relationships || []) relationship.turn ||= 0;
  for (const member of project.cast) for (const field of castFields) member[field] ||= '';
  if (project.revisionNotes) project.revisionNotes = normalizeRevisionNotes(project.revisionNotes);
  else delete project.revisionNotes;
  setOptional(project,'sceneBoard',normalizeSceneBoard(project) || undefined);
  const checkpoints = normalizeDraftCheckpoints(project.draftCheckpoints);
  setOptional(project,'draftCheckpoints',checkpoints?.length ? checkpoints : undefined);
  setOptional(project,'setupHistory',normalizeSetupHistory(project.setupHistory) || undefined);
  setOptional(project,'storyFlow',normalizeStoryFlow(project.storyFlow) || undefined);
  if (project.graphHistory) project.graphHistory = normalizeGraphHistory(project.graphHistory);
  else delete project.graphHistory;
  if (project.agentHistory) project.agentHistory = normalizeAgentHistory(project.agentHistory);
  else delete project.agentHistory;
  if (isStoryTime(project.storyStartAt)) project.storyStartSource ||= 'estimate';
  else {
    delete project.storyStartAt;
    delete project.storyStartSource;
  }

  const edit = project.agentEditRequest;
  if (typeof edit?.id !== 'string' || typeof edit.instruction !== 'string' || !edit.instruction.trim()) delete project.agentEditRequest;
  const request = project.agentRequest;
  if (!request || !['send','alternate','replace'].includes(request.mode) || typeof request.speakerId !== 'string' ||
      !Number.isSafeInteger(request.turnNumber) || request.mode === 'replace' && !Number.isSafeInteger(request.replyTurnNumber)) {
    delete project.agentRequest;
  }
  const notice = project.agentNotice;
  if (typeof notice?.message === 'string' && notice.message.trim() && Number.isSafeInteger(notice.turnNumber)) {
    notice.message = notice.message.trim().slice(0,300);
    if (notice.mode !== 'replace') {
      delete notice.mode;
      delete notice.replyTurnNumber;
    }
  } else delete project.agentNotice;
  if (!Number.isSafeInteger(project.nextTurn) || project.nextTurn <= 0) delete project.nextTurn;
  if (typeof project.graphUpdates !== 'boolean') delete project.graphUpdates;
  if (typeof project.speakerId !== 'string') delete project.speakerId;

  project.messages.forEach(normalizeTurn);
}

export function normalizeLibrary(data, createId = ()=>globalThis.crypto.randomUUID()) {
  if (!Array.isArray(data?.projects) || !data.projects.length || data.projects.length > maxLibraryStories + 1 ||
      data.projects.filter(project=>project?.id !== starterStoryId).length > maxLibraryStories) {
    throw Error('This file does not contain a story library.');
  }
  const library = structuredClone(data);
  library.projects.forEach(project=>normalizeProject(project,createId));
  const ids = new Set(library.projects.map(project=>project.id));
  if (ids.size !== library.projects.length) throw Error('Two stories have the same ID.');
  if (!ids.has(library.activeId)) library.activeId = library.projects[0].id;
  return library;
}
