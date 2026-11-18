import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isModelId, modelProvider, models } from './public/models.js';
import { chatUsage } from './provider-api.mjs';

const dayMs = 86_400_000;
const isoDay = date => date.toISOString().slice(0,10);
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;
const count = value => tokenCount(value) ? value : 0;
const finiteCost = value => Number.isFinite(value) && value >= 0;
const tokenFields = ['input','output','cacheRead','cacheWrite'];

export function providerCost(provider, model, usage) {
  if (provider === 'openrouter') return finiteCost(usage?.cost) ? usage.cost : null;
  if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 ||
      !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) return null;
  const rates = models.find(item=>item.id === model && item.provider === provider);
  if (!rates) return null;
  const input = usage.input_tokens, output = usage.output_tokens;
  if (provider === 'anthropic') {
    const read = count(usage.cache_read_input_tokens);
    const writes = count(usage.cache_creation_input_tokens);
    const hour = Math.min(writes,count(usage.cache_creation?.ephemeral_1h_input_tokens));
    if (model === 'claude-haiku-5-5') {
      const multiplier = input + read + writes > 100_000 ? 5 : 1;
      return multiplier * (input * rates.input + read * 0.01 + (writes - hour) * 0.125 + hour * 0.20 + output * rates.output) / 1_000_000;
    }
    return (input * rates.input + read * 0.10 + (writes - hour) * 2.50 + hour * 4 + output * rates.output) / 1_000_000;
  }
  const detail = usage.input_tokens_details;
  const read = Math.min(input,count(detail?.cached_tokens));
  const writes = Math.min(input - read,count(detail?.cache_write_tokens));
  if (model === 'gpt-6-luna') {
    const billedInput = (input - read - writes) * rates.input + 0.01 * read + 0.125 * writes;
    return (input > 272_000 ? billedInput * 2 + output * rates.output * 1.5 : billedInput + output * rates.output) / 1_000_000;
  }
  const extended = Math.min(writes,count(detail?.cache_write_tokens_details?.ttl_12h_tokens));
  const billedInput = (input - read - writes) * rates.input + 0.05 * read + 1.25 * (writes - extended) + 2.50 * extended;
  return (input > 272_000 ? billedInput * 2 + output * rates.output * 1.5 : billedInput + output * rates.output) / 1_000_000;
}

export function createSpendLedger(dataDir) {
  const directory = join(dataDir,'provider-spend');
  return {
    record({provider,model,result,time = new Date()}) {
      const returnedModel = result?.model;
      if (provider === 'openrouter' && isModelId(returnedModel)) model = returnedModel;
      const usd = providerCost(provider,model,result?.usage);
      const usage = chatUsage(provider,result?.usage);
      const reported = {input:usage?.prompt_tokens,output:usage?.completion_tokens,
        cacheRead:usage?.prompt_tokens_details?.cached_tokens,cacheWrite:usage?.prompt_tokens_details?.cache_write_tokens};
      const tokens = Object.fromEntries(Object.entries(reported).filter(([,value])=>tokenCount(value)));
      mkdirSync(directory,{recursive:true,mode:0o700});
      appendFileSync(join(directory,isoDay(time)+'.jsonl'),
        JSON.stringify({time:time.toISOString(),provider,model,usd,tokens})+'\n',{mode:0o600});
      return usd;
    },
    async recent(timeZone, now = new Date()) {
      const formatter = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
      const localDay = date => {
        const values = Object.fromEntries(formatter.formatToParts(date).map(({type,value})=>[type,value]));
        return values.year+'-'+values.month+'-'+values.day;
      };
      const localToday = Date.parse(localDay(now)+'T12:00:00Z');
      const days = new Map(Array.from({length:7},(_,i)=>[isoDay(new Date(localToday - (6-i)*dayMs)),new Map()]));
      const files = await Promise.all(Array.from({length:8},(_,i)=>readFile(
        join(directory,isoDay(new Date(now.valueOf()-i*dayMs))+'.jsonl'),'utf8'
      ).catch(error=>{ if (error.code !== 'ENOENT') throw error; return ''; })));
      for (const file of files) {
        for (const line of file.trim().split('\n')) {
          if (!line) continue;
          let entry;
          try { entry = JSON.parse(line); } catch { continue; }
          const {provider,model,time,usd} = entry || {};
          const timestamp = Date.parse(time);
          if (!Number.isFinite(timestamp) || !provider || modelProvider(model) !== provider) continue;
          const rows = days.get(localDay(new Date(timestamp)));
          if (!rows) continue;
          const key = provider+'/'+model;
          const row = rows.get(key) || {provider,model,usd:0,estimated:provider !== 'openrouter',unpriced:0,calls:0};
          row.calls++;
          if (finiteCost(usd)) row.usd += usd;
          else row.unpriced++;
          for (const field of tokenFields) {
            const value = entry.tokens?.[field];
            if (!tokenCount(value)) continue;
            const totals = row.tokens ||= {};
            const metric = totals[field] ||= {total:0,calls:0};
            metric.total += value;
            metric.calls++;
          }
          rows.set(key,row);
        }
      }
      return [...days].map(([date,rows])=>({date,models:[...rows.values()].sort((a,b)=>b.usd-a.usd)}));
    }
  };
}
