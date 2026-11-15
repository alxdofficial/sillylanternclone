// OpenRouter list prices in USD per million tokens, checked 2026-11-15.
export const models = [
  {id:'thedrummer/cydonia-24b-v4.1', name:'Cydonia 24B v4.1', input:0.30, output:0.50},
  {id:'cognitivecomputations/dolphin-mistral-24b-venice-edition', name:'Venice Dolphin 24B', input:0.20, output:0.90},
  {id:'sao10k/l3.1-euryale-70b', name:'Euryale 70B v2.2', input:0.85, output:0.85},
  {id:'anthracite-org/magnum-v4-72b', name:'Magnum v4 72B', input:2.50, output:5.00},
  {id:'thedrummer/unslopnemo-12b', name:'UnslopNemo 12B', input:0.40, output:0.40},
  {id:'gryphe/mythomax-l2-13b', name:'MythoMax 13B', input:0.08, output:0.11}
];

export const isModelId = value => /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(value)
  && value.length <= 150 && value.toLowerCase() !== 'openrouter/auto';

export function chapterCost(model) {
  return (2_000 * model.input + 5_000 * model.output) / 1_000_000;
}
