import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { providerNames } from './public/models.js';
import { diagnosticError } from './diagnostics.mjs';

const providers = Object.keys(providerNames);
export const validKey = key => typeof key === 'string' && /^[!-~]{1,512}$/.test(key);

export function createCredentialStore(dataDirectory) {
  const directory = join(dataDirectory,'credentials');
  const path = join(directory,'providers.json');
  let writes = Promise.resolve();
  const failure = () => diagnosticError('CREDENTIAL_STORE_UNAVAILABLE',
    'Studio could not access the local API key storage. Check the credentials folder in the Story Studio data directory.');
  const privateToUser = stat => (stat.mode & 0o077) === 0 && stat.uid === process.getuid();

  async function read() {
    try {
      const folder = await lstat(directory);
      if (!folder.isDirectory() || !privateToUser(folder)) throw failure();
      const file = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || !privateToUser(stat) || stat.size > 4096) throw failure();
        const data = JSON.parse(await file.readFile('utf8'));
        if (!data || Array.isArray(data) || typeof data !== 'object' ||
            Object.entries(data).some(([provider,key])=>!providers.includes(provider) || !validKey(key))) throw failure();
        return data;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw failure();
    }
  }

  const enabled = data => providers.filter(provider=>Object.hasOwn(data,provider));
  return {
    async status() {
      return enabled(await read());
    },
    async keys(requested) {
      if (!requested.some(([provider,key])=>providers.includes(provider) && key === undefined)) {
        return requested.map(([,key])=>key);
      }
      const saved = await read();
      return requested.map(([provider,key])=>key === undefined && providers.includes(provider) ? saved[provider] : key);
    },
    update(changes) {
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
          Object.entries(changes).some(([provider,key])=>!providers.includes(provider) || key !== null && !validKey(key))) {
        throw Object.assign(diagnosticError('INVALID_PROVIDER_KEYS','Enter a valid provider API key.'),{status:400});
      }
      const operation = writes.then(async () => {
        const data = await read();
        if (!Object.keys(changes).length) return enabled(data);
        await mkdir(directory,{recursive:true,mode:0o700});
        for (const [provider,key] of Object.entries(changes)) {
          if (key === null) delete data[provider];
          else data[provider] = key;
        }
        const temporary = join(directory,`.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary,JSON.stringify(data),{flag:'wx',mode:0o600});
          await rename(temporary,path);
        } finally {
          await unlink(temporary).catch(()=>{});
        }
        return enabled(data);
      }).catch(error => {
        if (error.diagnosticCode) throw error;
        throw failure();
      });
      writes = operation.catch(()=>{});
      return operation;
    }
  };
}
