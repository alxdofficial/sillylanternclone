import { z } from 'zod';
import { diagnosticError } from './diagnostics.mjs';

export function agentTool(name,description,schema,handle) {
  const {$schema, ...parameters} = z.toJSONSchema(schema,{target:'draft-7'});
  return {schema,handle,definition:{type:'function',function:{name,description,parameters}}};
}

export async function runAgentTask({messages,completions,action,reads = [],text,code,failure,prefixLength,onActionFeedback,roundLimit = ()=>4,retryMissingAction = false}) {
  const tools = [...reads,...(action ? [action] : [])].map(entry=>entry.definition);
  const finalName = action?.definition.function.name;
  let nudged = false;
  for (let round=0; round<roundLimit(); round++) {
    const response = await completions(messages,tools,prefixLength);
    if (text && typeof response?.text === 'string') return text(response);
    const calls = response?.tool_calls;
    if (calls === undefined || Array.isArray(calls) && !calls.length) {
      if (!retryMissingAction || !finalName || nudged || round+1 >= roundLimit()) break;
      nudged = true;
      const reply = response?.content ?? response?.text;
      if (typeof reply === 'string' && reply.trim()) messages.push({role:'assistant',content:reply});
      messages.push({role:'user',content:`Finish with the required ${finalName} tool. Include your reply in message. If you are only discussing the story, submit changes: [] with your reply.`});
      continue;
    }
    if (!Array.isArray(calls) || calls.length > 4) break;
    if (calls.some(call=>typeof call?.id !== 'string' || !call.id || call.type !== 'function'
      || typeof call.function?.name !== 'string' || !call.function.name
      || typeof call.function.arguments !== 'string') ||
      new Set(calls.map(call=>call.id)).size !== calls.length) break;
    messages.push(response);
    const results = [];
    const finalCalls = finalName ? calls.filter(call=>call.function.name === finalName).length : 0;
    for (const call of calls) {
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { /* Return an argument error below. */ }
      let result = {error:'Use an available tool and match its argument schema.'};
      const selected = [action,...reads].find(entry=>entry?.definition.function.name === call.function?.name);
      if (finalCalls > 1 && selected === action) {
        result = {error:'Send one final tool call. Combine all intended changes into that call.'};
      } else if (selected && selected === action && calls.length > 1) {
        result = {error:'Review the read results, then send the final action on its own.'};
      } else if (selected && args === undefined) {
        result = {error:'Send valid JSON arguments and match its argument schema.'};
      } else if (selected) {
        const parsed = selected.schema.safeParse(args);
        if (parsed.success) {
          const outcome = selected.handle(parsed.data);
          if (selected === action && Object.hasOwn(outcome,'value')) return outcome.value;
          result = selected === action ? outcome.feedback : outcome;
        } else {
          result = {error:'Match the tool argument schema.',fields:[...new Set(parsed.error.issues.map(issue=>issue.path.join('.') || 'arguments'))].slice(0,12)};
        }
      }
      if (selected && selected === action) onActionFeedback?.(result,args);
      results.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
    }
    messages.push(...results);
  }
  throw diagnosticError(code,failure);
}
