import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, checkedDirectory, readBoundedFile, serializeByKey } from './data-store-files.mjs';

export const artworkImageByteLimit = 20_000_000;
export const artworkArchiveByteLimit = 128_000_000;

const manifestByteLimit = 12_000_000;
const artworkStoryByteLimit = 320_000_000;
const maxEntries = 400;
const maxBatch = 12;
const validKinds = new Set(['reference','illustration','comic']);
const subjectKinds = new Set(['character','location','object']);
const statuses = new Set(['pending','approved']);
const extensions = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);

export const isArtworkId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);

function fail(status,code,message) {
  return Object.assign(new Error(message),{status,code,diagnosticCode:code});
}

function text(value,limit) {
  return typeof value === 'string' && value.length <= limit && Boolean(value.trim());
}

function validTurn(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function only(value,keys) {
  return record(value) && Object.keys(value).every(key=>keys.includes(key));
}

function invalidItem() {
  return fail(400,'ARTWORK_INVALID_METADATA','Check the artwork details and try again.');
}

function cleanSource(source) {
  if (source === undefined) return undefined;
  if (!only(source,['scene','canonKey','referenceKey']) ||
    source.canonKey !== undefined && !text(source.canonKey,200) ||
    source.referenceKey !== undefined && !text(source.referenceKey,200)) throw invalidItem();
  const {scene,canonKey,referenceKey} = source;
  if (scene !== undefined && (!only(scene,['turn','fingerprint','start','end']) ||
    !validTurn(scene.turn) || !text(scene.fingerprint,200) ||
    scene.start !== undefined && (!Number.isSafeInteger(scene.start) || scene.start < 0) ||
    scene.end !== undefined && (!Number.isSafeInteger(scene.end) || scene.end <= (scene.start ?? -1)) ||
    (scene.start === undefined) !== (scene.end === undefined))) throw invalidItem();
  return {
    ...(scene && {scene:{turn:scene.turn,fingerprint:scene.fingerprint,
      ...(scene.start !== undefined && {start:scene.start,end:scene.end})}}),
    ...(canonKey !== undefined && {canonKey}),
    ...(referenceKey !== undefined && {referenceKey})
  };
}

function cleanDetails(item) {
  if (!record(item) || !validKinds.has(item.kind) || !text(item.label,160) || !text(item.prompt,20_000) ||
    typeof item.mime !== 'string' || !Object.hasOwn(extensions,item.mime) ||
    (item.subject !== undefined && (!only(item.subject,['kind','name']) ||
      !subjectKinds.has(item.subject.kind) || !text(item.subject.name,300))) ||
    (item.references !== undefined && (!Array.isArray(item.references) ||
      item.references.length > maxBatch || !item.references.every(isArtworkId) ||
      new Set(item.references).size !== item.references.length))) throw invalidItem();
  const source = cleanSource(item.source);
  return {
    kind:item.kind,
    label:item.label.trim(),
    prompt:item.prompt.trim(),
    mime:item.mime,
    ...(item.subject && {subject:{kind:item.subject.kind,name:item.subject.name.trim()}}),
    ...(source && {source}),
    references:item.references?.slice() || []
  };
}

const dimensionsFit = (width,height) => width > 0 && height > 0 && width * height <= 64_000_000;

function isJpeg(bytes) {
  if (bytes.length < 13 || bytes[0] !== 255 || bytes[1] !== 216 ||
    bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    if (offset + 3 >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) {
      return length >= 8 && dimensionsFit(bytes.readUInt16BE(offset + 5),bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  return false;
}

function isWebp(bytes) {
  if (bytes.length < 25 || bytes.toString('ascii',0,4) !== 'RIFF' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString('ascii',8,12) !== 'WEBP') return false;
  switch (bytes.toString('ascii',12,16)) {
    case 'VP8 ':
      return bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42 &&
        dimensionsFit(bytes.readUInt16LE(26) & 16383,bytes.readUInt16LE(28) & 16383);
    case 'VP8L': {
      const bits = bytes.readUInt32LE(21);
      return bytes[20] === 47 && dimensionsFit((bits & 16383) + 1,((bits >>> 14) & 16383) + 1);
    }
    case 'VP8X':
      return bytes.length >= 30 && dimensionsFit(bytes.readUIntLE(24,3) + 1,bytes.readUIntLE(27,3) + 1);
    default:
      return false;
  }
}

function assertImage(bytes,mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
    throw fail(400,'ARTWORK_INVALID_IMAGE','An artwork file is empty or has an unsupported format.');
  }
  if (bytes.byteLength > artworkImageByteLimit) throw fail(413,'ARTWORK_IMAGE_TOO_LARGE','An artwork file exceeds 20 MB.');
  const data = Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let recognized = false;
  if (mime === 'image/png') {
    recognized = data.length >= 45 && data.subarray(0,8).equals(pngSignature) &&
      data.readUInt32BE(8) === 13 && data.toString('ascii',12,16) === 'IHDR' &&
      dimensionsFit(data.readUInt32BE(16),data.readUInt32BE(20)) &&
      data.toString('ascii',data.length-8,data.length-4) === 'IEND';
  } else if (mime === 'image/jpeg') {
    recognized = isJpeg(data);
  } else if (mime === 'image/webp') {
    recognized = isWebp(data);
  }
  if (!recognized) throw fail(400,'ARTWORK_INVALID_IMAGE','The artwork bytes do not match the selected image format.');
}

function readEntry(entry) {
  if (!record(entry) || !isArtworkId(entry.id) || !statuses.has(entry.status) ||
    !text(entry.createdAt,40) || !Number.isFinite(Date.parse(entry.createdAt)) ||
    !Number.isSafeInteger(entry.byteLength) || entry.byteLength <= 0 || entry.byteLength > artworkImageByteLimit ||
    entry.placedTurn !== undefined && (!validTurn(entry.placedTurn) || entry.status !== 'approved')) {
    throw invalidItem();
  }
  return {...cleanDetails(entry),id:entry.id,createdAt:entry.createdAt,status:entry.status,byteLength:entry.byteLength,
    ...(entry.placedTurn !== undefined && {placedTurn:entry.placedTurn})};
}

function keyForStory(storyId) {
  if (!text(storyId,4096)) throw fail(400,'ARTWORK_INVALID_STORY','Choose a story for this artwork.');
  return createHash('sha256').update(storyId).digest('hex');
}

function assetName(entry) {
  return `${entry.id}.${extensions[entry.mime]}`;
}

function corrupt() {
  return fail(500,'ARTWORK_STORAGE_INVALID','Story Studio could not read the artwork storage.');
}

const encodeManifest = (storyId,entries) => Buffer.from(JSON.stringify({version:1,storyId,entries}));

export function createArtworkStore(dataDir) {
  const root = resolve(dataDir,'artwork');
  const serialize = serializeByKey();

  // Serialize per story so generation, approval and archival see complete batches.
  function access(storyId,work) {
    const key = keyForStory(storyId), directory = join(root,key);
    return serialize(key,()=>work({key,directory}));
  }

  async function readManifest(storyId,directory) {
    if (!await checkedDirectory(root,false,corrupt) || !await checkedDirectory(directory,false,corrupt)) return [];
    let data;
    try {
      data = await readBoundedFile(join(directory,'manifest.json'),manifestByteLimit,corrupt);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    try {
      const saved = JSON.parse(data.toString('utf8'));
      if (!record(saved) || saved.version !== 1 || saved.storyId !== storyId ||
        !Array.isArray(saved.entries) || saved.entries.length > maxEntries) throw corrupt();
      const entries = saved.entries.map(readEntry);
      if (new Set(entries.map(entry=>entry.id)).size !== entries.length ||
        entries.reduce((sum,entry)=>sum+entry.byteLength,0) > artworkStoryByteLimit) throw corrupt();
      return entries;
    } catch {
      throw corrupt();
    }
  }

  async function saveManifest(storyId,directory,entries) {
    const bytes = encodeManifest(storyId,entries);
    if (bytes.length > manifestByteLimit) throw fail(413,'ARTWORK_STORAGE_FULL','This story has reached its artwork metadata limit.');
    await atomicWrite(directory,'manifest.json',bytes);
  }

  async function readImage(directory,entry) {
    const bytes = await readBoundedFile(join(directory,assetName(entry)),entry.byteLength,corrupt);
    if (bytes.length !== entry.byteLength) throw corrupt();
    try { assertImage(bytes,entry.mime); } catch { throw corrupt(); }
    return {mime:entry.mime,bytes};
  }

  async function list(storyId) {
    return access(storyId,({directory})=>readManifest(storyId,directory));
  }

  async function put(storyId,items) {
    if (!Array.isArray(items) || !items.length || items.length > maxBatch) throw invalidItem();
    // Take ownership of bytes before waiting for preceding operations.
    const createdAt = new Date().toISOString();
    const batch = items.map(item=>{
      const details = cleanDetails(item), id = item.id ?? randomUUID();
      if (!isArtworkId(id)) throw invalidItem();
      assertImage(item.bytes,details.mime);
      const bytes = Buffer.from(item.bytes);
      return {entry:{...details,id,createdAt,status:'pending',byteLength:bytes.length},bytes};
    });
    return access(storyId,async ({directory})=>{
      const entries = await readManifest(storyId,directory);
      const existingIds = new Set(entries.map(entry=>entry.id));
      let total = entries.reduce((sum,entry)=>sum+entry.byteLength,0);
      if (entries.length + batch.length > maxEntries) throw fail(413,'ARTWORK_STORAGE_FULL','This story has reached its artwork storage limit.');
      for (const {entry} of batch) {
        if (existingIds.has(entry.id)) throw fail(409,'ARTWORK_DUPLICATE_ID','This artwork ID is already stored.');
        if (entry.references.some(reference=>!existingIds.has(reference))) {
          throw fail(400,'ARTWORK_REFERENCE_MISSING','An artwork reference does not belong to this story or is no longer available.');
        }
        existingIds.add(entry.id);
        total += entry.byteLength;
        if (total > artworkStoryByteLimit) throw fail(413,'ARTWORK_STORAGE_FULL','This story has reached its artwork storage limit.');
      }
      await checkedDirectory(root,true,corrupt);
      await checkedDirectory(directory,true,corrupt);
      const written = [];
      try {
        for (const {entry,bytes} of batch) {
          const name = assetName(entry);
          await atomicWrite(directory,name,bytes);
          written.push(name);
        }
        const added = batch.map(({entry})=>entry);
        await saveManifest(storyId,directory,[...entries,...added]);
        return added;
      } catch (error) {
        await Promise.allSettled(written.map(name=>rm(join(directory,name),{force:true})));
        throw error;
      }
    });
  }

  async function update(storyId,id,change) {
    if (!isArtworkId(id) || !only(change,['action','turn']) ||
      !['approve','discard','place','unplace'].includes(change.action) ||
      (change.action === 'place' ? !validTurn(change.turn) : change.turn !== undefined)) throw invalidItem();
    return access(storyId,async ({directory})=>{
      const entries = await readManifest(storyId,directory);
      const index = entries.findIndex(item=>item.id === id);
      if (index < 0) return null;
      const item = entries[index];
      if (change.action === 'discard') {
        entries.splice(index,1);
        await saveManifest(storyId,directory,entries);
        await rm(join(directory,assetName(item)),{force:true});
        return {id,discarded:true};
      }
      if (change.action === 'approve' || change.action === 'place') item.status = 'approved';
      if (change.action === 'place') item.placedTurn = change.turn;
      if (change.action === 'unplace') delete item.placedTurn;
      await saveManifest(storyId,directory,entries);
      return item;
    });
  }

  async function file(storyId,id) {
    if (!isArtworkId(id)) return null;
    return access(storyId,async ({directory})=>{
      const entries = await readManifest(storyId,directory);
      const item = entries.find(entry=>entry.id === id);
      return item ? readImage(directory,item) : null;
    });
  }

  async function archive(storyIds,{maxBytes = artworkArchiveByteLimit} = {}) {
    const files = {};
    let size = 0;
    const reserve = amount=>{
      size += amount;
      if (size > maxBytes) throw fail(413,'ARTWORK_ARCHIVE_TOO_LARGE','Artwork exceeds the ZIP export limit. Copy the Studio data directory to back up the full library.');
    };
    for (const storyId of new Set(storyIds)) {
      await access(storyId,async ({key,directory})=>{
        const entries = await readManifest(storyId,directory);
        if (!entries.length) return;
        const manifest = encodeManifest(storyId,entries);
        reserve(manifest.length + entries.reduce((sum,entry)=>sum+entry.byteLength,0));
        const prefix = `artwork/${key}/`;
        files[prefix + 'manifest.json'] = manifest;
        for (const entry of entries) files[prefix + assetName(entry)] = (await readImage(directory,entry)).bytes;
      });
    }
    return files;
  }

  return {list,put,update,file,archive};
}
