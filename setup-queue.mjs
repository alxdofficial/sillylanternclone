import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { diagnosticError } from './diagnostics.mjs';
import { readSetupDraft, setupMessages } from './setup-chat.mjs';
import { maxSetupReplyCharacters } from './public/prompt.js';

const sessions = new Map();
const lifetime = 15 * 60_000;
const lease = 3 * 60_000;
const fail = (message,status = 400) => {
  const error = diagnosticError('SETUP_QUEUE_REJECTED',message);
  error.status = status;
  throw error;
};
const identifier = z.uuid();
const requestShape = z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('queue'),sessionId:identifier,mode:z.enum(['chat','draft']),
    messages:z.array(z.unknown()),manuscript:z.unknown().optional(),reviewed:z.boolean().optional(),
    context:z.string().optional()}),
  z.strictObject({action:z.literal('status'),sessionId:identifier}),
  z.strictObject({action:z.literal('cancel'),sessionId:identifier}),
  z.strictObject({action:z.literal('claim'),sessionId:identifier,agentId:identifier}),
  z.strictObject({action:z.literal('submit'),sessionId:identifier,agentId:identifier,requestId:identifier,
    text:z.string().trim().min(1).max(maxSetupReplyCharacters).optional(),draft:z.unknown().optional(),reason:z.string().trim().min(1).max(300).optional()})
]);

function progress(session) {
  if (!session) return {status:'closed'};
  if (session.result) return {status:'done',...session.result};
  return {status:session.agentId && session.claimUntil > Date.now() ? 'working' : 'waiting'};
}

export function setupQueue(input) {
  const result = requestShape.safeParse(input);
  if (!result.success) fail('The setup request is invalid.');
  const request = result.data;
  const {action,sessionId} = request;
  const now = Date.now();
  for (const [id,session] of sessions) if (session.expires <= now) sessions.delete(id);
  const session = sessions.get(sessionId);
  if (action === 'queue') {
    if (session && !session.result) fail('This setup session already has a pending request.',409);
    if (!session && sessions.size >= 12) fail('Too many setup sessions are open. Close one before continuing.',429);
    const {mode,messages,manuscript,context} = request;
    const prompt = setupMessages(messages,mode,manuscript,context);
    if (!prompt) fail('Check the setup discussion and manuscript excerpts. Your chat messages and additional context share a 20,000-word limit.');
    sessions.set(sessionId,{requestId:randomUUID(),mode,manuscript,prompt,expires:now + lifetime});
    return {status:'waiting'};
  }
  if (action === 'cancel') {
    sessions.delete(sessionId);
    return {status:'closed'};
  }
  if (action === 'status') return progress(session);
  if (action === 'claim') {
    if (!session) return {status:'closed'};
    if (session.result || (session.claimUntil > now && session.agentId !== request.agentId)) return {status:'idle'};
    session.agentId = request.agentId;
    session.claimUntil = now + lease;
    return {status:'queued',requestId:session.requestId,mode:session.mode,hasManuscript:Boolean(session.manuscript),
      prompt:session.prompt};
  }
  if (!session || session.result || session.requestId !== request.requestId || session.agentId !== request.agentId) {
    fail('This setup request has changed or closed. Wait for the next request.',409);
  }
  const {text,draft,reason} = request;
  if ([text,draft,reason].filter(value => value !== undefined).length !== 1) fail('Pass exactly one response, draft, or reason.');
  if (reason) session.result = {error:reason};
  else if (session.mode === 'chat' && text) session.result = {text};
  else if (session.mode === 'draft' && draft) {
    session.result = {draft:readSetupDraft({text:JSON.stringify(draft)},session.manuscript)};
  } else fail('A chat request needs text. A draft request needs structured setup fields.');
  delete session.prompt;
  delete session.manuscript;
  session.expires = now + lifetime;
  return {status:'saved'};
}
