import { agentReasoning, isAgentModel } from './public/models.js';

// Translate Studio's shared chat and function messages at the transport boundary.
const nativeOutput = Symbol('native provider output');
const cacheControl = {type:'ephemeral'};
const cachedText = text => ({type:'text',text,cache_control:cacheControl});
export function rememberProviderOutput(message, result) {
  if (result[nativeOutput]) Object.defineProperty(message,nativeOutput,{value:result[nativeOutput]});
  return message;
}

function claudeMessages(messages, cacheAt) {
  const result = [];
  for (const [index,message] of messages.entries()) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      let previous = result.at(-1);
      if (previous?.role !== 'user' || !Array.isArray(previous.content)) {
        previous = {role:'user',content:[]};
        result.push(previous);
      }
      previous.content.push({type:'tool_result',tool_use_id:message.tool_call_id,content:message.content});
    } else {
      const content = index === cacheAt ? [cachedText(message.content)] : message[nativeOutput] ?? message.content;
      result.push({role:message.role,content});
    }
  }
  return result;
}

export const providerAdapters = new Map([
  ['openrouter',{
    url:'https://openrouter.ai/api/v1/chat/completions',
    headers:key=>({authorization:'Bearer ' + key}),
    request({model,messages,maxOutputTokens,tools,stage,prefixLength,storyRef}) {
      const reasoning = tools || (stage === 'setup-chat' && isAgentModel(model)) ? agentReasoning(model) : undefined;
      const claudeAgent = stage !== 'prose' && model.startsWith('anthropic/');
      const outbound = claudeAgent && prefixLength ? messages.map((message,index)=>index === prefixLength - 1
        ? {...message,content:[{type:'text',text:message.content,cache_control:{type:'ephemeral'}}]}
        : message) : messages;
      return {model,messages:outbound,max_tokens:maxOutputTokens,
        provider:{data_collection:'deny',...(tools || reasoning ? {require_parameters:true} : {})},
        ...(tools ? {tools,tool_choice:'auto'} : {}),reasoning,
        ...(storyRef && stage !== 'prose' ? {session_id:'studio-' + storyRef + '-' + stage} : {}),
        ...(claudeAgent && !prefixLength ? {cache_control:{type:'ephemeral'}} : {})};
    },
    normalize:response=>response
  }],
  ['anthropic',{
    url:'https://api.anthropic.com/v1/messages',
    headers:key=>({'x-api-key':key,'anthropic-version':'2023-06-01'}),
    request({model,messages,maxOutputTokens,tools,prefixLength}) {
      const cacheAt = prefixLength ? prefixLength - 1 : -1;
      const systemBlocks = messages.flatMap((message,index)=>message.role === 'system'
        ? [index === cacheAt ? cachedText(message.content) : {type:'text',text:message.content}] : []);
      const system = systemBlocks.some(block=>block.cache_control) ? systemBlocks : systemBlocks.map(block=>block.text).join('\n\n');
      return {model,system,messages:claudeMessages(messages,cacheAt),max_tokens:maxOutputTokens,
        ...(tools ? {
          tools:tools.map(({function:{name,description,parameters}})=>({name,description,input_schema:parameters})),
          tool_choice:{type:'auto',disable_parallel_tool_use:true}
        } : {})};
    },
    normalize(result) {
      const blocks = Array.isArray(result?.content) ? result.content : [];
      const tool_calls = blocks.filter(block=>block.type === 'tool_use').map(block=>({
        id:block.id,type:'function',function:{name:block.name,arguments:JSON.stringify(block.input)}
      }));
      return {
        error:result?.error, [nativeOutput]:blocks,
        usage:{prompt_tokens:result?.usage && (result.usage.input_tokens ?? 0) +
          (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0),
          completion_tokens:result?.usage?.output_tokens,
          prompt_tokens_details:{cached_tokens:result?.usage?.cache_read_input_tokens,
            cache_write_tokens:result?.usage?.cache_creation_input_tokens}},
        choices:[{
          finish_reason:({max_tokens:'length',model_context_window_exceeded:'length',tool_use:'tool_calls',
            end_turn:'stop',stop_sequence:'stop',refusal:'content_filter'})[result?.stop_reason] ?? 'error',
          message:{content:blocks.filter(block=>block.type === 'text').map(block=>block.text).join(''),
            ...(tool_calls.length ? {tool_calls} : {})}
        }]
      };
    }
  }],
  ['openai',{
    url:'https://api.openai.com/v1/responses',
    headers:key=>({authorization:'Bearer ' + key}),
    request({model,messages,maxOutputTokens,tools}) {
      const input = messages.flatMap(message=>{
        if (message[nativeOutput]) return message[nativeOutput];
        if (message.role === 'tool') return {type:'function_call_output',call_id:message.tool_call_id,output:message.content};
        return {role:message.role,content:message.content};
      });
      return {model,input,max_output_tokens:maxOutputTokens,store:false,
        reasoning:{effort:tools ? 'low' : 'none'},
        ...(tools ? {
          tools:tools.map(({function:definition})=>({type:'function',...definition,strict:false})),
          tool_choice:'auto',parallel_tool_calls:false,include:['reasoning.encrypted_content']
        } : {})};
    },
    normalize(result) {
      const output = Array.isArray(result?.output) ? result.output : [];
      const content = output.filter(item=>item.type === 'message').flatMap(item=>item.content || []);
      const tool_calls = output.filter(item=>item.type === 'function_call').map(item=>({
        id:item.call_id,type:'function',function:{name:item.name,arguments:item.arguments}
      }));
      const finish = result?.status === 'completed' ? (tool_calls.length ? 'tool_calls' : 'stop')
        : ({max_output_tokens:'length',content_filter:'content_filter'})[result?.incomplete_details?.reason] ?? 'error';
      return {
        error:result?.error,[nativeOutput]:output,
        usage:{prompt_tokens:result?.usage?.input_tokens,completion_tokens:result?.usage?.output_tokens,
          prompt_tokens_details:result?.usage?.input_tokens_details},
        choices:[{finish_reason:finish,message:{
          content:content.filter(block=>block.type === 'output_text').map(block=>block.text).join(''),
          refusal:content.find(block=>block.type === 'refusal')?.refusal,
          ...(tool_calls.length ? {tool_calls} : {})
        }}]
      };
    }
  }]
]);
