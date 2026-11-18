import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { libraryByteLimit } from './public/library.js';
import { atomicWrite, checkedDirectory, readBoundedFile, serializeByKey } from './data-store-files.mjs';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const indexByteLimit = 32_000_000;
const compressedByteLimit = libraryByteLimit + 65_536;
const archiveByteLimit = 128_000_000;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

const hash = value => createHash('sha256').update(value).digest('hex');
const recordObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const selectedLabel = value => typeof value === 'string' && value.length <= 120 && Boolean(value.trim());
const validVersionId = value => typeof value === 'string' && idPattern.test(value);

function fail(status,code,message) {
  return Object.assign(new Error(message),{status,code,diagnosticCode:code});
}

function corrupt() {
  return fail(500,'STORY_VERSION_STORAGE_INVALID','Story Studio could not read the saved story versions.');
}

function keyForStory(storyId) {
  if (typeof storyId !== 'string' || storyId.length > 4096 || !storyId.trim()) {
    throw fail(400,'STORY_VERSION_INVALID_STORY','Choose an existing story for this version.');
  }
  return hash(storyId);
}

function encodeProject(project) {
  if (!recordObject(project) || typeof project.title !== 'string' || !Array.isArray(project.messages)) {
    throw fail(400,'STORY_VERSION_INVALID_SNAPSHOT','Choose a complete story to save a version.');
  }
  // Story versions retain unknown story fields and array order. A different object-key order alone is not an edit.
  const contents = Buffer.from(JSON.stringify(project,(_,value)=>recordObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]]))
    : value));
  if (contents.length > libraryByteLimit) {
    throw fail(413,'STORY_VERSION_SNAPSHOT_TOO_LARGE','This story exceeds the version snapshot size limit.');
  }
  return contents;
}

function decodeEntries(data,storyId) {
  const stored = JSON.parse(data.toString('utf8'));
  if (!recordObject(stored) || stored.version !== 1 || stored.storyId !== storyId || !Array.isArray(stored.entries)) {
    throw corrupt();
  }
  const ids = new Set();
  let previous = null;
  for (const entry of stored.entries) {
    if (!recordObject(entry) || !validVersionId(entry.id) || ids.has(entry.id) || entry.parentId !== previous ||
      typeof entry.digest !== 'string' || !digestPattern.test(entry.digest) ||
      typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) ||
      !selectedLabel(entry.label) || entry.restoredFrom !== undefined && !ids.has(entry.restoredFrom)) {
      throw corrupt();
    }
    ids.add(entry.id);
    previous = entry.id;
  }
  return stored.entries;
}

function metadata({id,parentId,createdAt,label,restoredFrom}) {
  return {id,parentId,createdAt,label,...(restoredFrom !== undefined && {restoredFrom})};
}

export function createStoryVersions(dataDir) {
  const root = resolve(dataDir,'story-versions');
  const serialize = serializeByKey();

  function access(storyId,work) {
    const key = keyForStory(storyId), directory = join(root,key);
    return serialize(key,()=>work(directory));
  }

  async function readManifest(directory,storyId) {
    if (!await checkedDirectory(root,false,corrupt) || !await checkedDirectory(directory,false,corrupt)) return [];
    try {
      const data = await readBoundedFile(join(directory,'manifest.json'),indexByteLimit,corrupt);
      return decodeEntries(data,storyId);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw corrupt();
    }
  }

  async function list(storyId) {
    return access(storyId,async directory=>(await readManifest(directory,storyId)).reverse().map(metadata));
  }

  async function get(storyId,versionId) {
    if (!validVersionId(versionId)) return null;
    return access(storyId,async directory=>{
      const entry = (await readManifest(directory,storyId)).find(item=>item.id === versionId);
      if (!entry) return null;
      try {
        const snapshots = join(directory,'snapshots');
        if (!await checkedDirectory(snapshots,false,corrupt)) throw corrupt();
        const compressed = await readBoundedFile(join(snapshots,entry.digest + '.json.gz'),compressedByteLimit,corrupt);
        const contents = await gunzipAsync(compressed,{maxOutputLength:libraryByteLimit});
        if (hash(contents) !== entry.digest) throw corrupt();
        const story = JSON.parse(contents.toString('utf8'));
        if (!recordObject(story) || story.id !== storyId || !Array.isArray(story.messages)) throw corrupt();
        return story;
      } catch {
        throw corrupt();
      }
    });
  }

  async function record(project,{label = 'Saved version',restoredFrom} = {}) {
    if (!selectedLabel(label) || restoredFrom !== undefined && !validVersionId(restoredFrom)) {
      throw fail(400,'STORY_VERSION_INVALID_DETAILS','Check the version label and restore source.');
    }
    const contents = encodeProject(project);
    const digest = hash(contents), storyId = project.id;
    return access(storyId,async directory=>{
      const entries = await readManifest(directory,storyId);
      if (restoredFrom !== undefined && !entries.some(entry=>entry.id === restoredFrom)) {
        throw fail(400,'STORY_VERSION_INVALID_RESTORE','The restored version does not belong to this story.');
      }
      const previous = entries.at(-1);
      if (previous?.digest === digest) return metadata(previous);
      const entry = {id:randomUUID(),parentId:previous?.id || null,digest,createdAt:new Date().toISOString(),
        label:label.trim(),...(restoredFrom !== undefined && {restoredFrom})};
      const manifest = Buffer.from(JSON.stringify({version:1,storyId,entries:[...entries,entry]}));
      if (manifest.length > indexByteLimit) {
        throw fail(413,'STORY_VERSION_INDEX_TOO_LARGE','This story has reached its version history limit.');
      }
      await checkedDirectory(root,true,corrupt);
      await checkedDirectory(directory,true,corrupt);
      const snapshots = join(directory,'snapshots');
      await checkedDirectory(snapshots,true,corrupt);
      if (!entries.some(previous=>previous.digest === digest)) {
        await atomicWrite(snapshots,digest + '.json.gz',await gzipAsync(contents));
      }
      await atomicWrite(directory,'manifest.json',manifest);
      return metadata(entry);
    });
  }

  async function archive(storyIds) {
    const files = {};
    let bytes = 0;
    const include = (name,contents)=>{
      bytes += contents.length;
      if (bytes > archiveByteLimit) {
        throw fail(413,'STORY_VERSION_ARCHIVE_TOO_LARGE','The version history is too large for a browser export. Copy the Studio data folder to back it up.');
      }
      files[name] = contents;
    };
    for (const storyId of new Set(storyIds)) {
      await access(storyId,async directory=>{
        const entries = await readManifest(directory,storyId);
        if (!entries.length) return;
        const folder = `story-versions/${keyForStory(storyId)}`;
        include(`${folder}/manifest.json`,Buffer.from(JSON.stringify({version:1,storyId,entries})));
        const snapshots = join(directory,'snapshots');
        if (!await checkedDirectory(snapshots,false,corrupt)) throw corrupt();
        for (const digest of new Set(entries.map(entry=>entry.digest))) {
          const filename = `${digest}.json.gz`;
          include(`${folder}/snapshots/${filename}`,await readBoundedFile(join(snapshots,filename),compressedByteLimit,corrupt));
        }
      });
    }
    return files;
  }

  return {list,get,record,archive};
}
