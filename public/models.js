// Listed OpenRouter USD/token rates, verified 2026-11-15.
// Catalog entries are suggestions, not content or availability guarantees.
export const models = [
  {id:'thedrummer/cydonia-24b-v4.1', name:'Cydonia 24B v4.1', use:'Creative prose', input:0.00000030, output:0.00000050},
  {id:'cognitivecomputations/dolphin-mistral-24b-venice-edition', name:'Venice Dolphin 24B', use:'Steerable instruction following', input:0.00000020, output:0.00000090},
  {id:'sao10k/l3.1-euryale-70b', name:'Euryale 70B v2.2', use:'Character roleplay', input:0.00000085, output:0.00000085}
];

export const outputCost = (model, words = 10_000) => words / 0.75 * model.output;
