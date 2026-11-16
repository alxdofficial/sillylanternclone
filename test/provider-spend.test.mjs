import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSpendLedger, providerCost } from '../provider-spend.mjs';

test('spend uses reported OpenRouter costs and direct API cache rates', () => {
  assert.equal(providerCost('openrouter','router/custom',{cost:0.014}),0.014);
  assert.equal(providerCost('openrouter','router/custom',{}),null);
  assert.equal(providerCost('anthropic','claude-sonnet-5-5',{
    input_tokens:1000,output_tokens:100,cache_read_input_tokens:2000,cache_creation_input_tokens:2000,
    cache_creation:{ephemeral_1h_input_tokens:1000}
  }),0.0097);
  assert.equal(providerCost('openai','gpt-6.1-terra',{
    input_tokens:300_000,output_tokens:1000,input_tokens_details:{cached_tokens:100_000,cache_write_tokens:100_000,
      cache_write_tokens_details:{ttl_12h_tokens:40_000}}
  }),0.5675);
});

test('daily spend persists by provider and model, using the requested local date', async () => {
  const path = await mkdtemp(join(tmpdir(),'story-studio-spend-'));
  try {
    const ledger = createSpendLedger(path);
    const time = new Date('2026-11-16T18:00:00Z');
    ledger.record({provider:'openrouter',model:'openai/gpt-6.1-terra',result:{usage:{cost:0.05}},time});
    ledger.record({provider:'openrouter',model:'openai/gpt-6.1-terra',result:{},time});
    ledger.record({provider:'openai',model:'gpt-6.1-terra',result:{usage:{input_tokens:1000,output_tokens:0}},time});
    const now = new Date('2026-11-17T02:00:00Z');
    const days = await createSpendLedger(path).recent('Asia/Hong_Kong',now);
    assert.equal(days.length,7);
    assert.equal(days.at(-2).models.length,0);
    assert.deepEqual(days.at(-1),{date:'2026-11-17',models:[
      {provider:'openrouter',model:'openai/gpt-6.1-terra',usd:0.05,estimated:false,unpriced:1,calls:2},
      {provider:'openai',model:'gpt-6.1-terra',usd:0.001,estimated:true,unpriced:0,calls:1}
    ]});
  } finally {
    await rm(path,{recursive:true,force:true});
  }
});
