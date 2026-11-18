import { randomUUID } from 'node:crypto';
import { createArtworkStore } from './artwork-store.mjs';
import { createStoryVersions } from './story-versions.mjs';
import { createSpendLedger } from './provider-spend.mjs';

const bucket = 'story-studio-private';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const revisionTag = () => '"' + randomUUID().replaceAll('-', '') + '"';

function storageError(status = 503, message = 'Hosted storage is temporarily unavailable.') {
  return Object.assign(new Error(message), {status, code:'HOSTED_STORAGE_FAILED'});
}

async function boundedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw storageError();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) return Buffer.concat(chunks,size);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw storageError(500);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function createHostedStorage({url,key,fetchImpl = fetch}) {
  const base = new URL(url);
  if (!['https:','http:'].includes(base.protocol) || base.username || base.password || !key) {
    throw new Error('Configure the Supabase URL and publishable key for hosted storage.');
  }

  function forAccount({userId,accessToken,getAccessToken}) {
    if (!uuid.test(userId) || (!getAccessToken && !accessToken)) throw storageError(401,'Sign in to access your library.');

    async function request(path,options = {}) {
      const token = getAccessToken ? await getAccessToken() : accessToken;
      let response;
      try {
        response = await fetchImpl(new URL(path,base),{
          ...options,
          redirect:'error',
          signal:AbortSignal.timeout(60_000),
          headers:{apikey:key,authorization:'Bearer '+token,...options.headers}
        });
      } catch {
        throw storageError();
      }
      if (response.ok) return response;
      await response.body?.cancel().catch(()=>{});
      if (response.status === 401 || response.status === 403) throw storageError(401,'Sign in again to access your library.');
      if (response.status === 413) throw storageError(413,'The saved data exceeds the hosted storage limit.');
      throw storageError();
    }

    async function query(table,selected,filters) {
      const query = new URLSearchParams({select:selected,user_id:'eq.'+userId,...filters});
      const response = await request('/rest/v1/'+table+'?'+query);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw storageError(500);
      return rows[0];
    }

    async function save(functionName,args) {
      const response = await request('/rest/v1/rpc/'+functionName,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
          ...args,p_revision:revisionTag()
        })
      });
      const result = await response.json();
      if (typeof result !== 'boolean') throw storageError(500);
      return result;
    }

    const library = {
      async read() {
        const row = await query('story_studio_libraries','library,revision');
        return {value:row?.library ?? null,revision:row?.revision ?? null};
      },
      write(value,expectedRevision) {
        return save('story_studio_save_library',{p_library:value,p_expected_revision:expectedRevision});
      }
    };

    const records = {
      async read(recordKey) {
        const row = await query('story_studio_records','value,revision',{record_key:'eq.'+recordKey});
        return {value:row?.value ?? null,revision:row?.revision ?? null};
      },
      write(recordKey,value,expectedRevision) {
        return save('story_studio_save_record',{p_record_key:recordKey,p_value:value,p_expected_revision:expectedRevision});
      },
      async update(recordKey,transform) {
        for (let attempt = 0; attempt < 6; attempt++) {
          const {value,revision} = await records.read(recordKey);
          const changed = await transform(value);
          if (await records.write(recordKey,changed,revision)) return changed;
        }
        throw storageError(409,'The saved data changed. Try again.');
      }
    };

    function fileAccess(namespace) {
      return async (storyKey,work)=>{
        const recordKey = namespace+':'+storyKey;
        const prefix = userId+'/'+namespace+'/'+storyKey+'/';
        const path = '/storage/v1/object/'+bucket+'/';
        async function remove(objects) {
          if (objects.length) {
            const response = await request(path.slice(0,-1),{
              method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:objects})
            });
            await response.body?.cancel();
          }
        }
        for (let attempt = 0; attempt < 6; attempt++) {
          const {value,revision} = await records.read(recordKey);
          const assets = {...value?.assets};
          const writes = new Map();
          const removed = new Set();
          let manifest;
          const result = await work({
            readManifest:async limit=>{
              if (!value) return null;
              const bytes = Buffer.from(JSON.stringify(value.manifest));
              if (bytes.length > limit) throw storageError(500);
              return bytes;
            },
            writeManifest:async bytes=>{ manifest = JSON.parse(bytes.toString('utf8')); },
            readAsset:async (name,limit)=>{
              const object = assets[name];
              if (!uuid.test(object)) throw storageError(500);
              return boundedBytes(await request('/storage/v1/object/authenticated/'+bucket+'/'+prefix+object),limit);
            },
            writeAsset:async (name,bytes,mime)=>{ writes.set(name,{bytes,mime}); },
            removeAsset:async name=>{ removed.add(name); }
          });
          if (!manifest) return result;
          const uploaded = [];
          const discarded = [];
          for (const name of removed) {
            if (uuid.test(assets[name])) discarded.push(prefix+assets[name]);
            delete assets[name];
          }
          try {
            for (const [name,{bytes,mime}] of writes) {
              const object = randomUUID();
              uploaded.push(prefix+object);
              const response = await request(path+prefix+object,{
                method:'POST',headers:{'content-type':mime,'cache-control':'private, max-age=0','x-upsert':'false'},body:bytes
              });
              await response.body?.cancel();
              assets[name] = object;
            }
          } catch (error) {
            await remove(uploaded).catch(()=>{});
            throw error;
          }
          // A lost response can follow a successful CAS. Retain uploaded blobs on ambiguous failures.
          if (await records.write(recordKey,{manifest,assets},revision)) {
            await remove(discarded).catch(()=>{});
            return result;
          }
          await remove(uploaded).catch(()=>{});
        }
        throw storageError(409,'The saved data changed. Try again.');
      };
    }

    return {
      library,records,
      spend:createSpendLedger(undefined,records),
      artwork:createArtworkStore(undefined,fileAccess('artwork')),
      versions:createStoryVersions(undefined,fileAccess('versions'))
    };
  }
  return {forAccount};
}
