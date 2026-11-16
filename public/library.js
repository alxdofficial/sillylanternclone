// The starter is attached to the live library in memory and kept out of backups.
export const starterStoryId = 'story-studio-starter-demo';
export const libraryByteLimit = 16_000_000;
export const maxLibraryStories = 100;

export function withoutStarter(library) {
  const projects = library.projects.filter(project => project.id !== starterStoryId);
  const activeId = projects.some(project => project.id === library.activeId) ? library.activeId : projects[0]?.id || '';
  return {...library,activeId,projects};
}

export function bookChapters(messages) {
  const chapters = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.content.trim()) continue;
    if (!chapters.length || message.startsChapter) chapters.push([]);
    chapters.at(-1).push(message.content);
  }
  return chapters;
}

export function bookMarkdown(title, chapters, first, last) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > last || last > chapters.length) {
    throw new RangeError('Choose an existing chapter range.');
  }
  const heading = title.replace(/\s+/gu, ' ').trim().replace(/[\\`*_\[\]<>#&]/gu, '\\$&');
  const selected = chapters.slice(first - 1,last).map((excerpts,index) =>
    [`## Chapter ${first + index}`, ...excerpts].join('\n\n'));
  return [`# ${heading || 'Untitled story'}`, ...selected].join('\n\n') + '\n';
}
