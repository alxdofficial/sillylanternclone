const nameCharacter = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]';

export function createDisplayNameMatcher(entries) {
  const names = new Map(entries);
  if (!names.size) return null;
  const alternatives = [...names.keys()].sort((left,right) => right.length - left.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const pattern = new RegExp(`(?<!${nameCharacter})(?:${alternatives.join('|')})(?!${nameCharacter})`,'gu');
  return (text,onReplacement) => text.replace(pattern,(original,offset) => {
    const display = names.get(original);
    onReplacement?.(offset,original.length,display.length);
    return display;
  });
}
