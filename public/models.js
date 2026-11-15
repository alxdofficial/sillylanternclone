// OpenRouter catalog prices in USD per million tokens.
export const models = [
  {id:'thedrummer/cydonia-24b-v4.1', name:'Cydonia 24B v4.1', input:0.30, output:0.50, maxOutputTokens:8000},
  {id:'gryphe/mythomax-l2-13b', name:'MythoMax 13B', input:0.08, output:0.11},
  {id:'deepseek/deepseek-v4.1-flash', name:'DeepSeek V4.1 Flash', input:0.0507, output:0.2028}
];

export const isModelId = value => /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(value)
  && value.length <= 150 && value.toLowerCase() !== 'openrouter/auto';

export function proseOutputLimit(modelId) {
  return models.find(model => model.id === modelId)?.maxOutputTokens ?? 2048;
}

export function chapterCost(model) {
  return (2_000 * model.input + 5_000 * model.output) / 1_000_000;
}
