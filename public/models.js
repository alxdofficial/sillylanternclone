// Rates in USD per million tokens are estimates. Context uses the lowest listed endpoint window.
export const sensitiveArtist = 'thedrummer/cydonia-24b-v4.1';
export const continuityModel = 'deepseek/deepseek-v4.1-flash';
export const providerNames = Object.freeze({
  openrouter:'OpenRouter', anthropic:'Claude API', openai:'OpenAI API'
});
const directDefaults = new Map([['anthropic','claude-haiku-5-5'],['openai','gpt-6-luna']]);

export function defaultDirectModel(configuredProviders, preferredProvider) {
  if (configuredProviders.has(preferredProvider) && directDefaults.has(preferredProvider)) {
    return directDefaults.get(preferredProvider);
  }
  for (const [provider,model] of directDefaults) if (configuredProviders.has(provider)) return model;
  return '';
}

export const models = [
  {id:'claude-haiku-5-5', provider:'anthropic', name:'Claude Haiku 5.5', input:0.10, output:0.50, contextWindow:1_000_000, tier:'Economy'},
  {id:'claude-sonnet-5-5', provider:'anthropic', name:'Claude Sonnet 5.5', input:2, output:10, contextWindow:1_000_000, tier:'Preferred'},
  {id:'gpt-6-luna', provider:'openai', name:'GPT-6 Luna', input:0.10, output:0.50, contextWindow:1_050_000, maxInput:922_000, tier:'Economy'},
  {id:'gpt-6.1-terra', provider:'openai', name:'GPT-6.1 Terra', input:1, output:5, contextWindow:1_050_000, maxInput:922_000, tier:'Preferred'},
  {id:sensitiveArtist, name:'Cydonia 24B v4.1', input:0.30, output:0.50, contextWindow:131_072, sensitiveWriter:true},
  {id:'cognitivecomputations/dolphin-mistral-24b-venice-edition', name:'Dolphin Mistral 24B Venice', input:0.20, output:0.90, contextWindow:128_000, sensitiveWriter:true},
  {id:continuityModel, name:'DeepSeek V4.1 Flash', input:0.14, output:0.42, contextWindow:1_000_000, tier:'Economy', sensitiveAgent:true},
  {id:'mistralai/mistral-large-4-0', name:'Mistral Large 4', input:0.70, output:2.10, contextWindow:524_288, sensitiveAgent:true, agentOnly:true},
  {id:'x-ai/grok-4.7', name:'Grok 4.7', input:2, output:6, contextWindow:500_000, reasoningRequired:true, sensitiveAgent:true, agentOnly:true},
  {id:'z-ai/glm-5.3-flash', name:'GLM 5.3 Flash', input:0.0399, output:0.0784, contextWindow:262_000, tier:'Economy', reasoningRequired:true},
  {id:'xiaomi/mimo-v2.6-flash', name:'Xiaomi MiMo-V2.6-Flash', input:0.10, output:0.28, contextWindow:1_000_000, tier:'Economy'},
  {id:'minimax/minimax-m3.1-flash', name:'MiniMax M3.1 Flash', input:0.075, output:0.30, contextWindow:1_000_000, tier:'Economy', reasoningRequired:true},
  {id:'openai/gpt-6.1-terra', name:'GPT-6.1 Terra', input:1, output:5, contextWindow:1_050_000, tier:'Preferred'},
  {id:'google/gemini-4-hydrogen', name:'Gemini 4 Hydrogen', input:1.50, output:7.50, contextWindow:1_048_576, tier:'Preferred', reasoningRequired:true},
  {id:'anthropic/claude-sonnet-5.5', name:'Claude Sonnet 5.5', input:2, output:10, contextWindow:1_000_000, tier:'Preferred', reasoningRequired:true},
  {id:'qwen/qwen4-max', name:'Qwen4 Max', input:1.50, output:4.50, contextWindow:1_000_000, tier:'Preferred'},
  {id:'z-ai/glm-5.3', name:'GLM 5.3', input:0.0699, output:1.4, tier:'Preferred', contextWindow:262_144, reasoningRequired:true},
  {id:'moonshotai/kimi-k3.1-pro', name:'Kimi K3.1 Pro', input:0.2403, output:8.4023, tier:'Preferred', contextWindow:409_600},
  {id:'google/gemini-4-carbon', name:'Gemini 4 Carbon', input:2, output:10, tier:'Preferred', contextWindow:1_048_576, reasoningRequired:true},
];

export const isModelId = value => typeof value === 'string' && /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(value)
  && value.length <= 150 && value.toLowerCase() !== 'openrouter/auto';

const catalogModel = id => models.find(model=>model.id === id);
export const modelProvider = id => catalogModel(id)?.provider || (isModelId(id) ? 'openrouter' : undefined);
export const isWriterModel = id => Boolean(modelProvider(id)) && !catalogModel(id)?.agentOnly;
export const canWriteSensitive = id => Boolean(catalogModel(id)?.sensitiveWriter);
export const usesSensitiveContinuity = (writer,sensitive) => sensitive || canWriteSensitive(writer);
export const isAgentModel = id => models.some(model => model.id === id && !model.sensitiveWriter && !model.agentOnly);
export const isContinuityModel = (id,sensitive) => sensitive ? Boolean(catalogModel(id)?.sensitiveAgent) : isAgentModel(id);
export const agentOutputLimit = 8_192;
export const setupChatOutputLimit = 2_048;
export const setupDraftOutputLimit = 16_384;
export const setupDraftModel = id => isAgentModel(id) ? id : continuityModel;
export const modelContextWindow = id => catalogModel(id)?.contextWindow;
export const modelInputLimit = id => catalogModel(id)?.maxInput ?? Infinity;

export function agentReasoning(id) {
  return catalogModel(id)?.reasoningRequired ? {effort:'low'} : {enabled:false};
}

export function modelTag(model,{agent = false} = {}) {
  return model.tier || (!agent && model.sensitiveWriter ? 'NSFW-friendly' : '');
}

export function modelLabel(model,options) {
  return [model.name,modelTag(model,options)].filter(Boolean).join(' · ');
}

export function proseOutputLimit(modelId) {
  return modelContextWindow(modelId) ? 8000 : 2048;
}

export function chapterCost(model) {
  if (!Number.isFinite(model.input) || !Number.isFinite(model.output)) return undefined;
  return (2_000 * model.input + 5_000 * model.output) / 1_000_000;
}
