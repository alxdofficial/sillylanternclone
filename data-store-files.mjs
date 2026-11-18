import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readBoundedFile(path,limit,corrupt) {
  const handle = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > limit) throw corrupt();
    const data = Buffer.alloc(stats.size);
    let position = 0;
    while (position < data.length) {
      const {bytesRead} = await handle.read(data,position,data.length-position);
      if (!bytesRead) throw corrupt();
      position += bytesRead;
    }
    if ((await handle.stat()).size !== stats.size) throw corrupt();
    return data;
  } finally {
    await handle.close();
  }
}

export async function checkedDirectory(path,create,corrupt) {
  if (create) await mkdir(path,{recursive:true,mode:0o700});
  try {
    if (!(await lstat(path)).isDirectory()) throw corrupt();
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' && !create) return false;
    throw error;
  }
}

export async function atomicWrite(folder,filename,bytes) {
  const temporary = join(folder,`.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});
    await rename(temporary,join(folder,filename));
  } finally {
    await rm(temporary,{force:true}).catch(()=>{});
  }
}

export function serializeByKey() {
  const operations = new Map();
  return (key,work)=>{
    const operation = (operations.get(key) || Promise.resolve()).catch(()=>{}).then(work);
    operations.set(key,operation);
    const settle = ()=>{
      if (operations.get(key) === operation) operations.delete(key);
    };
    void operation.then(settle,settle);
    return operation;
  };
}
