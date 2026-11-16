// OpenRouter catalog prices in USD per million tokens, checked 16 November 2026.
export const models = [
  {id:'thedrummer/cydonia-24b-v4.1', name:'Cydonia 24B v4.1', input:0.30, output:0.50, maxOutputTokens:8000, adultTest:'consistent'},
  {id:'deepseek/deepseek-v4.1-flash', name:'DeepSeek V4.1 Flash', input:0.14, output:0.42, agent:true, adultTest:'mixed'},
  {id:'anthropic/claude-sonnet-5.5', name:'Claude Sonnet 5.5', input:2, output:10, agent:true, reasoningRequired:true},
  {id:'openai/gpt-6.1-terra', name:'GPT-6.1 Terra', input:1, output:5, agent:true},
  {id:'z-ai/glm-5.3', name:'GLM 5.3', input:0.0699, output:1.4, agent:true, reasoningRequired:true},
  {id:'moonshotai/kimi-k3.1-pro', name:'Kimi K3.1 Pro', input:0.2403, output:8.4023, agent:true},
  {id:'google/gemini-4-carbon', name:'Gemini 4 Carbon', input:2, output:10, agent:true, reasoningRequired:true}
];

export const isModelId = value => /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(value)
  && value.length <= 150 && value.toLowerCase() !== 'openrouter/auto';

export const isAgentModel = id => models.some(model => model.agent && model.id === id);

export function agentReasoning(id) {
  return models.find(model => model.id === id)?.reasoningRequired ? {effort:'low'} : {enabled:false};
}

export function modelLabel(model) {
  if (model.adultTest === 'mixed') return model.name + ' · 18+ tested (mixed)';
  if (model.adultTest === 'consistent') return model.name + ' · 18+ tested';
  return model.name;
}

export function proseOutputLimit(modelId) {
  return models.find(model => model.id === modelId)?.maxOutputTokens ?? 2048;
}

export function chapterCost(model) {
  return (2_000 * model.input + 5_000 * model.output) / 1_000_000;
}
