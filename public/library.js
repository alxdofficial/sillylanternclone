// The starter is attached to the live library in memory and kept out of backups.
export const starterStoryId = 'story-studio-starter-demo';
export const maxLibraryStories = 100;

export function withoutStarter(library) {
  const projects = library.projects.filter(project => project.id !== starterStoryId);
  const activeId = projects.some(project => project.id === library.activeId) ? library.activeId : projects[0]?.id || '';
  return {...library,activeId,projects};
}
