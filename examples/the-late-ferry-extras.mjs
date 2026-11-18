import { readFile } from 'node:fs/promises';
import { artworkImageByteLimit, isArtworkId } from '../artwork-store.mjs';
import { readBoundedFile } from '../data-store-files.mjs';
import { starterStoryId } from '../public/library.js';

const artworkDirectory = new URL('./the-late-ferry-art/',import.meta.url);
const shelfPath = new URL('shelf.json',artworkDirectory);
const historyPath = new URL('./the-late-ferry-history.json',import.meta.url);
const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};

async function readFixture(path) {
  try {
    return JSON.parse(await readFile(path,'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function listStarterArtwork() {
  const shelf = await readFixture(shelfPath);
  return shelf?.version === 1 && shelf.storyId === starterStoryId && Array.isArray(shelf.entries) ? shelf.entries : [];
}

export async function readStarterArtwork(id) {
  if (!isArtworkId(id)) return null;
  const entry = (await listStarterArtwork()).find(item=>item.id === id);
  if (!entry || !Object.hasOwn(extensions,entry.mime) || !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength <= 0 || entry.byteLength > artworkImageByteLimit) return null;
  const file = new URL(`${id}.${extensions[entry.mime]}`,artworkDirectory);
  try {
    const bytes = await readBoundedFile(file,entry.byteLength,()=>new Error('Invalid bundled artwork file.'));
    return bytes.length === entry.byteLength ? {mime:entry.mime,bytes} : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function listStarterVersions() {
  const history = await readFixture(historyPath) || [];
  return history.map(({id,parentId = null,label,createdAt,restoredFrom})=>({id,parentId,label,createdAt,restoredFrom}));
}

export async function readStarterVersion(id) {
  const history = await readFixture(historyPath) || [];
  return history.find(entry=>entry.id === id)?.snapshot;
}
