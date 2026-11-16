import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const logLimit = 1024 * 1024;
const logDirectory = process.env.STORY_STUDIO_LOG_DIR
  || (process.env.STORY_STUDIO_DATA ? join(process.env.STORY_STUDIO_DATA,'logs')
    : join(homedir(),'Library','Logs','Story Studio'));

const systemCodes = new Set([
  'EACCES','EADDRINUSE','EADDRNOTAVAIL','ECONNREFUSED','ECONNRESET','EIO',
  'EMFILE','ENOENT','ENOSPC','ENOTDIR','EPERM','EROFS','ETIMEDOUT'
]);

export function diagnosticError(code, message) {
  return Object.assign(new Error(message), {diagnosticCode:code});
}

export function errorCode(error, fallback) {
  if (error?.diagnosticCode) return error.diagnosticCode;
  if (systemCodes.has(error?.code)) return error.code;
  if (systemCodes.has(error?.cause?.code)) return error.cause.code;
  if (error?.name === 'TimeoutError') return 'TIMEOUT';
  return fallback;
}

export function storyReference(id) {
  return typeof id === 'string' && id ? createHash('sha256').update(id).digest('hex').slice(0,12) : undefined;
}

export function createLogger(component, {limit = logLimit, redact} = {}) {
  const file = join(logDirectory,component + '.log');
  let reportedFailure = false;
  return (level,event,details = {}) => {
    try {
      mkdirSync(logDirectory,{recursive:true,mode:0o700});
      try {
        if (statSync(file).size >= limit) renameSync(file,file + '.1');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const line = JSON.stringify({time:new Date().toISOString(),level,component,event,pid:process.pid,...details},redact);
      appendFileSync(file,line + '\n',{mode:0o600});
    } catch {
      if (!reportedFailure) process.stderr.write(`Story Studio could not write its ${component} diagnostic log. Check the log directory permissions.\n`);
      reportedFailure = true;
    }
  };
}

export function createTrace(component) {
  const write = createLogger(`${component}-trace`,{limit:16 * logLimit,
    redact:(_, value) => typeof value === 'string' ? value.replace(/sk-or-v1-[\w-]+/gi,'[REDACTED API KEY]') : value});
  return (event, details, key) => {
    // Never capture request headers. Also remove the active credential if an upstream echoes it.
    if (key) {
      details = JSON.parse(JSON.stringify(details,(_, value) =>
        typeof value === 'string' ? value.replaceAll(key,'[REDACTED API KEY]') : value));
    }
    write('info',event,details);
  };
}
